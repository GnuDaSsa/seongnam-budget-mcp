// 편성(본예산·추경 회차)을 지정하지 않은 사업 질문에서 그 해의 편성별 근거를 하나씩 모으는 순수 함수 모음.
// 검색은 server.js가 하고, 여기서는 대상 편성 선정·결과 선택·근거 병합·요약만 맡는다.
// 추경 세출명세서는 그 회차에 바뀐 사업만 싣는다. 어느 회차에서 찾지 못한 것은 0원이나 사업 부재가 아니다.

export const EDITION_TIMELINE_LIMIT = 8;

export const EDITION_TIMELINE_NOTE = '편성 구분이나 추경 회차를 지정하지 않아 그 해 본예산과 수록된 추경 회차를 각각 찾았습니다. edition_timeline의 회차별 행(예산액·기정액·비교증감)을 편성 순서대로 제시하고, 가장 늦은 회차에서 확인된 금액을 그 시점 반영액으로 설명하세요. 추경 명세서는 그 회차에 바뀐 사업만 싣으므로 찾지 못한 회차는 "그 회차 변경 내역에서 확인되지 않음"으로 표시하고 0원이나 사업 부재로 단정하지 마세요. 서로 다른 편성의 금액을 더하지 마세요.';

export const DEPARTMENT_MIX_NOTE = '회차별 행의 담당 부서가 서로 다릅니다(같은 사업명이 여러 부서에 편성). 부서가 다른 행을 한 사업의 증감 흐름으로 잇지 말고 부서별로 나눠 제시하거나 부서를 지정해 다시 조회하세요.';

export function editionLabel(budgetType, revision) {
  return budgetType === '추경' ? revision + '회 추경' : '본예산';
}

// 편성을 특정하지 않은 단일 연도 성남시 세출 사업 질문만 대상으로 한다.
// 본예산만 명시했거나 회차·문서를 지정했으면 그 범위를 그대로 따른다.
export function editionTimelineEligible(a, words = []) {
  if (!a || !a.year || a.year_scope === 'all' || (a.policy?.years?.length ?? 1) > 1) return false;
  if (a.revision || a.document_id || a.category || a.topic_intent) return false;
  if (a.policy?.institution_scope?.mode !== 'municipal') return false;
  if (a.policy?.source_preference !== 'expenditure') return false;
  if (a.budget_type && a.budget_type !== '추경') return false;
  const excluded = a.policy?.excluded_budget_types || [];
  if (excluded.includes('추경')) return false;
  return words.length > 0;
}

// 연도 안에서 세출명세서가 수록된 편성 목록. 본예산 먼저, 추경은 회차 순.
export function editionsFor(documents = [], a, { matches = () => true, family = () => 'expenditure' } = {}) {
  const excluded = a?.policy?.excluded_budget_types || [];
  const keys = new Map();
  for (const d of documents) {
    if (!d || d.year !== a.year || !['본예산', '추경'].includes(d.budget_type)) continue;
    if (excluded.includes(d.budget_type)) continue;
    if (a.budget_type && d.budget_type !== a.budget_type) continue;
    if (d.budget_type === '추경' && !Number.isInteger(d.revision)) continue;
    if (family(d) !== 'expenditure' || !matches(d)) continue;
    const revision = d.budget_type === '추경' ? d.revision : null;
    const key = (d.budget_type === '본예산' ? 0 : 1) + ':' + String(revision ?? 0).padStart(2, '0');
    if (!keys.has(key)) keys.set(key, { budget_type: d.budget_type, revision, edition: editionLabel(d.budget_type, revision) });
  }
  return [...keys.keys()].sort().map(k => keys.get(k)).slice(0, EDITION_TIMELINE_LIMIT);
}

// 금액 열(예산액·기정액 또는 전년도·비교증감)이 둘 이상 이어지는 줄.
const AMOUNT_COLUMNS = /(?:^|\s)△?[\d,]{1,}\s+△?[\d,]{1,}(?:\s|$)/;
// 반납·이월 정산 줄은 사업 편성 행이 아니다.
const SETTLEMENT = /반납|이자|집행잔액|명시이월|사고이월/;

// 줄 순위: 0 사업 행(금액 열, 산출내역 기호 없음) · 1 산출내역 줄(금액 있음) · 2 낱말만 일치 또는 비율 집계표 · 3 정산 줄.
// 질문 낱말 일부만 든 줄은 10을 더해 모든 낱말이 든 줄보다 항상 뒤에 둔다. 낱말이 없으면 null.
export function lineRank(line = '', words = []) {
  const flat = String(line).replace(/\s/g, '');
  const ws = words.map(w => w.replace(/\s/g, '')).filter(Boolean);
  if (!ws.length || !ws.some(w => flat.includes(w))) return null;
  const all = ws.every(w => flat.includes(w)) ? 0 : 10;
  if (SETTLEMENT.test(flat)) return 3 + all;
  // 비율(%) 열이 있는 줄은 총괄·성질별 집계표라 부서 사업 행보다 뒤에 둔다.
  if (/\d%/.test(flat)) return 2 + all;
  const amounts = AMOUNT_COLUMNS.test(line);
  if (amounts && !/^\s*[○◦·-]/.test(line)) return 0 + all;
  if (amounts || /\d[\d,]*원/.test(line)) return 1 + all;
  return 2 + all;
}

