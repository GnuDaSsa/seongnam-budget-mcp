// 세출명세서 행(statement-rows.js)으로 순위·합계·편성 비교·재원 구성을 계산한다. 순수 함수이며 입출력은 호출자가 맡는다.
// 검증되지 않은 범위는 complete로 표시하지 않고, 합계·순위에 없는 값을 0원으로 채우지 않는다.
import { reconcileStatement } from './statement-rows.js';
import { sumDepartments, compareEditions } from './budget-analytics.js';

const norm = v => String(v ?? '').replace(/\s+/g, '');
const UNIT = '천원';

// ── 문서 찾기와 쪽 읽기 ─────────────────────────────────────────

// 카탈로그(catalog.json)의 문서 메타데이터에서 "전체" 세출예산사업명세서를 고른다.
// 본예산: 제목이 "… · 일반회계|기타특별회계 · 세출예산사업명세서 · 전체".
// 추경: 제목이 "N회 추경 세입세출예산서 · 세출예산사업명세서"(회계 구분 없음, 한 문서에 여러 회계가 들어 있다).
// 상수도·하수도·공영개발 특별회계는 구조가 달라 읽지 않는다(excluded).
export function findStatementDocuments(catalog, { year = null, budget_type = null, revision = null } = {}) {
  const documents = [];
  const excluded = [];
  for (const d of catalog?.documents ?? []) {
    const parts = String(d.title ?? '').split('·').map(s => s.trim());
    if (!parts.includes('세출예산사업명세서')) continue;
    if (year != null && d.year !== year) continue;
    if (budget_type != null && d.budget_type !== budget_type) continue;
    if (revision != null && (d.revision ?? null) !== revision) continue;
    const isMain = d.budget_type === '본예산' && parts[parts.length - 1] === '전체' && /^(일반회계|기타특별회계)$/.test(parts[parts.length - 3] ?? '');
    const isRevision = d.budget_type === '추경' && parts[parts.length - 1] === '세출예산사업명세서' && parts.length === 2;
    if (!isMain && !isRevision) {
      if (/(상수도|하수도|공영개발)/.test(d.title)) excluded.push({ document_id: d.id, title: d.title, reason: '구조가 다른 공기업·공영개발 회계 명세서는 읽지 않음' });
      continue;
    }
    const indexed = d.indexed_pages ?? null;
    documents.push({
      document_id: d.id,
      title: d.title,
      year: d.year,
      budget_type: d.budget_type,
      revision: d.revision ?? null,
      account_group: isMain ? parts[parts.length - 3] : '원문 확인',
      shards: d.shards ?? [],
      page_count: d.page_count ?? null,
      indexed_pages: indexed,
      all_pages_indexed: indexed != null && d.page_count != null ? indexed === d.page_count : null,
      status: d.status ?? null,
    });
  }
  documents.sort((a, b) => (a.year - b.year) || (a.budget_type === b.budget_type ? (a.revision ?? 0) - (b.revision ?? 0) : a.budget_type === '본예산' ? -1 : 1)
    || a.account_group.localeCompare(b.account_group, 'ko'));
  return { documents, excluded };
}

// 문서 하나를 읽는 자산 경로. 색인(pages-<shard>.json.gz)은 { pages: [[document_id, page, unit, ...]] }이고
// 본문(text-<shard>.json.gz)은 같은 순서의 문자열 배열이다.
export function statementAssetPaths(document) {
  return (document?.shards ?? []).flatMap(shard => [`corpus/pages-${shard}.json.gz`, `corpus/text-${shard}.json.gz`]);
}

// 이미 읽은 샤드 [{ index: {pages:[...]}, texts: [...] }]에서 한 문서의 쪽을 쪽 번호순으로 뽑는다.
export function pagesFromShards(shards, documentId) {
  const pages = [];
  for (const { index, texts } of shards ?? []) {
    (index?.pages ?? []).forEach((row, i) => {
      if (row[0] === documentId && typeof texts?.[i] === 'string') pages.push({ page: row[1], unit: row[2] ?? null, text: texts[i] });
    });
  }
  return pages.sort((a, b) => a.page - b.page);
}

