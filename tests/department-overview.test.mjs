import test from 'node:test';
import assert from 'node:assert/strict';
import { statementLine } from '../worker/quality.js';
import { departmentPageRows, departmentOverview } from '../worker/department-overview.js';

// 들여쓰기가 의미를 가지는 세출명세서 쪽 본문(1회 추경). 부서 합계 0, 정책 1, 단위사업 2, 세부사업 3, 편성목 9.
const SUPPLEMENTARY_TEXT = [
  '세출예산사업명세서',
  '부서: AI반도체과',
  '   부서ㆍ정책ㆍ단위(회계)ㆍ세부사업ㆍ편성목    예산액    기정액    비교증감',
  'AI반도체과    34,946,472    8,837,472    26,109,000',
  ' 산업기반활성화    30,516,020    4,217,020    26,299,000',
  '  시스템반도체산업육성    29,682,000    3,383,000    26,299,000',
  '   판교시스템반도체연구센터조성    26,299,000    0    26,299,000',
  '         401 시설비및부대비    26,299,000    0    26,299,000',
  '  미래모빌리티데이터구축    2,643,442    2,833,442    △190,000',
  '   미래모빌리티기반도시시설물데이터구축    2,075,924    2,265,924    △190,000',
].join('\n');

// 본예산 쪽: 세부사업 A(미래모빌리티기반도시시설물데이터구축) 2,265,924, 세부사업 B(스마트공장지원) 1,140,000.
const MAIN_TEXT = [
  '세출예산사업명세서',
  '부서: AI반도체과',
  'AI반도체과    8,837,472    7,000,000    1,837,472',
  '  미래모빌리티데이터구축    3,405,924    2,000,000    1,405,924',
  '   미래모빌리티기반도시시설물데이터구축    2,265,924    2,000,000    265,924',
  '  스마트공장확산    1,140,000    0    1,140,000',
  '   스마트공장지원    1,140,000    0    1,140,000',
].join('\n');

const UNRELATED_TEXT = [
  '세출예산사업명세서',
  '부서: 다른과',
  '다른 부서   1   0   1',
].join('\n');

function edition(budgetType, revision, documentId, text) {
  return {
    budget_type: budgetType,
    revision,
    document_id: documentId,
    title: `2026 ${budgetType === '추경' ? `제${revision}회 추경` : '본예산'} 세출예산사업명세서`,
    pages: [{ page: 1, page_url: `https://example.test/${documentId}#page=1`, unit: '천원', text }],
  };
}

const MAIN = edition('본예산', undefined, 'doc-main', MAIN_TEXT);
const SUPPLEMENTARY = edition('추경', 1, 'doc-sup-1', SUPPLEMENTARY_TEXT);

// ── 줄 단위 해석 ──────────────────────

test('부서 합계 행은 들여쓰기 0으로 읽고 예산액·기정액·증감을 확인한다', () => {
  const line = 'AI반도체과    34,946,472    8,837,472    26,109,000';
  const parsed = statementLine(line, 2);
  assert.equal(parsed.label, 'AI반도체과');
  assert.equal(parsed.indent, 0);
  assert.equal(parsed.amounts.amount, 34946472);
  assert.equal(parsed.amounts.previous_amount, 8837472);
  assert.equal(parsed.amounts.change, 26109000);
  assert.equal(parsed.amounts.columns_verified, true);
  assert.equal(parsed.amounts.source_line, 3);
});

test('금액이 없는 줄은 amounts가 null이다', () => {
  const parsed = statementLine('부서: AI반도체과', 1);
  assert.equal(parsed.label, '부서: AI반도체과');
  assert.equal(parsed.amounts, null);
});

test('증감이 △로 적힌 줄은 음수로 읽는다', () => {
  const line = '  미래모빌리티데이터구축                 2,643,442            2,833,442         △190,000';
  const parsed = statementLine(line, 8);
  assert.equal(parsed.indent, 2);
  assert.equal(parsed.amounts.change, -190000);
});

// ── 한 쪽에서 부서 행 읽기 ───────────────────────────────────────────────

test('부서 쪽에서 부서 합계와 세부사업 두 개를 읽는다', () => {
  const rows = departmentPageRows(SUPPLEMENTARY_TEXT, 'AI반도체과');
  assert.equal(rows.total.amount, 34946472);
  assert.equal(rows.businesses.length, 2);
  const byName = Object.fromEntries(rows.businesses.map(b => [b.name, b]));
  assert.equal(byName['판교시스템반도체연구센터조성'].amount, 26299000);
  assert.equal(byName['미래모빌리티기반도시시설물데이터구축'].amount, 2075924);
});

