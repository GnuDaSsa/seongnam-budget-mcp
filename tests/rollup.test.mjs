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
async function research(query, extra = {}) {
  const {data, status} = await get('/api/research?' + new URLSearchParams({query, ...extra}));
  assert.equal(status, 200, query + ' 응답 상태');
  return data;
}

test('본예산만 요청하고 추경을 제외하면 추경 문서와 비교를 반환하지 않는다', async () => {
  const r = await research('2026년 중원구 사회복지과 기초연금 본예산만 알려줘. 추경은 제외해줘.');
  assert.equal(r.analysis.kind, 'business_lookup');
  assert.equal(r.analysis.status, 'matched');
  assert.equal(r.analysis.rows[0].amount, 110922543);
  assert.ok(r.analysis.documents_read.every(d => d.edition === '본예산'));
  assert.ok(r.evidence.every(e => e.budget_type !== '추경'));
  assert.ok((r.department_overview?.editions || []).every(e => e.budget_type !== '추경'));
});

test('미확인 사업은 부서 개요가 있어도 0원이나 부재로 판단하지 않도록 안내한다', async () => {
  const r = await research('2026년 분당구 건설과에 달나라 지하철 조성사업 예산이 없는 게 확실해? 0원으로 보고서에 적어도 돼?');
  assert.equal(r.match_quality.level, 'semantic_only');
  assert.equal(r.verification_status.business, 'not_verified');
  assert.match(r.next_action, /부재나 0원을 확정하지 마세요/);
});

test('세 구 요청은 단일 구로 줄이지 않고 합계 미검증을 알린다', async () => {
  const r = await research('2026년 본예산 기초연금 지급액을 수정구·중원구·분당구 사회복지과별로 각각 보여주고 세 구 합계를 계산해줘.');
  assert.equal(r.query_interpretation.department_scope.names.length, 3);
  // 세출명세서 행 계산이 가능하므로 합계 미검증 안내 대신 검증된 세 행의 계산 합계를 낸다.
  assert.equal(r.analysis.kind, 'department_sum');
  assert.equal(r.analysis.status, 'calculated');
  assert.equal(r.analysis.calculated_total.amount, 308118174);
  assert.deepEqual(r.analysis.rows.map(x => [x.department, x.amount, x.page]),
    [['수정구사회복지과', 114003724, 883], ['중원구사회복지과', 110922543, 1110], ['분당구사회복지과', 83191907, 1291]]);
  assert.match(r.next_action, /계산값/);
});

test('본예산과 추경 비교 요청은 두 편성 범위를 보존한다', async () => {
  const r = await research('2026년 중원구 사회복지과 기초연금 본예산과 1회 추경에서 기정액 경정액 증감액을 각각 비교해줘.');
  assert.deepEqual(r.query_interpretation.comparison_budget_types, ['본예산', '추경']);
  assert(r.department_overview.editions.some(e => e.budget_type === '본예산'));
  assert(r.department_overview.editions.some(e => e.budget_type === '추경' && e.revision === 1));
  // 본예산과 1회 추경 행이 모두 읽히므로 비교 완료 여부는 analysis가 말한다.
  assert.equal(r.analysis.kind, 'edition_compare');
  assert.equal(r.analysis.status, 'compared');
  assert.equal(r.analysis.initial.amount, 110922543);
  const [rev] = r.analysis.revisions;
  assert.deepEqual([rev.revision, rev.revised_amount, rev.previous_amount, rev.amendment_change, rev.page, rev.previous_matches_initial],
    [1, 116417588, 110922543, 5495045, 351, true]);
});

