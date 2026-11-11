import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStatementRows, parseStatement, parseSectionTitle, reconcileStatement } from '../worker/statement-rows.js';
import { findStatementDocuments } from '../worker/analysis.js';
import { hasSnapshot, catalog, loadStatementPages } from './helpers/statement-snapshot.mjs';

const line = (indent, label, ...nums) => `${' '.repeat(indent)}${label}    ${nums.join('    ')}`;
const fund = (label, amount) => `${' '.repeat(28)}${label}          ${amount}`;
const HEADER = ['부서ㆍ정책ㆍ단위(회계)ㆍ세부사업ㆍ편성목    예산액    전년도    비교증감', '   전년도', '   예산액'];

// 총괄표 쪽(부서: 머리글 없음)은 행으로 읽지 않는다.
const SUMMARY = ['세출예산사업명세서', '2026년도본예산전체일반회계                (단위:천원)', line(0, 'A과', '1,300', '1,000', '30.00%')].join('\n');

// 부서 A과: 사업 하나(공백 이름, 재원 포함), 들여쓰기 4의 공백 이름 사업이 쪽 끝에 있고 편성목은 다음 쪽에 이어진다.
const PAGE2 = [
  '세출예산사업명세서',
  '2026년도본예산일반회계전체',
  '부서: A과',
  '정책: 기본정책',
  '단위: 첫단위                          (단위:천원)',
  ...HEADER,
  line(0, 'A과', '1,300', '1,200', '100'),
  line(1, '기본정책', '1,000', '900', '100'),
  line(2, '첫단위', '600', '500', '100'),
  line(3, '사업 하나', '400', '300', '100'),
  fund('국', '100'),
  fund('도', '300'),
  line(9, '101 인건비', '400', '300', '100'),
  line(10, '01 기본급', '400', '300', '100'),
  '     ○산출근거 항목                  10,000원*40명                400',
  line(3, '사업둘', '200', '200', '0'),
  line(9, '201 일반운영비', '200', '200', '0'),
  line(2, '둘째단위', '400', '400', '0'),
  line(4, '들여쓰기넷 사업', '400', '400', '0'),
].join('\n');

// 이어지는 쪽: 머리글의 정책은 앞 쪽 값(기본정책)이지만 쪽 중간에서 새 정책이 시작된다.
const PAGE3 = [
  '부서: A과',
  '정책: 기본정책',
  '단위: 둘째단위                          (단위:천원)',
  ...HEADER,
  line(9, '201 일반운영비', '400', '400', '0'),
  line(1, '행정운영경비(A과)', '300', '300', '0'),
  line(2, '인력단위', '300', '300', '0'),
  line(3, '인력운영비', '300', '300', '0'),
  line(9, '101 인건비', '300', '300', '0'),
  line(0, 'B과', '500', '500', '0'),
  line(1, '정책Z', '500', '500', '0'),
  line(2, '단위Z', '500', '500', '0'),
  line(3, '사업Z', '500', '500', '0'),
  line(9, '201 일반운영비', '500', '500', '0'),
].join('\n');

const PAGES = [{ page: 1, text: SUMMARY }, { page: 2, text: PAGE2 }, { page: 3, text: PAGE3 }];
const META = { document_id: 'doc-main', year: 2026, edition: '본예산', account: '일반회계' };
const businesses = rows => rows.filter(r => r.level === 'business');

test('섹션 제목에서 회계를 읽는다(공백이 섞인 추경 제목 포함)', () => {
  assert.equal(parseSectionTitle('2026년도추경1 회교통사업전체').account, '교통사업');
  assert.equal(parseSectionTitle('2026년도본예산일반회계전체').account, '일반회계');
  assert.equal(parseSectionTitle('2026년도본예산전체일반회계 (단위:천원)').account, '일반회계');
  assert.equal(parseSectionTitle('세출예산사업명세서'), null);
});

test('총괄표 쪽은 읽지 않고 세부사업을 편성목 구조로 찾는다(들여쓰기와 공백 이름 무관)', () => {
  const rows = parseStatementRows(PAGES, META);
  assert.equal(rows.some(r => r.page === 1), false);
  assert.deepEqual(businesses(rows).map(r => r.business), ['사업 하나', '사업둘', '들여쓰기넷 사업', '인력운영비', '사업Z']);
  assert.equal(rows.filter(r => r.level === 'department').length, 2);
});

test('쪽 경계를 넘어 부서·세부사업·편성목 경로를 이어 가고 새 정책이 쪽 머리글의 정책을 덮는다', () => {
  const rows = parseStatementRows(PAGES, META);
  const objectOnNextPage = rows.find(r => r.level === 'object' && r.page === 3 && r.object.code === '201' && r.department === 'A과');
  assert.equal(objectOnNextPage.business, '들여쓰기넷 사업');
  assert.equal(objectOnNextPage.unit, '둘째단위');
  assert.equal(objectOnNextPage.policy, '기본정책');
  const staff = rows.find(r => r.business === '인력운영비' && r.level === 'business');
  assert.equal(staff.policy, '행정운영경비(A과)'); // 머리글의 '기본정책'이 아님
  assert.equal(staff.policy_kind, '행정운영경비');
  assert.equal(staff.unit, '인력단위');
  const normal = rows.find(r => r.business === '사업 하나');
  assert.equal(normal.policy_kind, '정책사업');
  assert.equal(normal.account, '일반회계');
  assert.equal(normal.amount_unit, '천원');
  assert.equal(rows.find(r => r.business === '사업Z').department, 'B과');
});

