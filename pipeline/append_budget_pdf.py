"""Stage one newly published municipal PDF against a verified existing snapshot.

The output directory must be new. Publish from it only after release checks.
Existing document IDs, page offsets and trained cluster centres stay stable.
"""
import argparse
import gzip
import hashlib
import json
import shutil
import struct
import subprocess
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from build_snapshot import terms
from build_terms import bucket
from build_vectors import chunks, quantize
from collect import ROOT, parse_budget_index, parse_pdf


def digest(data):
    return hashlib.sha256(data).hexdigest()


def write_json(path, value, pretty=False):
    text = (json.dumps(value, ensure_ascii=False, indent=2) + '\n' if pretty else
            json.dumps(value, ensure_ascii=False, separators=(',', ':')))
    path.write_bytes(text.encode())


def read_json(path):
    return json.loads(path.read_bytes())


def pack(path, data):
    path.write_bytes(gzip.compress(data, compresslevel=6, mtime=0))


def packed_json(path, value):
    pack(path, json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode())


def add_pages(snapshot, catalog, doc, rows):
    corpus = snapshot / 'corpus'
    start = catalog['summary']['snapshot_units']
    postings = defaultdict(lambda: defaultdict(list))
    doc['shards'] = []
    for pos in range(0, len(rows), 1000):
        part = rows[pos:pos+1000]
        name = f"{doc['year']}-{doc['id']}-{pos//1000}"
        page_file = corpus / f'pages-{name}.json.gz'
        text_file = corpus / f'text-{name}.json.gz'
        if page_file.exists() or text_file.exists():
            raise ValueError('Shard name collision')
        pages, texts = [], []
        for index, (_, doc_id, page, text, sha, unit, printed) in enumerate(part):
            pages.append([doc_id, page, unit, printed, sha, len(text), None])
            texts.append(text)
            for word in terms(text):
                postings[bucket(word)][word].append(start+pos+index)
        packed_json(page_file, {'pages': pages})
        packed_json(text_file, texts)
        catalog['shards'].append({'id': name, 'year': doc['year'], 'offset': start+pos,
                                  'pages': len(part), 'index_bytes': page_file.stat().st_size,
                                  'text_bytes': text_file.stat().st_size})
        doc['shards'].append(name)
    for number, extra in postings.items():
        path = corpus / f'terms-{number:02x}.json.gz'
        old = json.loads(gzip.decompress(path.read_bytes()))
        for word in sorted(extra):
            old.setdefault(word, []).extend(extra[word])
        packed_json(path, old)
    return start


def extend_common_tokens(semantic, used, dimensions):
    path = semantic / 'common.bin.gz'
    data = gzip.decompress(path.read_bytes())
    count, = struct.unpack_from('<I', data)
    ids = np.frombuffer(data, '<u4', count, 4)
    new_ids = sorted(used.difference(ids.tolist()))
    if not new_ids:
        return count
    scales = list(np.frombuffer(data, '<f4', count, 4+4*count))
    vectors = list(np.frombuffer(data, 'i1', offset=4+8*count).reshape(count, dimensions))
    blocks = {}
    for token in new_ids:
        number = token // 2048
        if number not in blocks:
            block = gzip.decompress((semantic / f'tokens-{number}.bin.gz').read_bytes())
            first, length = struct.unpack_from('<II', block)
            blocks[number] = (first, np.frombuffer(block, '<f4', length, 8),
                              np.frombuffer(block, 'i1', offset=8+4*length).reshape(length, dimensions))
        first, block_scales, block_rows = blocks[number]
        scales.append(block_scales[token-first])
        vectors.append(block_rows[token-first])
    all_ids = np.array(ids.tolist()+new_ids, dtype='<u4')
    order = np.argsort(all_ids)
    pack(path, struct.pack('<I', len(all_ids)) + all_ids[order].tobytes()
         + np.asarray(scales, dtype='<f4')[order].tobytes() + np.asarray(vectors, dtype='i1')[order].tobytes())
    return len(all_ids)


