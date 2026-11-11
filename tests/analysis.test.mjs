import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStatementRows } from '../worker/statement-rows.js';
import { rankRows, matchBusiness, sumAcrossDepartments, compareEditionRows, fundingBreakdown, pagesFromShards, statementAssetPaths } from '../worker/analysis.js';
import { hasSnapshot, catalog, loadStatementPages } from './helpers/statement-snapshot.mjs';
import { findStatementDocuments } from '../worker/analysis.js';

const line = (indent, label, ...nums) => `${' '.repeat(indent)}${label}    ${nums.join('    ')}`;
const fund = (label, amount) => `${' '.repeat(28)}${label}          ${amount}`;
const HEADER = ['부서ㆍ정책ㆍ단위(회계)ㆍ세부사업ㆍ편성목    예산액    전년도    비교증감', '   전년도'];

// 한 부서 = 부서 행 + 정책 + 단위 + 세부사업 목록(각각 편성목 하나).
function department(name, businesses, { funding = {} } = {}) {
  const total = businesses.reduce((n, [, amount]) => n + amount, 0);
  const out = ['부서: ' + name, '단위: 단위  (단위:천원)', ...HEADER, line(0, name, total, 0, total), line(1, '공통정책', total, 0, total), line(2, '공통단위', total, 0, total)];
  for (const [business, amount] of businesses) {
    out.push(line(3, business, amount, 0, amount));
    for (const [label, value] of Object.entries(funding[business] ?? {})) out.push(fund(label, value));
    out.push(line(9, '301 일반보전금', amount, 0, amount), line(10, '01 사회보장적수혜금', amount, 0, amount));
  }
  return out.join('\n');
}

const MAIN_PAGES = [
  { page: 1, text: '2026년도본예산일반회계전체\n' + department('수정구과', [['기초연금', 300], ['인력운영비', 120]], { funding: { 기초연금: { 국: 240, 도: 12, 시: 48 } } }) },
  { page: 2, text: department('중원구과', [['기초연금', 200], ['인력운영비', 120]]) },
  { page: 3, text: department('분당구과', [['기초연금', 100], ['다른사업', 50]]) },
];
const META = { document_id: 'doc-main', year: 2026, edition: '본예산', account: '일반회계' };
const rows = parseStatementRows(MAIN_PAGES, META);

test('세부사업 순위는 부서별 행을 따로 두고 같은 이름을 합치지 않으며 검증된 범위만 complete', () => {
  const r = rankRows(rows, { level: 'business', n: 3 });
  assert.equal(r.status, 'complete');
  assert.deepEqual(r.items.map(i => [i.rank, i.department, i.name, i.amount, i.unit]), [
    [1, '수정구과', '기초연금', 300, '천원'],
    [2, '중원구과', '기초연금', 200, '천원'],
    [3, '수정구과', '인력운영비', 120, '천원'], // 같은 금액 120의 첫 행, 중원구과 120은 같은 순위
  ]);
  assert.deepEqual(r.coverage, { reconciled: 3, total: 3, inventory_status: 'verified' });
  assert.deepEqual([r.scope.year, r.scope.account, r.scope.level], [2026, '일반회계', 'business']);
  assert.ok(r.items.every(i => i.page && i.document_id === 'doc-main' && i.path.business));
});

test('같은 금액은 같은 순위를 받고 asc는 작은 금액부터', () => {
  const r = rankRows(rows, { level: 'business', n: 6, direction: 'desc' });
  assert.deepEqual(r.items.map(i => i.rank), [1, 2, 3, 3, 5, 6]);
  const asc = rankRows(rows, { level: 'business', n: 1, direction: 'asc' });
  assert.equal(asc.items[0].name, '다른사업');
});