// 같은 세부사업이 여러 부서에 편성된 경우의 부서별 묶음
test('여러 부서에 편성된 세부사업은 부서별 행과 계산 합계를 함께 반환한다', async () => {
  const r = await research('2024년 공공근로 지출과 시도비 비율');
  assert.equal(r.match_quality.level, 'verified');
  const rollup = r.business_rollup;
  assert.equal(rollup.business_name, '공공근로사업추진');
  assert.equal(rollup.edition, '본예산');
  assert.equal(rollup.departments.length, 4);
  assert.deepEqual(new Set(rollup.rows.map(row => row.amount)), new Set([754000, 2000000, 1312500, 2366200]));
  assert.equal(rollup.calculated_total.amount, 6432700);
  for (const row of rollup.rows) {
    assert.equal(row.columns_verified, true);
    assert.equal(row.unit, '천원');
  }
  assert.match(r.next_action, /4개 부서/);
  for (const e of r.evidence) {
    assert(e.budget_type === '본예산' || e.budget_type === '추경', '근거 편성 구분: ' + e.budget_type);
  }
});

// 여러 연도를 한 번에 조회할 때 연도별 묶음과 응답 크기 제한
test('2021~2027년 조회는 연도별 묶음과 축소된 근거를 반환한다', async () => {
  const {status, data: r} = await get('/api/research?' + new URLSearchParams({
    query: '2021~2027년 공공근로 지출과 시도비 비율',
  }));
  assert.equal(status, 200);
  assert.equal(r.per_year.length, 7);

  const totals = {2022: 6387000, 2023: 6387000, 2024: 6432700, 2025: 6775500, 2026: 7082200};
  // per_year는 요청한 연도 순서대로 배열된다(2021~2027).
  for (const [index, year] of [2021, 2022, 2023, 2024, 2025, 2026].entries()) {
    const entry = r.per_year[index];
    assert.equal(entry.business_rollup.rows[0].year, year, year + '년 항목 순서');
    assert.equal(entry.business_rollup.departments.length, 4, year + '년 부서 수');
    assert(entry.business_rollup.rows.every(row => row.year === year && row.budget_type === '본예산'));
    if (year === 2021) {
      // 2021 전체본의 확인된 4개 부서 외에 분리 PDF 4쪽은 부서 머리말이 미확인이다.
      // 금액이 같다는 이유만으로 이 쪽들을 특정 부서에 대응시켜 합산하지 않는다.
      const rollup = entry.business_rollup;
      const unknown = rollup.rows.filter(row => row.department === null);
      const known = rollup.rows.filter(row => row.department !== null);
      assert.equal(rollup.rows.length, 8);
      assert.equal(known.length, 4);
      assert.deepEqual(new Set(unknown.map(row => row.id)), new Set([
        '8536c9c4f91b9c755ecf:p5', 'c8b6796623f925d7a48e:p34',
        'dd36e9bc7e46821e6b6e:p32', '3048a6359d8e2d8d9e3e:p38',
      ]));
      for (const rows of [known, unknown]) {
        assert.deepEqual(new Set(rows.map(row => row.amount)), new Set([595000, 549000, 410000, 645000]));
        assert(rows.every(row => row.columns_verified && row.unit === '천원'));
      }
      assert.equal(rollup.calculated_total, null);
    } else {
      assert.equal(entry.business_rollup.rows.length, 4, year + '년 확인된 부서 행 수');
      assert.equal(entry.business_rollup.calculated_total.amount, totals[year], year + '년 합계');
    }
  }

  const last = r.per_year[6];
  assert.equal(last.match_quality.level, 'none');
  assert.deepEqual(last.evidence_ids, []);

  for (const e of r.evidence) {
    assert(Array.from(e.text).length <= 1500, '근거 본문 1,500자 이하');
  }
  assert(JSON.stringify(r).length < 150000, '응답 JSON 150,000자 미만');
  assert(
    r.query_interpretation.notices.some(n => n.includes('4개 이상 연도')),
    '4개 이상 연도 안내 문구',
  );
});

test('최대 여덟 개 연도를 넘는 기간은 400과 안내 문구를 반환한다', async () => {
  const {status, data} = await get('/api/research?' + new URLSearchParams({query: '2015~2026년 공공근로'}));
  assert.equal(status, 400);
  const message = typeof data.error === 'string' ? data.error : JSON.stringify(data.error);
  assert.match(message, /최대 8개/);
});

