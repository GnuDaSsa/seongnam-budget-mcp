import test from 'node:test';
import assert from 'node:assert/strict';
import {createDiagnostics} from '../worker/diagnostics.js';
import {createTelemetry} from '../worker/telemetry.js';

const QUESTION = '2026년 분당구 건설과에 달나라 지하철 조성사업 예산이 없는 게 확실해? 0원으로 보고서에 적어도 돼?';
const URL_LIKE = 'https://example.invalid/private/path?token=abc123';

test('toJSON has exactly the in-band shape and records stage timings and counts', async () => {
 let clock = 0;
 const d = createDiagnostics(() => clock);
 await d.span('search')(async () => { clock += 12.34; });
 await d.span('hydrate')(async () => { clock += 3; });
 d.count('assets_read', 4);
 d.count('assets_read');
 d.count('cache_hits', 2);
 const out = d.toJSON();
 assert.deepEqual(Object.keys(out).sort(), ['counts', 'partial', 'timings_ms']);
 assert.deepEqual(out.timings_ms, {search: 12.3, hydrate: 3});
 assert.deepEqual(out.counts, {assets_read: 5, cache_hits: 2});
 assert.equal(out.partial, false);
});

test('partial is true after markPartial or after a failed or timed-out span', async () => {
 const d = createDiagnostics(() => 0);
 await d.span('search')(async () => 1);
 assert.equal(d.toJSON().partial, false);
 d.markPartial();
 assert.equal(d.toJSON().partial, true);

 const e = createDiagnostics(() => 0);
 const error = new Error('internal');
 error.name = 'TimeoutError';
 await assert.rejects(e.span('asset_remote')(async () => { throw error; }), err => err === error);
 assert.equal(e.toJSON().partial, true);
});

test('a question string passed anywhere never appears in the output', async () => {
 const d = createDiagnostics(() => 0);
 for (const bad of [QUESTION, URL_LIKE]) {
  assert.throws(() => d.span(bad), TypeError);
  assert.throws(() => d.count(bad, 1), TypeError);
  assert.throws(() => d.count('assets_read', bad), TypeError);
 }
 await d.span('scope')(async () => 1);
 d.count('years', 1);
 const text = JSON.stringify(d.toJSON());
 assert.doesNotMatch(text, /달나라|지하철|분당구|건설과|0원|https?:|example\.invalid|token|abc123/);
 assert.doesNotMatch(text, /2026/);
});

test('error messages from rejected inputs do not echo the value', () => {
 const d = createDiagnostics(() => 0);
 for (const call of [() => d.span(QUESTION), () => d.count(QUESTION, 1), () => d.count('assets_read', QUESTION)]) {
  try { call(); assert.fail('expected throw'); }
  catch (error) {
   assert.ok(error instanceof TypeError);
   assert.doesNotMatch(String(error.message), /달나라|지하철|0원|https?:/);
  }
 }
});

test('counts reject negative, fractional, unsafe and unknown names', () => {
 const d = createDiagnostics(() => 0);
 for (const n of [-1, 0.5, Infinity, NaN, '3', 2 ** 60]) assert.throws(() => d.count('assets_read', n), TypeError);
 assert.throws(() => d.count('unknown_metric', 1), TypeError);
 assert.deepEqual(d.toJSON().counts, {});
});

test('span names match what worker/telemetry.js accepts', async () => {
 const names = ['scope', 'search', 'vector', 'lexical', 'hydrate', 'rerank', 'evidence', 'bridge', 'rollup', 'overview', 'analysis', 'asset_local', 'asset_remote', 'serialize'];
 const telemetry = createTelemetry(() => 0);
 for (const name of names) {
  await telemetry.measure(name, async () => 1);
  await createDiagnostics(() => 0).span(name)(async () => 1);
 }
 assert.throws(() => createDiagnostics(() => 0).span('unknown_stage'), TypeError);
});

test('the diagnostic block is a detached copy', async () => {
 const d = createDiagnostics(() => 0);
 d.count('rows_read', 3);
 const first = d.toJSON();
 first.counts.rows_read = 999;
 assert.equal(d.toJSON().counts.rows_read, 3);
});