test('부서 합계와 세부사업 합계가 어긋나면 complete가 아니라 available_rows_only', () => {
  const broken = rows.map(r => (r.level === 'department' && r.department === '분당구과' ? { ...r, amounts: { ...r.amounts, budget: 9999 } } : r));
  const r = rankRows(broken, { level: 'business', n: 2 });
  assert.equal(r.status, 'available_rows_only');
  assert.equal(r.coverage.reconciled, 2);
  assert.equal(r.coverage.total, 3);
  assert.ok(r.items.length === 2);
});

test('추경 행은 순위를 내도 complete가 아니고 연도·편성이 섞이면 순위를 만들지 않는다', () => {
  const sup = parseStatementRows(MAIN_PAGES, { ...META, edition: '추경1회' });
  assert.equal(rankRows(sup, { level: 'business' }).status, 'available_rows_only');
  const mixed = rankRows([...rows, ...sup], { level: 'business' });
  assert.equal(mixed.status, 'incomplete');
  assert.deepEqual(mixed.items, []);
  assert.equal(rankRows(rows, { level: 'business', department: '없는과' }).status, 'incomplete');
});

test('부서 순위와 uncovered_accounts 전달', () => {
  const r = rankRows(rows, { level: 'department', n: 2, uncovered_accounts: ['상수도공기업특별회계'] });
  assert.deepEqual(r.items.map(i => [i.name, i.amount]), [['수정구과', 420], ['중원구과', 320]]);
  assert.equal(r.status, 'complete');
  assert.deepEqual(r.coverage.uncovered_accounts, ['상수도공기업특별회계']);
});

test('통계목 코드 순위는 부서 안에서 통계목 금액순이며 코드 형식이 틀리면 거부', () => {
  const r = rankRows(rows, { level: 'stat', code: '301-01', department: '수정구과', n: 5 });
  assert.equal(r.status, 'complete');
  assert.deepEqual(r.items.map(i => [i.name, i.amount, i.path.stat.code]), [['기초연금', 300, '01'], ['인력운영비', 120, '01']]);
  assert.equal(rankRows(rows, { level: 'stat', code: '3011', department: '수정구과' }).status, 'incomplete');
  assert.equal(rankRows(rows, { level: 'stat', code: '999-99', department: '수정구과' }).status, 'incomplete');
});

test('세부사업 이름 맞춤: 질문에 이름이 들어 있으면 가장 긴 이름이 이기고, 없으면 0원이 아니라 no_name_match', () => {
  const m = matchBusiness(rows, '2026년 수정구, 중원구, 분당구 기초연금 지급액 합계');
  assert.equal(m.status, 'matched');
  assert.deepEqual(m.rows.map(r => r.department), ['수정구과', '중원구과', '분당구과']);
  const none = matchBusiness(rows, '달나라 지하철 예산은 얼마인가');
  assert.equal(none.status, 'no_name_match');
  assert.deepEqual(none.rows, []);
  assert.match(none.note, /0원이 아니라/);
  const longer = parseStatementRows([{ page: 1, text: '2026년도본예산일반회계전체\n' + department('수정구과', [['기초연금', 300], ['기초연금지급', 7]]) }], META);
  assert.equal(matchBusiness(longer, '기초연금지급 얼마').rows[0].business, '기초연금지급');
});

test('세부사업 이름 맞춤: 내용어가 모두 이름에 있으면 일치, 여러 이름이면 ambiguous로 합계 후보를 내지 않는다', () => {
  const words = matchBusiness(rows, '인력운영 예산', null);
  assert.equal(words.status, 'matched');
  assert.equal(words.basis, 'all_content_words');
  const amb = parseStatementRows([{ page: 1, text: '2026년도본예산일반회계전체\n' + department('수정구과', [['노인복지사업', 5], ['노인복지시설', 6]]) }], META);
  const a = matchBusiness(amb, '노인복지 예산');
  assert.equal(a.status, 'ambiguous');
  assert.deepEqual(a.rows, []);
  assert.equal(a.candidates.length, 2);
});