test('부서를 명시한 질의는 부서 묶음을 만들지 않는다', async () => {
  const r = await research('정보통신과 2026년 예산');
  assert.equal(r.business_rollup, null);
});

// 부서 개요: 한 부서의 편성별 총액과 세부사업 금액
test('추경을 포함한 부서 질문은 본예산과 추경의 부서 개요를 함께 반환한다', async () => {
  const r = await research('AI반도체과 2026년도 예산 중 가장 비싼거 추경 포함');
  const overview = r.department_overview;
  assert.equal(overview.department, 'AI반도체과');
  const labels = overview.editions.map(e => e.label);
  assert(labels.includes('본예산'), '본예산 편성 포함');
  assert(labels.includes('1회 추경'), '1회 추경 편성 포함');
  const sup = overview.editions.find(e => e.label === '1회 추경');
  assert.equal(sup.department_total.amount, 34946472);
  assert.equal(sup.department_total.previous_amount, 8837472);
  assert.equal(overview.largest_business.name, '판교시스템반도체연구센터조성');
  assert.equal(overview.largest_business.amount, 26299000);
  assert.equal(overview.largest_business.as_of, '1회 추경');
  // 순위 계산은 본예산 명세서 기준이며 추경 포함 순위는 만들지 않는다는 점을 analysis가 알린다. 추경 반영 최대액은 overview 계산값.
  assert.equal(r.analysis.kind, 'ranking');
  assert.equal(r.analysis.scope.budget_type, '본예산');
  assert.ok(r.analysis.notices.some(n => /추경을 포함한 전체 순위는 계산하지 않았습니다/.test(n)));
  // 추경을 함께 요청했으므로 본예산만의 순위를 complete로 표시하지 않는다.
  assert.equal(r.analysis.status, 'partial_scope');
  assert.match(r.next_action, /추경 반영\)의 순위는 계산되지 않았습니다/);
  assert.equal(overview.base_reconciled, true);
  // 근거(evidence)는 analysis가 계산에 쓴 본예산 명세서 쪽을 앞에 둔다. 추경 쪽 값은 department_overview의 편성별 행으로 제공된다.
  assert.ok(r.evidence.length > 0);
  assert.equal(r.evidence[0].budget_type, '본예산');
  assert.ok(r.analysis.items.every(i => r.evidence.some(e => e.page === i.page)), '순위 행의 쪽이 근거에 포함');
});

test('본예산만 묻는 부서 질문은 본예산 편성 하나와 가장 큰 사업을 반환한다', async () => {
  const r = await research('AI반도체과 2026년 본예산 가장 큰 사업');
  const overview = r.department_overview;
  assert.equal(overview.editions.length, 1);
  assert.equal(overview.editions[0].label, '본예산');
  assert.equal(overview.editions[0].department_total.amount, 8837472);
  assert.equal(overview.largest_business.amount, 2265924);
});

test('부서를 명시하지 않은 사업 질문은 부서 개요가 null이다', async () => {
  const r = await research('2024년 공공근로 예산');
  assert.equal(r.department_overview, null);
});

test('한 부서에만 편성된 사업은 묶음이 있어도 합계를 내지 않는다', async () => {
  const r = await research('노인일자리 및 사회활동지원 예산');
  if (r.business_rollup === null) return;
  assert.equal(r.business_rollup.departments.length, 1);
  assert.equal(r.business_rollup.calculated_total, null);
});

