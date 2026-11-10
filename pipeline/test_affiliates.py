"""Network-free regressions for public ingestion bounds and source locators."""
import unittest
import pymupdf
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


if __name__ == '__main__':
    unittest.main()