test('부서 한정 이름 맞춤은 다른 부서의 같은 이름 행을 제외한다', () => {
  const m = matchBusiness(rows, '기초연금', ['중원구과']);
  assert.deepEqual(m.rows.map(r => r.department), ['중원구과']);
  assert.equal(matchBusiness(rows, '기초연금', ['없는과']).status, 'no_name_match');
});

test('부서 합계는 요청 부서마다 검증된 행이 정확히 하나일 때만 낸다', () => {
  const m = matchBusiness(rows, '기초연금');
  const byDept = {};
  for (const r of m.rows) (byDept[r.department] ??= []).push(r);
  const all = sumAcrossDepartments(byDept, ['수정구과', '중원구과', '분당구과']);
  assert.equal(all.complete, true);
  assert.equal(all.total, 600);
  assert.equal(all.unit, '천원');
  assert.deepEqual(all.rows.map(r => r.page), [1, 2, 3]);
  const missing = sumAcrossDepartments({ 수정구과: byDept['수정구과'], 중원구과: byDept['중원구과'] }, ['수정구과', '중원구과', '분당구과']);
  assert.equal(missing.total, null);
  assert.deepEqual(missing.missing_departments, ['분당구과']);
  const dup = sumAcrossDepartments({ ...byDept, 수정구과: [byDept['수정구과'][0], byDept['수정구과'][0]] }, ['수정구과', '중원구과', '분당구과']);
  assert.equal(dup.total, null);
  assert.ok(dup.ambiguous_departments.includes('수정구과') || dup.warnings.length > 0);
  const unverified = byDept['중원구과'].map(r => ({ ...r, columns_verified: false }));
  assert.equal(sumAcrossDepartments({ 수정구과: byDept['수정구과'], 중원구과: unverified }, ['수정구과', '중원구과']).total, null);
});

const REV_PAGE = (previous, budget) => ['부서: 중원구과', '단위: 공통단위  (단위:천원)', '   기정액', ...['부서ㆍ정책ㆍ단위(회계)ㆍ세부사업ㆍ편성목    예산액    기정액    비교증감'],
  line(0, '중원구과', budget, previous, budget - previous), line(1, '공통정책', budget, previous, budget - previous),
  line(2, '공통단위', budget, previous, budget - previous), line(3, '기초연금', budget, previous, budget - previous), line(9, '301 일반보전금', budget, previous, budget - previous)].join('\n');

test('편성 비교: 본예산·기정액·경정액·증감을 따로 두고 없는 회차는 not_listed_in_revision, 합산하지 않는다', () => {
  const initial = rows.find(r => r.department === '중원구과' && r.business === '기초연금');
  const rev1 = parseStatementRows([{ page: 1, text: '2026년도추경1회일반회계전체\n' + REV_PAGE(200, 260) }], { ...META, document_id: 'doc-r1', edition: '추경1회' }).find(r => r.level === 'business');
  const result = compareEditionRows(initial, [rev1], [1, 2]);
  assert.equal(result.status, 'partial');
  assert.deepEqual(result.revisions[0], {
    revision: 1, label: '1회 추경', status: 'compared', initial_amount: 200, previous_amount: 200, revised_amount: 260,
    amendment_change: 60, difference_from_initial: 60, previous_matches_initial: true, unit: '천원', document_id: 'doc-r1', page: 1,
    source_line: rev1.source_line, column_labels: { budget: '예산액', previous: '기정액', change: '비교증감' },
  });
  assert.deepEqual(result.revisions[1], { revision: 2, label: '2회 추경', status: 'not_listed_in_revision' });
  assert.equal(result.initial.amount, 200);
  assert.equal(JSON.stringify(result).includes('460'), false); // 본예산 + 경정액을 더하지 않음
  assert.equal(compareEditionRows(initial, [], [1]).status, 'not_listed_in_revision');
  assert.equal(compareEditionRows(null, [rev1]).status, 'no_initial');
});

