// 정확한 사업명 구분("아동수당지급" vs "아동수당지급(자체)")과 구별 묶음(구는 부서가 아님). 합성 행으로 스냅샷 없이 확인한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveQuery } from '../worker/policy.js';
import { buildAnalysis } from '../worker/research-analysis.js';
import { matchBusiness, matchDistrictGroups, districtsOfName, parseExclusions, rowExcluded } from '../worker/analysis.js';

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

test('쉼표로 연결된 제외 목록은 일부만 제외한 결과를 확정하지 않는다', async () => {
  const q = '2026년 분당구 가정복지과 일반회계 본예산에서 아동수당지급을 알려줘. 아동수당지급, 아동수당지급(자체)는 제외해줘.';
  const r = await run(q, [D7], ROWS7);
  assert.notEqual(r.status, 'matched');
  assert.ok(r.exclusions?.unmatched_terms?.includes('쉼표로 연결된 제외 목록'));
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

// ── #8 띄어 쓴 활동어 제외 구절("유지 관리는 제외")은 붙여 쓴 형태와 같은 결과여야 한다 ──
const NAME8R = '스마트그린·안전쉼터조성';
const rows8real = () => [
  total(D8, 7200000 + 500, 20),
  row(D8, '2026년수정구일원' + NAME8R, 1800000, 21), row(D8, '2026년중원구일원' + NAME8R, 1600000, 22),
  row(D8, '2026년분당구북부일원' + NAME8R, 1800000, 23), row(D8, '2026년분당구남부일원' + NAME8R, 2000000, 24),
  row(D8, '2026년수정구일원스마트그린·안전쉼터유지관리', 500, 25),
];
const Q8S = '2026년 스마트도시과 일반회계 본예산 스마트 그린 안전 쉼터 조성의 수정구, 중원구, 분당구별 금액과 합계는? 유지 관리는 제외해줘.';

test('#8 띄어 쓴 활동어 제외 구절은 단일 활동 낱말처럼 행을 제외한다', () => {
  const a = parseExclusions('합계는? 유지 관리는 제외해줘.');
  assert.deepEqual(a.items.map(x => [x.term, x.multiword]), [['유지관리', true]]);
  assert.equal(rowExcluded('스마트그린 안전쉼터 유지관리(분당구)', a.items), true);
  const b = parseExclusions('유지 보수는 제외해줘');
  assert.equal(rowExcluded('도시정보시설운영및유지보수', b.items), true);
  // 대조: 활동 낱말이 아닌 구절이나 앞에 다른 낱말이 붙은 구절은 다른 행을 지우지 않는다.
  assert.equal(rowExcluded('스마트그린 안전쉼터 유지관리', parseExclusions('안전 관리는 제외해줘').items), false);
  assert.equal(rowExcluded('스마트그린 안전쉼터 유지관리', parseExclusions('시설 유지 관리는 제외해줘').items), false);
  assert.equal(rowExcluded('스마트그린 안전쉼터 조성(수정구)', parseExclusions('쉼터 조성은 제외해줘').items), false);
});

test('#8 띄어 쓴 유지 관리 제외 질문은 붙여 쓴 질문과 같은 합계를 낸다', async () => {
  const r = await run(Q8S, [D8], rows8real());
  assert.equal(r.status, 'calculated');
  assert.equal(r.calculated_total.amount, 7200000);
  assert.deepEqual(r.exclusions.unmatched_terms, []);
  const joined = await run(Q8S.replace('유지 관리', '유지관리'), [D8], rows8real());
  assert.equal(joined.calculated_total.amount, r.calculated_total.amount);
  assert.equal(joined.exclusions.excluded_row_count, r.exclusions.excluded_row_count);
});

test('부서명에 든 구는 지역 구분으로 읽지 않는다', () => {
  const rows = [row('분당구사회복지과', '기초연금(분당구)', 5, 1)];
  assert.equal(matchDistrictGroups(rows, '2026년 분당구 사회복지과 기초연금', ['분당구사회복지과']), null);
  assert.deepEqual(districtsOfName('조성(분당 북부)'), ['분당구']);
  assert.deepEqual(districtsOfName('조성 분당 북부'), []);
  assert.deepEqual(districtsOfName('조성(분당구 북부)'), ['분당구']);
  assert.deepEqual(districtsOfName('조성(분당북부)'), ['분당구']);
});

// ── 제외 구절: 마지막 낱말만으로 다른 사업을 지우지 않는다(합성 행, 스냅샷 불필요) ──
const bizRow = (business, department = '가정복지과') => ({ level: 'business', business, department, page: 1, source_line: 1 });

test('제외 구절: 여러 낱말 구절은 전체를 보존하고 마지막 낱말만 쓰지 않는다', () => {
  const ex = parseExclusions('달나라 지하철 조성사업은 제외해줘');
  assert.deepEqual(ex.items.map(x => [x.phrase, x.term, x.multiword]), [['달나라 지하철 조성사업', '달나라지하철조성사업', true]]);
  assert.deepEqual(ex.items[0].tokens, ['달나라', '지하철', '조성사업']);
});

test('제외 구절: 앞 문장·조사·편성·부서 낱말은 구절에 넣지 않는다', () => {
  assert.deepEqual(parseExclusions('2026년 분당구 가정복지과 일반회계 본예산에서 아동수당지급(자체)은 빼고 아동수당지급 금액만 알려줘.').terms, ['아동수당지급(자체)']);
  assert.deepEqual(parseExclusions('아동수당지급 예산만 알려줘. 아동수당지급(자체)는 제외해줘.').terms, ['아동수당지급(자체)']);
  assert.deepEqual(parseExclusions('스마트그린 안전쉼터 조성의 구별 금액과 합계는? 유지관리는 제외해줘.').terms, ['유지관리']);
});

test('제외 구절: 같은 이름 행 조성사업이 있어도 다른 구절은 그 행을 지우지 않고 미일치로 남긴다', () => {
  const ex = parseExclusions('달나라 지하철 조성사업은 제외해줘');
  assert.equal(rowExcluded('조성사업', ex.items), false);
  assert.equal(rowExcluded('지하철 유지관리', ex.items), false);
  const rows = [bizRow('조성사업'), bizRow('아동수당지급')];
  const m = matchBusiness(rows, '달나라 지하철 조성사업은 제외해줘 조성사업 예산', ['가정복지과']);
  assert.deepEqual(m.exclusions.unmatched_terms, ['달나라 지하철 조성사업']);
  assert.equal(m.exclusions.excluded_row_count, 0);
});

test('제외 구절: 활동 낱말로 끝나는 여러 낱말 구절은 활동 낱말 포함으로 다른 행을 지우지 않는다', () => {
  const ex = parseExclusions('달나라 시설 유지관리는 제외해줘');
  assert.equal(ex.items[0].multiword, true);
  assert.equal(rowExcluded('스마트그린 유지관리', ex.items), false);
  assert.equal(rowExcluded('달나라시설유지관리', ex.items), true);
});

test('제외 구절: 공백만 다른 정확한 이름은 제외한다', () => {
  const ex = parseExclusions('달나라 지하철 조성사업은 제외해줘');
  assert.equal(rowExcluded('달나라지하철조성사업', ex.items), true);
  assert.equal(rowExcluded('달나라 지하철 조성사업', ex.items), true);
  const m = matchBusiness([bizRow('달나라지하철조성사업'), bizRow('아동수당지급')], '달나라 지하철 조성사업은 제외해줘', ['가정복지과']);
  assert.deepEqual(m.exclusions.unmatched_terms, []);
  assert.equal(m.exclusions.excluded_row_count, 1);
});

test('제외 구절: 아동수당지급(자체) 제외는 자기 자신만 지우고 아동수당지급은 남긴다', () => {
  const ex = parseExclusions('아동수당지급(자체)는 제외해줘');
  assert.equal(rowExcluded('아동수당지급(자체)', ex.items), true);
  assert.equal(rowExcluded('아동수당지급', ex.items), false);
  const m = matchBusiness([bizRow('아동수당지급'), bizRow('아동수당지급(자체)')], '아동수당지급 금액 알려줘. 아동수당지급(자체)는 제외해줘.', ['가정복지과']);
  assert.deepEqual(m.exclusions.unmatched_terms, []);
  assert.equal(m.exclusions.excluded_row_count, 1);
});

test('제외 구절: 단일 낱말 정확 제외와 없는 낱말의 미일치 보고', () => {
  const ex = parseExclusions('기초연금은 제외해줘');
  assert.equal(rowExcluded('기초연금', ex.items), true);
  assert.equal(rowExcluded('기초연금지원', ex.items), false);
  const m = matchBusiness([bizRow('아동수당지급')], '아동수당지급 예산. 없는사업은 제외해줘.', ['가정복지과']);
  assert.deepEqual(m.exclusions.unmatched_terms, ['없는사업']);
});

test('제외 구절: 단일 활동 낱말(유지관리·조성)은 이름 포함으로 제외한다', () => {
  const ex = parseExclusions('유지관리는 제외해줘');
  assert.equal(ex.items[0].multiword, false);
  assert.equal(rowExcluded('스마트그린 안전쉼터 유지관리(분당구)', ex.items), true);
  assert.equal(rowExcluded('스마트그린 안전쉼터 조성(분당구)', ex.items), false);
  assert.equal(rowExcluded('스마트그린 조성', parseExclusions('조성은 제외해줘').items), true);
});
