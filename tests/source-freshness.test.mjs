import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { compareDocuments, hashAttachment, hashDay, listPublished } from '../scripts/check-source-freshness.mjs';

const base = 'https://www.seongnam.go.kr/humanframe/file/sncity/bgt/2030/';
const file = (revision, name = revision) => ({
  url: base + name + '.pdf', year: 2030, budget_type: '추경', revision,
  status: 'indexed', sha256: 'b'.repeat(64), category: '연도별 예산서'
});

test('detects a new edition, a missing attachment within an edition, and a replaced document', async () => {
  const listed = [file(4), file(4,'extra'), file(5)];
  const deployed = [file(4), file(3)];
  const summary = await compareDocuments(listed, deployed, () => true, async () => 'a'.repeat(64));
  assert.deepEqual(summary.changes.map(d => [d.reason,d.url]), [
    ['content_replaced',file(4).url], ['missing_from_site',file(4,'extra').url],
    ['missing_from_site',file(5).url], ['no_longer_listed',file(3).url]
  ]);
  assert.deepEqual(summary.changes.filter(d => d.reason === 'missing_from_site').map(d => d.new_edition), [false,true]);
  assert.equal(summary.hashes_checked, 1);
});

test('reports collection and hash failures without treating skipped or inaccessible data as verified', async () => {
  const docs = [file(1),file(2),file(3),file(4)];
  const published = [{ ...docs[0], revision: 2 }, { ...docs[1], sha256: null }, docs[2], docs[3]];
  const summary = await compareDocuments(docs, published, u => u === docs[2].url, async () => { throw Error('HTTP 503'); });
  assert.equal(summary.hashes_checked, 0);
  assert.deepEqual(summary.changes.map(c => c.reason), ['edition_mismatch','not_collected']);
  assert.deepEqual(summary.errors, [{ url: docs[2].url, message: 'HTTP 503' }]);
});

test('pagination reads the reported total and refuses an empty or duplicate intermediate page', async () => {
  const site = 'https://example.com';
  const docs = [file(1),file(2)];
  const request = async url => {
    const offset = Number(url.searchParams.get('offset'));
    return Response.json({ offset, total: 2, documents: [docs[offset]] });
  };
  assert.deepEqual(await listPublished(site, 2030, request),docs);
  const empty = async () => Response.json({ offset: 0, total: 2, documents: [] });
  await assert.rejects(listPublished(site, 2030, empty), /incomplete/);
  const duplicate = async () => Response.json({ offset: 0, total: 2, documents: [docs[0],docs[0]] });
  await assert.rejects(listPublished(site, 2030, duplicate), /Duplicate/);
});

test('hashes real streamed PDF bytes, checks source path and rejects a 200 maintenance page', async () => {
  const url = file(4).url;
  const checked = await hashAttachment(url, async () => new Response('%PDF-1.5'));
  assert.equal(checked, createHash('sha256').update('%PDF-1.5').digest('hex'));
  await assert.rejects(hashAttachment(url, async () => new Response('<html>maintenance</html>')), /Unexpected/);
  await assert.rejects(hashAttachment('https://example.org/wrong.pdf'), /path/);
  const day = hashDay(url);
  assert.equal(day,hashDay(url));
  assert.ok(day>=0 && day<7);
});
