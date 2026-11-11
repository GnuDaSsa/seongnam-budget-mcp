// 정확한 사업명 구분("아동수당지급" vs "아동수당지급(자체)")과 구별 묶음(구는 부서가 아님). 합성 행으로 스냅샷 없이 확인한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveQuery } from '../worker/policy.js';
import { buildAnalysis } from '../worker/research-analysis.js';
import { matchBusiness, matchDistrictGroups, districtsOfName } from '../worker/analysis.js';

const DOCS = [{ document_id: 'main', title: 'm', year: 2026, budget_type: '본예산', revision: null, account_group: '일반회계' }];
const row = (department, business, budget, page, extra = {}) => ({
  level: 'business', year: 2026, account: '일반회계', budget_type: '본예산', revision: null, department, policy: '정책', unit: '단위', business,
  amount_unit: '천원', columns_verified: true, document_id: 'main', page, source_line: 1, amounts: { budget, previous: null, change: null }, ...extra,
});
const total = (department, budget, page) => ({ level: 'department', year: 2026, account: '일반회계', budget_type: '본예산', revision: null, department, document_id: 'main', page, source_line: 0, amounts: { budget } });

function scoped(query, names) {
  const a = resolveQuery({ query });
  a.policy.institution_scope = { mode: 'municipal' };
  a.departments = names.map(name => ({ name }));
  return a;
}
const run = (query, names, rows) => buildAnalysis(scoped(query, names), { documents: DOCS, loadRows: async () => rows, urlFor: (id, p) => id + '#page=' + p });

// ── #7 아동수당지급 / 아동수당지급(자체) ──
const D7 = '분당구가정복지과';
const ROWS7 = [total(D7, 30682621, 10), row(D7, '아동수당지급', 25154525, 11), row(D7, '아동수당지급(자체)', 5528096, 12)];
const Q7 = '2026년 분당구 가정복지과 일반회계 본예산에서 아동수당지급과 아동수당지급(자체)의 예산을 각각 알려줘.';

test('#7 각각: 이름이 정확히 다른 두 사업을 따로 내고 합산하지 않는다', async () => {
  const r = await run(Q7, [D7], ROWS7);
  assert.equal(r.kind, 'business_lookup');
  assert.equal(r.match_kind, 'named_items');
  assert.equal(r.status, 'matched');
  assert.deepEqual(r.items.map(i => [i.business, i.amount, i.page, i.status]), [['아동수당지급', 25154525, 11, 'matched'], ['아동수당지급(자체)', 5528096, 12, 'matched']]);
  assert.equal(r.calculated_total, null);
  assert.ok(!JSON.stringify(r).includes('30682621'));
});

test('#7 (자체) 행이 수록되지 않으면 일반 행으로 대체하지 않고 사업별로 미확인 처리한다', async () => {
  const r = await run(Q7, [D7], ROWS7.filter(x => x.business !== '아동수당지급(자체)'));
  assert.equal(r.status, 'incomplete');
  assert.deepEqual(r.items.map(i => i.business), ['아동수당지급']);
  assert.ok(r.unmatched_terms.length > 0);
  assert.equal(r.calculated_total, null);
});

test('#7 (자체)만 요청하면 같은 접두 이름의 일반 행이 답에 붙지 않는다', async () => {
  const q = '2026년 분당구 가정복지과 일반회계 본예산에서 아동수당지급(자체) 예산만 알려줘.';
  const r = await run(q, [D7], ROWS7);
  assert.deepEqual(r.rows.map(x => [x.business, x.amount]), [['아동수당지급(자체)', 5528096]]);
  const none = await run(q, [D7], ROWS7.filter(x => x.business !== '아동수당지급(자체)'));
  assert.ok(!JSON.stringify(none).includes('25154525'));
  assert.equal(none.status, 'no_name_match');
});

test('matchBusiness: 두 사업명을 요청했는데 다중 반환을 지원하지 않으면 하나로 축소하지 않는다', () => {
  const m = matchBusiness(ROWS7, '아동수당지급과 아동수당지급(자체) 각각', [D7]);
  assert.equal(m.status, 'ambiguous');
  const multi = matchBusiness(ROWS7, '아동수당지급과 아동수당지급(자체) 각각', [D7], { allowMulti: true });
  assert.equal(multi.status, 'multi_matched');
  assert.deepEqual(multi.groups.map(g => g.name), ['아동수당지급', '아동수당지급(자체)']);
});