def add_vectors(snapshot, manifest, doc_id, rows, start):
    semantic = snapshot / 'semantic'
    dim = manifest['dimensions']
    centers = np.frombuffer(gzip.decompress((semantic/'centroids.bin.gz').read_bytes()), '<f4').reshape(-1, dim)
    by_cluster = defaultdict(list)
    used = set()
    # Batch by page to keep the encoder input and JSON output bounded, sharing one model per batch.
    locations, texts = [], []
    def encode_batch():
        result = subprocess.run(['node', str(ROOT/'scripts/encode-budget-chunks.mjs'), str(snapshot)],
                                input=json.dumps(texts, ensure_ascii=False).encode(), stdout=subprocess.PIPE, check=True)
        encoded = json.loads(result.stdout)
        vectors = np.asarray(encoded['vectors'], dtype='<f4')
        if vectors.shape != (len(locations), dim):
            raise ValueError('Incomplete encoder output')
        used.update(encoded['used'])
        clusters = (vectors @ centers.T).argmax(axis=1)
        quantized, _ = quantize(vectors)
        for location, vector, cluster in zip(locations, quantized, clusters, strict=True):
            by_cluster[int(cluster)].append((location, vector.copy()))
        locations.clear()
        texts.clear()
    for index, row in enumerate(rows):
        for lo, hi, text in chunks(row[3], manifest['chunk_characters'], manifest['chunk_overlap']):
            locations.append((start+index, lo, hi))
            texts.append(text)
            if len(texts) >= 256:
                encode_batch()
    if texts:
        encode_batch()
    for number, added in by_cluster.items():
        path = semantic / f'cluster-{number}.bin.gz'
        data = gzip.decompress(path.read_bytes())
        n, = struct.unpack_from('<I', data)
        if n != manifest['clusters'][number] or len(data) != 4+(16+dim)*n:
            raise ValueError(f'Invalid IVF cluster {number}')
        added_locs = np.asarray([loc for loc, _ in added], dtype='<u4')
        added_rows = np.asarray([vec for _, vec in added], dtype='i1')
        added_norms = np.linalg.norm(added_rows.astype('f4'), axis=1).astype('<f4')
        pack(path, struct.pack('<I', n+len(added))
             + data[4:4+12*n] + added_locs.tobytes()
             + data[4+12*n:4+16*n] + added_norms.tobytes() + data[4+16*n:] + added_rows.tobytes())
        manifest['clusters'][number] += len(added)
    path = semantic / 'page-docs.bin.gz'
    old = gzip.decompress(path.read_bytes())
    doc_num = len(manifest['doc_ids'])
    if len(old) != start*2 or doc_num > 65535 or manifest['pages'] != start:
        raise ValueError('Semantic page map mismatch')
    pack(path, old + struct.pack('<H', doc_num)*len(rows))
    manifest['doc_ids'].append(doc_id)
    manifest['pages'] += len(rows)
    manifest['chunks'] += sum(len(additions) for additions in by_cluster.values())
    manifest['characters'] += sum(len(row[3]) for row in rows)
    manifest['used_tokens'] = extend_common_tokens(semantic, used, dim)
    manifest['assets_bytes'] = sum(p.stat().st_size for p in semantic.glob('*.gz'))


def update_summary(catalog, doc, snapshot, stamp):
    s = catalog['summary']
    s['generated_at'] = stamp
    for key in ('documents', 'downloaded_documents', 'indexed_documents', 'snapshot_documents'):
        s[key] += 1
    for key in ('snapshot_units', 'snapshot_pages', 'indexed_pages'):
        s[key] += doc['indexed_pages']
    s['pdf_pages'] += doc['page_count']
    s['unindexed_pdf_pages'] += doc['page_count'] - doc['indexed_pages']
    s['status_counts'][doc['status']] = s['status_counts'].get(doc['status'], 0) + 1
    for key in ('discovered', 'downloaded', 'indexed_documents'):
        s['category_stats'][doc['category']][key] += 1
    s['years'] = sorted(set(s['years']) | {doc['year']}, reverse=True)
    sizes = [p.stat().st_size for p in (snapshot/'corpus').glob('terms-*.json.gz')]
    s['snapshot_bytes'] = sum(sh['index_bytes']+sh['text_bytes'] for sh in catalog['shards']) + sum(sizes)
    s['max_term_bucket_bytes'] = max(sizes)


