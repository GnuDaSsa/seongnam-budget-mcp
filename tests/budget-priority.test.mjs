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

const BUDGET_PLAN_TYPES = ['본예산', '추경'];

test('세입 부서 구간과 위치·회계 항목은 원문 쪽에서 확인한다', async () => {
  const department = await research('2026년 도서관지원과 세입 예산 알려줘');
  assert.equal(department.evidence[0].document_id, '900cfcf0496b43682393');
  assert.equal(department.evidence[0].page, 4);
  assert.equal(department.evidence[0].source_family, 'revenue');
  const parking = await research('2026년 산성동 주차장 부지 사용료 세입');
  assert.equal(parking.evidence[0].document_id, '77026d693c41306e52d5');
  assert.equal(parking.evidence[0].page, 5);
  assert.equal(parking.evidence[0].source_family, 'revenue');
  const fee = await research('2024년 상수도 급수공사 수수료 세입 예산');
  assert.equal(fee.evidence[0].document_id, '83a60464d077ef91714a');
  assert.equal(fee.evidence[0].page, 2);
  assert.equal(fee.evidence[0].source_family, 'revenue');
  assert.match(department.next_action, /부서 전체 세입 총액으로 확대하지/);
});

test('회계가 지정된 이름 변형은 유사 항목으로 표시하고 회계 범위를 지킨다', async () => {
  for (const query of ['2024년 상수도 특별회계 급수공사비 알려줘','2024년 상수도공기업 특별회계 급수 공사비 알려줘']) {
    const result = await research(query);
    assert.equal(result.match_quality.level, 'similar');
    assert.equal(result.evidence[0].document_id, '0775a628b8a18ab92908');
    assert.equal(result.evidence[0].page, 12);
    assert.equal(result.evidence[0].similar_business.original_name, '급수공사');
    assert.match(result.next_action, /유사 항목/);
  }
  const exact = await research('2013년 상수도 특별회계 급수공사비 통계목 알려줘');
  assert.equal(exact.match_quality.level, 'verified');
  assert.equal(exact.evidence[0].page, 36);
  const comparison = await research('2024년과 2025년 상수도 특별회계 급수공사비 예산 비교');
  assert.equal(comparison.match_quality.level, 'similar');
  assert.match(comparison.next_action, /유사 항목/);
  const otherAccount = await research('2024년 하수도공기업특별회계 급수공사비 세출 예산');
  assert(otherAccount.evidence.every(e => e.account === '하수도공기업특별회계'));
});

// 규칙: 결산을 묻지 않은 질문은 예산편성 자료(본예산·추경)만 근거로 쓴다.
test('결산을 묻지 않은 사업 예산 질의는 본예산 또는 추경 근거만 반환한다', async () => {
  const queries = [
    '노인일자리 및 사회활동지원 예산',
    '2024년 청년 지원 사업 예산',
    '2025년 도로 유지보수 예산',
    '도서관 운영 예산',
    '정보통신과 2026년 예산',
  ];
  for (const query of queries) {
    const r = await research(query);
    assert(r.evidence.length >= 1, query + ': 근거가 1건 이상이어야 함');
    const types = r.evidence.map(e => e.budget_type);
    assert(types.every(t => BUDGET_PLAN_TYPES.includes(t)),
      query + ': 편성 구분 ' + JSON.stringify(types));
  }
});

test('편성 미지정 시 총액은 수록된 최종 추경, 본예산 지정 시 당초 총액을 반환한다', async () => {
  const r = await research('2025년 성남시 예산 총액');
  assert.equal(r.evidence[0].budget_type, '추경');
  assert.equal(r.evidence[0].revision, 4);
  assert.equal(r.answer_card.rows[0].amount, 4673332396);
  const main = await research('2025년 성남시 본예산 총액');
  assert.equal(main.evidence[0].budget_type, '본예산');
  assert.equal(main.answer_card.rows[0].amount, 3829777841);
});

test('연도 비교는 각 연도의 최종 추경까지 조회하고 명시한 본예산 조건을 따른다', async () => {
  const r = await research('2024년 2026년 노인일자리 예산 비교');
  assert.equal(r.query_interpretation.comparison_budget_basis, 'latest_available_appropriation');
  assert.deepEqual(r.per_year.map(y => y.filters.year), [2024, 2026]);
  for (const y of r.per_year) {
    assert(y.edition_timeline.editions.some(e => e.budget_type === '추경' && e.revision === 4));
    assert(r.evidence.some(e => e.year === y.filters.year && e.budget_type === '추경'));
  }
  const main = await research('2024년 2026년 본예산 노인일자리 예산 비교');
  assert.deepEqual([...new Set(main.evidence.map(e => e.year))], [2024, 2026]);
  assert(main.evidence.every(e => e.budget_type === '본예산'));
});

test('결산을 명시한 질의는 결산 근거만 반환한다', async () => {
  const r = await research('2024년 결산 세출 집행액');
  assert(r.evidence.length >= 1, '근거가 1건 이상이어야 함');
  const types = r.evidence.map(e => e.budget_type);
  assert(types.every(t => t === '결산'), '편성 구분 ' + JSON.stringify(types));
});
