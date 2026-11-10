// 한 부서의 편성별 총액과 세부사업 금액 목록. 수록된 세출명세서 쪽의 들여쓰기 구조만 사용한다.
import { statementLine } from './quality.js';

const TOP_BUSINESSES = 15;
const BUSINESS_INDENT = 3;
const UNIT_INDENT = 2;
const STARTS_WITH_NAME = /^[가-힣A-Za-z0-9(]/;

const normalize = value => String(value || '').replace(/\s/g, '');
const editionLabel = e => (e.budget_type === '추경' ? `${e.revision}회 추경` : e.budget_type);

// 한 쪽에서 부서 총액 행과 세부사업 행을 읽는다.
export function departmentPageRows(text, departmentName) {
  const department = normalize(departmentName);
  const businesses = [];
  let total = null;
  let unitBusiness = null;
  const lines = String(text || '').split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const { label, indent, amounts } = statementLine(lines[index], index);
    if (!amounts || !STARTS_WITH_NAME.test(label)) continue;
    if (indent === 0 && normalize(label) === department) total = amounts;
    else if (indent === UNIT_INDENT) unitBusiness = label;
    else if (indent === BUSINESS_INDENT) businesses.push({ name: label, unit_business: unitBusiness, ...amounts });
  }
  return { total, businesses };
}

function editionSummary(edition, departmentName) {
  const byName = new Map();
  let total = null;
  for (const page of edition.pages) {
    const rows = departmentPageRows(page.text, departmentName);
    const location = { page: page.page, page_url: page.page_url, unit: page.unit };
    if (rows.total && !total) total = { ...rows.total, ...location };
    for (const business of rows.businesses) {
      const key = normalize(business.name);
      if (!byName.has(key)) byName.set(key, { ...business, ...location });
    }
  }
  const businesses = [...byName.values()].sort((a, b) => b.amount - a.amount);
  return {
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
  return {
    department: departmentName,
    year,
    editions: summaries.map(({ all, ...summary }) => summary),
    latest_amounts: ranked.slice(0, TOP_BUSINESSES),
    latest_amounts_truncated: ranked.length > TOP_BUSINESSES,
    largest_business: ranked[0] ?? null,
    pages_truncated: pagesTruncated,
    note: 'department_total은 원문의 부서 합계 행입니다. businesses는 그 편성의 세부사업 행을 금액순으로 나열한 것입니다. '
      + 'latest_amounts는 본예산 금액에 수록된 추경 회차의 예산액을 순서대로 반영한 계산값이며, 추경 명세서에는 변경된 사업만 나옵니다. '
      + '수록되지 않은 회차나 스캔 쪽은 반영되지 않았으므로 편성 회차(as_of)를 함께 밝히세요. 서로 다른 편성의 금액을 합산하지 마세요.',
  };
}
