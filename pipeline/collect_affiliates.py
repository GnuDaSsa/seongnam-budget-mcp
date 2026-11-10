"""Collect reviewed public affiliate PDF URLs without changing the city corpus.

Sequential, bounded HTTPS downloads; no credentials, redirects, retries or TLS bypass.
The source registry is reviewed separately; this is not an unrestricted web crawler.
Run: python pipeline/collect_affiliates.py [--cached]
"""
import argparse
import gzip
import hashlib
import json
import re
import subprocess
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

import pymupdf

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'snapshot' / 'affiliates'
RAW = ROOT / 'data' / 'affiliates'
UA = 'SeongnamBudgetResearch/0.2'
MAX_BYTES = 30_000_000


class OCRRequired(ValueError):
    def __init__(self, page_count):
        super().__init__('No searchable text; OCR required')
        self.page_count = page_count


def sha(data):
    return hashlib.sha256(data).hexdigest()


def checked_url(url, hosts):
    p = urlsplit(url)
    if p.scheme != 'https' or p.hostname not in hosts or p.username or p.password or p.port not in (None, 443):
        raise ValueError('Unapproved public HTTPS source')
    return p


def download(url):
    # Standard certificate verification remains enabled. Never follow redirects
    # outside the reviewed source; no rename batches or automatic retries.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            return None
    request = urllib.request.Request(url, headers={'User-Agent': UA})
    try:
        with urllib.request.build_opener(NoRedirect()).open(request, timeout=40) as response:
            body = response.read(MAX_BYTES + 1)
            if len(body) > MAX_BYTES:
                raise ValueError('Public file exceeds size limit')
            return response.status, body
    except urllib.error.HTTPError as exc:
        return exc.code, b''


def robots_allowed(text, url):
    # Longest matching rule wins; Allow wins ties. Preserve wildcard query rules
    # and sites with CRCRLF blank lines between every directive.
    groups, agents, rules = [], [], []
    for line in text.splitlines():
        key, sep, value = line.split('#', 1)[0].partition(':')
        if not sep:
            continue
        key, value = key.strip().lower(), value.strip()
        if key == 'user-agent':
            if rules:
                groups.append((agents, rules))
                agents, rules = [], []
            agents.append(value.lower())
        elif key in ('allow', 'disallow') and agents and value:
            rules.append((key, value))
    groups.append((agents, rules))
    applicable = [(max((len(a) if a != '*' else 0) for a in agents if a == '*' or a in UA.lower()), rules)
                  for agents, rules in groups if any(a == '*' or a in UA.lower() for a in agents)]
    if not applicable:
        return True
    specificity = max(rank for rank, _ in applicable)
    target = urlsplit(url).path + ('?' + urlsplit(url).query if urlsplit(url).query else '')
    matches = []
    for rank, rules in applicable:
        if rank != specificity:
            continue
        for key, value in rules:
            pattern = '^' + re.escape(value).replace(r'\*', '.*').replace(r'\$', '$')
            if re.search(pattern, target):
                matches.append((len(value.replace('*', '')), key == 'allow'))
    return max(matches)[1] if matches else True


def parse_pdf(payload):
    if not payload.startswith(b'%PDF'):
        raise ValueError('Not a PDF; login/error/other format must be reviewed')
    with pymupdf.open(stream=payload, filetype='pdf') as doc:
        if doc.needs_pass or not doc.page_count:
            raise ValueError('Encrypted or portfolio-only PDF needs separate review')
        if doc.page_count > 2000:
            raise ValueError('PDF page limit')
        pages = []
        for number, page in enumerate(doc, 1):
            text = page.get_text('text', sort=True).replace('\x00', '').strip()
            if len(re.sub(r'\s', '', text)) < 30:
                continue
            units = []
            for label in re.findall(r'단위\s*[:：]\s*([^\n)\]]{1,50})', text):
                for value in re.findall(r'(?<![가-힣])(?:백\s*만\s*원|천\s*원|억\s*원|원)(?![가-힣])', label):
                    value = re.sub(r'\s', '', value)
                    if value not in units:
                        units.append(value)
            printed = re.findall(r'(?:^|\n)\s*[-－]\s*(\d+)\s*[-－]\s*(?:$|\n)', text)
            pages.append({'page': number, 'text': text, 'unit': ' / '.join(units) or None,
                'printed_page': printed[-1] if printed else None, 'text_hash': sha(text.encode())})
        return doc.page_count, pages


