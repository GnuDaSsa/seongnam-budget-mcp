import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {detectAnalyticIntent} from '../worker/analytic-intent.js';

const DEPARTMENTS = ['예산과', '회계과', '대중교통과', '공원과', '구조물관리과', '분당구구조물관리과', '수정구사회복지과', '중원구사회복지과', '분당구사회복지과', '분당구건설과'];

test('issue #2: top-5 세부사업 by amount is a business ranking with N=5', () => {
 const r = detectAnalyticIntent('2026년 본예산 세출 중 예산액이 가장 큰 세부사업 5개와 각각의 금액을 알려줘.', {departments: DEPARTMENTS});
 assert.deepEqual(r.ranking, {direction: 'desc', n: 5, level: 'business', code: null, department: null});
 assert.deepEqual(r.kinds, ['ranking']);
 assert.equal(r.explicit_edition, true);
 assert.equal(r.explicit_account, null);
 assert.equal(r.department_sum, false);
 assert.equal(r.edition_compare, false);
});

test('issue #2: top-3 부서 by 총액 is a department ranking, account stated', () => {
 const r = detectAnalyticIntent('2026년 본예산 중 일반회계 부서별 총액 상위 3개 부서와 금액을 알려줘', {departments: DEPARTMENTS});
 assert.deepEqual(r.ranking, {direction: 'desc', n: 3, level: 'department', code: null, department: null});
 assert.equal(r.explicit_account, '일반회계');
 assert.equal(r.explicit_edition, true);
 assert.deepEqual(r.kinds, ['ranking']);
});

test('issue #2 stat: 401-01 시설비 under a named department is level stat, not business, despite 세부사업 wording', () => {
 const r = detectAnalyticIntent('2026년 분당구 구조물관리과에서 세부사업 총액이 아니라 401-01 시설비 금액이 가장 큰 사업은?', {departments: DEPARTMENTS});
 assert.equal(r.ranking.level, 'stat');
 assert.equal(r.ranking.code, '401-01');
 assert.equal(r.ranking.direction, 'desc');
 assert.equal(r.ranking.n, 1);
 assert.equal(r.ranking.department, '분당구구조물관리과');
 assert.equal(r.explicit_edition, false, 'edition must not be assumed');
 assert.equal(r.explicit_account, null, 'account must not be assumed');
});

test('a bare 통계목 or 시설비 wording is stat even without a printed code', () => {
 assert.equal(detectAnalyticIntent('2026년 시설비 금액이 가장 큰 부서는?').ranking.level, 'stat');
 assert.equal(detectAnalyticIntent('2026년 통계목별 금액 최대 사업').ranking.level, 'stat');
 assert.equal(detectAnalyticIntent('2026년 401-01 시설비 금액이 가장 큰 사업은?').ranking.code, '401-01');
});

test('issue #4: three district departments summed, no ranking', () => {
 const r = detectAnalyticIntent('2026년 본예산 기초연금 지급액을 수정구·중원구·분당구 사회복지과별로 각각 보여주고 세 구 합계를 계산해줘.', {departments: DEPARTMENTS});
 assert.equal(r.department_sum, true);
 assert.equal(r.ranking, null);
 assert.deepEqual(r.kinds, ['department_sum']);
 assert.equal(r.explicit_edition, true);
 assert.equal(r.explicit_account, null);
});

test('district sum fallback without a departments list counts distinct 구 names', () => {
 assert.equal(detectAnalyticIntent('수정구·중원구·분당구 기초연금 합계를 알려줘').department_sum, true);
 assert.equal(detectAnalyticIntent('수정구 기초연금 합계를 알려줘').department_sum, false);
});

test('issue #5: 본예산 with 1회 추경 and 기정액·경정액·증감 is an edition comparison', () => {
 const r = detectAnalyticIntent('2026년 중원구 사회복지과 기초연금 본예산과 1회 추경에서 기정액 경정액 증감액을 각각 비교해줘.', {departments: DEPARTMENTS});
 assert.equal(r.edition_compare, true);
 assert.equal(r.explicit_edition, true);
 assert.equal(r.department_sum, false);
 assert.equal(r.ranking, null);
 assert.deepEqual(r.kinds, ['edition_compare']);
});

test('본예산 with 추경 alone (no 기정액 wording) is still an edition comparison; 본예산 alone is not', () => {
 assert.equal(detectAnalyticIntent('2026년 본예산과 추경 차이').edition_compare, true);
 assert.equal(detectAnalyticIntent('2026년 본예산 총액').edition_compare, false);
});

test('issue #6a: unfound-item question is not a ranking and carries no analytic kinds', () => {
 const r = detectAnalyticIntent('2026년 분당구 건설과에 달나라 지하철 조성사업 예산이 없는 게 확실해? 0원으로 보고서에 적어도 돼?', {departments: DEPARTMENTS});
 assert.equal(r.ranking, null);
 assert.deepEqual(r.kinds, []);
 assert.equal(r.department_sum, false);
 assert.equal(r.edition_compare, false);
 assert.equal(r.funding, false);
});

