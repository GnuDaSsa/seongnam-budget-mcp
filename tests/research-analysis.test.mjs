// budget_research analysis 블록: 이슈 #2·#4·#5·#6 재현 질문을 실제 2026 세출명세서 행으로 확인한다.
// 로컬 snapshot이 없으면 실데이터 사례는 건너뛴다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveQuery } from '../worker/policy.js';
import { buildAnalysis, analysisEligible, businessResidue } from '../worker/research-analysis.js';
import { findStatementDocuments } from '../worker/analysis.js';
import { parseStatementRows } from '../worker/statement-rows.js';
import { researchGuidance } from '../worker/research-guidance.js';
import { hasSnapshot, catalog, loadStatementPages } from './helpers/statement-snapshot.mjs';

function scoped(query, departments = []) {
  const a = resolveQuery({ query });
  a.policy.institution_scope = { mode: 'municipal' };
  a.departments = departments.map(name => ({ name }));
  return a;
}

const rowCache = new Map();
const loadRows = doc => {
  if (!rowCache.has(doc.document_id)) rowCache.set(doc.document_id, parseStatementRows(loadStatementPages(doc.document_id), {
    document_id: doc.document_id, year: doc.year, edition: doc.budget_type === '추경' ? doc.revision + '회 추경' : '본예산',
    account: doc.account_group === '원문 확인' ? null : doc.account_group,
  }));
  return rowCache.get(doc.document_id);
};
const run = (query, departments) => buildAnalysis(scoped(query, departments), { documents: findStatementDocuments(catalog()).documents, loadRows, urlFor: (id, p) => id + '#page=' + p });
const live = { skip: !hasSnapshot && 'local snapshot not present' };

test('행 계산 대상은 시 세출 단일 연도 질문으로 제한한다', () => {
  assert.equal(analysisEligible(scoped('2026년 본예산 세출 중 가장 큰 세부사업 5개')), true);
  const all = scoped('역대 기초연금 예산'); all.year_scope = 'all';
  assert.equal(analysisEligible(all), false);
  const topic = scoped('2026년 AI 사업'); topic.topic_intent = { content_query: 'AI' };
  assert.equal(analysisEligible(topic), false);
});

test('부서명만 있는 질문은 사업 확인 대상으로 보지 않는다', () => {
  assert.deepEqual(businessResidue('2026년 분당구건설과 예산', ['분당구건설과']), []);
  assert.ok(businessResidue('2026년 분당구건설과 달나라 지하철 조성사업 예산', ['분당구건설과']).length > 0);
});

test('주입한 행 로더가 없거나 의도가 없으면 analysis를 만들지 않는다', async () => {
  assert.equal(await buildAnalysis(scoped('2026년 본예산 세출 중 가장 큰 세부사업 5개'), { documents: [] }), null);
  assert.equal(await buildAnalysis(scoped('2026년 성남시 본예산 총예산'), { documents: [], loadRows: async () => [] }), null);
});

test('#2 회계 미지정 세부사업 상위 5개는 일반회계 범위로 한정해 표시한다', live, async () => {
  const r = await run('2026년 본예산 세출 중 예산액이 가장 큰 세부사업 5개와 각각의 금액을 알려줘.');
  assert.equal(r.kind, 'ranking');
  assert.equal(r.status, 'partial_scope');
  assert.equal(r.scope.account_group, '일반회계');
  assert.deepEqual(r.items.map(i => [i.name, i.department, i.amount]), [
    ['인력운영비', '회계과', 247882961],
    ['기초연금', '수정구사회복지과', 114003724],
    ['보전지출(장기미집행공원지방채원리금상환)(자체)', '공원과', 112000000],
    ['기초연금', '중원구사회복지과', 110922543],
    ['기초연금', '분당구사회복지과', 83191907],
  ]);
  assert.equal(r.coverage.reconciled, 160);
  assert.equal(r.coverage.total, 160);
  assert.ok(r.coverage.uncovered_accounts.includes('상수도'));
  assert.ok(r.items.every(i => i.page && i.page_url));
  const g = researchGuidance('2026년 본예산 세출 중 예산액이 가장 큰 세부사업 5개', null, { level: 'verified' }, r);
  assert.match(g.note, /요청한 전체 범위\(모든 회계 또는 추경 반영\)의 순위는 계산되지 않았습니다/);
  assert.match(g.note, /회계 미지정: 일반회계/);
});