// GitHub issue #4: 두 부서 차액 질문이 제외한 구를 피연산자로 넣거나 합계로 바뀌지 않아야 한다.
test('이슈 #4: 제외 표현이 붙은 구를 뺀 두 부서 차액을 계산하고 합계로 대체하지 않는다', async () => {
  const r = await research('2026년 기초연금 일반회계 본예산 중 수정구와 분당구 사회복지과의 차액은? 중원구는 제외해줘.');
  const a = r.analysis;
  assert.equal(a.kind, 'department_difference');
  assert.equal(a.status, 'calculated');
  // 합계(197,195,631)가 아니라 차액이므로 calculated_total은 null이어야 한다.
  assert.equal(a.calculated_total, null);
  assert.notEqual(a.calculated_total?.amount, 197195631);
  assert.equal(a.difference.signed_difference, null);
  assert.equal(a.difference.absolute_difference, 30811817);
  assert.equal(a.difference.unit, '천원');
  assert.equal(a.difference.direction_basis, 'ambiguous');
  assert.equal(a.difference.operands[0].department, '수정구사회복지과');
  assert.equal(a.difference.operands[0].amount, 114003724);
  assert.equal(a.difference.operands[1].department, '분당구사회복지과');
  assert.equal(a.difference.operands[1].amount, 83191907);
  assert.equal(a.difference.operands.length, 2);
  assert.ok(a.excluded_departments.includes('중원구사회복지과'), '제외 부서 중원구사회복지과');
  assert.ok(!a.difference.operands.some(o => o.department === '중원구사회복지과'), '제외 부서는 피연산자가 아님');
  assert.equal(a.scope.edition, '본예산');
  assert.equal(a.scope.account_group, '일반회계');
  assert.equal(a.scope.year, 2026);
  assert.ok(!a.intent.kinds.includes('department_sum'), '합계 의도가 없어야 함');
  assert.ok(a.intent.kinds.includes('department_difference'));
});

test('이슈 #4 대조: 같은 부서 조합을 합계로 물으면 department_sum으로 처리한다', async () => {
  const r = await research('2026년 기초연금 일반회계 본예산 중 수정구와 분당구 사회복지과의 합계는? 중원구는 제외해줘.');
  assert.equal(r.analysis.kind, 'department_sum');
  assert.ok(r.analysis.intent.kinds.includes('department_sum'));
  assert.ok(!r.analysis.intent.kinds.includes('department_difference'));
});

// 빌드된 worker 기준: 방향을 묻는 차액 질문은 절대값 차이만 계산하고 합계를 답으로 내지 않는다.
function assertDepartmentDifferenceBuiltWorker(a, operands) {
  assert.equal(a.kind, 'department_difference');
  assert.equal(a.status, 'calculated');
  assert.equal(a.calculated_total, null);
  assert.equal(a.total, null);
  assert.notEqual(a.calculated_total?.amount, 197195631);
  assert.ok(!a.rows.some(row => row.amount === 197195631), '합계 금액이 행으로 노출되지 않음');
  assert.equal(a.difference.absolute_difference, 30811817);
  assert.equal(a.difference.unit, '천원');
  assert.equal(a.difference.direction_known, false);
  assert.equal(a.difference.signed_difference, null);
  assert.equal(a.difference.expression, null);
  assert.deepEqual(a.difference.operands.map(o => [o.department, o.amount]), operands);
  assert.equal(a.scope.year, 2026);
  assert.equal(a.scope.edition, '본예산');
  assert.equal(a.scope.account_group, '일반회계');
  assert.ok(a.source_pages.length > 0, 'source_pages 비어 있지 않음');
  assert.deepEqual(a.source_pages.map(p => p.page).sort((x, y) => x - y), [883, 1291]);
}

test('빌드 worker: 분당구가 수정구보다 얼마나 적은지 묻는 차액은 절대값 차이만 계산한다', async () => {
  const r = await research('2026년 기초연금 일반회계 본예산에서 분당구 사회복지과 예산이 수정구 사회복지과보다 얼마나 적어?');
  assertDepartmentDifferenceBuiltWorker(r.analysis, [
    ['분당구사회복지과', 83191907],
    ['수정구사회복지과', 114003724],
  ]);
});

