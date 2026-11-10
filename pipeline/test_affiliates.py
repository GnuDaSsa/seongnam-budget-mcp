"""Network-free regressions for public ingestion bounds and source locators."""
import unittest
import contextlib
import io
import json
import tempfile
from pathlib import Path
from unittest.mock import patch
import pymupdf
import collect_affiliates as collector
from collect_affiliates import checked_url, robots_allowed, parse_pdf


class AffiliateIngestionTests(unittest.TestCase):
    def test_source_cannot_escape_reviewed_host(self):
        for url in ['http://www.snyouth.or.kr/a', 'https://www.snyouth.or.kr.evil.test/a',
                    'https://user:password@www.snyouth.or.kr/a', 'https://www.snyouth.or.kr:444/a']:
            with self.assertRaises(ValueError):
                checked_url(url, ['www.snyouth.or.kr'])

    def test_robots_wildcards_and_other_user_agents(self):
        rules = 'User-agent: Googlebot\n\nDisallow: /\n\nUser-agent: *\n\nDisallow: /admin/\nDisallow: /*?*\n'
        self.assertTrue(robots_allowed(rules, 'https://www.snyouth.or.kr/File/Download/abcd'))
        self.assertFalse(robots_allowed(rules, 'https://www.snyouth.or.kr/fmcs/284?page=2'))
        self.assertFalse(robots_allowed(rules, 'https://www.snyouth.or.kr/admin/index'))
        self.assertFalse(robots_allowed('User-agent: *\nDisallow: /', 'https://www.snip.or.kr/a'))

    def test_real_pdf_locator_survives_skipped_blank_page(self):
        with pymupdf.open() as d:
            d.new_page()
            d.new_page().insert_text((30, 40), 'Public budget source with enough searchable text and amount 1234.')
            count, pages = parse_pdf(d.tobytes())
        self.assertEqual(count, 2)
        self.assertEqual([p['page'] for p in pages], [2])
        self.assertIsNone(pages[0]['unit'])

    def test_error_page_is_never_indexed(self):
        with self.assertRaises(ValueError):
            parse_pdf(b'<html>Login required</html>')

    def test_cached_run_reports_whole_scan_pages_and_preserves_verified_fallback(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            raw, out = root / 'data' / 'affiliates', root / 'snapshot' / 'affiliates'
            raw.mkdir(parents=True)
            out.mkdir(parents=True)
            (root / 'pipeline').mkdir()
            sources = [{'institution_id': 'example', 'url': 'https://example.test/' + name + '.pdf',
                'source_page': 'https://example.test/disclosure', 'title': name, 'year': 2026,
                'budget_type': '본예산', 'detail_level': 'budget_summary', 'document_stage': 'proposal'}
                for name in ['text-budget', 'scan-budget']]
            config = {'roster_source': 'https://example.test/roster', 'roster_note': 'Fixture roster',
                'institutions': [{'id': 'example', 'name': 'Example institution', 'hosts': ['example.test']}],
                'sources': sources}
            (root / 'pipeline' / 'affiliate-sources.json').write_text(json.dumps(config), encoding='utf-8')
            city_asset = {'path': 'corpus/city.json.gz', 'bytes': 10, 'sha256': 'untouched'}
            (root / 'snapshot' / 'assets.json').write_text(json.dumps({'files': [city_asset]}), encoding='utf-8')
            (raw / 'example.test-robots.json').write_text(json.dumps({'status': 404, 'text': ''}), encoding='utf-8')
            with pymupdf.open() as d:
                d.new_page().insert_text((30, 40), 'Published budget with enough searchable original text and amount 1234.')
                text_pdf = d.tobytes()
            with pymupdf.open() as d:
                d.new_page()
                d.new_page()
                scan_pdf = d.tobytes()
            ids = [collector.sha(s['url'].encode())[:20] for s in sources]
            for identifier, payload in zip(ids, [text_pdf, scan_pdf]):
                (raw / (identifier + '.pdf')).write_bytes(payload)
            with patch.multiple(collector, ROOT=root, RAW=raw, OUT=out), \
                    patch.object(collector, 'download', side_effect=AssertionError('Network forbidden')) as network, \
                    contextlib.redirect_stdout(io.StringIO()):
                collector.run(cached=True)
                catalog = json.loads((out / 'catalog.json').read_text(encoding='utf-8'))
                self.assertEqual(catalog['summary']['indexed_documents'], 1)
                self.assertEqual(catalog['summary']['unindexed_pdf_pages'], 0)
                self.assertEqual(catalog['summary']['ocr_required_documents'], 1)
                self.assertEqual(catalog['summary']['ocr_required_pdf_pages'], 2)
                failure = catalog['unavailable_documents'][0]
                self.assertEqual(failure['url'], sources[1]['url'])
                self.assertEqual(failure['source_page'], sources[1]['source_page'])
                self.assertEqual(failure['document_stage'], 'proposal')
                self.assertEqual(failure['status'], 'not_indexed')
                self.assertEqual(failure['extraction_status'], 'ocr_required')
                self.assertEqual(failure['page_count'], 2)
                self.assertEqual(failure['indexed_pages'], 0)
                self.assertEqual(failure['sha256'], collector.sha(scan_pdf))
                self.assertFalse((out / (ids[1] + '.json.gz')).exists())
                self.assertEqual(catalog['institutions'][0]['indexed_documents'], 1)
                manifest = json.loads((root / 'snapshot' / 'assets.json').read_text(encoding='utf-8'))
                self.assertEqual(manifest['files'][0], city_asset)
                self.assertEqual(len(manifest['files']), 2)
                # A later scan-only version must not discard the previous searchable snapshot
                # or count that same document as wholly unindexed OCR work.
                (raw / (ids[0] + '.pdf')).write_bytes(scan_pdf)
                collector.run(cached=True)
                refreshed = json.loads((out / 'catalog.json').read_text(encoding='utf-8'))
                self.assertEqual(refreshed['documents'][0]['refresh_status'], 'failed_using_previous_snapshot')
                self.assertEqual(refreshed['documents'][0]['sha256'], collector.sha(text_pdf))
                self.assertEqual(refreshed['summary']['indexed_documents'], 1)
                self.assertEqual(refreshed['summary']['ocr_required_documents'], 1)
                self.assertEqual(refreshed['summary']['ocr_required_pdf_pages'], 2)
                self.assertEqual(refreshed['summary']['failed_documents'], 2)
                network.assert_not_called()


if __name__ == '__main__':
    unittest.main()