def run(cached=False):
    config = json.loads((ROOT / 'pipeline' / 'affiliate-sources.json').read_text(encoding='utf-8'))
    institutions = {i['id']: i for i in config['institutions']}
    OUT.mkdir(parents=True, exist_ok=True)
    RAW.mkdir(parents=True, exist_ok=True)
    previous = {}
    if (OUT / 'catalog.json').exists():
        old = json.loads((OUT / 'catalog.json').read_text(encoding='utf-8'))
        previous = {d['id']: d for d in old.get('documents', [])}
    robots = {}
    docs, failures = [], []
    for source in config['sources']:
        institution = institutions[source['institution_id']]
        identifier = sha(source['url'].encode())[:20]
        try:
            parsed = checked_url(source['url'], institution['hosts'])
            origin = 'https://' + parsed.netloc
            robot_path = RAW / (parsed.hostname + '-robots.json')
            if origin not in robots:
                if cached and robot_path.exists():
                    robots[origin] = json.loads(robot_path.read_text(encoding='utf-8'))
                else:
                    status, data = download(origin + '/robots.txt')
                    if status not in (200, 404):
                        raise ValueError('robots.txt not available: HTTP %s' % status)
                    robots[origin] = {'status': status, 'text': data.decode('utf-8', errors='replace') if status == 200 else ''}
                    robot_path.write_text(json.dumps(robots[origin]), encoding='utf-8')
            if not robots_allowed(robots[origin]['text'], source['url']):
                raise ValueError('Source robots.txt disallows this URL')
            path = RAW / (identifier + '.pdf')
            if path.exists():
                if path.stat().st_size > MAX_BYTES:
                    raise ValueError('Cached public file exceeds size limit')
                payload = path.read_bytes()
            elif cached:
                raise ValueError('Cached source unavailable')
            else:
                time.sleep(0.5)
                status, payload = download(source['url'])
                if status != 200:
                    raise ValueError('Public download HTTP %s; redirects are not followed' % status)
                if not payload.startswith(b'%PDF'):
                    raise ValueError('Public endpoint did not return PDF')
                path.write_bytes(payload)
            if source.get('expected_sha256') and sha(payload) != source['expected_sha256']:
                raise ValueError('Source content changed; review before indexing')
            page_count, pages = parse_pdf(payload)
            if not pages:
                raise OCRRequired(page_count)
            packed = gzip.compress(json.dumps({'pages': pages}, ensure_ascii=False, separators=(',', ':')).encode(), mtime=0)
            (OUT / (identifier + '.json.gz')).write_bytes(packed)
            d = {**source, 'id': identifier, 'title': institution['name'] + ' · ' + source['title'],
                'source_scope': 'affiliate', 'institution_name': institution['name'], 'revision': source.get('revision'),
                'account': source.get('account', '원문 확인'), 'category': '산하기관 ' + source['budget_type'],
                'sha256': sha(payload), 'bytes': len(payload), 'page_count': page_count, 'indexed_pages': len(pages),
                'status': 'indexed' if len(pages) == page_count else 'partial_ocr_required',
                'shard': identifier, 'shard_sha256': sha(packed), 'shard_bytes': len(packed)}
            docs.append(d)
            print(json.dumps({'institution': institution['id'], 'year': d['year'], 'pages': page_count, 'indexed': len(pages)}), flush=True)
        except (ValueError, OSError, subprocess.SubprocessError) as exc:
            failure = {**source, 'id': identifier, 'status': 'not_indexed', 'reason': str(exc)[:200]}
            if isinstance(exc, OCRRequired):
                failure.update({'extraction_status': 'ocr_required', 'page_count': exc.page_count,
                    'indexed_pages': 0, 'sha256': sha(payload), 'bytes': len(payload)})
            failures.append(failure)
            # Do not erase verified earlier snapshots on temporary source failures.
            # Keep both original provenance and an explicit refresh failure marker.
            old = previous.get(identifier)
            old_path = OUT / (identifier + '.json.gz')
            if old and old_path.exists():
                existing = old_path.read_bytes()
                if len(existing) == old['shard_bytes'] and sha(existing) == old['shard_sha256']:
                    docs.append({**old, 'refresh_status': 'failed_using_previous_snapshot',
                        'refresh_error': str(exc)[:200]})
            print(json.dumps({'institution': institution['id'], 'status': 'not_indexed', 'reason': str(exc)[:200]}), flush=True)
    for i in institutions.values():
        i['indexed_documents'] = sum(d['institution_id'] == i['id'] for d in docs)
        i['indexed_pages'] = sum(d['indexed_pages'] for d in docs if d['institution_id'] == i['id'])
        i.pop('hosts', None)
    indexed_ids = {d['id'] for d in docs}
    # A failed refresh can still have a verified searchable older snapshot.
    # Count wholly unindexed OCR documents separately from indexed-document gaps.
    ocr_required = {d['id']: d for d in failures
        if d.get('extraction_status') == 'ocr_required' and d['id'] not in indexed_ids}
    catalog = {'schema_version': 1, 'generated_at': datetime.now(timezone.utc).isoformat(),
        'roster_source': config['roster_source'], 'roster_note': config['roster_note'],
        'institutions': list(institutions.values()), 'documents': docs, 'unavailable_documents': failures,
        'summary': {'documents': len(docs), 'indexed_documents': len(docs),
            'indexed_pages': sum(d['indexed_pages'] for d in docs), 'coverage_complete': False,
            'unindexed_pdf_pages': sum(d['page_count'] - d['indexed_pages'] for d in docs),
            'ocr_required_documents': len(ocr_required),
            'ocr_required_pdf_pages': sum(d['page_count'] for d in ocr_required.values()),
            'failed_documents': len(failures), 'retrieval': 'lexical',
            'note': '확인된 공개자료만 수록. 총괄표는 사업별 세부 예산서가 아니며 기관·연도별 누락이 있습니다.'}}
    (OUT / 'catalog.json').write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    manifest_path = ROOT / 'snapshot' / 'assets.json'
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    manifest['files'] = [f for f in manifest['files'] if not f['path'].startswith('affiliates/')] + [
        {'path': 'affiliates/' + d['shard'] + '.json.gz', 'bytes': d['shard_bytes'], 'sha256': d['shard_sha256']} for d in docs]
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(catalog['summary']), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--cached', action='store_true')
    run(parser.parse_args().cached)
