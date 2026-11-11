// Strict arithmetic over source-verified detailed-business rows. The caller must
// enumerate source pages and determine coverage; search hits do not prove it.
const norm = v => typeof v === 'string' ? v.replace(/\s+/g, '') : '';
const known = v => !!norm(v);
const validEdition = r => r.budget_type === '본예산'
  ? r.revision == null || r.revision === 0
  : r.budget_type === '추경' && Number.isInteger(r.revision) && r.revision > 0;
const revision = r => r.budget_type === '본예산' ? null : r.revision;
const same = (a, b, fields) => fields.every(f => norm(a[f]) && norm(a[f]) === norm(b[f]));
const safeRow = r => r && Number.isInteger(r.year) && r.year > 0 && validEdition(r)
  && ['department', 'account', 'business', 'unit', 'page_url'].every(f => known(r[f]))
  && Number.isSafeInteger(r.amount) && r.columns_verified === true;
const scope = r => JSON.stringify([r.year, r.budget_type, revision(r), norm(r.account), norm(r.unit)]);
const businessKey = r => JSON.stringify([norm(r.department), norm(r.policy_business), norm(r.unit_business), norm(r.business)]);
const sameRow = (a, b) => a.amount === b.amount && a.previous_amount === b.previous_amount && a.change === b.change;

// Preserve all source locations when the same row appears in multiple PDFs.
// Conflicting duplicates and missing hierarchy make the result non-final.
function deduplicate(rows) {
  const map = new Map();
  let invalid = false, conflicts = false;
  for (const r of rows) {
    if (!safeRow(r) || !known(r.policy_business) || !known(r.unit_business)) { invalid = true; continue; }
    const key = `${scope(r)}:${businessKey(r)}`;
    const existing = map.get(key);
    if (!existing) map.set(key, { ...r, source_urls: [r.page_url] });
    else if (!sameRow(existing, r)) conflicts = true;
    else if (!existing.source_urls.includes(r.page_url)) existing.source_urls.push(r.page_url);
  }
  return { rows: [...map.values()], invalid, conflicts };
}

// coverage.complete is an independently verified source inventory, not an
// assertion based on the number of search hits. The result always labels scope.
export function rankBusinesses(rows = [], { limit = 5, coverage = {} } = {}) {
  const dedup = deduplicate(rows);
  const scopes = new Set(dedup.rows.map(scope));
  const bounded = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 100) : 5;
  const complete = coverage.complete === true && !dedup.invalid && !dedup.conflicts && scopes.size === 1;
  return {
    scope: complete ? 'verified_inventory' : 'available_rows_only',
    complete,
    rows: scopes.size <= 1 && !dedup.conflicts ? dedup.rows.sort((a, b) => b.amount - a.amount || businessKey(a).localeCompare(businessKey(b))).slice(0, bounded) : [],
    row_count: dedup.rows.length,
    warnings: [!coverage.complete && '전체 자료 범위 미검증', dedup.invalid && '검증되지 않은 행 제외', dedup.conflicts && '중복 행 금액 충돌', scopes.size > 1 && '연도·편성·회계·단위 혼합'].filter(Boolean),
  };
}

// Exactly one verified business row per explicitly requested department; no
// partial sum is represented as the total of the requested departments.
export function sumDepartments(rows = [], requestedDepartments = []) {
  const requested = [...new Set(requestedDepartments.map(norm).filter(Boolean))];
  const d = deduplicate(rows);
  const wanted = d.rows.filter(r => requested.includes(norm(r.department)));
  const missing = requested.filter(name => !wanted.some(r => norm(r.department) === name));
  const extras = wanted.length !== requested.length;
  const first = wanted[0];
  const aligned = first && wanted.every(r => scope(r) === scope(first) && same(first, r, ['policy_business', 'unit_business', 'business', 'account', 'unit']));
  const sum = wanted.reduce((n, r) => n + r.amount, 0);
  const complete = requested.length > 0 && !missing.length && !extras && !d.invalid && !d.conflicts && aligned && Number.isSafeInteger(sum);
  return { complete: !!complete, rows: wanted, missing_departments: missing, calculated_total: complete ? { amount: sum, unit: first.unit } : null,
    warnings: [d.invalid && '검증되지 않은 행', d.conflicts && '중복 행 금액 충돌', extras && '부서별 사업 행이 하나로 확인되지 않음', !aligned && '사업·편성·회계·단위 불일치'].filter(Boolean) };
}

// Supplementary previous amount is not necessarily the initial budget: earlier
// amendments may intervene. Never add the revised amount to the initial amount.
export function compareEditions(main, supplementary) {
  const comparable = safeRow(main) && safeRow(supplementary)
    && main.budget_type === '본예산' && supplementary.budget_type === '추경'
    && main.year === supplementary.year
    && same(main, supplementary, ['department', 'account', 'policy_business', 'unit_business', 'business', 'unit'])
    && Number.isSafeInteger(supplementary.previous_amount) && Number.isSafeInteger(supplementary.change)
    && supplementary.amount - supplementary.previous_amount === supplementary.change;
  if (!comparable) return { complete: false, main: main ?? null, supplementary: supplementary ?? null, comparison: null,
    note: '동일 사업·부서·회계·단위와 원문 열의 대응을 확인하지 못했습니다. 누락을 0원으로 처리하지 마세요.' };
  const difference = supplementary.amount - main.amount;
  if (!Number.isSafeInteger(difference)) return { complete: false, main, supplementary, comparison: null, note: '금액 계산 범위를 초과했습니다.' };
  return { complete: true, main, supplementary,
    comparison: { initial_amount: main.amount, previous_amount: supplementary.previous_amount, revised_amount: supplementary.amount,
      amendment_change: supplementary.change, difference_from_initial: difference, unit: main.unit,
      previous_matches_initial: supplementary.previous_amount === main.amount },
    note: '기정액은 해당 추경 직전 금액이며 이전 추경이 있으면 본예산과 다를 수 있습니다.' };
}

