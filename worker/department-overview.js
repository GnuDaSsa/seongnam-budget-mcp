// 한 부서의 편성별 총액과 세부사업 금액 목록. 수록된 세출명세서 쪽의 들여쓰기 구조만 사용한다.
import { parseStatementRows } from './statement-rows.js';

const TOP_BUSINESSES = 15;

const normalize = value => String(value || '').replace(/\s/g, '');
const editionLabel = e => (e.budget_type === '추경' ? `${e.revision}회 추경` : e.budget_type);

// 구조 행 해석은 statement-rows.js의 순차 규칙을 쓴다. 세부사업은 다음 구조 행이 편성목(3자리 코드)인 금액 3열 이름 행이며,
// 들여쓰기는 힌트일 뿐이다(공백이 있는 이름은 들여쓰기 4·6, 일부는 2로 읽힌다).
const amountsOf = row => ({
  source_line: row.source_line,
  source_excerpt: row.source_excerpt,
  amount: row.amounts.budget,
  previous_amount: row.amounts.previous,
  change: row.amounts.change,
  columns_verified: row.amounts.budget - row.amounts.previous === row.amounts.change,
});

function rowsOfPages(pages, departmentName) {
  const department = normalize(departmentName);
  const rows = parseStatementRows(pages, { document_id: null, year: null, edition: null, account: null }, { lenient: true });
  let total = null;
  const businesses = [];
  for (const row of rows) {
    if (row.level === 'department' && normalize(row.department) === department) {
      if (!total) total = { ...amountsOf(row), page: row.page };
    } else if (row.level === 'business' && normalize(row.department) === department) {
      businesses.push({ name: row.business, unit_business: row.unit, page: row.page, ...amountsOf(row) });
    }
  }
  return { total, businesses };
}

// 한 쪽에서 부서 총액 행과 세부사업 행을 읽는다.
export function departmentPageRows(text, departmentName) {
  const source = String(text || '');
  // 부서 머리글이 없는 쪽도 지정한 부서의 쪽으로 읽는다(이전 동작과 같다).
  const withHeader = /^\s*부서:/m.test(source) ? source : `부서: ${departmentName}\n${source}`;
  const { total, businesses } = rowsOfPages([{ page: 1, text: withHeader }], departmentName);
  return {
    total: total ? (({ page, ...rest }) => rest)(total) : null,
    businesses: businesses.map(({ page, ...rest }) => rest),
  };
}

function editionSummary(edition, departmentName) {
  const byName = new Map();
  const pages = [...edition.pages].sort((a, b) => a.page - b.page);
  const { total: parsedTotal, businesses: parsedBusinesses } = rowsOfPages(pages, departmentName);
  const locations = new Map(pages.map(p => [p.page, { page: p.page, page_url: p.page_url, unit: p.unit }]));
  const total = parsedTotal ? { ...(({ page, ...rest }) => rest)(parsedTotal), ...locations.get(parsedTotal.page) } : null;
  let businessSum = 0;
  for (const business of parsedBusinesses) {
    businessSum += business.amount;
    const key = normalize(business.name);
    if (!byName.has(key)) {
      const { page, ...rest } = business;
      byName.set(key, { ...rest, ...locations.get(page) });
    }
  }
  const businesses = [...byName.values()].sort((a, b) => b.amount - a.amount);
  return {
    // 원문 부서 합계와 세부사업 행의 합계가 같을 때만 true. 합계 행이 없으면 null.
    // 추경 명세서는 변경된 사업만 나오므로 합계가 맞지 않는 것이 정상이다.
    reconciliation: {
      department_total: total ? total.amount : null,
      business_sum: parsedBusinesses.length ? businessSum : null,
      reconciled: total ? total.amount === businessSum && parsedBusinesses.length > 0 : null,
    },
    budget_type: edition.budget_type,
    revision: edition.revision ?? null,
    label: editionLabel(edition),
    document_id: edition.document_id,
    title: edition.title,
    pages_read: edition.pages.length,
    department_total: total,
    business_count: businesses.length,
    businesses: businesses.slice(0, TOP_BUSINESSES),
    businesses_truncated: businesses.length > TOP_BUSINESSES,
    all: businesses,
  };
}

// 본예산 금액에 수록된 추경 회차를 순서대로 덮어써 사업별 최신 예산액을 만든다(계산값).
function latestAmounts(summaries) {
  const latest = new Map();
  for (const summary of summaries) {
    for (const business of summary.all) {
      latest.set(normalize(business.name), {
        name: business.name,
        amount: business.amount,
        unit: business.unit,
        as_of: summary.label,
        columns_verified: business.columns_verified,
        page: business.page,
        page_url: business.page_url,
      });
    }
  }
  return [...latest.values()].sort((a, b) => b.amount - a.amount);
}

// editions: 본예산 다음에 추경 회차 순서로 정렬된 [{budget_type, revision, document_id, title, pages:[{page, page_url, unit, text}]}]
export function departmentOverview(departmentName, year, editions = [], pagesTruncated = false) {
  const summaries = editions.map(e => editionSummary(e, departmentName));
  if (!summaries.some(s => s.business_count || s.department_total)) return null;
  const ranked = latestAmounts(summaries);
  // 본예산 세부사업 합계가 원문 부서 합계와 다르면 행이 빠졌을 수 있으므로 가장 큰 사업을 내지 않는다.
  const base = summaries.find(s => s.budget_type === '본예산');
  const baseReconciled = base ? base.reconciliation.reconciled : null;
  const businessesReconciled = baseReconciled !== false;
  return {
    department: departmentName,
    year,
    editions: summaries.map(({ all, ...summary }) => summary),
    latest_amounts: ranked.slice(0, TOP_BUSINESSES),
    latest_amounts_truncated: ranked.length > TOP_BUSINESSES,
    largest_business: businessesReconciled ? ranked[0] ?? null : null,
    // true: 본예산 세부사업 합계 = 부서 합계. false: 불일치(largest_business 생략). null: 본예산 또는 합계 행 없음.
    base_reconciled: baseReconciled,
    largest_business_suppressed_reason: businessesReconciled ? null : '본예산 세부사업 합계가 부서 합계와 달라 가장 큰 사업을 확정하지 않았습니다. 일부 행이 읽히지 않았을 수 있습니다.',
    pages_truncated: pagesTruncated,
    note: 'department_total은 원문의 부서 합계 행입니다. businesses는 그 편성의 세부사업 행을 금액순으로 나열한 것입니다. '
      + 'latest_amounts는 본예산 금액에 수록된 추경 회차의 예산액을 순서대로 반영한 계산값이며, 추경 명세서에는 변경된 사업만 나옵니다. '
      + '수록되지 않은 회차나 스캔 쪽은 반영되지 않았으므로 편성 회차(as_of)를 함께 밝히세요. 서로 다른 편성의 금액을 합산하지 마세요.',
  };
}
