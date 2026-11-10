// 근거 신뢰도 판정과 응답 축소. 모델·네트워크 호출 없이 반환된 근거만으로 계산한다.

export const QUALITY_LEVELS = ['none', 'semantic_only', 'semantic_bridge', 'keyword', 'verified'];

const SEMANTIC_ONLY_TEXT_LIMIT = 1200;
const SEMANTIC_ONLY_LEAD = 200;
const BRIDGE_SOURCE_LIMIT = 2;

const normalize = value => String(value || '').replace(/\s/g, '');

// 깨진 인코딩(U+FFFD)이 섞인 검색어는 엉뚱한 근거를 그럴듯하게 돌려주므로 거부한다.
export function hasReplacementCharacter(value) {
  return typeof value === 'string' && value.includes('�');
}

// 해당 연도 본예산의 "세입·세출예산규모 및 총괄표" 문서. 없으면 null.
export function totalTableDocument(documents, year) {
  if (!Number.isInteger(year)) return null;
  return documents.find(d => d.year === year && d.budget_type === '본예산' && /총괄표/.test(d.title || '')) || null;
}

// 편성 구분을 밝히지 않은 세출 사업 비교는 연도별 본예산으로 맞춘다.
export function comparisonBudgetBasis(policy = {}, budgetType) {
  if (policy.budget_type_basis && policy.budget_type_basis !== 'unspecified') return policy.budget_type_basis;
  if (budgetType) return 'parameter';
  if (policy.source_preference !== 'expenditure') return 'source_preference';
  return 'main_budget_default';
}

function isVerified(evidence) {
  const scores = evidence.retrieval_scores || {};
  return Boolean(
    evidence.verified_council_anchor ||
    scores.exact_phrase ||
    scores.business_terms ||
    evidence.classification?.matched_paths?.length ||
    evidence.topic_matches?.length
  );
}

function isKeyword(evidence, mode) {
  if (mode === 'lexical') return true;
  if (evidence.source_scope && evidence.source_scope !== 'municipal') return true;
  const rank = evidence.retrieval_scores?.lexical_rank;
  return rank !== null && rank !== undefined;
}

// verified > keyword > semantic_bridge > semantic_only > none
export function matchQuality(evidence = [], mode = 'hybrid') {
  if (!evidence.length) return { level: 'none', basis: 'no_evidence' };
  const direct = evidence.filter(e => !e.bridge);
  if (direct.some(isVerified)) return { level: 'verified', basis: 'query_terms_or_business_path_in_source' };
  if (direct.some(e => isKeyword(e, mode))) return { level: 'keyword', basis: 'keyword_postings' };
  if (evidence.some(e => e.bridge)) return { level: 'semantic_bridge', basis: 'business_title_from_semantic_source' };
  return { level: 'semantic_only', basis: 'vector_similarity_only' };
}

export function weakestQuality(qualities = []) {
  const known = qualities.filter(q => q && QUALITY_LEVELS.includes(q.level));
  if (!known.length) return { level: 'none', basis: 'no_evidence' };
  const weakest = known.reduce((a, b) => (QUALITY_LEVELS.indexOf(b.level) < QUALITY_LEVELS.indexOf(a.level) ? b : a));
  return { level: weakest.level, basis: 'weakest_year' };
}

// 의미 유사 후보는 일치 구간 주변만 남긴다. 전문은 get_budget_page로 확인할 수 있다.
export function trimSemanticEvidence(evidence) {
  if (!evidence.context || typeof evidence.text !== 'string') return evidence;
  const chars = Array.from(evidence.text);
  const chunkStart = evidence.matched_chunk?.start ?? evidence.context.start;
  const from = Math.max(0, chunkStart - evidence.context.start - SEMANTIC_ONLY_LEAD);
  const to = Math.min(chars.length, from + SEMANTIC_ONLY_TEXT_LIMIT);
  const start = evidence.context.start + from;
  const end = evidence.context.start + to;
  const trimmed = {
    ...evidence,
    text: chars.slice(from, to).join(''),
    text_is_complete: start === 0 && end === evidence.context.total_characters,
    context: { ...evidence.context, start, end },
  };
  if (!evidence.classification) return trimmed;
  const { paths, matched_paths, ...header } = evidence.classification;
  trimmed.classification = {
    ...header,
    paths: [],
    matched_paths: [],
    paths_omitted: (paths?.length || 0) > 0,
  };
  return trimmed;
}