// ── 공통 보조 ─────────────────────────────────────────────────

const rowPath = r => ({
  account: r.account ?? null,
  department: r.department ?? null,
  policy: r.policy ?? null,
  unit: r.unit ?? null,
  business: r.business ?? null,
  object: r.object ?? null,
  stat: r.stat ?? null,
});
const scopeKey = r => JSON.stringify([r.year ?? null, r.budget_type ?? null, r.revision ?? null, r.account ?? null]);
const scopeOf = r => ({ year: r.year ?? null, edition: r.edition ?? null, budget_type: r.budget_type ?? null, revision: r.revision ?? null, account: r.account ?? null });

function kernelRow(r) {
  if (!r) return null;
  return {
    year: r.year, budget_type: r.budget_type, revision: r.revision ?? null, account: r.account, department: r.department,
    policy_business: r.policy, unit_business: r.unit, business: r.business, unit: r.amount_unit,
    page_url: r.document_id && r.page ? `${r.document_id}#page=${r.page}` : null,
    amount: r.amounts?.budget, previous_amount: r.amounts?.previous, change: r.amounts?.change,
    columns_verified: r.columns_verified === true,
  };
}

const source = r => ({ document_id: r.document_id ?? null, page: r.page ?? null, source_line: r.source_line ?? null });

// ── 순위 ─────────────────────────────────────────────────────

// level 'business' | 'department' | 'stat'. stat은 code 'NNN-NN'(편성목-통계목)이 필요하며 department로 한정할 수 있다.
export function rankRows(rows = [], { level = 'business', code = null, department = null, direction = 'desc', n = 5, account = null, uncovered_accounts = null } = {}) {
  const limit = Number.isInteger(n) && n > 0 ? Math.min(n, 100) : 5;
  const asc = direction === 'asc';
  const dept = department ? norm(department) : null;
  let codeParts = null;
  if (level === 'stat') {
    const m = String(code ?? '').match(/^(\d{3})-(\d{2})$/);
    if (!m) return { status: 'incomplete', items: [], scope: { level, code: code ?? null }, coverage: { reconciled: 0, total: 0 }, reason: '통계목 순위에는 NNN-NN 형식의 코드가 필요합니다.' };
    codeParts = { object: m[1], stat: m[2] };
  }
  const inAccount = account ? rows.filter(r => norm(r.account) === norm(account)) : rows;
  const picked = inAccount.filter(r => {
    if (r.level !== level) return false;
    if (dept && norm(r.department) !== dept) return false;
    if (codeParts && !(r.object?.code === codeParts.object && r.stat?.code === codeParts.stat)) return false;
    return true;
  });
  const scopes = new Map(picked.map(r => [scopeKey(r), scopeOf(r)]));
  const scope = scopes.size === 1 ? { ...[...scopes.values()][0], level, code: code ?? null, department: department ?? null }
    : { year: null, edition: null, account: null, level, code: code ?? null, department: department ?? null, mixed: [...scopes.values()] };
  const empty = (status, reason, coverage) => ({ status, items: [], scope, coverage, reason });
  if (!picked.length) return empty('incomplete', '조건에 맞는 행이 없습니다.', { reconciled: 0, total: 0 });
  if (scopes.size > 1) return empty('incomplete', '연도·편성·회계가 섞여 있어 순위를 만들지 않았습니다.', { reconciled: 0, total: 0 });

  // 검증 범위: 같은 연도·편성·회계 전체 행의 부서 합계 대조.
  const single = [...scopes.values()][0];
  const inventoryRows = inAccount.filter(r => scopeKey(r) === scopeKey(picked[0]));
  const rec = reconcileStatement(inventoryRows);
  const departmentsInScope = dept ? rec.departments.filter(d => norm(d.department) === dept) : rec.departments;
  const reconciled = departmentsInScope.filter(d => d.reconciled).length;
  const coverage = { reconciled, total: departmentsInScope.length, inventory_status: rec.inventory_status };
  if (uncovered_accounts?.length) coverage.uncovered_accounts = [...uncovered_accounts];
  let verified = rec.inventory_status === 'verified' || (single.budget_type === '본예산' && dept && departmentsInScope.length > 0 && reconciled === departmentsInScope.length);
  // 통계목 순위는 편성목 금액과 통계목 합계도 맞아야 한다.
  if (level === 'stat') verified = verified && statObjectsReconcile(inventoryRows, dept);
  const sorted = [...picked].sort((a, b) => (asc ? a.amounts.budget - b.amounts.budget : b.amounts.budget - a.amounts.budget)
    || String(a.department).localeCompare(String(b.department), 'ko') || a.page - b.page || a.source_line - b.source_line);
  let previousAmount = null;
  let previousRank = 0;
  const items = sorted.slice(0, limit).map((r, i) => {
    const rank = r.amounts.budget === previousAmount ? previousRank : i + 1; // 같은 금액은 같은 순위
    previousAmount = r.amounts.budget;
    previousRank = rank;
    return {
      rank,
      name: level === 'department' ? r.department : r.business,
      department: r.department,
      amount: r.amounts.budget,
      unit: r.amount_unit ?? UNIT,
      page: r.page,
      document_id: r.document_id,
      source_line: r.source_line,
      path: rowPath(r),
      policy_kind: r.policy_kind ?? null,
      columns_verified: r.columns_verified === true,
    };
  });
  return {
    status: verified ? 'complete' : 'available_rows_only',
    items,
    scope,
    coverage,
    total_candidates: sorted.length,
    ...(verified ? {} : { reason: single.budget_type === '추경' ? '추경 명세서는 변경 목록이라 전체 순위를 확정할 수 없습니다.' : '부서 합계와 세부사업 합계가 맞지 않아 전체 순위를 확정하지 않았습니다.' }),
  };
}