// 원문에서 질문 낱말이 든 줄 중 사업 행에 가장 가까운 줄과 그 순위.
export function bestLine(text = '', words = []) {
  let best = null;
  for (const line of String(text).split('\n')) {
    const rank = lineRank(line, words);
    if (rank === null) continue;
    if (!best || rank < best.rank) best = { rank, line: line.replace(/\s+/g, ' ').trim().slice(0, 240) };
    if (rank === 0) break;
  }
  return best;
}

export function matchedLine(text = '', words = []) {
  return bestLine(text, words)?.line ?? null;
}

const matchKind = r => (r.exact_match ? 'exact' : r.business_match ? 'business_terms' : 'keyword');

// 한 편성의 키워드 검색 결과를 근거 후보 순서로 정렬한다.
// 사업 행이 보이는 쪽을 먼저 두고, 같은 순위면 구절 일치 → 사업어 일치 → 검색 순서.
export function rankEditionHits(results = [], words = []) {
  const usable = results.filter(r => r && r.gid !== undefined);
  const strength = r => (r.exact_match ? 0 : r.business_match ? 1 : 2);
  return usable
    .map((r, i) => ({ r, i, rank: bestLine(r.excerpt || '', words)?.rank ?? 99, s: strength(r) }))
    .sort((x, y) => x.rank - y.rank || x.s - y.s || x.i - y.i)
    .map(x => ({ hit: x.r, match: matchKind(x.r), rank: x.rank }));
}

export function pickEditionHit(results = [], words = []) {
  const [first] = rankEditionHits(results, words);
  return first ? { hit: first.hit, match: first.match } : null;
}

// 같은 사업명이 여러 부서(예: 구청별)에 있으면 회차마다 다른 부서 행이 뽑혀 흐름이 섞인다.
// 기준 부서(본예산 최선 후보, 없으면 처음 찾은 회차)를 정하고, 각 회차에서 그 부서 후보가 사업 행이면 우선한다.
// ranked: [{edition,...,candidates:[{hit,match,rank,department}]}] → [{edition,...,hit,match,department,department_consistent}]
export function chooseConsistentHits(ranked = []) {
  const firstWith = ranked.find(e => e.budget_type === '본예산' && e.candidates?.length) || ranked.find(e => e.candidates?.length);
  const anchor = firstWith?.candidates[0]?.department || null;
  return ranked.map(e => {
    const { candidates = [], ...rest } = e;
    if (!candidates.length) return { ...rest };
    const best = candidates[0];
    const same = anchor ? candidates.find(c => c.department === anchor && c.rank < 10) : null;
    // 기준 부서가 있는데 그 부서 행이 없고 부서를 알 수 없는 쪽(총괄·집계표)만 잡혔으면 흐름에 섞지 않는다.
    if (anchor && !same && !best.department) return { ...rest, unanchored: true };
    const pick = same || best;
    return { ...rest, hit: pick.hit, match: pick.match, department: pick.department || null, department_consistent: !anchor || !pick.department || pick.department === anchor };
  });
}

const editionKey = e => (e.budget_type === '추경' ? '추경:' + e.revision : String(e.budget_type));

// 기존 근거가 원문 일치로 확인됐으면 그 순서를 지키고, 기존 근거에 없는 편성의 회차 근거만 뒤에 붙인다.
// 기존 근거가 약하면(의미 유사·없음) 회차 근거를 앞에 둔다. 같은 쪽은 한 번만 싣는다.
// cap은 호출자가 요청한 근거 수(limit)다. 넘치는 회차는 edition_timeline에만 쪽 정보로 남는다.
export function mergeEditionEvidence(editionEvidence = [], found = [], { foundFirst = true, cap = 6 } = {}) {
  if (!foundFirst) {
    const ids = new Set(editionEvidence.map(e => e.id));
    return [...editionEvidence, ...found.filter(e => !ids.has(e.id))].slice(0, cap);
  }
  const ids = new Set(found.map(e => e.id)), covered = new Set(found.map(editionKey));
  const missing = editionEvidence.filter(e => !ids.has(e.id) && !covered.has(editionKey(e)));
  return [...found, ...missing].slice(0, Math.max(cap, found.length));
}

// edition_timeline 응답 본문. entries: [{edition,budget_type,revision,match,evidence}] (찾지 못한 편성은 evidence 없음)
export function editionTimeline(year, entries = [], words = []) {
  const editions = entries.map(x => x.evidence ? {
    edition: x.edition, budget_type: x.budget_type, revision: x.revision, found: true, match: x.match,
    document_id: x.evidence.document_id, page: x.evidence.page, page_url: x.evidence.page_url, unit: x.evidence.unit ?? null,
    department: x.department ?? x.evidence.classification?.department ?? null,
    matched_line: matchedLine(x.evidence.text, words),
  } : { edition: x.edition, budget_type: x.budget_type, revision: x.revision, found: false, match: null, ...(x.unanchored ? { skipped: 'department_unknown_summary_only' } : {}) });
  const found = editions.filter(e => e.found);
  const departments = [...new Set(found.map(e => e.department).filter(Boolean))];
  return {
    basis: 'edition_unspecified',
    year,
    searched_editions: editions.length,
    found_editions: found.length,
    latest_found_edition: found.length ? found[found.length - 1].edition : null,
    departments,
    departments_differ: departments.length > 1,
    editions,
    note: departments.length > 1 ? EDITION_TIMELINE_NOTE + ' ' + DEPARTMENT_MIX_NOTE : EDITION_TIMELINE_NOTE,
  };
}
