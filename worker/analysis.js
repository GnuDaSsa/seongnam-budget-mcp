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

// 질문에서 이름이 "단독으로" 나온 세부사업만 고른다. 정확한 이름 비교이며 괄호 표기도 이름의 일부다.
// - 더 긴 이름의 일부로만 나온 짧은 이름은 제외한다("아동수당지급(자체)" 안의 "아동수당지급").
// - 이름 바로 뒤에 괄호가 이어지면 그 괄호까지가 이름이므로 괄호 없는 이름으로 보지 않는다.
function standaloneNames(q, keys) {
  const occurrences = [];
  for (const key of keys) {
    if (key.length < 2) continue;
    for (let at = q.indexOf(key); at >= 0; at = q.indexOf(key, at + 1)) occurrences.push({ key, start: at, end: at + key.length });
  }
  const free = occurrences.filter(o => !/[(（]/.test(q[o.end] ?? '')
    && !occurrences.some(p => p.key !== o.key && p.start <= o.start && p.end >= o.end && p.end - p.start > o.end - o.start));
  return [...new Set(free.map(o => o.key))];
}

const EACH_WORDS = /각각|따로|개별|하나씩/;
export const eachRequested = question => EACH_WORDS.test(String(question ?? ''));

// ── 제외 표현 해석 ──────────────────────────────────────────
// "아동수당지급(자체)는 제외해줘", "유지관리는 제외해줘", "조성 빼고" 같은 제외 절을 명시적 제외어로 분리한다.
// 편성·회계·구·부서·연도를 가리키는 제외 절은 기존 경로가 처리하므로 그대로 둔다. 제외어가 아닌 낱말은 지우지 않는다.
const EXCLUSION_CLAUSE = /([^\s,.;!?]+?)(?:은|는|을|를|도|가|이|만)?\s*(?:제외|빼고|빼서|빼지|말고)(?:\s*(?:해\s*줘|해\s*주세요|하고|해서|해|하며))?/g;
const NON_BUSINESS_TERM = /^(?:본예산|추경|추가경정(?:예산)?|\d+회추경|예산|일반회계|기타특별회계|수정구|중원구|분당구|\d{4}년(?:도)?|의회|산하기관|기관|자료)$/;
// 이름 전체가 아니라 활동 낱말로 제외할 수 있는 말. 그 밖의 제외어는 괄호 표기까지 포함한 정확한 이름으로만 비교한다.
const EXCLUDABLE_ACTIVITY = new Set(['유지보수', '유지관리', '운영', '관리', '보수', '조성']);

// 제외 낱말 앞에 여러 낱말로 된 사업명이 올 수 있다("달나라 지하철 조성사업은 제외해줘"). 마지막 낱말만 쓰면 다른 사업을 지우므로,
// 같은 절 안에서 앞쪽 낱말을 이어 붙인다. 문장부호, 조사·접속어로 끝나는 낱말, 요청어, 연도·편성·회계·구·부서 낱말에서 멈춘다.
const MAX_PHRASE_TOKENS = 5;
const PHRASE_STOP_TOKEN = /(?:에서|에서는|에는|에|의|와|과|으로|로|이며|이고|하고|랑|이랑|은|는|을|를|만|중|및|그리고|또는|한|해서)$|구$|과$|제외|빼고|말고|알려|보여|계산|합산|찾아|확인|비교|^(?:예산|금액|합계|총액|차액|사업|세부사업|각각|합쳐|그리고|및|또는|중|\d{4}년(?:도)?|본예산|추경|일반회계|기타특별회계)$/;

export function parseExclusions(question, ignore = []) {
  const src = String(question ?? '').normalize('NFKC');
  const skip = (ignore ?? []).map(n => norm(String(n ?? '').normalize('NFKC'))).filter(Boolean);
  const items = [];
  let out = '';
  let last = 0;
  for (const m of src.matchAll(EXCLUSION_CLAUSE)) {
    const lastToken = norm(m[1]);
    if (!lastToken || NON_BUSINESS_TERM.test(lastToken) || skip.some(d => d === lastToken || d.includes(lastToken) || lastToken.includes(d))) continue;
    const prefix = [...src.slice(last, m.index).matchAll(/\S+/g)];
    const tokens = [m[1]];
    let phraseStart = m.index;
    for (let i = prefix.length - 1; i >= 0 && tokens.length < MAX_PHRASE_TOKENS; i--) {
      const tk = prefix[i][0];
      if (/[,.;!?。]/.test(tk) || PHRASE_STOP_TOKEN.test(tk) || NON_BUSINESS_TERM.test(norm(tk)) || skip.includes(norm(tk))) break;
      tokens.unshift(tk);
      phraseStart = last + prefix[i].index;
    }
    const term = norm(tokens.join(''));
    if (/[,，]\s*$/.test(src.slice(last, phraseStart))) items.push({ term: '제외목록해석불가', phrase: '쉼표로 연결된 제외 목록', tokens: [], multiword: true, unresolved: true });
    if (!items.some(x => x.term === term)) items.push({ term, phrase: tokens.join(' '), tokens, multiword: tokens.length > 1 });
    out += src.slice(last, phraseStart) + ' ';
    last = m.index + m[0].length;
  }
  out += src.slice(last);
  return { text: items.length ? out : String(question ?? ''), terms: items.map(x => x.term), items };
}

// 제외어가 이 사업명을 가리키는가. 공백을 뺀 정확한 이름(괄호 포함)이 제외 구절 전체와 같거나,
// 제외 구절 전체(띄어 쓴 "유지 관리" 포함)가 활동 낱말(조성·유지관리 등)일 때만 이름에 포함되는지 본다.
// "아동수당지급(자체)"를 제외해도 "아동수당지급"은 제외하지 않고, 여러 낱말 구절은 마지막 낱말이나 활동 낱말로 다른 행을 지우지 않는다.
// terms는 parseExclusions의 items(권장) 또는 단일 낱말 문자열이다.
export function rowExcluded(businessName, terms = []) {
  const name = norm(String(businessName ?? '').normalize('NFKC'));
  return (terms ?? []).some(t => {
    if (typeof t !== 'string' && t.unresolved) return false;
    const term = typeof t === 'string' ? t : t.term;
    // 띄어 쓴 활동어("유지 관리")는 이어 붙인 구절 전체가 활동 낱말이므로 붙여 쓴 형태와 같이 본다.
    return name === term || (EXCLUDABLE_ACTIVITY.has(term) && name.includes(term));
  });
}

// 제외어별 일치 행 수를 보고한다. 일치하는 행이 없는 제외어(여러 낱말 구절이 정확한 이름과 맞지 않는 경우 포함)는
// 모호하므로 아무 행도 지우지 않고 unmatched_terms에 구절 그대로 남겨 호출자가 완료로 보지 않는다.
function exclusionReport(rows, items) {
  const biz = rows.filter(r => r.level === 'business' && r.business);
  const unmatched = items.filter(t => !biz.some(r => rowExcluded(r.business, [t])));
  return {
    terms: items.map(t => t.term),
    phrases: items.map(t => ({ phrase: t.phrase, tokens: t.tokens, multiword: t.multiword })),
    excluded_row_count: biz.filter(r => rowExcluded(r.business, items)).length,
    unmatched_terms: unmatched.map(t => (t.multiword ? t.phrase : t.term)),
  };
}

// question 안에서 세부사업 이름을 찾는다. 이름이 질문에 단독으로 들어 있으면(가장 긴 이름 우선) 또는 질문의 내용어가 모두 이름에 들어 있으면 일치.
// allowMulti이고 질문이 "각각"을 요청하며 서로 다른 정확한 이름이 둘 이상이면 status 'multi_matched'와 이름별 groups를 낸다(합산하지 않음).
export function matchBusiness(rows = [], question = '', departments = null, options = {}) {
  const ex = parseExclusions(question, departments ?? []);
  if (!ex.items.length) return matchBusinessCore(rows, question, departments, options);
  const scoped = departments?.length ? rows.filter(r => departments.map(norm).includes(norm(r.department))) : rows;
  const exclusions = exclusionReport(scoped, ex.items);
  const kept = rows.filter(r => !(r.level === 'business' && rowExcluded(r.business, ex.items)));
  return { ...matchBusinessCore(kept, ex.text, departments, options), exclusions };
}

function matchBusinessCore(rows = [], question = '', departments = null, { allowMulti = false } = {}) {
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
  const contained = standaloneNames(q, [...byName.keys()]);
  if (contained.length) {
    if (allowMulti && contained.length > 1 && eachRequested(question)) {
      const ordered = [...contained].sort((x, y) => q.indexOf(x) - q.indexOf(y));
      return {
        status: 'multi_matched', basis: 'question_contains_names', candidates: candidatesOf(ordered),
        groups: ordered.map(k => ({ name: byName.get(k)[0].business, rows: byName.get(k) })),
        rows: ordered.flatMap(k => byName.get(k)),
      };
    }
    if (contained.length > 1) return decide(contained, 'multiple_explicit_names');
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

// ── 질문 낱말 보조(부서명 제거, 이름에 쓰인 낱말 분리) ─────────────

const EXTRA_STOP = new Set(['일반회계', '기타특별회계', '구별', '별', '지역별', '알려주세요', '알려줘요', '보여주세요', '얼마인가요', '얼마야', '얼마예요', '확인해줘', '부탁해', '계산해줘', '얼마입니까']);
const DISTRICT_NAMES = ['수정구', '중원구', '분당구'];
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isGeneric = w => STOP_WORDS.has(w) || EXTRA_STOP.has(w);
const baseWord = t => (t.length > 2 ? t.replace(PARTICLE, '') : t);
const tokenize = text => String(text ?? '').normalize('NFKC').split(/[\s,·、/]+/).map(t => t.replace(/[?.!"'“”‘’]/g, '')).filter(Boolean);
const yearLike = t => /^\d+(?:년도|년|회)?$/.test(t);

// 질문에서 부서명(공백 무시)을 지운다. "분당구 가정복지과"의 구는 부서명의 일부이므로 지역 구분으로 읽지 않기 위해서다.
export function stripDepartments(text, departments = []) {
  let t = String(text ?? '').normalize('NFKC');
  for (const d of departments ?? []) {
    const chars = Array.from(String(d ?? '').normalize('NFKC').replace(/\s+/g, ''));
    if (chars.length) t = t.replace(new RegExp(chars.map(escapeRe).join('\\s*'), 'g'), ' ');
  }
  return t;
}

// 사업명 후보 낱말: 연도·부서·구 이름·일반어·회계 표기를 뺀 나머지. 낱말은 줄이거나 바꾸지 않는다(조사만 제거).
function coreWords(question, departments) {
  const stripped = stripDepartments(question, departments);
  return [...new Set(tokenize(stripped)
    .map(t => t.replace(/(?:수정구|중원구|분당구)(?:별|의|는|은|가|이|를|을|와|과|도|만)?/g, ''))
    .filter(t => t && !yearLike(t))
    .map(baseWord)
    .filter(t => t.length >= 2 && !isGeneric(t)))];
}

// 사업명에 원문 그대로 적힌 구. 전체 이름(수정구·중원구·분당구)이나 괄호가 수정·중원·분당으로 시작하는 표기만 인정한다.
export function districtsOfName(name) {
  const text = String(name ?? '').normalize('NFKC');
  const found = new Set(DISTRICT_NAMES.filter(d => text.includes(d)));
  for (const m of text.matchAll(/\(\s*(수정|중원|분당)/g)) found.add(m[1] + '구');
  return DISTRICT_NAMES.filter(d => found.has(d));
}

// 질문의 사업명 낱말 중 정확한 이름(names)으로 설명되지 않는 나머지. "각각" 질문에서 일부 사업만 찾았는데 완료로 보이는 것을 막는다.
export function unmatchedTerms(question, departments = [], names = []) {
  const keys = names.map(n => norm(String(n ?? '').normalize('NFKC'))).filter(Boolean).sort((x, y) => y.length - x.length);
  const left = [];
  for (const token of tokenize(stripDepartments(question, departments))) {
    let rest = norm(token);
    for (const key of keys) rest = rest.split(key).join('');
    if (!rest || yearLike(rest)) continue;
    rest = baseWord(rest);
    if (rest.length >= 2 && !isGeneric(rest)) left.push(rest);
  }
  return [...new Set(left)];
}

// ── 구별(지역 구분) 묶음 ───────────────────────────────────
// 부서가 하나로 정해진 질문에서 "수정구 중원구 분당구별"은 부서가 아니라 사업명에 명시된 지역 구분이다.
// 같은 부서의 세부사업 중 질문의 사업명 낱말을 모두 포함하는 행만 후보로 삼고, 이름에 구가 적힌 행만 그 구에 넣는다.
// 합계는 sumRequested이고 아래가 모두 확인될 때만 낸다: 모든 요청 구에 행 존재, 구 미표기·다중 구 후보 없음, 이름 낱말 전부 일치,
// 열·단위·범위 검증, 해당 부서의 세부사업 합계가 부서 인쇄 총액과 일치.
const ACTIVITY_TERMS = ['유지보수', '유지관리', '운영', '관리', '보수'];

export function matchDistrictGroups(rows = [], question = '', departments = [], { sumRequested = false } = {}) {
  const deps = departments ?? [];
  const ex = parseExclusions(question, deps);
  question = ex.text;
  const requested = [...new Set(stripDepartments(question, deps).match(/수정구|중원구|분당구/g) ?? [])];
  if (!requested.length || deps.length !== 1) return null;
  const core = coreWords(question, deps);
  if (!core.length) return null;
  const dept = norm(deps[0]);
  const fullPool = rows.filter(r => r.level === 'business' && r.business && norm(r.department) === dept);
  const exclusions = exclusionReport(fullPool, ex.items);
  // 명시적으로 제외한 행(예: 유지관리)은 후보에도 결과에도 넣지 않는다.
  const pool = fullPool.filter(r => !rowExcluded(r.business, ex.items));
  const hasAll = (name, words) => words.every(w => name.includes(norm(w)));
  let basis = 'all_core_words';
  let candidates = pool.filter(r => hasAll(norm(r.business), core));
  if (!candidates.length) {
    const relaxed = core.map(w => (w.length > 3 && w.endsWith('사업') ? w.slice(0, -2) : w));
    if (relaxed.some((w, i) => w !== core[i])) {
      candidates = pool.filter(r => hasAll(norm(r.business), relaxed));
      basis = 'core_words_without_generic_suffix';
    }
  }
  if (!candidates.some(r => districtsOfName(r.business).length)) return null;

  // 질문에 없는 활동(운영·보수 등)이 이름에 붙은 행은 질문한 사업과 다른 사업이다.
  const qn = norm(question);
  const kept = candidates.filter(r => !ACTIVITY_TERMS.some(t => norm(r.business).includes(t) && !qn.includes(t)));
  const excluded_other_activity_rows = candidates.length - kept.length;
  const order = (a, b) => (a.page - b.page) || (a.source_line - b.source_line);
  const groups = requested.map(group => ({ group, rows: kept.filter(r => { const ds = districtsOfName(r.business); return ds.length === 1 && ds[0] === group; }).sort(order) }));
  const unassigned = kept.filter(r => districtsOfName(r.business).length !== 1).sort(order);
  const listed = groups.flatMap(g => g.rows);

  const reasons = [];
  if (excluded_other_activity_rows) reasons.push('질문과 활동명이 다른 후보 행을 제외해 범위가 완전한지 확정하지 않았습니다.');
  if (exclusions.unmatched_terms.length) reasons.push('제외 요청한 ' + exclusions.unmatched_terms.join('·') + '에 해당하는 행을 해당 부서에서 찾지 못해 제외 범위를 확정하지 않았습니다.');
  const missing = groups.filter(g => !g.rows.length).map(g => g.group);
  if (missing.length) reasons.push(missing.join('·') + ' 구분이 이름에 적힌 행을 찾지 못했습니다.');
  if (unassigned.length) reasons.push('이름에 구가 적히지 않았거나 여러 구가 섞인 후보 행 ' + unassigned.length + '개가 있어 구별 귀속을 확정하지 않았습니다.');
  if (basis !== 'all_core_words') reasons.push('질문의 사업명 낱말과 이름이 일부만 일치해(조성사업 ↔ 조성 등) 같은 사업으로 확정하지 않았습니다.');
  if (listed.length) {
    if (!listed.every(r => r.columns_verified === true && Number.isSafeInteger(r.amounts?.budget))) reasons.push('열이 검증되지 않았거나 금액을 읽지 못한 행이 있습니다.');
    if (new Set(listed.map(r => r.amount_unit ?? UNIT)).size > 1) reasons.push('행의 금액 단위가 서로 달라 합치지 않았습니다.');
    if (new Set(listed.map(r => JSON.stringify([scopeKey(r), r.document_id ?? null]))).size > 1) reasons.push('연도·편성·회계 또는 문서가 섞여 있습니다.');
    const same = listed[0];
    const rec = reconcileStatement(rows.filter(r => scopeKey(r) === scopeKey(same))).departments.find(d => norm(d.department) === dept && d.account === same.account);
    if (!rec?.reconciled) reasons.push('해당 부서의 세부사업 합계와 부서 인쇄 총액이 맞지 않아 후보 행이 빠짐없이 수록됐는지 확정하지 않았습니다.');
  }
  const complete = reasons.length === 0 && listed.length > 0;
  let calculated_total = null;
  const subtotals = {};
  if (sumRequested && complete) {
    for (const g of groups) subtotals[g.group] = g.rows.reduce((n, r) => n + r.amounts.budget, 0);
    calculated_total = { amount: listed.reduce((n, r) => n + r.amounts.budget, 0), unit: listed[0].amount_unit ?? UNIT, calculated: true };
  }
  return {
    basis, core_words: core, requested_groups: requested, groups, unassigned_rows: unassigned,
    excluded_other_activity_rows, exclusions, reasons, complete, sum_requested: !!sumRequested, subtotals, calculated_total,
  };
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

// 두 부서의 같은 사업 예산액 차액. 합계가 아니라 minuend - subtrahend이며, 검증 규칙은 sumAcrossDepartments와 같다.
// ordered: 질문 순서의 부서 둘. directionKnown=true일 때만 부호 있는 방향 차액(첫째 - 둘째)을 낸다.
export function differenceAcrossDepartments(rowsByDept = {}, ordered = [], { directionKnown = false } = {}) {
  const names = [...new Set(ordered.map(norm).filter(Boolean))].map(n => ordered.find(d => norm(d) === n));
  const fail = (note, extra = {}) => ({ complete: false, operation: 'difference', operands: [], signed_difference: null, absolute_difference: null, unit: null, missing_departments: [], ambiguous_departments: [], warnings: [], note, ...extra });
  if (names.length !== 2) return fail('차액은 정확히 두 부서가 있을 때만 계산합니다. 부서 수: ' + names.length);
  const sum = sumAcrossDepartments(rowsByDept, names);
  const operands = names.map(n => sum.rows.find(r => norm(r.department) === norm(n))).filter(Boolean);
  if (!sum.complete || operands.length !== 2 || !operands.every(o => Number.isSafeInteger(o.amount)) || operands[0].unit !== operands[1].unit) {
    return fail('요청한 두 부서의 단일·검증 행이 확인되지 않아 차액을 내지 않았습니다.', { missing_departments: sum.missing_departments, ambiguous_departments: sum.ambiguous_departments, warnings: sum.warnings });
  }
  const [first, second] = operands;
  const signed = first.amount - second.amount;
  return {
    complete: true, operation: 'difference', operands, unit: sum.unit ?? first.unit ?? UNIT,
    direction_known: !!directionKnown,
    minuend: directionKnown ? first : null, subtrahend: directionKnown ? second : null,
    signed_difference: directionKnown ? signed : null, absolute_difference: Math.abs(signed),
    larger_department: signed === 0 ? null : (signed > 0 ? first.department : second.department),
    missing_departments: [], ambiguous_departments: [], warnings: sum.warnings,
    note: directionKnown
      ? '질문 순서의 첫째 부서 금액에서 둘째 부서 금액을 뺀 계산값입니다. 합계가 아닙니다.'
      : '빼는 방향이 질문에서 확정되지 않아 부호 있는 차액은 내지 않고 절대값 차이만 계산했습니다. 합계가 아닙니다.',
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
