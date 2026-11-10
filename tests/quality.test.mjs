import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import worker from '../dist/server/index.js';

// 정적 자산 환경: dist/client 아래 파일을 읽고, 의미 검색 토큰은 snapshot에서 보충한다.
const root = path.resolve('dist/client');
const env = {ASSETS: {async fetch(req) {
  const pathname = new URL(req.url).pathname;
  const p = path.resolve(root, '.' + pathname);
  if (!p.startsWith(root + path.sep)) return new Response('', {status: 403});
  try {
    return new Response(await readFile(p));
  } catch (error) {
    if (!/^\/semantic\/tokens-\d+\.bin\.gz$/.test(pathname)) return new Response('', {status: 404});
    try {
      return new Response(await readFile(path.resolve('snapshot', '.' + pathname)));
    } catch (snapshotError) {
      return new Response('', {status: 404});
    }
  }
}}};

async function get(route) {
  const r = await worker.fetch(new Request('https://test.local' + route), env);
  return {status: r.status, data: await r.json()};
}
async function rpc(method, params) {
  const body = JSON.stringify({jsonrpc: '2.0', id: 1, method, params});
  const r = await worker.fetch(new Request('https://test.local/mcp', {
    method: 'POST', headers: {'content-type': 'application/json'}, body,
  }), env);
  return r.json();
}
async function postRaw(buffer) {
  const r = await worker.fetch(new Request('https://test.local/mcp', {
    method: 'POST', headers: {'content-type': 'application/json'}, body: buffer,
  }), env);
  return {status: r.status, data: await r.json()};
}
async function research(query, extra = {}) {
  const {data, status} = await get('/api/research?' + new URLSearchParams({query, ...extra}));
  assert.equal(status, 200, query + ' 응답 상태');
  return data;
}

const LEVELS = ['verified', 'keyword', 'semantic_bridge', 'semantic_only', 'none'];
const TOTALS = {2026: 3940847350, 2025: 3829777841, 2019: 3012903337, 2010: 1757774347};

// 검증된 총액 카드 공통 검사
function assertVerifiedTotal(r, year, amount) {
  assert.equal(r.retrieval.mode, 'verified_total_table');
  assert.equal(r.answer_card.year, year);
  const rows = r.answer_card.rows;
  assert.equal(rows[0].amount, amount);
  assert.equal(rows[0].amount, rows[1].amount + rows[2].amount, '합계는 하위 두 행의 합');
  assert.equal(r.evidence[0].year, year);
  assert.equal(r.evidence[0].budget_type, '본예산');
  assert.match(r.evidence[0].title, /총괄표/);
  assert.equal(r.filters.budget_type, '본예산');
}

// A. 총액 조회의 연도 일반화
test('2025년 총액을 물으면 검증된 본예산 총괄표 카드를 반환한다', async () => {
  assertVerifiedTotal(await research('2025년 성남시 예산 총액'), 2025, TOTALS[2025]);
});
test('2019년 총액을 물으면 검증된 본예산 총괄표 카드를 반환한다', async () => {
  assertVerifiedTotal(await research('2019년 성남시 예산 총액'), 2019, TOTALS[2019]);
});
test('2010년 총액을 물으면 검증된 본예산 총괄표 카드를 반환한다', async () => {
  assertVerifiedTotal(await research('2010년 성남시 예산 총액'), 2010, TOTALS[2010]);
});
test('작년 총액을 물으면 2025년 카드를 반환한다', async () => {
  assertVerifiedTotal(await research('작년 성남시 예산 총액'), 2025, TOTALS[2025]);
});
test('2009년 총액은 단위 표기가 깨져 있어 카드 없이 미검증 모드로 근거만 반환한다', async () => {
  const r = await research('2009년 성남시 예산 총액');
  assert.equal(r.answer_card, undefined);
  assert.equal(r.retrieval.mode, 'total_table_unverified');
  assert.equal(r.evidence[0].year, 2009);
  assert.equal(r.evidence[0].budget_type, '본예산');
  assert.match(r.evidence[0].title, /총괄표/);
});
test('연도 없이 총액을 물으면 기존대로 2026년 합계를 반환한다', async () => {
  const r = await research('성남시 예산 총액');
  assert.equal(r.answer_card.year, 2026);
  assert.equal(r.answer_card.rows[0].amount, TOTALS[2026]);
});

// B. 연도 비교의 편성 구분 정렬과 중복 제거
test('편성 구분 없이 세 연도를 비교하면 본예산으로 맞춰 세 연도 근거를 모두 반환한다', async () => {
  const r = await research('2024년 2025년 2026년 노인일자리 예산 비교');
  assert.equal(r.per_year.length, 3);
  assert(r.evidence.length > 0);
  assert(r.evidence.every(e => e.budget_type === '본예산'), '모든 근거가 본예산');
  assert.equal(r.query_interpretation.comparison_budget_basis, 'main_budget_default');
  const years = new Set(r.evidence.map(e => e.year));
  for (const year of [2024, 2025, 2026]) assert(years.has(year), year + '년 근거 포함');
});
test('추경을 명시해 연도를 비교하면 모든 근거가 추경이고 기준은 질의로 표시된다', async () => {
  const r = await research('2024년 2025년 추경 노인일자리 예산 비교');
  assert(r.evidence.length > 0);
  assert(r.evidence.every(e => e.budget_type === '추경'), '모든 근거가 추경');
  assert.equal(r.query_interpretation.comparison_budget_basis, 'query');
});
test('2025년과 2026년 총액을 비교하면 연도별 카드의 합계를 반환한다', async () => {
  const r = await research('2025년과 2026년 성남시 예산 비교');
  assert.equal(r.per_year[0].answer_card.rows[0].amount, TOTALS[2025]);
  assert.equal(r.per_year[1].answer_card.rows[0].amount, TOTALS[2026]);
});
test('연도 비교 응답은 근거를 최상위에만 두고 연도별에는 근거 id만 남긴다', async () => {
  const r = await research('2024년 2025년 2026년 노인일자리 예산 비교');
  for (const y of r.per_year) {
    assert(!Object.hasOwn(y, 'evidence'), '연도별 evidence 속성 없음');
    assert(Array.isArray(y.evidence_ids) && y.evidence_ids.every(id => typeof id === 'string'));
    assert.equal(typeof y.answer_policy, 'string');
    assert.equal(typeof y.next_action, 'string');
  }
  assert.deepEqual(r.per_year.flatMap(y => y.evidence_ids), r.evidence.map(e => e.id));
});

