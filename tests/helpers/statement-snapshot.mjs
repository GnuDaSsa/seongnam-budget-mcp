// 로컬 snapshot이 있을 때만 세출명세서 쪽을 읽는 테스트 보조(없으면 hasSnapshot이 false).
import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { pagesFromShards } from '../../worker/analysis.js';

const root = path.resolve('snapshot');
const needed = ['catalog.json', 'corpus/pages-2026-0.json.gz', 'corpus/text-2026-0.json.gz', 'corpus/pages-2026-7.json.gz', 'corpus/text-2026-7.json.gz'];
export const hasSnapshot = needed.every(f => existsSync(path.join(root, f)));

const gz = file => JSON.parse(gunzipSync(readFileSync(path.join(root, file))));
let catalogCache = null;
export const catalog = () => (catalogCache ??= JSON.parse(readFileSync(path.join(root, 'catalog.json'), 'utf8')));

const cache = new Map();
export function loadStatementPages(documentId) {
  if (!cache.has(documentId)) {
    const doc = catalog().documents.find(d => d.id === documentId);
    const shards = doc.shards.map(shard => ({ index: gz(`corpus/pages-${shard}.json.gz`), texts: gz(`corpus/text-${shard}.json.gz`) }));
    cache.set(documentId, pagesFromShards(shards, documentId));
  }
  return cache.get(documentId);
}