def stage(args):
    base = ROOT / 'snapshot'
    catalog = read_json(base/'catalog.json')
    data = args.pdf.read_bytes()
    sha = digest(data)
    if sha != args.sha256 or not data.startswith(b'%PDF-'):
        raise ValueError('PDF signature or SHA-256 mismatch')
    doc = parse_budget_index(args.source_index.read_bytes()).get(args.url)
    if not doc or not args.url.endswith('.pdf') or not doc['year']:
        raise ValueError('PDF absent from the supplied official annual budget index')
    existing = next((d for d in catalog['documents'] if d['id']==doc['id'] or d['url']==doc['url']), None)
    if existing:
        if (existing['url'] != doc['url'] or existing['sha256'] != sha or
                not existing.get('shards') or not existing.get('indexed_pages')):
            raise ValueError('Existing document needs replacement or re-indexing; use a full build')
        print(json.dumps({'already_indexed': True, 'id': doc['id']}))
        return
    count, rows = parse_pdf(data, doc['id'])
    if not rows:
        raise ValueError('No indexable text in the PDF')
    stamp = args.observed_at or datetime.now(timezone.utc).isoformat()
    if datetime.fromisoformat(stamp).tzinfo is None:
        raise ValueError('Observation time must include a timezone')
    output = args.output.resolve()
    if output == base or base in output.parents:
        raise ValueError('Staging directory must be outside the source snapshot')
    output.mkdir(parents=True, exist_ok=False)
    manifest = read_json(base/'semantic/manifest.json')
    if (digest((base/'catalog.json').read_bytes()) != manifest['corpus_catalog_sha256']
            or [d['id'] for d in catalog['documents']] != manifest['doc_ids']):
        raise ValueError('Catalog and semantic source differ')
    subprocess.run(['node', str(ROOT/'scripts/download-snapshot.mjs'), '--check'], cwd=ROOT, check=True)
    snapshot = output/'snapshot'
    shutil.copytree(base, snapshot)
    doc.update(discovered_at=stamp, fetched_at=stamp, sha256=sha, bytes=len(data), page_count=count,
               indexed_pages=len(rows), error=None, status='indexed' if len(rows)==count else 'partial_ocr_required')
    start = add_pages(snapshot, catalog, doc, rows)
    catalog['documents'].append(doc)
    update_summary(catalog, doc, snapshot, stamp)
    write_json(snapshot/'catalog.json', catalog)
    previous_chunks = manifest['chunks']
    add_vectors(snapshot, manifest, doc['id'], rows, start)
    manifest.update(corpus_catalog_sha256=digest((snapshot/'catalog.json').read_bytes()), generated_at=stamp)
    write_json(snapshot/'semantic/manifest.json', manifest, pretty=True)
    # Both can resolve their inputs from the staged snapshot via the working directory.
    code = "const {buildLexical}=await import(process.argv[1]); await buildLexical()"
    subprocess.run(['node','--input-type=module','-e',code,(ROOT/'scripts/build-lexical.mjs').as_uri()], cwd=output, check=True)
    subprocess.run(['node',str(ROOT/'scripts/build-departments.mjs')], cwd=output, check=True)
    assets = read_json(base/'assets.json')
    files = {f['path']: f for f in assets['files']}
    changes = []
    for path in sorted(snapshot.rglob('*.gz')):
        rel = path.relative_to(snapshot).as_posix()
        asset = {'path':rel,'bytes':path.stat().st_size,'sha256':digest(path.read_bytes())}
        if files.get(rel) != asset:
            changes.append(rel)
            files[rel] = asset
    assets['files'] = list(files.values())
    assets['version'] = stamp[:10]
    write_json(snapshot/'assets.json', assets, pretty=True)
    subprocess.run(['node',str(ROOT/'scripts/download-snapshot.mjs'),'--check'], cwd=output, check=True)
    report = {'url':doc['url'],'id':doc['id'],'source_sha256':sha,'pdf_pages':count,'indexed_pages':len(rows),
              'indexed_chunks':manifest['chunks']-previous_chunks,
              'baseline_asset_manifest_sha256':digest((base/'assets.json').read_bytes()),
              'changed_assets':changes,'changed_source':['assets.json','catalog.json','semantic/manifest.json']}
    write_json(output/'append-report.json',report,pretty=True)
    print(json.dumps({k:v for k,v in report.items() if k!='changed_assets'}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-index', type=Path, required=True)
    parser.add_argument('--url', required=True)
    parser.add_argument('--pdf', type=Path, required=True)
    parser.add_argument('--sha256', required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--observed-at')
    stage(parser.parse_args())