// C. 깨진 인코딩 거부
test('유효하지 않은 UTF-8 본문을 /mcp에 보내면 400과 -32700 오류를 반환한다', async () => {
  const body = Buffer.concat([
    Buffer.from('{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"budget_research","arguments":{"query":"'),
    Buffer.from([0xbc, 0xba, 0xb3, 0xb2]),
    Buffer.from('"}}}'),
  ]);
  const {status, data} = await postRaw(body);
  assert.equal(status, 400);
  assert.equal(data.error.code, -32700);
});
test('EUC-KR로 퍼센트 인코딩된 GET 질의는 UTF-8 오류와 함께 400을 반환한다', async () => {
  const {status, data} = await get('/api/research?query=%BC%BA%B3%B2%20%BF%B9%BB%EA');
  assert.equal(status, 400);
  const message = typeof data.error === 'string' ? data.error : JSON.stringify(data.error);
  assert.match(message, /UTF-8/);
});
test('도구 인자에 대체 문자(U+FFFD)가 있으면 isError 결과를 반환한다', async () => {
  const {result} = await rpc('tools/call', {name: 'budget_research', arguments: {query: '성남� 예산'}});
  assert.equal(result.isError, true);
});

// D. 일치 신뢰도
test('사업명이 정확히 일치하는 질의는 match_quality가 verified다', async () => {
  const r = await research('노인일자리 및 사회활동지원 예산');
  assert.equal(r.match_quality.level, 'verified');
});
test('총액 질의는 match_quality가 verified다', async () => {
  const r = await research('성남시 예산 총액');
  assert.equal(r.match_quality.level, 'verified');
});
test('아무것도 찾지 못한 질의는 match_quality가 none이고 근거가 비어 있다', async () => {
  const r = await research('zzzzzzzzzzzz', {mode: 'lexical'});
  assert.equal(r.match_quality.level, 'none');
  assert.deepEqual(r.evidence, []);
});
test('의미 유사 결과만 있는 질의는 semantic_only이고 본문과 응답 크기를 제한한다', async () => {
  const r = await research('화성 탐사선 발사 지원 예산');
  assert.equal(r.match_quality.level, 'semantic_only');
  for (const e of r.evidence) assert(Array.from(e.text).length <= 1200, '근거 본문 1200자 이하');
  assert(JSON.stringify(r).length < 40000, '응답 JSON 40000자 미만');
  assert.match(r.next_action, /의미 유사/);
});
test('match_quality.level은 항상 정해진 다섯 값 중 하나다', async () => {
  const queries = [
    ['노인일자리 및 사회활동지원 예산', {}],
    ['성남시 예산 총액', {}],
    ['zzzzzzzzzzzz', {mode: 'lexical'}],
    ['화성 탐사선 발사 지원 예산', {}],
    ['어르신이 일할 수 있도록 돕는 사업', {}],
  ];
  for (const [query, extra] of queries) {
    const r = await research(query, extra);
    assert(LEVELS.includes(r.match_quality.level), query + ' 수준: ' + r.match_quality.level);
  }
});

// E. 의미 질의의 세출명세서 연결
test('의미 질의는 세출명세서 사업을 근거 연결(semantic bridge)로 반환한다', async () => {
  const r = await research('어르신이 일할 수 있도록 돕는 사업');
  assert.equal(r.match_quality.level, 'semantic_bridge');
  const bridged = r.evidence.find(e => e.source_family === 'expenditure'
    && e.text.replace(/\s/g, '').includes('노인일자리및사회활동지원확대')
    && e.retrieval_scores?.method === 'semantic_bridge'
    && e.bridge?.business_name === '노인일자리및사회활동지원확대');
  assert(bridged, '연결된 세출명세서 근거가 있어야 함');
  const source = r.evidence.find(e => e.id === bridged.bridge.from_id && e.id !== bridged.id);
  assert(source, 'bridge.from_id가 같은 응답의 다른 근거를 가리켜야 함');
  assert.equal(source.year, 2026);
});

// F. MCP 도구 호출 경로 일관성
test('MCP 도구 호출 결과는 content 본문과 structuredContent가 일치한다', async () => {
  const {result} = await rpc('tools/call', {name: 'budget_research', arguments: {query: '2025년 성남시 예산 총액'}});
  assert.equal(result.isError, false);
  assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
  assert.equal(result.structuredContent.answer_card.year, 2025);
});