test('편성목과 통계목 코드·이름은 원문 그대로이고 없는 분류는 null이다', () => {
  const rows = parseStatementRows(PAGES, META);
  const stat = rows.find(r => r.level === 'stat');
  assert.deepEqual(stat.object, { code: '101', name: '인건비' });
  assert.deepEqual(stat.stat, { code: '01', name: '기본급' });
  const business = rows.find(r => r.business === '사업둘');
  assert.equal(business.object, null);
  assert.equal(business.stat, null);
  const dept = rows.find(r => r.level === 'department');
  assert.equal(dept.business, null);
  assert.equal(dept.policy, null);
  assert.equal(dept.policy_kind, null);
});

test('금액 3열은 예산액·전년도예산액·비교증감이며 산식이 맞을 때만 열이 검증된다', () => {
  const rows = parseStatementRows(PAGES, META);
  const row = rows.find(r => r.business === '사업 하나');
  assert.deepEqual(row.amounts, { budget: 400, previous: 300, change: 100 });
  assert.deepEqual(row.column_labels, { budget: '예산액', previous: '전년도예산액', change: '비교증감' });
  assert.equal(row.columns_verified, true);
  const broken = parseStatementRows([{ page: 2, text: PAGE2.replace(line(3, '사업둘', '200', '200', '0'), line(3, '사업둘', '200', '200', '7')) }], META);
  assert.equal(broken.find(r => r.business === '사업둘').columns_verified, false);
  const noHeader = parseStatementRows([{ page: 2, text: PAGE2.replace('비교증감', '').replace('전년도', '') }], META);
  assert.equal(noHeader.find(r => r.business === '사업둘').columns_verified, false);
});

test('재원 행(국·도·시)은 직전 구조 행에 붙고 산출근거 행은 행이 되지 않는다', () => {
  const rows = parseStatementRows(PAGES, META);
  const row = rows.find(r => r.business === '사업 하나');
  assert.deepEqual(row.funding, { 국: 100, 도: 300 });
  assert.equal(rows.find(r => r.business === '사업둘').funding, null);
  assert.equal(rows.some(r => /산출근거/.test(`${r.business}${r.object?.name}`)), false);
});

test('쪽 번호가 끊기면 앞 쪽 경로를 이어받지 않고 쪽 머리글 부서만 쓴다', () => {
  const rows = parseStatementRows([PAGES[1], { page: 5, text: PAGE3 }], META);
  const first = rows.find(r => r.page === 5);
  assert.equal(first.department, 'A과');
  assert.equal(first.business, null); // 앞 쪽의 사업을 잘못 이어받지 않는다
});

test('모든 부서의 합계가 맞는 본예산은 verified, 어긋난 부서가 있으면 partial', () => {
  const rows = parseStatementRows(PAGES, META);
  const rec = reconcileStatement(rows);
  assert.deepEqual(rec.departments.map(d => [d.department, d.printed_total, d.business_sum, d.reconciled]), [['A과', 1300, 1300, true], ['B과', 500, 500, true]]);
  assert.equal(rec.overall.department_count, 2);
  assert.equal(rec.overall.reconciled_count, 2);
  assert.equal(rec.overall.account_total_sum, 1800);
  assert.equal(rec.inventory_status, 'verified');
  const bad = parseStatementRows([PAGES[1], { page: 3, text: PAGE3.replace(line(3, '사업Z', '500', '500', '0'), line(3, '사업Z', '490', '500', '-10')) }], META);
  const badRec = reconcileStatement(bad);
  assert.equal(badRec.departments.find(d => d.department === 'B과').reconciled, false);
  assert.equal(badRec.inventory_status, 'partial');
});

test('추경은 변경 목록이라 change_list이고 합계가 맞아도 verified가 아니다', () => {
  const rows = parseStatementRows(PAGES, { ...META, edition: '추경1회' });
  assert.equal(rows[0].budget_type, '추경');
  assert.equal(rows[0].revision, 1);
  assert.equal(reconcileStatement(rows).inventory_status, 'change_list');
});

test('섹션 제목이 바뀌면 회계와 부서 상태를 초기화한다', () => {
  const next = ['2026년도추경1 회교통사업전체', '부서: 교통과', ...HEADER, line(0, '교통과', '10', '5', '5'), line(1, '정책Y', '10', '5', '5'), line(2, '단위Y', '10', '5', '5'), line(3, '사업Y', '10', '5', '5'), line(9, '301 일반보전금', '10', '5', '5')].join('\n');
  const { rows } = parseStatement([...PAGES, { page: 4, text: next }], META);
  const row = rows.find(r => r.business === '사업Y');
  assert.equal(row.account, '교통사업');
  assert.equal(row.department, '교통과');
});

