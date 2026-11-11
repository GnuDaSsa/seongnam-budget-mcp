// Per-request, opt-in measurements. Never accept question text, URLs or errors as data.
const STAGES = new Set(['scope', 'search', 'vector', 'lexical', 'hydrate', 'rerank', 'evidence', 'bridge', 'rollup', 'overview', 'asset_local', 'asset_remote', 'serialize']);
const SIZES = new Set(['response_bytes', 'asset_bytes']);

export function createTelemetry(now = () => performance.now()) {
 const started = now(), stages = Object.create(null), sizes = Object.create(null);
 async function measure(stage, work) {
  if (!STAGES.has(stage)) throw new TypeError('Unknown telemetry stage');
  const begin = now();
  let failed = false, timedOut = false;
  try { return await work(); }
  catch (error) { failed = true; timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError'; throw error; }
  finally {
   const elapsed = Math.max(0, now() - begin);
   const row = stages[stage] ||= {count: 0, failures: 0, timeouts: 0, duration_sum_ms: 0};
   row.count++; row.failures += Number(failed); row.timeouts += Number(timedOut); row.duration_sum_ms += elapsed;
  }
 }
 function addSize(kind, bytes) {
  if (!SIZES.has(kind) || !Number.isSafeInteger(bytes) || bytes < 0) throw new TypeError('Invalid telemetry size');
  sizes[kind] = (sizes[kind] || 0) + bytes;
 }
 function snapshot() {
  return {wall_ms: Math.max(0, now() - started), stages: Object.fromEntries(Object.entries(stages).map(([k, v]) => [k, {...v}])), sizes: {...sizes}};
 }
 return {measure, addSize, snapshot};
}
