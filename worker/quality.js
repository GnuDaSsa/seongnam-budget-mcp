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