test('issue #6b: 국비 도비 시비 breakdown with 합계 for one department is funding, not a department sum', () => {
 const r = detectAnalyticIntent('2026년 수정구 사회복지과 기초연금 본예산의 국비 도비 시비와 합계를 원문 근거로 알려줘.', {departments: DEPARTMENTS});
 assert.equal(r.funding, true);
 assert.equal(r.department_sum, false);
 assert.equal(r.ranking, null);
 assert.deepEqual(r.kinds, ['funding']);
 assert.equal(r.edition_compare, false);
});

test('국도비 and 재원 also count as funding', () => {
 assert.equal(detectAnalyticIntent('국도비 구성 알려줘').funding, true);
 assert.equal(detectAnalyticIntent('재원별 금액').funding, true);
});

test('예산과 is never a ranking word, and 예산 alone is not a ranking', () => {
 assert.equal(detectAnalyticIntent('2026년 예산과 총예산 알려줘', {departments: DEPARTMENTS}).ranking, null);
 assert.equal(detectAnalyticIntent('2026년 예산과 본예산 총액', {departments: DEPARTMENTS}).ranking, null);
 assert.equal(detectAnalyticIntent('2026년 예산 알려줘').ranking, null);
 assert.equal(detectAnalyticIntent('2026년 예산액 확인').ranking, null);
});

test('예산과 can name a department only in its recognised contexts, and then a ranking keeps it as the scope', () => {
 const r = detectAnalyticIntent('2026년 예산과에서 가장 큰 사업은?', {departments: DEPARTMENTS});
 assert.equal(r.ranking.department, '예산과');
 assert.equal(r.ranking.level, 'business');
});

test('ranking direction and N parsing', () => {
 assert.deepEqual(detectAnalyticIntent('가장 작은 사업 3개').ranking, {direction: 'asc', n: 3, level: 'business', code: null, department: null});
 assert.equal(detectAnalyticIntent('최소 금액 사업').ranking.direction, 'asc');
 assert.equal(detectAnalyticIntent('하위 2개 사업').ranking.n, 2);
 assert.equal(detectAnalyticIntent('TOP 10 사업').ranking.n, 10);
 assert.equal(detectAnalyticIntent('최대 사업').ranking.n, 1);
 assert.equal(detectAnalyticIntent('1위 사업').ranking.n, 1);
 assert.equal(detectAnalyticIntent('사업 순위 알려줘').ranking.n, null, 'bare 순위 without N leaves n null');
});

test('explicit account is the earliest mentioned account; absent account stays null', () => {
 assert.equal(detectAnalyticIntent('상수도 사업 중 가장 큰 것').explicit_account, '상수도');
 assert.equal(detectAnalyticIntent('기타특별회계 가장 큰 사업').explicit_account, '기타특별회계');
 assert.equal(detectAnalyticIntent('가장 큰 사업').explicit_account, null);
});

test('explicit edition is reported only when stated', () => {
 assert.equal(detectAnalyticIntent('가장 큰 사업').explicit_edition, false);
 assert.equal(detectAnalyticIntent('1회 추경 가장 큰 사업').explicit_edition, true);
 assert.equal(detectAnalyticIntent('2026년 결산 가장 큰 사업').explicit_edition, true);
});

test('defensive input handling and non-string query', () => {
 const r = detectAnalyticIntent(undefined);
 assert.deepEqual(r.kinds, []);
 assert.equal(r.ranking, null);
 assert.equal(detectAnalyticIntent(null, {departments: undefined}).funding, false);
});

test('accepts departments given as strings or {key,name} objects', () => {
 const asObjects = DEPARTMENTS.map(name => ({key: name.replace(/\s/g, ''), name}));
 const a = detectAnalyticIntent('2026년 분당구구조물관리과 가장 큰 사업', {departments: asObjects});
 const b = detectAnalyticIntent('2026년 분당구구조물관리과 가장 큰 사업', {departments: DEPARTMENTS});
 assert.deepEqual(a, b);
 assert.equal(a.ranking.department, '분당구구조물관리과');
});

test('acceptance fixture is well formed and every item is still a hypothesis', () => {
 const fixture = JSON.parse(readFileSync(new URL('./fixtures/analytic-acceptance.json', import.meta.url), 'utf8'));
 assert.equal(fixture.schema_version, 1);
 assert.ok(fixture.items.length >= 7);
 for (const item of fixture.items) assert.equal(item.status, 'hypothesis', item.id);
 const issue2 = fixture.items.find(i => i.id === 'acc-2-stat-401-01');
 assert.match(issue2.expect.rows[0].amount_conflict, /5,547,500/);
 assert.match(issue2.expect.rows[0].amount_conflict, /5,347,500/);
});