test('#2 일반회계 부서 총액은 독립 총액 대조 전까지 부분 범위로 표시한다', live, async () => {
  const r = await run('2026년 본예산 중 일반회계 부서별 총액 상위 3개 부서와 금액을 알려줘');
  assert.equal(r.status, 'partial_scope');
  assert.deepEqual(r.items.map(i => [i.name, i.amount]), [['회계과', 286474241], ['대중교통과', 200418594], ['수정구사회복지과', 185986330]]);
});

test('#2 401-01 순위는 통계목 행 기준이며 세부사업 총액과 섞지 않는다', live, async () => {
  const r = await run('2026년 본예산 분당구 구조물관리과에서 세부사업 총액이 아니라 401-01 시설비 금액이 가장 큰 사업은?', ['분당구구조물관리과']);
  assert.equal(r.kind, 'ranking');
  assert.equal(r.scope.level, 'stat');
  assert.equal(r.scope.code, '401-01');
  assert.equal(r.edition_basis, 'query');
  assert.equal(r.items[0].name.replace(/\s/g, ''), '지하차도(터널)시설물유지관리보수공사');
  assert.equal(r.items[0].amount, 5347500);
  assert.equal(r.items[0].page, 1342);
  assert.equal(r.items[1].amount, 4426000);
  assert.equal(r.items[2].amount, 3739223);
  assert.equal(r.total_candidates, 21);
});

test('#4 세 구 사회복지과 기초연금은 행별 금액과 계산 합계를 낸다', live, async () => {
  const depts = ['수정구사회복지과', '중원구사회복지과', '분당구사회복지과'];
  const r = await run('2026년 본예산 기초연금 지급액을 수정구·중원구·분당구 사회복지과별로 각각 보여주고 세 구 합계를 계산해줘.', depts);
  assert.equal(r.kind, 'department_sum');
  assert.equal(r.status, 'calculated');
  assert.equal(r.calculated_total.amount, 308118174);
  assert.equal(r.calculated_total.calculated, true);
  assert.deepEqual(r.rows.map(x => x.page).sort((x, y) => x - y), [883, 1110, 1291]);
});

test('#4 요청 부서 하나가 빠지면 합계를 만들지 않고 누락 부서를 밝힌다', live, async () => {
  const r = await run('2026년 본예산 기초연금 수정구·중원구·분당구 사회복지과 합계', ['수정구사회복지과', '중원구사회복지과', '분당구없는과']);
  assert.notEqual(r.status, 'calculated');
  assert.equal(r.calculated_total ?? r.total ?? null, null);
  assert.ok((r.missing_departments || []).includes('분당구없는과'));
});

test('#5 본예산과 1회 추경 기정액·경정액·증감을 따로 비교한다', live, async () => {
  const r = await run('2026년 중원구 사회복지과 기초연금 본예산과 1회 추경에서 기정액 경정액 증감액을 각각 비교해줘.', ['중원구사회복지과']);
  assert.equal(r.kind, 'edition_compare');
  assert.equal(r.status, 'compared');
  assert.equal(r.initial.amount, 110922543);
  const rev = r.revisions.find(x => x.revision === 1);
  assert.equal(rev.revised_amount, 116417588);
  assert.equal(rev.previous_amount, 110922543);
  assert.equal(rev.amendment_change, 5495045);
  assert.equal(rev.page, 351);
  assert.equal(rev.previous_matches_initial, true);
});

test('#6a 없는 사업은 no_name_match이며 0원을 금지한다', live, async () => {
  const r = await run('2026년 본예산 분당구 건설과에 달나라 지하철 조성사업 예산이 없는 게 확실해? 0원으로 보고서에 적어도 돼?', ['분당구건설과']);
  assert.equal(r.status, 'no_name_match');
  assert.ok(r.department_rows_checked.business_rows > 0);
  assert.equal(r.source_pages.length, 0);
  const g = researchGuidance('달나라 지하철', {}, { level: 'semantic_only' }, r);
  assert.match(g.note, /^미확인/);
});