test('세부사업마다 바로 위 단위사업명을 unit_business로 붙인다', () => {
  const rows = departmentPageRows(SUPPLEMENTARY_TEXT, 'AI반도체과');
  const byName = Object.fromEntries(rows.businesses.map(b => [b.name, b]));
  assert.equal(byName['판교시스템반도체연구센터조성'].unit_business, '시스템반도체산업육성');
  assert.equal(byName['미래모빌리티기반도시시설물데이터구축'].unit_business, '미래모빌리티데이터구축');
});

test('정책·단위사업·편성목 행은 세부사업 목록에 들어가지 않는다', () => {
  const names = departmentPageRows(SUPPLEMENTARY_TEXT, 'AI반도체과').businesses.map(b => b.name);
  for (const excluded of ['산업기반활성화', '시스템반도체산업육성', '401 시설비및부대비', '미래모빌리티데이터구축']) {
    assert.equal(names.includes(excluded), false, excluded + ' 제외');
  }
});

test('부서명이 다르면 부서 합계는 null이다', () => {
  assert.equal(departmentPageRows(SUPPLEMENTARY_TEXT, '다른과').total, null);
});

// ── 편성별 개요 ──────────────────────

test('본예산과 1회 추경을 함께 주면 두 편성을 순서대로 라벨링한다', () => {
  const overview = departmentOverview('AI반도체과', 2026, [MAIN, SUPPLEMENTARY]);
  assert.equal(overview.editions.length, 2);
  assert.deepEqual(overview.editions.map(e => e.label), ['본예산', '1회 추경']);
});

test('각 편성의 세부사업은 금액 내림차순으로 정렬된다', () => {
  const overview = departmentOverview('AI반도체과', 2026, [MAIN, SUPPLEMENTARY]);
  const [main, sup] = overview.editions;
  assert.deepEqual(main.businesses.map(b => b.amount), [2265924, 1140000]);
  assert.deepEqual(sup.businesses.map(b => b.amount), [26299000, 2075924]);
});

test('가장 큰 사업은 추경 쪽 판교 연구센터이며 편성 회차는 1회 추경이다', () => {
  const overview = departmentOverview('AI반도체과', 2026, [MAIN, SUPPLEMENTARY]);
  assert.equal(overview.largest_business.name, '판교시스템반도체연구센터조성');
  assert.equal(overview.largest_business.amount, 26299000);
  assert.equal(overview.largest_business.as_of, '1회 추경');
});

test('본예산에만 있는 사업은 본예산 기준으로 남고 두 편성에 있으면 추경 금액으로 덮어쓴다', () => {
  const overview = departmentOverview('AI반도체과', 2026, [MAIN, SUPPLEMENTARY]);
  const latest = Object.fromEntries(overview.latest_amounts.map(b => [b.name, b]));
  assert.equal(latest['스마트공장지원'].as_of, '본예산');
  assert.equal(latest['스마트공장지원'].amount, 1140000);
  assert.equal(latest['미래모빌리티기반도시시설물데이터구축'].as_of, '1회 추경');
  assert.equal(latest['미래모빌리티기반도시시설물데이터구축'].amount, 2075924);
});

test('편성 항목에는 all 속성이 없다', () => {
  const overview = departmentOverview('AI반도체과', 2026, [MAIN, SUPPLEMENTARY]);
  for (const edition of overview.editions) {
    assert.equal(Object.hasOwn(edition, 'all'), false);
  }
});

test('세부사업이 16개 이상이면 15개로 잘리고 businesses_truncated가 true다', () => {
  const lines = ['부서: 대량과', '대량과   100000000   0   100000000'];
  for (let i = 0; i < 16; i += 1) {
    lines.push(`   세부사업${String(i).padStart(2, '0')}   ${1000000 + i * 1000}   0   ${1000000 + i * 1000}`);
  }
  const many = edition('본예산', undefined, 'doc-many', lines.join('\n'));
  const overview = departmentOverview('대량과', 2026, [many]);
  const [only] = overview.editions;
  assert.equal(only.business_count, 16);
  assert.equal(only.businesses.length, 15);
  assert.equal(only.businesses_truncated, true);
});

test('읽을 행이 전혀 없으면 null을 반환한다', () => {
  assert.equal(departmentOverview('AI반도체과', 2026, [edition('본예산', undefined, 'doc-x', UNRELATED_TEXT)]), null);
  assert.equal(departmentOverview('AI반도체과', 2026, []), null);
});

test('쪽이 잘렸다고 표시하면 pages_truncated가 true다', () => {
  assert.equal(departmentOverview('AI반도체과', 2026, [MAIN, SUPPLEMENTARY], true).pages_truncated, true);
  assert.equal(departmentOverview('AI반도체과', 2026, [MAIN, SUPPLEMENTARY]).pages_truncated, false);
});