test('findStatementDocuments는 전체 명세서와 추경 명세서만 고르고 공기업 회계는 제외한다', () => {
  const cat = { documents: [
    { id: 'a', title: '2026년 세입세출예산서 · 일반회계 · 세출예산사업명세서 · 전체', year: 2026, budget_type: '본예산', revision: null, shards: ['2026-0'], page_count: 3, indexed_pages: 3 },
    { id: 'b', title: '2026년 세입세출예산서 · 일반회계 · 세출예산사업명세서 · 의회사무국', year: 2026, budget_type: '본예산', shards: [] },
    { id: 'c', title: '2026년 1회 추경 세입세출예산서 · 세출예산사업명세서', year: 2026, budget_type: '추경', revision: 1, shards: ['2026-7'], page_count: 4, indexed_pages: 3 },
    { id: 'd', title: '2026년 1회 추경 세입세출예산서 · 상수도공기업특별회계 · 세출예산사업명세서', year: 2026, budget_type: '추경', revision: 1, shards: [] },
    { id: 'e', title: '2026년 세입세출예산서 · 일반회계 · 세입예산사업명세서', year: 2026, budget_type: '본예산', shards: [] },
  ] };
  const { documents, excluded } = findStatementDocuments(cat, { year: 2026 });
  assert.deepEqual(documents.map(d => [d.document_id, d.account_group, d.all_pages_indexed]), [['a', '일반회계', true], ['c', '원문 확인', false]]);
  assert.deepEqual(excluded.map(d => d.document_id), ['d']);
});

// ── 실제 snapshot(있을 때만) ──────────────────────────────

const MAIN_ID = '32c9f094ec3f79fa18d0';
const SUP1_ID = 'ecf3620a37b739b371c6';
const real = { skip: !hasSnapshot && 'snapshot 없음' };
let mainRows = null;
const mainStatement = () => (mainRows ??= parseStatementRows(loadStatementPages(MAIN_ID), { document_id: MAIN_ID, year: 2026, edition: '본예산', account: '일반회계' }));

test('2026 본예산 일반회계: 160개 부서가 모두 맞고 부서 합계의 합이 3,364,121,953', real, () => {
  const rec = reconcileStatement(mainStatement());
  assert.equal(rec.overall.department_count, 160);
  assert.equal(rec.overall.reconciled_count, 160);
  assert.equal(rec.overall.account_total_sum, 3364121953);
  assert.equal(rec.inventory_status, 'verified');
  assert.equal(mainStatement().every(r => r.columns_verified), true);
});

test('2026 본예산 수정구 기초연금: p883 금액과 재원 구성', real, () => {
  const row = mainStatement().find(r => r.level === 'business' && r.department === '수정구사회복지과' && r.business === '기초연금');
  assert.equal(row.page, 883);
  assert.equal(row.amounts.budget, 114003724);
  assert.deepEqual(row.funding, { 국: 91203571, 도: 4560031, 시: 18240122 });
  assert.equal(row.policy, '노인복지증진');
  assert.equal(row.unit, '노후소득보장강화');
});

test('분당구구조물관리과: 들여쓰기 4에 있는 공백 이름 세부사업도 읽는다', real, () => {
  const list = mainStatement().filter(r => r.level === 'business' && r.department === '분당구구조물관리과').sort((a, b) => b.amounts.budget - a.amounts.budget);
  assert.equal(list[0].business, '지하차도(터널) 시설물유지관리보수공사');
  assert.equal(list[0].amounts.budget, 5547500);
});

test('2026 1회 추경 중원구 기초연금 p351: 경정액·기정액·증감을 원문 열로 읽는다', real, () => {
  const rows = parseStatementRows(loadStatementPages(SUP1_ID), { document_id: SUP1_ID, year: 2026, edition: '추경1회' });
  const row = rows.find(r => r.level === 'business' && r.department === '중원구사회복지과' && r.business === '기초연금');
  assert.equal(row.page, 351);
  assert.deepEqual(row.amounts, { budget: 116417588, previous: 110922543, change: 5495045 });
  assert.equal(row.column_labels.previous, '기정액');
  assert.equal(row.columns_verified, true);
  assert.equal(reconcileStatement(rows).inventory_status, 'change_list');
  assert.ok(rows.some(r => r.account === '교통사업'), '추경 문서 안의 교통사업 섹션 회계 식별');
});

test('catalog에서 2026 전체 명세서 문서를 찾는다', real, () => {
  const { documents } = findStatementDocuments(catalog(), { year: 2026 });
  assert.ok(documents.some(d => d.document_id === MAIN_ID && d.account_group === '일반회계'));
  assert.ok(documents.some(d => d.document_id === SUP1_ID && d.revision === 1));
});