// 편성목 행 금액 = 그 아래 통계목 행 합계인지 확인한다(대상 부서 한정 가능).
function statObjectsReconcile(rows, dept) {
  let current = null;
  let checked = 0;
  const close = () => !current || current.stat === null || current.stat === current.amount;
  for (const r of rows) {
    if (dept && norm(r.department) !== dept) continue;
    if (r.level === 'object') {
      if (!close()) return false;
      current = { amount: r.amounts.budget, stat: null };
      checked += 1;
    } else if (r.level === 'stat') {
      if (current) current.stat = (current.stat ?? 0) + r.amounts.budget;
    } else {
      if (!close()) return false;
      current = null;
    }
  }
  return close() && checked > 0;
}

// ── 세부사업 이름 맞춤 ──────────────────────────────────────

const STOP_WORDS = new Set(['예산', '얼마', '합계', '금액', '지급액', '기정액', '경정액', '증감', '사업', '세부사업', '본예산', '추경', '국비', '도비', '시비', '구성', '비교', '알려줘', '알려', '보여줘', '전체', '총액', '합산', '더하면', '각각', '모두', '포함']);
const PARTICLE = /(에서|으로|은|는|이|가|을|를|의|에|로|과|와|도|만)$/;

function contentWords(question, departmentNames) {
  const deps = departmentNames.map(norm).filter(Boolean);
  return String(question ?? '').split(/[\s,·、/]+/)
    .map(t => t.replace(/[?.!"'()]/g, ''))
    .filter(t => t && !/\d{4}\s*년|^\d+회?$/.test(t))
    .filter(t => !deps.some(d => t.includes(d)))
    .map(t => (t.length > 2 ? t.replace(PARTICLE, '') : t))
    .filter(t => t.length >= 2 && !STOP_WORDS.has(t));
}

// question 안에서 세부사업 이름을 찾는다. 이름이 질문에 들어 있으면(가장 긴 이름 우선) 또는 질문의 내용어가 모두 이름에 들어 있으면 일치.
export function matchBusiness(rows = [], question = '', departments = null) {
  const wanted = departments?.length ? new Set(departments.map(norm)) : null;
  const businessRows = rows.filter(r => r.level === 'business' && r.business && (!wanted || wanted.has(norm(r.department))));
  const byName = new Map();
  for (const r of businessRows) {
    const key = norm(r.business);
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(r);
  }
  const candidatesOf = names => names.map(k => ({ name: byName.get(k)[0].business, row_count: byName.get(k).length, departments: [...new Set(byName.get(k).map(r => r.department))] }));
  const q = norm(question);
  const decide = (names, basis) => {
    if (names.length === 1) return { status: 'matched', rows: byName.get(names[0]), candidates: candidatesOf(names), basis };
    return { status: 'ambiguous', rows: [], candidates: candidatesOf(names), basis };
  };
  // 1) 정규화한 이름이 질문의 부분 문자열인 경우(가장 긴 이름 우선).
  const contained = [...byName.keys()].filter(k => k.length >= 2 && q.includes(k));
  if (contained.length) {
    const longest = Math.max(...contained.map(k => k.length));
    return decide(contained.filter(k => k.length === longest), 'question_contains_name');
  }
  // 2) 질문의 내용어가 모두 한 이름에 들어 있는 경우.
  const names = [...new Set((wanted ? businessRows : rows.filter(r => r.level === 'business')).map(r => r.department))];
  const words = contentWords(question, [...(departments ?? []), ...names]);
  if (words.length) {
    const hits = [...byName.keys()].filter(k => words.every(w => k.includes(norm(w))));
    if (hits.length) return decide(hits, 'all_content_words');
  }
  return { status: 'no_name_match', rows: [], candidates: [], basis: null, note: '질문과 일치하는 세부사업 이름이 수록 행에 없습니다. 0원이 아니라 일치하는 행을 찾지 못한 것입니다.' };
}

// ── 부서별 합계 ─────────────────────────────────────────────

// rowsByDept: {부서: [business 행]} 또는 Map. 요청한 부서마다 같은 경로·회계·단위의 검증된 행이 정확히 하나일 때만 합계를 낸다.
export function sumAcrossDepartments(rowsByDept = {}, requestedDepartments = []) {
  const entries = rowsByDept instanceof Map ? [...rowsByDept.entries()] : Object.entries(rowsByDept);
  const flat = entries.flatMap(([, list]) => list ?? []).filter(r => r?.level === 'business');
  const kernel = sumDepartments(flat.map(kernelRow), requestedDepartments);
  const requested = [...new Set(requestedDepartments.map(norm).filter(Boolean))];
  const perDepartment = requested.map(name => flat.filter(r => norm(r.department) === name));
  const ambiguous = requested.filter((name, i) => perDepartment[i].length > 1);
  const complete = kernel.complete && ambiguous.length === 0;
  return {
    complete,
    total: complete ? kernel.calculated_total.amount : null,
    unit: complete ? kernel.calculated_total.unit : null,
    rows: flat.filter(r => requested.includes(norm(r.department)))
      .map(r => ({ department: r.department, amount: r.amounts.budget, unit: r.amount_unit, ...source(r), path: rowPath(r) })),
    missing_departments: kernel.missing_departments.map(n => requestedDepartments.find(d => norm(d) === n) ?? n),
    ambiguous_departments: ambiguous.map(n => requestedDepartments.find(d => norm(d) === n) ?? n),
    warnings: kernel.warnings,
    note: complete ? '요청한 부서별 같은 사업 행의 예산액을 더한 계산값입니다.' : '요청한 모든 부서의 단일·검증 행이 확인되지 않아 합계를 내지 않았습니다.',
  };
}

// ── 편성 비교 ───────────────────────────────────────────────

// initialRow: 본예산 business 행. revisionRows: 추경 business 행 배열(또는 {revision, row} 배열).
// expectedRevisions: 비교할 회차 목록. 목록에 있는데 행이 없으면 not_listed_in_revision(변경 없음이 아님). 금액을 서로 더하지 않는다.
export function compareEditionRows(initialRow, revisionRows = [], expectedRevisions = null) {
  if (!initialRow) return { status: 'no_initial', initial: null, revisions: [], note: '본예산 행이 없어 비교하지 않았습니다.' };
  const given = (revisionRows ?? []).map(x => (x && 'row' in x && !('amounts' in x) ? { revision: x.revision ?? x.row?.revision ?? null, row: x.row } : { revision: x?.revision ?? null, row: x }));
  const wanted = expectedRevisions ?? [...new Set(given.map(g => g.revision))];
  const revisions = [];
  for (const revision of wanted) {
    const hits = given.filter(g => g.revision === revision && g.row);
    if (!hits.length) { revisions.push({ revision, label: `${revision}회 추경`, status: 'not_listed_in_revision' }); continue; }
    if (hits.length > 1) { revisions.push({ revision, label: `${revision}회 추경`, status: 'ambiguous', row_count: hits.length }); continue; }
    const row = hits[0].row;
    const k = compareEditions(kernelRow(initialRow), kernelRow(row));
    if (!k.complete) { revisions.push({ revision, label: `${revision}회 추경`, status: 'not_comparable', ...source(row), note: k.note }); continue; }
    revisions.push({
      revision,
      label: `${revision}회 추경`,
      status: 'compared',
      initial_amount: k.comparison.initial_amount,
      previous_amount: k.comparison.previous_amount,
      revised_amount: k.comparison.revised_amount,
      amendment_change: k.comparison.amendment_change,
      difference_from_initial: k.comparison.difference_from_initial,
      previous_matches_initial: k.comparison.previous_matches_initial,
      unit: k.comparison.unit,
      ...source(row),
      column_labels: row.column_labels ?? null,
    });
  }
  const compared = revisions.filter(r => r.status === 'compared').length;
  return {
    status: !revisions.length ? 'not_listed_in_revision' : compared === revisions.length ? 'compared' : compared ? 'partial' : revisions.every(r => r.status === 'not_listed_in_revision') ? 'not_listed_in_revision' : 'not_comparable',
    initial: { amount: initialRow.amounts.budget, unit: initialRow.amount_unit ?? UNIT, ...source(initialRow), path: rowPath(initialRow) },
    revisions,
    note: '본예산액, 기정액(해당 추경 직전 금액), 경정액(추경 후 예산액), 증감은 각각 원문 열입니다. 서로 더하지 마세요. 추경 명세서에 없으면 변경 없음이 아니라 해당 추경 명세서에 수록되지 않은 것입니다.',
  };
}

// ── 재원 구성 ───────────────────────────────────────────────

export function fundingBreakdown(row) {
  if (!row) return { status: 'no_row', parts: [] };
  const base = { row_amount: row.amounts?.budget ?? null, unit: row.amount_unit ?? UNIT, ...source(row), path: rowPath(row) };
  const funding = row.funding;
  if (!funding || !Object.keys(funding).length) return { status: 'not_printed', parts: [], ...base };
  const parts = Object.entries(funding).map(([label, amount]) => ({ label, amount, ...(row.funding_detail?.[label] ? { previous: row.funding_detail[label].previous, change: row.funding_detail[label].change } : {}) }));
  const sum = parts.reduce((n, p) => n + p.amount, 0);
  return { status: sum === base.row_amount ? 'verified' : 'mismatch', parts, sum, difference: base.row_amount - sum, ...base };
}