test('편성 미지정은 임의 본예산 집계를 막고 미검증 연도는 행 집계를 막는다', live, async () => {
  const missing = await run('2026년 분당구 구조물관리과 401-01 시설비가 가장 큰 사업은?', ['분당구구조물관리과']);
  assert.equal(missing.status, 'edition_required');
  const otherYear = await run('2025년 본예산 세부사업 중 가장 큰 사업은?');
  assert.equal(otherYear.status, 'year_not_validated');
});

test('#6b 수정구 기초연금 재원은 국·도·시 합이 예산액과 맞는다', live, async () => {
  const r = await run('2026년 수정구 사회복지과 기초연금 본예산의 국비 도비 시비와 합계를 원문 근거로 알려줘.', ['수정구사회복지과']);
  assert.equal(r.kind, 'funding');
  assert.equal(r.status, 'matched');
  const parts = Object.fromEntries(r.funding.parts.map(p => [p.label, p.amount]));
  assert.equal(parts['국'] ?? parts['국비'], 91203571);
  assert.equal(parts['도'] ?? parts['도비'], 4560031);
  assert.equal(parts['시'] ?? parts['시비'], 18240122);
  assert.equal(r.funding.sum, 114003724);
  assert.equal(r.source_pages[0].page, 883);
});

// ── #5 제외한 편성은 비교 대상이 아니며 읽지도 반환하지도 않는다(합성 문서·행, 스냅샷 불필요) ──
const DEPT = '중원구사회복지과';
const synthRow = (extra) => ({
  level: 'business', year: 2026, account: '일반회계', department: DEPT, policy: '노인복지', unit: '기초연금', business: '기초연금',
  amount_unit: '천원', columns_verified: true, page: 1, source_line: 1, ...extra,
});
const SYNTH_DOCS = [
  { document_id: 'main', title: 'm', year: 2026, budget_type: '본예산', revision: null, account_group: '일반회계' },
  { document_id: 'rev1', title: 'r1', year: 2026, budget_type: '추경', revision: 1, account_group: '원문 확인' },
];
const SYNTH_ROWS = {
  main: [synthRow({ document_id: 'main', budget_type: '본예산', revision: null, amounts: { budget: 100, previous: null, change: null } })],
  rev1: [synthRow({ document_id: 'rev1', budget_type: '추경', revision: 1, amounts: { budget: 130, previous: 100, change: 30 } })],
};
async function runSynthetic(query) {
  const read = [];
  const a = scoped(query, [DEPT]);
  const r = await buildAnalysis(a, { documents: SYNTH_DOCS, loadRows: async doc => { read.push(doc.document_id); return SYNTH_ROWS[doc.document_id]; }, urlFor: (id, p) => id + '#page=' + p });
  return { a, r, read };
}

test('#5 음성 대조: 본예산만 요청하고 추경 제외면 비교·추경 문서 읽기·추경 행 반환이 없다', async () => {
  for (const q of [
    '2026년 중원구 사회복지과 기초연금 본예산만 알려줘. 추경은 제외해줘.',
    '2026년 중원구 사회복지과 기초연금 본예산 알려줘 추경 빼고',
    '2026년 중원구 사회복지과 기초연금 본예산 추경 제외',
  ]) {
    const { a, r, read } = await runSynthetic(q);
    assert.ok(a.policy.excluded_budget_types.includes('추경'), q);
    assert.equal(a.budget_type, '본예산', q);
    assert.notEqual(r.kind, 'edition_compare', q);
    assert.ok(!r.intent.kinds.includes('edition_compare'), q);
    assert.deepEqual(read, ['main'], q);
    assert.ok(!r.documents_read.some(d => d.edition !== '본예산'), q);
    assert.ok(!JSON.stringify(r).includes('rev1'), q);
    assert.ok(!(r.rows ?? []).some(x => x.budget_type === '추경'), q);
    assert.equal(r.status, 'matched', q);
    assert.equal(r.rows[0].amount, 100, q);
  }
});

test('#5 추경 제외인데 편성이 지정되지 않으면 추경을 임의로 고르지 않고 중단한다', async () => {
  const { r, read } = await runSynthetic('2026년 중원구 사회복지과 기초연금 추경 제외하고 알려줘');
  assert.equal(r.status, 'edition_required');
  assert.deepEqual(read, []);
});