test('편성 비교: 기정액이 본예산과 다르면 previous_matches_initial이 false(앞선 추경 존재 가능)', () => {
  const initial = rows.find(r => r.department === '중원구과' && r.business === '기초연금');
  const rev2 = parseStatementRows([{ page: 1, text: '2026년도추경2회일반회계전체\n' + REV_PAGE(230, 250) }], { ...META, document_id: 'doc-r2', edition: '추경2회' }).find(r => r.level === 'business');
  const result = compareEditionRows(initial, [{ revision: 2, row: rev2 }]);
  assert.equal(result.revisions[0].previous_matches_initial, false);
  assert.equal(result.revisions[0].difference_from_initial, 50);
  assert.equal(result.revisions[0].amendment_change, 20);
});

test('편성 비교: 사업 경로가 다르면 not_comparable이며 임의로 대응시키지 않는다', () => {
  const initial = rows.find(r => r.department === '중원구과' && r.business === '기초연금');
  const rev = parseStatementRows([{ page: 1, text: '2026년도추경1회일반회계전체\n' + REV_PAGE(200, 260).replaceAll('공통단위', '다른단위') }], { ...META, edition: '추경1회' }).find(r => r.level === 'business');
  assert.equal(compareEditionRows(initial, [rev], [1]).revisions[0].status, 'not_comparable');
});

test('재원 구성: 국·도·시 합이 행 금액과 같을 때만 verified, 없으면 not_printed', () => {
  const row = rows.find(r => r.department === '수정구과' && r.business === '기초연금');
  const f = fundingBreakdown(row);
  assert.equal(f.status, 'verified');
  assert.deepEqual(f.parts.map(p => [p.label, p.amount]), [['국', 240], ['도', 12], ['시', 48]]);
  assert.equal(f.sum, 300);
  assert.equal(f.page, 1);
  assert.equal(fundingBreakdown({ ...row, funding: { ...row.funding, 시: 40 } }).status, 'mismatch');
  assert.equal(fundingBreakdown(rows.find(r => r.business === '다른사업')).status, 'not_printed');
  assert.equal(fundingBreakdown(null).status, 'no_row');
});

test('pagesFromShards와 statementAssetPaths는 샤드 배열에서 문서 쪽을 쪽 순서로 읽는다', () => {
  const shards = [{ index: { pages: [['d1', 2, '천원'], ['x', 1, '천원'], ['d1', 1, '천원']] }, texts: ['two', 'other', 'one'] }];
  assert.deepEqual(pagesFromShards(shards, 'd1').map(p => [p.page, p.text]), [[1, 'one'], [2, 'two']]);
  assert.deepEqual(statementAssetPaths({ shards: ['2026-0', '2026-1'] }), ['corpus/pages-2026-0.json.gz', 'corpus/text-2026-0.json.gz', 'corpus/pages-2026-1.json.gz', 'corpus/text-2026-1.json.gz']);
});

// ── 실제 snapshot(있을 때만) ──────────────────────────────

const real = { skip: !hasSnapshot && 'snapshot 없음' };
const MAIN_ID = '32c9f094ec3f79fa18d0';
const SUP1_ID = 'ecf3620a37b739b371c6';
let cache = null;
function realRows() {
  if (!cache) {
    cache = {
      main: parseStatementRows(loadStatementPages(MAIN_ID), { document_id: MAIN_ID, year: 2026, edition: '본예산', account: '일반회계' }),
      sup: parseStatementRows(loadStatementPages(SUP1_ID), { document_id: SUP1_ID, year: 2026, edition: '추경1회' }),
    };
  }
  return cache;
}

test('2026 본예산 일반회계 세부사업 상위 5개와 검증 범위', real, () => {
  const r = rankRows(realRows().main, { level: 'business', n: 5 });
  assert.equal(r.status, 'complete');
  assert.deepEqual(r.coverage, { reconciled: 160, total: 160, inventory_status: 'verified' });
  assert.deepEqual(r.items.map(i => [i.department, i.name, i.amount]), [
    ['회계과', '인력운영비', 247882961],
    ['수정구사회복지과', '기초연금', 114003724],
    ['공원과', '보전지출(장기미집행공원지방채원리금상환)(자체)', 112000000],
    ['중원구사회복지과', '기초연금', 110922543],
    ['분당구사회복지과', '기초연금', 83191907],
  ]);
});