// 성인지예산서 등 설명형 자료의 "사업명(회계) □사업개요" 머리에서 실제 사업명을 읽는다.
const BUSINESS_TITLE = /(?:^|\n)[ \t]*([^\n()□○]{4,60})\((일반회계|[^\n()]{2,24}특별회계)\)\s*□\s*사업\s*개요/g;

// 설명 자료가 질문과 충분히 가까울 때만 연결한다. 정답셋으로 맞춘 경험적 기준이며 낮은 유사도의 엉뚱한 연결을 막는다.
const BRIDGE_MIN_COSINE = 0.48;
const BRIDGE_MIN_MAXSIM = 0.55;
const BRIDGE_STRONG_MAXSIM = 0.6;

function isCloseEnough(scores = {}) {
  const cosine = scores.cosine ?? 0;
  const maxsim = scores.token_maxsim ?? 0;
  return maxsim >= BRIDGE_STRONG_MAXSIM || (cosine >= BRIDGE_MIN_COSINE && maxsim >= BRIDGE_MIN_MAXSIM);
}

export function bridgeBusinessNames(evidence = []) {
  const found = [];
  const seen = new Set();
  for (const item of evidence) {
    if (found.length >= BRIDGE_SOURCE_LIMIT) break;
    if (item.source_scope !== 'municipal' || item.source_family === 'expenditure') continue;
    if (!isCloseEnough(item.retrieval_scores)) continue;
    for (const match of String(item.text || '').matchAll(BUSINESS_TITLE)) {
      const name = normalize(match[1]);
      if (name.length < 4 || seen.has(name)) continue;
      seen.add(name);
      found.push({ business_name: name, from_id: item.id });
      break;
    }
  }
  return found;
}

// 다시 찾은 세출명세서 근거에 실제로 그 사업명이 있는지 확인한 뒤에만 연결한다.
export function asBridgedEvidence(evidence, link) {
  if (evidence.source_family !== 'expenditure') return null;
  if (!normalize(evidence.text).includes(link.business_name)) return null;
  return {
    ...evidence,
    retrieval_scores: { method: 'semantic_bridge', vectorized: false },
    bridge: { ...link, basis: 'business_title_in_semantic_source', query_to_business_link: 'semantic_inference' },
  };
}

// ── 여러 부서에 나뉘어 편성된 같은 세부사업 묶음 ─────────────────────────────

const AMOUNT = /^[△▲-]?\d[\d,]*$/;
const ROLLUP_MATCHED_PATH_LIMIT = 6;
const COMPACT_TEXT_LIMIT = 1500;
const COMPACT_LEAD = 300;

function toNumber(value) {
  const digits = Number(value.replace(/^[△▲-]/, '').replaceAll(',', ''));
  return /^[△▲-]/.test(value) ? -digits : digits;
}

// 명세서 한 줄을 들여쓰기, 첫 열 이름, 금액 열(예산액, 전년도 또는 기정액, 증감)로 읽는다. 금액이 없으면 amounts는 null.
export function statementLine(line, index) {
  const columns = line.trim().split(/\s{2,}/);
  const numbers = columns.slice(1).map(c => c.trim()).filter(c => AMOUNT.test(c)).map(toNumber);
  const parsed = { label: columns[0], indent: line.length - line.trimStart().length, amounts: null };
  if (!numbers.length) return parsed;
  const [amount, previous = null, change = null] = numbers;
  parsed.amounts = {
    source_line: index + 1,
    source_excerpt: line.trim().replace(/\s{2,}/g, '  '),
    amount,
    previous_amount: previous,
    change,
    // 예산액 - 비교 대상 = 증감이 맞을 때만 열 대응을 확인된 것으로 본다.
    columns_verified: numbers.length >= 3 && amount - previous === change,
  };
  return parsed;
}

// 세출명세서에서 세부사업명과 같은 행의 금액 열을 읽는다.
export function businessRow(text, businessName) {
  const wanted = normalize(businessName);
  if (!wanted) return null;
  const lines = String(text || '').split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const parsed = statementLine(lines[index], index);
    if (parsed.amounts && normalize(parsed.label) === wanted) return parsed.amounts;
  }
  return null;
}

// 검증된 근거의 첫 사업 경로에서 묶음 기준이 될 세부사업명을 정한다.
export function rollupBusinessName(evidence = []) {
  const top = evidence.find(e => e.source_family === 'expenditure' && e.classification?.matched_paths?.length);
  return normalize(top?.classification.matched_paths[0].detailed_business) || null;
}