test('빌드 worker: 수정구보다 분당구가 얼마나 많은지 묻는 반대 순서도 같은 절대값 차이를 낸다', async () => {
  const r = await research('2026년 기초연금 일반회계 본예산에서 수정구 사회복지과보다 분당구 사회복지과가 얼마나 많아?');
  assertDepartmentDifferenceBuiltWorker(r.analysis, [
    ['수정구사회복지과', 114003724],
    ['분당구사회복지과', 83191907],
  ]);
});

// 세목 묶음 회귀: 빌드 worker 기준. 이름이 정확히 같은 사업만 묶고, 합계는 요청된 경우에만 계산한다.
// 금액 필드(amount 또는 amounts.budget)와 쪽 번호(page 또는 source_page)를 분석 결과 안에서 찾는다.
const amountOf = o => (typeof o.amount === 'number' ? o.amount : typeof o.amounts?.budget === 'number' ? o.amounts.budget : null);
const pageOf = o => o.page ?? o.source_page ?? null;
function findAmountRows(node, out = []) {
  if (Array.isArray(node)) node.forEach(x => findAmountRows(x, out));
  else if (node && typeof node === 'object') {
    if (amountOf(node) !== null) out.push(node);
    Object.values(node).forEach(v => findAmountRows(v, out));
  }
  return out;
}
function findNamedRows(node, name) {
  const seen = new Set();
  return findAmountRows(node).filter(o => Object.values(o).includes(name) && !seen.has(o) && seen.add(o));
}
const INCOMPLETE_RE = /확인되지|확인할 수 없|불완전|누락|미확인|일부만|부분/;
const COMPLETE_CLAIM_RE = /모두 확인|전부 확인|완전한 합계|누락 없이|빠짐없이/;
const SUM_JSON_FORMS = ['30682621', '30,682,621'];

test('세목 회귀 1: 아동수당지급과 아동수당지급(자체)는 각각 따로 보거나, 불완전하다고 명시하고 합산하지 않는다', async () => {
  const r = await research('2026년 분당구 가정복지과 일반회계 본예산에서 아동수당지급과 아동수당지급(자체)의 예산을 각각 알려줘.');
  const a = r.analysis;
  const serialized = JSON.stringify(a);
  for (const form of SUM_JSON_FORMS) assert.equal(serialized.includes(form), false, '합산값 미노출: ' + form);
  assert.ok(!a?.calculated_total || a.calculated_total.amount !== 30682621, '합계 계산 금지');

  const plain = findNamedRows(a, '아동수당지급').filter(o => amountOf(o) === 25154525);
  const self = findNamedRows(a, '아동수당지급(자체)').filter(o => amountOf(o) === 5528096);
  assert.ok(plain.length > 0 && self.length > 0, '두 사업의 원문 행을 각각 반환');
  assert.equal(pageOf(plain[0]), 1309);
  assert.equal(pageOf(self[0]), 1310);
  assert.equal(a.calculated_total ?? null, null, '요청되지 않은 합계 없음');
});