// ── #8 스마트그린 안전쉼터 구별 ──
const D8 = '스마트도시과';
const NAME = '스마트그린 안전쉼터 조성사업';
const rows8 = (over = []) => [
  total(D8, 8000000 + 500, 20),
  row(D8, NAME + '(수정구)', 1800000, 21), row(D8, NAME + '(중원구)', 1600000, 22),
  row(D8, NAME + '(분당구 북부)', 2300000, 23), row(D8, NAME + '(분당구 남부)', 2300000, 24),
  row(D8, NAME + ' 유지관리(수정구)', 500, 25),
  ...over,
];
const Q8 = '2026년 스마트도시과 일반회계 본예산 스마트그린 안전쉼터 조성사업의 수정구 중원구 분당구별 금액과 합계는?';

test('#8 활동이 다른 후보를 제외했다면 구별 행은 보여 주되 합계를 확정하지 않는다', async () => {
  const r = await run(Q8, [D8], rows8());
  assert.equal(r.match_kind, 'district_groups');
  assert.equal(r.status, 'incomplete');
  assert.equal(r.calculated_total, null);
  assert.equal(r.geographic_groups_are_not_departments, true);
  assert.deepEqual(r.rows.map(x => [x.group, x.amount, x.page]), [['수정구', 1800000, 21], ['중원구', 1600000, 22], ['분당구', 2300000, 23], ['분당구', 2300000, 24]]);
  assert.ok(r.rows.every(x => x.department === D8));
  assert.ok(r.groups.every(g => g.subtotal === null));
  assert.equal(r.excluded_other_activity_rows, 1);
  assert.ok(!JSON.stringify(r).includes('유지관리'));
});

test('#8 구 구분이 없는 후보 행이나 부서 총액 불일치가 있으면 합계 없이 incomplete', async () => {
  const stray = await run(Q8, [D8], rows8([row(D8, NAME, 100, 26)]));
  assert.equal(stray.status, 'incomplete');
  assert.equal(stray.calculated_total, null);
  assert.ok(stray.unassigned_row_count === 1);
  const mismatch = await run(Q8, [D8], rows8().map(x => (x.level === 'department' ? { ...x, amounts: { budget: 9999999 } } : x)));
  assert.equal(mismatch.status, 'incomplete');
  assert.equal(mismatch.calculated_total, null);
  const missing = await run(Q8, [D8], rows8().filter(x => !String(x.business).includes('중원구')));
  assert.equal(missing.status, 'incomplete');
  assert.equal(missing.calculated_total, null);
  assert.equal(missing.groups.find(g => g.group === '중원구').status, 'not_found');
});

test('#8 합계를 요청하지 않으면 요청한 구의 행만 나열하고 합계를 내지 않는다', async () => {
  const r = await run('2026년 스마트도시과 일반회계 본예산 스마트그린 안전쉼터 조성사업의 수정구 금액만 알려줘.', [D8], rows8());
  assert.equal(r.calculated_total, null);
  assert.deepEqual(r.rows.map(x => [x.group, x.amount]), [['수정구', 1800000]]);
  assert.ok(!JSON.stringify(r).includes('8000000'));
});

test('#8 없는 사업명은 구별 묶음으로 바뀌지 않고 유사한 사업으로 대체되지 않는다', async () => {
  const r = await run('2026년 스마트도시과 일반회계 본예산 달나라 우주정거장 조성사업 예산은?', [D8], rows8());
  assert.equal(r.status, 'no_name_match');
  assert.ok(!JSON.stringify(r).includes('스마트그린'));
});

test('부서명에 든 구는 지역 구분으로 읽지 않는다', () => {
  const rows = [row('분당구사회복지과', '기초연금(분당구)', 5, 1)];
  assert.equal(matchDistrictGroups(rows, '2026년 분당구 사회복지과 기초연금', ['분당구사회복지과']), null);
  assert.deepEqual(districtsOfName('조성(분당 북부)'), ['분당구']);
  assert.deepEqual(districtsOfName('조성 분당 북부'), []);
  assert.deepEqual(districtsOfName('조성(분당구 북부)'), ['분당구']);
  assert.deepEqual(districtsOfName('조성(분당북부)'), ['분당구']);
});