test('#5 양성 대조: 본예산과 1회 추경 비교는 두 편성을 모두 읽어 edition_compare를 만든다', async () => {
  const { a, r, read } = await runSynthetic('2026년 중원구 사회복지과 기초연금 본예산과 1회 추경 비교');
  assert.deepEqual(a.policy.excluded_budget_types, []);
  assert.equal(r.kind, 'edition_compare');
  assert.equal(r.status, 'compared');
  assert.deepEqual([...read].sort(), ['main', 'rev1']);
  assert.equal(r.initial.amount, 100);
  assert.equal(r.revisions[0].revision, 1);
  assert.equal(r.revisions[0].revised_amount, 130);
});

// ── #4 차액 질문은 합계가 아니라 minuend - subtrahend를 낸다(합성 문서·행, 스냅샷 불필요) ──
const D_SUJEONG = '수정구사회복지과', D_JUNGWON = '중원구사회복지과', D_BUNDANG = '분당구사회복지과';
const diffRow = (department, budget, extra = {}) => synthRow({ document_id: 'main', budget_type: '본예산', revision: null, department, amounts: { budget, previous: null, change: null }, ...extra });
const DIFF_DOCS = [{ document_id: 'main', title: 'm', year: 2026, budget_type: '본예산', revision: null, account_group: '일반회계' }];
const DIFF_ROWS = [diffRow(D_SUJEONG, 114003724, { page: 883 }), diffRow(D_JUNGWON, 110922543, { page: 1110 }), diffRow(D_BUNDANG, 83191907, { page: 1291 })];
async function runDiff(query, departments, rows = DIFF_ROWS) {
  return buildAnalysis(scoped(query, departments), { documents: DIFF_DOCS, loadRows: async () => rows, urlFor: (id, p) => id + '#page=' + p });
}
const ISSUE_QUERY = '2026년 기초연금 일반회계 본예산 중 수정구와 분당구 사회복지과의 차액은? 중원구는 제외해줘.';

test('#4 차액: 방향이 없는 두 구의 절대 차이와 피연산자·단위를 낸다(합계 아님)', async () => {
  const r = await runDiff(ISSUE_QUERY, [D_BUNDANG, D_SUJEONG]);
  assert.equal(r.kind, 'department_difference');
  assert.equal(r.status, 'calculated');
  assert.ok(r.intent.kinds.includes('department_difference'));
  assert.ok(!r.intent.kinds.includes('department_sum'));
  assert.equal(r.calculated_total, null);
  assert.equal(r.total, null);
  assert.equal(r.difference.direction_known, false);
  assert.equal(r.difference.signed_difference, null);
  assert.equal(r.difference.absolute_difference, 30811817);
  assert.equal(r.difference.unit, '천원');
  assert.equal(r.difference.operation, 'absolute_difference');
  assert.equal(r.difference.operands[0].department, D_SUJEONG);
  assert.equal(r.difference.operands[0].amount, 114003724);
  assert.equal(r.difference.operands[1].department, D_BUNDANG);
  assert.equal(r.difference.operands[1].amount, 83191907);
  assert.deepEqual(r.excluded_departments, [D_JUNGWON]);
  assert.ok(!r.difference.operands.some(o => o.department === D_JUNGWON));
  assert.notEqual(r.difference.signed_difference, 197195631);
  assert.equal(r.scope.edition, '본예산');
  assert.equal(r.scope.account_group, '일반회계');
  assert.equal(r.scope.year, 2026);
  assert.deepEqual(r.source_pages.map(p => p.page).sort((x, y) => x - y), [883, 1291]);
});

test('#4 차액: 질문 순서가 반대여도 방향을 임의로 확정하지 않는다', async () => {
  const r = await runDiff('2026년 기초연금 일반회계 본예산 분당구와 수정구 사회복지과의 차액은?', [D_SUJEONG, D_BUNDANG]);
  assert.equal(r.status, 'calculated');
  assert.equal(r.difference.operands[0].department, D_BUNDANG);
  assert.equal(r.difference.operands[1].department, D_SUJEONG);
  assert.equal(r.difference.signed_difference, null);
  assert.equal(r.difference.absolute_difference, 30811817);
});

test('#4 차액: 중원구를 포함해 나열해도 제외 표현이 있으면 피연산자에서 뺀다', async () => {
  const r = await runDiff('2026년 기초연금 일반회계 본예산 수정구 중원구 분당구 사회복지과 중 중원구는 제외하고 차이를 알려줘', [D_SUJEONG, D_JUNGWON, D_BUNDANG]);
  assert.equal(r.status, 'calculated');
  assert.deepEqual(r.excluded_departments, [D_JUNGWON]);
  assert.deepEqual(r.difference.operands.map(o => o.department), [D_SUJEONG, D_BUNDANG]);
  assert.equal(r.difference.absolute_difference, 30811817);
});

