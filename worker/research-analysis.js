// budget_research의 `analysis` 블록. 원문 세출명세서 행(statement-rows.js)을 문서 단위로 순서대로 읽어
// 순위·부서 합계·편성 비교·재원·사업 확인을 계산한다. 입출력(loadRows)은 호출자가 주입한다.
// 검증되지 않은 범위는 complete로 표시하지 않고 미확인을 0원으로 바꾸지 않는다.
import { detectAnalyticIntent, detectDifferenceIntent, differenceOperands } from './analytic-intent.js';
import { rankRows, matchBusiness, matchDistrictGroups, unmatchedTerms, eachRequested, parseExclusions, sumAcrossDepartments, differenceAcrossDepartments, compareEditionRows, fundingBreakdown } from './analysis.js';
import { reconcileStatement } from './statement-rows.js';
import { retrievalWords } from './retrieval-phrases.js';

const norm = v => String(v ?? '').replace(/\s+/g, '');
const UNSUPPORTED_ACCOUNTS = ['상수도', '하수도', '공영개발사업'];
const CITY_UNCOVERED = ['기타특별회계', '상수도', '하수도', '공영개발사업'];
const DEPARTMENT_TOTAL = /(?:부서|소관|해당\s*과|과의?)\s*(?:전체\s*)?(?:총예산|총액|예산\s*총액)|기본경비\s*제외|전체\s*예산/;
const GENERIC = new Set(['예산', '예산액', '본예산', '추경', '얼마', '얼마야', '얼마인가요', '금액', '총액', '총예산', '전체', '편성', '세출', '세부사업', '사업', '내역', '알려줘', '알려주세요', '보여줘']);
const MAX_SOURCE_PAGES = 3;

export function analysisEligible(a) {
  return !!a && a.policy?.institution_scope?.mode === 'municipal' && a.policy?.source_preference === 'expenditure'
    && Number.isInteger(a.year) && a.year_scope !== 'all' && !a.topic_intent && !a.document_id && !a.category
    && (!a.budget_type || ['본예산', '추경'].includes(a.budget_type));
}

// 부서명과 일반어를 뺀 뒤에도 사업명으로 볼 낱말이 남는지.
export function businessResidue(query, departmentNames = []) {
  let q = String(query || '');
  for (const name of departmentNames) q = q.split(name).join(' ');
  return retrievalWords(q).filter(w => !/^\d/.test(w) && !GENERIC.has(w) && !departmentNames.some(d => norm(d).includes(w)));
}

function rowView(r, urlFor) {
  return {
    department: r.department ?? null, policy: r.policy ?? null, unit_business: r.unit ?? null, business: r.business ?? null,
    object: r.object ?? null, stat: r.stat ?? null, level: r.level,
    amount: r.amounts?.budget ?? null, previous_amount: r.amounts?.previous ?? null, change: r.amounts?.change ?? null,
    unit: r.amount_unit ?? '천원', column_labels: r.column_labels ?? null, columns_verified: r.columns_verified === true,
    funding: r.funding ?? null, policy_kind: r.policy_kind ?? null,
    year: r.year ?? null, budget_type: r.budget_type ?? null, revision: r.revision ?? null, account: r.account ?? null,
    document_id: r.document_id ?? null, page: r.page ?? null, source_line: r.source_line ?? null,
    page_url: urlFor ? urlFor(r.document_id, r.page) : null,
  };
}

function editionLabel(doc) { return doc.budget_type === '추경' ? doc.revision + '회 추경' : '본예산'; }

function pickSources(rows) {
  const seen = new Set(), out = [];
  for (const r of rows) {
    const key = r.document_id + ':' + r.page;
    if (!r.document_id || !r.page || seen.has(key)) continue;
    seen.add(key); out.push({ document_id: r.document_id, page: r.page, source_line: r.source_line ?? null });
    if (out.length >= MAX_SOURCE_PAGES) break;
  }
  return out;
}