// 같은 편성(연도·종류·회차)에서 같은 세부사업명이 있는 부서별 행을 모은다.
// 전체본과 부서별 PDF에 실린 같은 행은 한 번만 센다.
export function businessRollup(pages = [], name, edition, candidatesTruncated = false) {
  if (!name) return null;
  const byKey = new Map();
  for (const page of pages) {
    if (page.source_family !== 'expenditure') continue;
    const row = businessRow(page.text, name);
    if (!row) continue;
    const candidate = {
      year: page.year, budget_type: page.budget_type,
      revision: page.budget_type === '본예산' && (page.revision == null || page.revision === 0) ? null : page.revision ?? null,
      department: page.classification?.department ?? null, unit: page.unit, ...row,
      id: page.id, page_url: page.page_url, locator_label: page.locator_label,
    };
    // 금액이 같아도 부서가 다르면 별도 편성이다. 부서 미확인 행은 임의로 대응시키지 않는다.
    const key = normalize(candidate.department)
      ? JSON.stringify([candidate.year, candidate.budget_type, candidate.revision, normalize(candidate.department),
        candidate.unit, row.amount, row.previous_amount, row.change])
      : Symbol('unidentified-department');
    if (!byKey.has(key)) byKey.set(key, candidate);
  }
  const rows = [...byKey.values()].sort((a, b) => String(a.department).localeCompare(String(b.department), 'ko'));
  if (!rows.length) return null;
  const departments = [...new Set(rows.map(r => r.department).filter(Boolean))];
  const departmentKeys = rows.map(r => normalize(r.department));
  const sameKnownEdition = Number.isInteger(rows[0].year) && rows[0].year > 0
    && (rows[0].budget_type === '본예산' && rows[0].revision === null
      || rows[0].budget_type === '추경' && Number.isInteger(rows[0].revision) && rows[0].revision > 0);
  const summable = !candidatesTruncated && rows.length > 1 && departmentKeys.every(Boolean)
    && new Set(departmentKeys).size === rows.length && sameKnownEdition && Boolean(normalize(rows[0].unit))
    && rows.every(r => r.columns_verified && r.unit === rows[0].unit
      && Number.isSafeInteger(r.amount)
      && r.year === rows[0].year && r.budget_type === rows[0].budget_type && r.revision === rows[0].revision);
  const total = summable ? rows.reduce((sum, r) => sum + r.amount, 0) : null;
  return {
    business_name: name,
    edition,
    departments,
    rows,
    rows_may_be_incomplete: candidatesTruncated,
    calculated_total: total !== null && Number.isSafeInteger(total)
      ? { amount: total, unit: rows[0].unit, basis: 'sum_of_listed_department_rows' }
      : null,
    note: '같은 세부사업명이 여러 부서에 편성될 수 있습니다. 부서별 금액을 모두 제시하세요. calculated_total은 나열한 부서 행의 '
      + '단순 합계(계산값)이며 수록 범위 밖의 부서나 추경 변경분은 포함하지 않습니다. 부서 미확인 행이나 서로 다른 연도·편성 종류·추경 회차는 합산하지 마세요.',
  };
}

// 긴 기간 조회용: 사업 행 주변만 남기고 사업 경로 목록을 줄인다.
export function compactEvidence(evidence) {
  if (!evidence.context || typeof evidence.text !== 'string') return evidence;
  const first = evidence.classification?.matched_paths?.[0];
  if (!first) return trimSemanticEvidence(evidence);
  const lines = evidence.text.split('\n');
  const before = Array.from(lines.slice(0, Math.max(0, first.source_line - 1)).join('\n')).length;
  const chars = Array.from(evidence.text);
  const from = Math.max(0, Math.min(before, chars.length) - COMPACT_LEAD);
  const to = Math.min(chars.length, from + COMPACT_TEXT_LIMIT);
  const start = evidence.context.start + from;
  const end = evidence.context.start + to;
  const { paths, matched_paths, ...header } = evidence.classification;
  return {
    ...evidence,
    text: chars.slice(from, to).join(''),
    text_is_complete: start === 0 && end === evidence.context.total_characters,
    context: { ...evidence.context, start, end },
    classification: {
      ...header,
      paths: [],
      matched_paths: matched_paths.slice(0, ROLLUP_MATCHED_PATH_LIMIT),
      paths_omitted: (paths?.length || 0) > 0,
    },
  };
}