test('2026 본예산 부서 상위 3개', real, () => {
  const r = rankRows(realRows().main, { level: 'department', n: 3 });
  assert.deepEqual(r.items.map(i => [i.name, i.amount]), [['회계과', 286474241], ['대중교통과', 200418594], ['수정구사회복지과', 185986330]]);
});

test('분당구구조물관리과 401-01 통계목 순위: 21개 행, 상위 3개', real, () => {
  const r = rankRows(realRows().main, { level: 'stat', code: '401-01', department: '분당구구조물관리과', n: 3 });
  assert.equal(r.status, 'complete');
  assert.equal(r.total_candidates, 21);
  assert.deepEqual(r.items.map(i => [i.name, i.amount, i.page]), [
    ['지하차도(터널) 시설물유지관리보수공사', 5347500, 1342],
    ['공동구시설물유지관리보수공사', 4426000, 1343],
    ['교량유지관리보수공사', 3739223, 1339],
  ]);
});

test('기초연금 3개 구청 합계 308,118,174, 한 부서를 빼면 합계 없음', real, () => {
  const { main } = realRows();
  const depts = ['수정구사회복지과', '중원구사회복지과', '분당구사회복지과'];
  const m = matchBusiness(main, '2026년 수정구, 중원구, 분당구 기초연금 지급액 합계', depts);
  assert.equal(m.status, 'matched');
  const byDept = {};
  for (const r of m.rows) (byDept[r.department] ??= []).push(r);
  const sum = sumAcrossDepartments(byDept, depts);
  assert.equal(sum.total, 308118174);
  assert.deepEqual(sum.rows.map(r => r.page), [883, 1110, 1291]);
  const { 분당구사회복지과: _omitted, ...two } = byDept;
  const partial = sumAcrossDepartments(two, depts);
  assert.equal(partial.total, null);
  assert.deepEqual(partial.missing_departments, ['분당구사회복지과']);
  assert.equal(matchBusiness(main, '달나라 지하철 예산').status, 'no_name_match');
});

test('수정구 기초연금 재원과 중원구 1회 추경 비교', real, () => {
  const { main, sup } = realRows();
  const su = main.find(r => r.level === 'business' && r.department === '수정구사회복지과' && r.business === '기초연금');
  const f = fundingBreakdown(su);
  assert.equal(f.status, 'verified');
  assert.deepEqual(f.parts.map(p => p.amount), [91203571, 4560031, 18240122]);
  const initial = main.find(r => r.level === 'business' && r.department === '중원구사회복지과' && r.business === '기초연금');
  const revised = sup.filter(r => r.level === 'business' && r.department === '중원구사회복지과' && r.business === '기초연금' && r.account === '일반회계');
  const c = compareEditionRows(initial, revised, [1]);
  assert.equal(c.initial.amount, 110922543);
  assert.deepEqual([c.revisions[0].revised_amount, c.revisions[0].previous_amount, c.revisions[0].amendment_change, c.revisions[0].page, c.revisions[0].previous_matches_initial], [116417588, 110922543, 5495045, 351, true]);
  assert.equal(rankRows(sup, { level: 'business', account: '일반회계' }).status, 'available_rows_only');
});

test('catalog 문서 선택으로 읽은 본예산 문서가 같은 결과를 낸다', real, () => {
  const doc = findStatementDocuments(catalog(), { year: 2026, budget_type: '본예산' }).documents.find(d => d.account_group === '일반회계');
  assert.equal(doc.document_id, MAIN_ID);
  assert.equal(doc.all_pages_indexed, true);
});
