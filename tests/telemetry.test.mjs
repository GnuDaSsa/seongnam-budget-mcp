import test from 'node:test';
import assert from 'node:assert/strict';
import {createTelemetry} from '../worker/telemetry.js';

test('measures work, preserves result and returns detached snapshots', async () => {
 let clock = 10; const t = createTelemetry(() => clock);
 assert.equal(await t.measure('search', async () => { clock += 7; return 42; }), 42);
 t.addSize('response_bytes', 120);
 const first = t.snapshot();
 assert.deepEqual(first, {wall_ms: 7, stages: {search: {count: 1, failures: 0, timeouts: 0, duration_sum_ms: 7}}, sizes: {response_bytes: 120}});
 first.stages.search.count = 99;
 assert.equal(t.snapshot().stages.search.count, 1);
});

test('records failures and timeouts while propagating the original error without storing it', async () => {
 let clock = 0; const t = createTelemetry(() => clock);
 const error = new Error('private query text'); error.name = 'TimeoutError';
 await assert.rejects(t.measure('asset_remote', () => { clock = 12; throw error; }), e => e === error);
 assert.deepEqual(t.snapshot().stages.asset_remote, {count: 1, failures: 1, timeouts: 1, duration_sum_ms: 12});
 assert.doesNotMatch(JSON.stringify(t.snapshot()), /private query text/);
});

test('only accepts predefined metrics and nonnegative integer sizes', async () => {
 const t = createTelemetry();
 await assert.rejects(t.measure('private query text', () => 1), TypeError);
 assert.throws(() => t.addSize('private query text', 1), TypeError);
 for (const value of [-1, 0.5, Infinity, '12']) assert.throws(() => t.addSize('asset_bytes', value), TypeError);
 assert.deepEqual(t.snapshot().sizes, {});
});
