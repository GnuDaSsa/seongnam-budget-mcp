// In-band, per-request diagnostics built on worker/telemetry.js.
// Only fixed stage and count names are accepted, so question text, URLs and identifiers can never reach the output.
import {createTelemetry} from './telemetry.js';

// Must match the stage names worker/telemetry.js accepts (checked in tests/diagnostics.test.mjs).
const SPANS = new Set(['scope', 'search', 'vector', 'lexical', 'hydrate', 'rerank', 'evidence', 'bridge', 'rollup', 'overview', 'analysis', 'asset_local', 'asset_remote', 'serialize']);
const COUNTS = new Set(['assets_read', 'cache_hits', 'cache_misses', 'rows_read', 'years']);

export function createDiagnostics(now) {
 const telemetry = createTelemetry(now);
 const counts = Object.create(null);
 let markedPartial = false;

 // span(name) returns a runner: await span('search')(async () => ...). Errors propagate unchanged.
 function span(name) {
  if (!SPANS.has(name)) throw new TypeError('Unknown diagnostics span');
  return work => telemetry.measure(name, work);
 }
 function count(name, n = 1) {
  if (!COUNTS.has(name)) throw new TypeError('Unknown diagnostics count');
  if (!Number.isSafeInteger(n) || n < 0) throw new TypeError('Invalid diagnostics count');
  counts[name] = (counts[name] || 0) + n;
 }
 // Called when a stage was skipped or cut short. Takes no reason text by design.
 function markPartial() { markedPartial = true; }
 function toJSON() {
  const snap = telemetry.snapshot();
  const timings_ms = {};
  let failed = false;
  for (const [stage, row] of Object.entries(snap.stages)) {
   timings_ms[stage] = Math.round(row.duration_sum_ms * 10) / 10;
   if (row.failures > 0 || row.timeouts > 0) failed = true;
  }
  return {timings_ms, counts: {...counts}, partial: markedPartial || failed};
 }
 return {span, count, markPartial, toJSON};
}
