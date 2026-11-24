// Only these fixed buckets and the Korean calendar day reach durable storage.
const kstDate = new Intl.DateTimeFormat('sv-SE', {
 timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
});

const increment = `INSERT INTO mcp_usage_daily (day, source, outcome, calls)
 VALUES (?, ?, ?, 1)
 ON CONFLICT (day, source, outcome) DO UPDATE SET calls = calls + 1`;

const dailyCounts = `SELECT day,
 SUM(calls) AS total_calls,
 SUM(CASE WHEN source = 'benchmark' THEN calls ELSE 0 END) AS benchmark_calls,
 SUM(CASE WHEN source = 'unclassified' THEN calls ELSE 0 END) AS unclassified_calls,
 SUM(CASE WHEN outcome = 'success' THEN calls ELSE 0 END) AS success_calls,
 SUM(CASE WHEN outcome = 'error' THEN calls ELSE 0 END) AS error_calls
 FROM mcp_usage_daily GROUP BY day ORDER BY day`;

const fields = ['total_calls', 'benchmark_calls', 'unclassified_calls', 'success_calls', 'error_calls'];

export async function recordToolUsage(db, userAgent, isError, startedAt) {
 if (!db) return false;
 const source = /^SeongnamBudgetQA\//i.test(userAgent || '') ? 'benchmark' : 'unclassified';
 const outcome = isError ? 'error' : 'success';
 try {
  const write = await db.prepare(increment).bind(kstDate.format(startedAt), source, outcome).run();
  if (write.success) return true;
 } catch {
  // D1 may be unavailable while budget search still works.
 }
 console.warn('mcp_usage_write_failed');
 return false;
}

export async function getMcpUsage(db) {
 let daily;
 try {
  const read = await db.prepare(dailyCounts).all();
  if (!read.success || !Array.isArray(read.results)) throw new Error();
  daily = read.results;
 } catch {
  throw new Error('호출 집계 저장소를 조회할 수 없습니다.');
 }
 const totals = Object.fromEntries(fields.map(field => [field, 0]));
 for (const row of daily) {
  for (const field of fields) totals[field] += row[field];
 }
 return {
  timezone: 'Asia/Seoul',
  count_basis: '집계 시작 이후 저장된 MCP 예산 도구 실행 건수입니다. 재호출과 도구 오류를 포함합니다. 통계 조회·연결·웹 요청은 제외합니다. 벤치마크 표식이 없는 호출에는 자동화 도구도 포함됩니다.',
  first_day: daily[0]?.day ?? null,
  last_day: daily.at(-1)?.day ?? null,
  ...totals, daily,
 };
}