test('#4 차액: 방향을 뒤집을 수 있는 표현은 방향을 확정하지 않고 절대값만 낸다', async () => {
  const r = await runDiff('2026년 기초연금 일반회계 본예산 수정구와 분당구 사회복지과 중 분당구가 수정구보다 얼마나 덜 편성됐어? 차이는?', [D_SUJEONG, D_BUNDANG]);
  assert.equal(r.status, 'calculated');
  assert.equal(r.difference.direction_ambiguous, true);
  assert.equal(r.difference.signed_difference, null);
  assert.equal(r.difference.minuend, null);
  assert.equal(r.difference.absolute_difference, 30811817);
  assert.equal(r.difference.operands.length, 2);
  assert.equal(r.difference.expression, null);
});

test('#4 차액: 요청 부서 행이 없으면 숫자 없이 incomplete로 중단한다', async () => {
  const rows = DIFF_ROWS.filter(x => x.department !== D_BUNDANG);
  const r = await runDiff(ISSUE_QUERY, [D_SUJEONG, D_BUNDANG], rows);
  assert.equal(r.kind, 'department_difference');
  assert.notEqual(r.status, 'calculated');
  assert.equal(r.difference, undefined);
  assert.equal(r.calculated_total, null);
  assert.deepEqual(r.missing_departments, [D_BUNDANG]);
});

test('#4 차액: 제외하지 않은 부서가 둘을 넘으면 합계로 대체하지 않고 중단한다', async () => {
  const r = await runDiff('2026년 기초연금 일반회계 본예산 수정구 중원구 분당구 사회복지과의 차액은?', [D_SUJEONG, D_JUNGWON, D_BUNDANG]);
  assert.equal(r.kind, 'department_difference');
  assert.equal(r.status, 'too_many_departments');
  assert.equal(r.difference, undefined);
  assert.equal(r.calculated_total, null);
  assert.ok(!/197195631|308118174/.test(JSON.stringify(r)));
});

test('#4 차액: 한 부서만 확인되고 다른 구가 질문에 있으면 단일 행 답으로 넘기지 않는다', async () => {
  const r = await runDiff('2026년 기초연금 일반회계 본예산 수정구와 분당구 사회복지과의 차액은?', [D_SUJEONG]);
  assert.equal(r.kind, 'department_difference');
  assert.equal(r.status, 'insufficient_departments');
  assert.equal(r.difference, undefined);
});

test('#4 차액과 합계를 함께 묻거나 편성이 모호하면 계산하지 않는다', async () => {
  const both = await runDiff('2026년 기초연금 일반회계 본예산 수정구와 분당구 사회복지과의 차액과 합계', [D_SUJEONG, D_BUNDANG]);
  assert.equal(both.status, 'ambiguous_operation');
  assert.equal(both.difference, undefined);
  const edition = await runDiff('2026년 기초연금 일반회계 수정구와 분당구 사회복지과의 본예산과 추경 차액', [D_SUJEONG, D_BUNDANG]);
  assert.notEqual(edition.status, 'calculated');
  assert.equal(edition.difference, undefined);
  const none = await runDiff('2026년 기초연금 일반회계 수정구와 분당구 사회복지과의 차액은?', [D_SUJEONG, D_BUNDANG]);
  assert.equal(none.status, 'edition_required');
});

test('#4 일반 합계 질문은 차액 변경 후에도 합산한다', async () => {
  const r = await runDiff('2026년 기초연금 일반회계 본예산 수정구와 분당구 사회복지과의 합계는?', [D_SUJEONG, D_BUNDANG]);
  assert.equal(r.kind, 'department_sum');
  assert.equal(r.status, 'calculated');
  assert.equal(r.calculated_total.amount, 197195631);
  assert.equal(r.difference, undefined);
  const three = await runDiff('2026년 기초연금 일반회계 본예산 수정구 중원구 분당구 사회복지과 합계', [D_SUJEONG, D_JUNGWON, D_BUNDANG]);
  assert.equal(three.calculated_total.amount, 308118174);
});