// documents: findStatementDocuments(CATALOG,{year}).documents. loadRows(doc) → 그 문서의 전체 행.
export async function buildAnalysis(a, { documents = [], loadRows, urlFor = null } = {}) {
  if (!analysisEligible(a) || typeof loadRows !== 'function') return null;
  const departments = (a.departments || []).map(d => d.name);
  // 질문이 제외한 편성은 의도 판별·문서 선택·행 읽기 어디에도 쓰지 않는다.
  const excluded = a.policy?.excluded_budget_types || [];
  const intent = detectAnalyticIntent(a.query, { departments, excluded_budget_types: excluded });
  const residue = businessResidue(a.query, departments);
  const editionExcluded = excluded.includes('본예산') || excluded.includes('추경');
  const compareRequested = !editionExcluded && (intent.edition_compare || (a.policy?.allowed_budget_types?.includes('본예산') && a.policy.allowed_budget_types.includes('추경')));
  // 차액은 합계와 별도 종류다. 제외한 부서는 피연산자가 아니다.
  const diffWords = detectDifferenceIntent(a.query);
  const diff = diffWords.difference ? differenceOperands(a.query, departments) : null;
  const differenceRequested = !!diff && !intent.edition_compare && (departments.length >= 2 || diff.mentioned_districts >= 2);
  const operationConflict = !!diff && (diffWords.sum || intent.edition_compare);
  let kind = null;
  if (intent.ranking) kind = 'ranking';
  else if (diff && (departments.length >= 2 || diff.mentioned_districts >= 2) && (differenceRequested || operationConflict)) kind = 'department_difference';
  else if (departments.length >= 2 && intent.department_sum) kind = 'department_sum';
  else if (departments.length === 1 && compareRequested && residue.length) kind = 'edition_compare';
  else if (departments.length === 1 && intent.funding && residue.length) kind = 'funding';
  else if (departments.length === 1 && residue.length && !DEPARTMENT_TOTAL.test(a.query)) kind = 'business_lookup';
  if (!kind) return null;

  const notices = [];
  const base = { kind, method: 'statement_row_index', intent: { kinds: intent.kinds, ranking: intent.ranking, explicit_account: intent.explicit_account, explicit_edition: intent.explicit_edition } };
  const stop = (status, reason, extra = {}) => ({ ...base, status, reason, notices, ...extra });

  if (kind !== 'business_lookup' && parseExclusions(a.query, departments).terms.length) return stop('exclusion_unverified', '사업명 제외 조건을 이 계산 유형에서 검증할 수 없어 순위·합계·비교를 확정하지 않았습니다.');

  if (a.year !== 2026) return stop('year_not_validated', '이 연도의 원문 행 분석은 아직 검증하지 않아 순위·합계·비교를 계산하지 않았습니다.');

  if (UNSUPPORTED_ACCOUNTS.includes(intent.explicit_account)) return stop('unsupported_account', intent.explicit_account + ' 명세서는 표 구조가 달라 행 단위 계산을 하지 않습니다. 원문 쪽을 직접 확인하세요.');

  const yearDocs = documents.filter(d => d.year === a.year && !excluded.includes(d.budget_type));
  const mainDocs = yearDocs.filter(d => d.budget_type === '본예산');
  const revisionDocs = yearDocs.filter(d => d.budget_type === '추경');
  // 계산 기준 편성: 질문에 추경만 명시했으면 그 회차, 그 밖에는 본예산(미지정이면 그 사실을 알린다).
  const revisionOnly = a.budget_type === '추경' && !compareRequested;
  if (!a.budget_type && !compareRequested) return stop('edition_required', '편성 구분이 지정되지 않아 본예산이나 추경 중 하나를 임의로 선택하지 않았습니다. 편성 범위를 지정하세요.');
  if (revisionOnly && !a.revision) return stop('edition_required', '추경 회차가 지정되지 않아 행 단위 계산을 하지 않았습니다. 회차를 지정하세요.');
  let primaryDocs = revisionOnly ? revisionDocs.filter(d => d.revision === a.revision) : mainDocs;
  if (intent.explicit_account === '일반회계' || intent.explicit_account === '기타특별회계') primaryDocs = primaryDocs.filter(d => d.account_group === intent.explicit_account || d.account_group === '원문 확인');
  if (!primaryDocs.length) return stop('no_statement_document', (revisionOnly ? a.revision + '회 추경' : a.year + '년 본예산') + ' 세출예산사업명세서(전체)가 수록 색인에 없어 행 단위 계산을 하지 않았습니다.');
  const editionBasis = 'query';
  base.edition_basis = editionBasis;
  if (kind === 'ranking' && compareRequested) notices.push('본예산과 추경을 함께 요청했지만 순위는 본예산 세출명세서 기준입니다. 추경 명세서는 변경된 사업만 나오는 변경 목록이라 추경을 포함한 전체 순위는 계산하지 않았습니다. 추경 반영 최대액은 department_overview.latest_amounts를 계산값으로만 참고하세요.');

  const loaded = [];
  async function rowsOf(doc) {
    const hit = loaded.find(x => x.doc === doc);
    if (hit) return hit.rows;
    const rows = await loadRows(doc);
    loaded.push({ doc, rows });
    return rows;
  }
  // 요청 부서가 들어 있는 첫 문서(일반회계 → 기타특별회계 순).
  async function docWithDepartments(docs, names) {
    for (const doc of docs) {
      const rows = await rowsOf(doc);
      if (names.every(n => rows.some(r => norm(r.department) === norm(n)))) return { doc, rows };
    }
    return null;
  }
  const view = r => rowView(r, urlFor);
  const finish = (status, extra = {}, rows = []) => ({ ...base, status, notices, ...extra, source_pages: pickSources(rows),
    documents_read: loaded.map(x => ({ document_id: x.doc.document_id, title: x.doc.title, edition: editionLabel(x.doc), account_group: x.doc.account_group, rows: x.rows.length })) });

  if (kind === 'department_difference') {
    const operandNames = diff.operands, excludedNames = diff.excluded;
    const scopeInfo = { excluded_departments: excludedNames, requested_operands: operandNames, calculated_total: null, total: null };
    if (operationConflict) return stop('ambiguous_operation', '질문이 차액과 ' + (diffWords.sum ? '합계' : '편성 비교') + '를 함께 요청해 하나의 계산으로 정할 수 없습니다. 합계나 차액을 임의로 선택하지 않았습니다. 요청을 나누어 다시 질문하세요.', scopeInfo);
    if (compareRequested) return stop('edition_required', '본예산과 추경이 함께 요청되어 어느 편성의 부서 금액으로 차액을 낼지 정할 수 없습니다. 편성을 하나로 지정하세요.', scopeInfo);
    if (operandNames.length < 2) return stop('insufficient_departments', '비교할 부서가 두 곳 확인되지 않아 차액을 계산하지 않았습니다(확인된 부서: ' + (operandNames.join(', ') || '없음') + '). 부서명을 정확히 지정하세요.', scopeInfo);
    if (operandNames.length > 2) return stop('too_many_departments', '차액은 두 부서에만 정의되는데 제외하지 않은 부서가 ' + operandNames.length + '곳(' + operandNames.join(', ') + ')입니다. 비교할 두 부서를 지정하거나 나머지를 제외하세요. 합계로 대신하지 않았습니다.', scopeInfo);
    // 회계를 지정하지 않았는데 두 부서가 여러 회계 문서에 있으면 어느 회계인지 정할 수 없다.
    if (!intent.explicit_account && primaryDocs.length > 1) {
      const holders = [];
      for (const doc of primaryDocs) { const rows = await rowsOf(doc); if (operandNames.every(n => rows.some(r => norm(r.department) === norm(n)))) holders.push(doc); }
      if (holders.length > 1) return stop('account_required', '두 부서가 ' + holders.map(d => d.account_group).join('·') + ' 명세서에 모두 있어 회계 구분이 필요합니다. 회계를 지정하세요.', scopeInfo);
    }
    const found = await docWithDepartments(primaryDocs, operandNames);
    const doc = found?.doc ?? primaryDocs[0];
    const rows = found?.rows ?? await rowsOf(doc);
    const present = operandNames.filter(n => rows.some(r => norm(r.department) === norm(n)));
    const missing = operandNames.filter(n => !present.includes(n));
    if (missing.length) return finish('incomplete', { reason: '요청한 부서 ' + missing.join(', ') + ' 행을 ' + editionLabel(doc) + ' ' + doc.account_group + ' 세출명세서에서 찾지 못해 차액을 내지 않았습니다. 0원으로 처리하지 않았습니다.', missing_departments: missing, ambiguous_departments: [], ...scopeInfo, scope: { year: a.year, edition: editionLabel(doc), account_group: doc.account_group, document_id: doc.document_id } });
    const m = matchBusiness(rows, a.query, operandNames);
    if (m.status !== 'matched') return finish(m.status, { reason: m.note ?? '요청한 부서들에서 질문한 세부사업을 하나로 특정하지 못해 차액을 내지 않았습니다.', candidates: m.candidates, missing_departments: [], ...scopeInfo });
    const byDept = new Map();
    for (const row of m.rows.filter(r => operandNames.some(n => norm(n) === norm(r.department)))) { const k = row.department; if (!byDept.has(k)) byDept.set(k, []); byDept.get(k).push(row); }
    // 단순 나열 순서는 뺄셈 방향을 뜻하지 않는다. 명시적인 방향 파서가 검증되기 전에는 절대 차이만 반환한다.
    const directionKnown = false;
    const d = differenceAcrossDepartments(byDept, operandNames, { directionKnown });
    const scope = { year: a.year, edition: editionLabel(doc), account_group: doc.account_group, document_id: doc.document_id, unit: d.unit ?? '천원' };
    if (!d.complete) return finish('incomplete', { reason: d.note, missing_departments: d.missing_departments, ambiguous_departments: d.ambiguous_departments, warnings: d.warnings, business: m.rows[0]?.business ?? null, rows: m.rows.map(view), ...scopeInfo, scope }, m.rows);
    const label = o => o.department + ' ' + o.amount.toLocaleString('en-US') + ' ' + d.unit;
    const [first, second] = d.operands;
    return finish('calculated', {
      reason: null,
      business: m.rows[0]?.business ?? null,
      rows: m.rows.filter(r => operandNames.some(n => norm(n) === norm(r.department))).map(view),
      ...scopeInfo,
      difference: {
        operation: d.direction_known ? 'minuend - subtrahend' : 'absolute_difference',
        operands: d.operands, unit: d.unit,
        direction_known: d.direction_known, direction_ambiguous: !d.direction_known,
        direction_basis: d.direction_known ? 'question_order' : 'ambiguous',
        minuend: d.minuend, subtrahend: d.subtrahend,
        signed_difference: d.signed_difference, absolute_difference: d.absolute_difference,
        larger_department: d.larger_department,
        expression: d.direction_known ? label(first) + ' - ' + label(second) + ' = ' + d.signed_difference.toLocaleString('en-US') + ' ' + d.unit : null,
        labels: { signed_difference: '부호 있는 차액(앞 부서 - 뒤 부서)', absolute_difference: '절대값 차이' },
        calculated: true,
      },
      warnings: d.warnings, scope,
      note: d.note + (d.direction_known ? '' : ' 두 부서의 금액과 절대값 차이를 함께 제시하고 방향은 질문에서 확정되지 않았다고 밝히세요.') + ' 이 값은 합계가 아니므로 두 금액을 더한 값을 답으로 제시하지 마세요.',
    }, m.rows);
  }

  if (kind === 'ranking') {
    const r = intent.ranking;
    const requestedN = r.n ?? 10;
    const n = requestedN === 1 ? 3 : Math.min(requestedN, 30);
    const department = r.level === 'department' ? null : r.department;
    let found;
    if (department) {
      found = await docWithDepartments(primaryDocs, [department]);
      if (!found) return finish('department_not_in_statement', { reason: department + ' 행을 ' + (revisionOnly ? a.revision + '회 추경' : '본예산') + ' 세출명세서에서 찾지 못해 순위를 만들지 않았습니다.' });
    } else {
      const doc = primaryDocs.find(d => d.account_group === (intent.explicit_account || '일반회계')) || primaryDocs[0];
      found = { doc, rows: await rowsOf(doc) };
    }
    const cityWide = !department && !intent.explicit_account;
    const ranked = rankRows(found.rows, { level: r.level, code: r.code, department, direction: r.direction, n, uncovered_accounts: cityWide ? CITY_UNCOVERED : null });
    let status = ranked.status;
    let reason = ranked.reason ?? null;
    if (status === 'complete' && compareRequested) {
      // 추경을 함께 요청한 순위를 본예산만으로 complete라 하지 않는다.
      status = 'partial_scope';
      reason = '요청 범위에 추경이 포함됐지만 순위는 본예산 세출명세서 기준입니다. 추경을 반영한 순위나 1위로 표현하지 마세요.';
    } else if (status === 'complete' && cityWide && found.doc.budget_type === '본예산') {
      status = 'partial_scope';
      reason = '회계 미지정: ' + found.doc.account_group + ' 세출명세서 안의 순위입니다. 기타특별회계·상수도·하수도·공영개발사업은 포함하지 않았으므로 시 전체 1위나 전체 순위로 표현하지 마세요.';
    }
    if (status === 'complete' && !department) {
      status = 'partial_scope';
      reason = '수록된 명세서의 부서별 합계는 대조했지만 회계 전체 총액과 독립적으로 대조하지 못해 해당 회계의 완전한 순위로 확정하지 않습니다.';
    }
    return finish(status, {
      reason,
      requested_n: r.n, returned_n: ranked.items.length,
      scope: { ...ranked.scope, document_id: found.doc.document_id, account_group: found.doc.account_group, edition: editionLabel(found.doc), unit: ranked.items[0]?.unit ?? '천원', amount_column: '예산액' },
      coverage: ranked.coverage, total_candidates: ranked.total_candidates ?? 0,
      items: ranked.items.map(it => ({ ...it, page_url: urlFor ? urlFor(it.document_id, it.page) : null })),
      note: '같은 이름의 사업이 여러 부서에 있으면 부서별 행을 따로 순위에 둡니다. 순위는 원문 예산액 열 기준이며 계산값이 아닙니다.',
    }, ranked.items.map(it => ({ document_id: it.document_id, page: it.page, source_line: it.source_line })));
  }

  if (kind === 'department_sum') {
    const found = await docWithDepartments(primaryDocs, departments);
    const doc = found?.doc ?? primaryDocs[0];
    const rows = found?.rows ?? await rowsOf(doc);
    const present = departments.filter(n => rows.some(r => norm(r.department) === norm(n)));
    const m = matchBusiness(rows, a.query, present.length ? present : departments);
    if (m.status !== 'matched') return finish(m.status, { reason: m.note ?? '요청한 부서들에서 질문한 세부사업을 하나로 특정하지 못해 합계를 내지 않았습니다.', candidates: m.candidates, total: null, missing_departments: departments.filter(n => !present.includes(n)) });
    const byDept = new Map();
    for (const row of m.rows) { const k = row.department; if (!byDept.has(k)) byDept.set(k, []); byDept.get(k).push(row); }
    const sum = sumAcrossDepartments(byDept, departments);
    return finish(sum.complete ? 'calculated' : 'incomplete', {
      reason: sum.complete ? null : sum.note,
      business: m.rows[0]?.business ?? null,
      rows: m.rows.map(view), calculated_total: sum.complete ? { amount: sum.total, unit: sum.unit, calculated: true } : null,
      missing_departments: sum.missing_departments, ambiguous_departments: sum.ambiguous_departments, warnings: sum.warnings,
      scope: { year: a.year, edition: editionLabel(doc), account_group: doc.account_group, document_id: doc.document_id },
      note: sum.note,
    }, m.rows);
  }

  const department = departments[0];
  const found = await docWithDepartments(primaryDocs, [department]);
  if (!found) {
    return finish('department_not_in_statement', { reason: department + ' 행을 ' + (revisionOnly ? a.revision + '회 추경' : a.year + '년 본예산') + ' 세출명세서에서 찾지 못했습니다. 부서명 변경을 추정하지 않으며 사업 부재나 0원으로 해석하지 마세요.' });
  }
  const deptRows = found.rows.filter(r => norm(r.department) === norm(department));
  // 구별 묶음: "수정구 중원구 분당구별"은 부서가 아니라 사업명에 적힌 지역 구분이다(부서명에 든 구는 제외). 차액 질문은 이 경로를 쓰지 않는다.
  if (kind === 'business_lookup' && !diffWords.difference) {
    const g = matchDistrictGroups(found.rows, a.query, [department], { sumRequested: diffWords.sum });
    if (g) {
      const listed = [...g.groups.flatMap(x => x.rows.map(r => ({ r, group: x.group }))), ...g.unassigned_rows.map(r => ({ r, group: null }))];
      const status = !g.complete ? 'incomplete' : g.calculated_total ? 'calculated' : 'matched';
      return finish(status, {
        reason: g.complete ? null : g.reasons.join(' ') + ' 확인된 후보 행만 나열하며 합계나 누락 구분의 금액을 만들지 않았습니다.',
        match_kind: 'district_groups', business: null, department,
        geographic_groups_are_not_departments: true,
        requested_groups: g.requested_groups, business_query_words: g.core_words, name_match_basis: g.basis,
        groups: g.groups.map(x => ({ group: x.group, row_count: x.rows.length, status: x.rows.length ? 'rows_listed' : 'not_found', subtotal: g.calculated_total ? { amount: g.subtotals[x.group], unit: g.calculated_total.unit, calculated: true } : null })),
        rows: listed.map(({ r, group }) => ({ ...view(r), group })),
        unassigned_row_count: g.unassigned_rows.length,
        excluded_other_activity_rows: g.excluded_other_activity_rows,
        exclusions: g.exclusions,
        calculated_total: g.calculated_total, total: null,
        scope: { year: a.year, edition: editionLabel(found.doc), account_group: found.doc.account_group, document_id: found.doc.document_id, unit: listed[0]?.r.amount_unit ?? '천원' },
        note: '구 이름은 부서가 아니라 원문 세부사업명에 적힌 지역 구분이며 담당 부서는 ' + department + '입니다. 같은 구의 행이 여러 개면 별도 행으로 나열합니다. '
          + (g.calculated_total ? '합계는 구 이름이 명시된 모든 행과 부서 총액 대조를 확인한 계산값입니다.' : g.sum_requested ? '합계는 확인되지 않아 계산하지 않았습니다.' : '합계를 요청하지 않아 계산하지 않았습니다.'),
      }, listed.map(x => x.r));
    }
  }

  const match = matchBusiness(found.rows, a.query, [department], { allowMulti: kind === 'business_lookup' });

  // 각각: 서로 다른 정확한 이름의 사업을 따로 보여 준다. 이름이 비슷한 다른 행으로 대체하거나 합산하지 않는다.
  if (kind === 'business_lookup' && eachRequested(a.query) && (match.status === 'multi_matched' || match.status === 'matched')) {
    const named = match.status === 'multi_matched' ? match.groups : [{ name: match.rows[0].business, rows: match.rows }];
    const unmatched = unmatchedTerms(a.query, [department], named.map(x => x.name));
    if (named.length > 1 || unmatched.length) {
      const items = named.map(x => {
        const one = x.rows.length === 1 ? x.rows[0] : null;
        return {
          business: x.name, row_count: x.rows.length,
          status: !one ? 'ambiguous_rows' : one.columns_verified === true && Number.isSafeInteger(one.amounts?.budget) ? 'matched' : 'columns_not_verified',
          amount: one?.amounts?.budget ?? null, unit: one?.amount_unit ?? '천원',
          document_id: one?.document_id ?? null, page: one?.page ?? null, source_line: one?.source_line ?? null,
          page_url: one && urlFor ? urlFor(one.document_id, one.page) : null,
        };
      });
      const problems = [];
      if (match.exclusions?.unmatched_terms?.length) problems.push('제외할 사업 범위를 확인하지 못했습니다: ' + match.exclusions.unmatched_terms.join(', ') + '.');
      if (items.some(i => i.status !== 'matched')) problems.push('일부 사업의 행이 하나로 검증되지 않았습니다(' + items.filter(i => i.status !== 'matched').map(i => i.business + ': ' + i.status).join(', ') + ').');
      if (unmatched.length) problems.push('질문의 다음 표현에 해당하는 정확한 이름의 행을 ' + department + ' ' + editionLabel(found.doc) + ' 세출명세서에서 확인되지 않았습니다: ' + unmatched.join(', ') + '. 이름이 비슷한 다른 행으로 대체하지 않았습니다.');
      return finish(problems.length ? 'incomplete' : 'matched', {
        reason: problems.length ? problems.join(' ') : null,
        match_kind: 'named_items', business: null, department,
        requested_items: named.map(x => x.name), unmatched_terms: unmatched, items,
        rows: named.flatMap(x => x.rows).map(view),
        calculated_total: null, total: null,
        scope: { year: a.year, edition: editionLabel(found.doc), account_group: found.doc.account_group, document_id: found.doc.document_id, unit: named[0].rows[0]?.amount_unit ?? '천원' },
        note: '정확히 같은 이름의 행만 사업별로 따로 제시했고 괄호 표기(예: (자체))는 이름의 일부입니다. 요청하지 않은 합계는 계산하지 않았으며 사업 금액을 서로 더하지 마세요.',
      }, named.flatMap(x => x.rows));
    }
  }

  if (kind === 'edition_compare') {
    if (match.status !== 'matched' || match.rows.length !== 1) return finish(match.status === 'matched' ? 'ambiguous' : match.status, { reason: match.note ?? '본예산에서 질문한 사업 행을 하나로 특정하지 못해 비교하지 않았습니다.', candidates: match.candidates });
    const initial = match.rows[0];
    const wanted = a.revision ? [a.revision] : [...new Set(revisionDocs.map(d => d.revision))].sort((x, y) => x - y);
    const missingRevisionDocs = wanted.filter(rv => !revisionDocs.some(d => d.revision === rv));
    const revRows = [];
    for (const doc of revisionDocs.filter(d => wanted.includes(d.revision))) {
      const rows = await rowsOf(doc);
      for (const row of rows) if (row.level === 'business' && norm(row.department) === norm(department) && norm(row.business) === norm(initial.business)) revRows.push({ revision: doc.revision, row });
    }
    const available = wanted.filter(rv => !missingRevisionDocs.includes(rv));
    const cmp = compareEditionRows(initial, revRows, available);
    const status = missingRevisionDocs.length ? 'incomplete' : cmp.status === 'compared' ? 'compared' : cmp.status;
    return finish(status, {
      reason: missingRevisionDocs.length ? missingRevisionDocs.map(r => r + '회').join('·') + ' 추경 세출명세서가 색인에 없어 비교를 완료하지 않았습니다.' : null,
      business: initial.business, initial: view(initial), revisions: cmp.revisions.map(x => ({ ...x, page_url: urlFor && x.document_id ? urlFor(x.document_id, x.page) : null })),
      missing_revision_documents: missingRevisionDocs, note: cmp.note,
    }, [initial, ...revRows.map(x => x.row)]);
  }

  if (match.status !== 'matched') {
    const rec = reconcileStatement(found.rows).departments.filter(d => norm(d.department) === norm(department));
    const businesses = deptRows.filter(r => r.level === 'business');
    return finish(match.status, {
      reason: match.status === 'no_name_match'
        ? '미확인: ' + department + '의 ' + editionLabel(found.doc) + ' 세출명세서 세부사업 ' + businesses.length + '개 행에서 질문한 사업명을 찾지 못했습니다. 0원이나 사업 부재로 확정하지 마세요.'
        : '질문과 일치하는 세부사업이 여러 개라 하나로 특정하지 않았습니다. 사업명을 정확히 지정하세요.',
      candidates: match.candidates,
      department_rows_checked: { department, edition: editionLabel(found.doc), business_rows: businesses.length, reconciled: rec.length ? rec.every(d => d.reconciled) : null },
      editions_not_checked: revisionOnly ? [] : revisionDocs.map(editionLabel),
    });
  }
  if (kind === 'funding') {
    if (match.rows.length !== 1) return finish('ambiguous', { reason: '같은 부서에 같은 이름의 세부사업 행이 여러 개라 재원을 하나로 정하지 않았습니다.', rows: match.rows.map(view) }, match.rows);
    const f = fundingBreakdown(match.rows[0]);
    return finish(f.status === 'verified' ? 'matched' : 'incomplete', {
      reason: f.status === 'verified' ? null : f.status === 'not_printed' ? '해당 사업 행에 재원 구분이 인쇄되어 있지 않습니다.' : '재원 합계가 사업 예산액과 맞지 않아 확정하지 않았습니다.',
      business: match.rows[0].business, row: view(match.rows[0]), funding: f,
      note: '국·도·시비 등은 원문 재원 줄이며 합계는 계산값으로 대조했습니다.',
    }, match.rows);
  }
  // 제외 요청: 정확한 이름으로 제외한 행은 결과에 없다. 제외어에 해당하는 행이 없으면 요청 범위를 확정하지 않는다.
  const exclusions = match.exclusions ?? null;
  const exclusionUnresolved = exclusions?.unmatched_terms?.length > 0;
  return finish(exclusionUnresolved ? 'incomplete' : 'matched', {
    reason: exclusionUnresolved ? '제외 요청한 ' + exclusions.unmatched_terms.join('·') + '에 해당하는 행을 ' + department + ' 세출명세서에서 찾지 못해 제외 범위를 확정하지 않았습니다. 이름이 비슷한 다른 행을 제외하지 않았습니다.' : null,
    business: match.rows[0].business, rows: match.rows.map(view), exclusions,
    note: '원문 세출명세서 행입니다. 금액은 예산액 열이며 편성 회차를 함께 밝히세요.' + (exclusions ? ' 제외 요청어는 괄호 표기까지 같은 정확한 이름으로만 제외했습니다.' : ''),
  }, match.rows);
}