test('세목 회귀 2: 스마트그린 안전쉼터 구별 금액은 8,000,000 천원 합계 또는 불완전 명시이며 구는 부서가 아니다', async () => {
  const r = await research('2026년 스마트도시과 일반회계 본예산 스마트그린 안전쉼터 조성사업의 수정구 중원구 분당구별 금액과 합계는?');
  const a = r.analysis;
  const districts = ['수정구', '중원구', '분당구'];

  // 구 이름이 부서로 분류되지 않는다.
  const deptScope = r.query_interpretation?.department_scope?.names ?? [];
  for (const d of districts) assert.equal(deptScope.some(n => n === d || n === d + '사회복지과' || n === d + '청'), false, '구가 부서 범위로 쓰임: ' + d);
  for (const row of findAmountRows(a)) {
    if (typeof row.department === 'string') assert.equal(districts.includes(row.department), false, '구가 department 필드로 쓰임');
  }

  // 유지관리 행은 구축 금액으로 쓰지 않는다.
  const expected = [[1800000, '수정구'], [1600000, '중원구'], [2300000, '분당']];
  for (const [amount, label] of expected) {
    for (const row of findAmountRows(a).filter(o => amountOf(o) === amount)) {
      assert.equal(JSON.stringify(row).includes('유지관리'), false, amount + ' 행이 유지관리 행으로 섞임');
      if (label !== '분당') assert.ok(JSON.stringify(row).includes(label), label + ' 행 식별');
    }
  }

  if (a?.calculated_total) {
    assert.equal(a.calculated_total.amount, 8000000, '합계는 8,000,000 천원');
    const north = findAmountRows(a).filter(o => amountOf(o) === 2300000);
    assert.ok(north.length >= 2, '분당 2개 행(2,300,000 두 개)이 별도로 있어야 함');
    for (const amount of [1800000, 1600000]) assert.ok(findAmountRows(a).some(o => amountOf(o) === amount), amount + ' 행 존재');
    for (const row of findAmountRows(a).filter(o => [1800000, 1600000, 2300000].includes(amountOf(o)))) {
      assert.notEqual(pageOf(row), null, '행마다 원문 쪽 번호');
    }
  } else {
    // 합계를 주지 않는 경우: 불완전 명시, 후보 행 제시, 완전성 주장 금지
    assert.match(r.next_action ?? '', INCOMPLETE_RE, '합계 불완전 명시');
    assert.equal(COMPLETE_CLAIM_RE.test(r.next_action ?? ''), false, '완전성 주장 금지');
    assert.ok(findAmountRows(a).length > 0, '후보 행 제시');
  }
  assert.equal(JSON.stringify(a).includes('유지관리'), false, '유지관리 행이 분석 결과에 섞이지 않음');
});

test('세목 음성 1: 자료에 없는 사업명은 어떤 사업과도 매칭되지 않고 검증되지 않는다', async () => {
  const r = await research('2026년 스마트도시과 일반회계 본예산 달나라 우주정거장 조성사업 예산은?');
  assert.notEqual(r.match_quality?.level, 'verified');
  assert.equal(r.verification_status?.business, 'not_verified');
  assert.equal(r.analysis?.calculated_total ?? null, null, '계산 합계 없음');
  assert.equal(JSON.stringify(r.analysis ?? {}).includes('스마트그린'), false, '무관한 스마트그린 사업으로 대체되지 않음');
});

test('세목 음성 2: 정확한 이름이 아닌 부분 문자열로 다른 세목 행을 가져오지 않는다', async () => {
  const r = await research('2026년 분당구 가정복지과 일반회계 본예산에서 아동수당지급(자체) 예산만 알려줘.');
  const a = r.analysis;
  const self = findNamedRows(a, '아동수당지급(자체)');
  // '(자체)' 요청에 정확한 이름이 다른 '아동수당지급' 금액(25,154,525)이 답으로 붙으면 안 된다.
  assert.equal(self.some(o => amountOf(o) === 25154525), false, '(자체) 요청에 아동수당지급 금액이 붙음');
  const serialized = JSON.stringify(a ?? {});
  for (const form of SUM_JSON_FORMS) assert.equal(serialized.includes(form), false, '합계 미요청: ' + form);
});

test('세목 음성 3: 합계를 요청하지 않은 구별 질문은 합계를 계산하지 않는다', async () => {
  const r = await research('2026년 스마트도시과 일반회계 본예산 스마트그린 안전쉼터 조성사업의 수정구 금액만 알려줘.');
  assert.equal(r.analysis?.calculated_total ?? null, null, '요청하지 않은 합계 계산 금지');
  assert.equal(JSON.stringify(r.analysis ?? {}).includes('8000000') || JSON.stringify(r.analysis ?? {}).includes('8,000,000'), false, '8,000,000 합계 미노출');
});
