// 편성(본예산·추경 회차)을 지정하지 않은 사업 질문에서 그 해의 편성별 근거를 하나씩 모으는 순수 함수 모음.
// 검색은 server.js가 하고, 여기서는 대상 편성 선정·결과 선택·근거 병합·요약만 맡는다.
// 추경 세출명세서는 그 회차에 바뀐 사업만 싣는다. 어느 회차에서 찾지 못한 것은 0원이나 사업 부재가 아니다.

import { parseStatementRows } from './statement-rows.js';

export const EDITION_TIMELINE_NOTE = '요청 범위에서 그 해 수록 편성별 원문을 확인했습니다. latest_verified_row가 있으면 그 행의 부서·사업·회계·편성 회차와 쪽을 밝혀 해당 시점의 금액으로 답하세요. 단순 검색 후보만 있는 회차에서 사업 금액을 추정하지 마세요. 추경 명세서에는 변경된 사업만 수록됩니다. 찾지 못한 회차는 "해당 회차 변경 내역에서 확인되지 않음"으로 표시하고 0원이나 사업 부재로 단정하지 마세요. 서로 다른 편성의 금액을 더하지 마세요.';

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
  return [...keys.keys()].sort().map(k => keys.get(k));
}

// 금액·단위·열이 확인된 세부사업 이름행만 사용한다. 한 쪽에서 여러 사업이 맞으면 하나를 고르지 않는다.
export function verifiedEditionRow(text, hit, words) {
  if (!words.length) return null;
  const norm = s => String(s || '').toLowerCase().replace(/\s/g, '');
  const accounts = words.filter(w => /회계$/.test(w));
  const businessWords = words.filter(w => !accounts.includes(w));
  if (!businessWords.length) return null;
  const rows = parseStatementRows([{ page: hit.page, text }], {
    edition: editionLabel(hit.budget_type, hit.revision),
    account: hit.account === '원문 확인' ? null : hit.account,
    unit: hit.unit === '원문 확인' ? null : hit.unit,
  }).filter(r => r.level === 'business' && accounts.every(w => norm(r.account) === norm(w))
    && businessWords.every(w => norm(r.business).includes(norm(w))));
  const exact = rows.filter(r => norm(r.business) === businessWords.map(norm).join(''));
  const matches = exact.length ? exact : rows;
  if (matches.length !== 1) return null;
  const [row] = matches;
  const previousColumn = hit.budget_type === '추경' ? '기정액' : '전년도예산액';
  if (!row.department || !row.amount_unit || !row.columns_verified || row.column_labels.previous !== previousColumn) return null;
  return {
    business: row.business, department: row.department, account: row.account, amount: row.amounts.budget, unit: row.amount_unit,
    previous_amount: row.amounts.previous, change: row.amounts.change, source_line: row.source_line, source_excerpt: row.source_excerpt,
  };
}

const rowKey = r => JSON.stringify([r.department, r.business, r.account, r.unit].map(s => String(s || '').replace(/\s/g, '')));

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
  const anchorRow = ranked.flatMap(e => e.candidates || []).find(c => c.verified_row)?.verified_row;
  const anchor = anchorRow?.department || firstWith?.candidates[0]?.department || null;
  return ranked.map(e => {
    const { candidates = [], ...rest } = e;
    if (!candidates.length) return { ...rest };
    const best = candidates[0];
    const same = anchor ? candidates.find(c => c.department === anchor && c.rank < 10) : null;
    // 기준 부서가 있는데 그 부서 행이 없고 부서를 알 수 없는 쪽(총괄·집계표)만 잡혔으면 흐름에 섞지 않는다.
    if (anchor && !same && !best.department) return { ...rest, unanchored: true };
    const identity = anchorRow && candidates.find(c => c.verified_row && rowKey(c.verified_row) === rowKey(anchorRow));
    const pick = identity || same || best;
    return { ...rest, hit: pick.hit, match: pick.match, department: pick.department || null,
      verified_row: pick.verified_row || null, department_consistent: !anchor || !pick.department || pick.department === anchor };
  });
}

const editionKey = e => (e.budget_type === '추경' ? '추경:' + e.revision : String(e.budget_type));

// 기존 근거가 원문 일치로 확인됐으면 그 순서를 지키고, 기존 근거에 없는 편성의 회차 근거만 뒤에 붙인다.
// 기존 근거가 약하면(의미 유사·없음) 회차 근거를 앞에 둔다. 같은 쪽은 한 번만 싣는다.
// cap은 호출자가 요청한 근거 수(limit)다. 넘치는 회차는 edition_timeline에만 쪽 정보로 남는다.
export function mergeEditionEvidence(editionEvidence = [], found = [], { foundFirst = true, cap = 6, latestId = null } = {}) {
  if (latestId) {
    const latest = editionEvidence.find(e => e.id === latestId);
    if (latest) {
      const seen = new Set([latest.id]);
      const ordered = foundFirst ? [...found, ...editionEvidence] : [...editionEvidence, ...found];
      return [latest, ...ordered.filter(e => !seen.has(e.id) && seen.add(e.id))].slice(0, cap);
    }
  }
  if (!foundFirst) {
    const ids = new Set(editionEvidence.map(e => e.id));
    return [...editionEvidence, ...found.filter(e => !ids.has(e.id))].slice(0, cap);
  }
  const ids = new Set(found.map(e => e.id)), covered = new Set(found.map(editionKey));
  const missing = editionEvidence.filter(e => !ids.has(e.id) && !covered.has(editionKey(e)));
  return [...found, ...missing].slice(0, cap);
}

// edition_timeline 응답 본문. entries: [{edition,budget_type,revision,match,evidence}] (찾지 못한 편성은 evidence 없음)
export function editionTimeline(year, entries = [], words = []) {
  const editions = entries.map(x => x.evidence ? {
    edition: x.edition, budget_type: x.budget_type, revision: x.revision, found: true, match: x.match,
    document_id: x.evidence.document_id, page: x.evidence.page, page_url: x.evidence.page_url, unit: x.evidence.unit ?? null,
    department: x.department ?? x.evidence.classification?.department ?? null,
    matched_line: x.verified_row?.source_excerpt || matchedLine(x.evidence.text, words),
    verified_row: x.verified_row || null,
  } : { edition: x.edition, budget_type: x.budget_type, revision: x.revision, found: false, match: null, ...(x.unanchored ? { skipped: 'department_unknown_summary_only' } : {}) });
  const found = editions.filter(e => e.found);
  const departments = [...new Set(found.map(e => e.department).filter(Boolean))];
  const verified = found.filter(e => e.verified_row);
  const latest = verified.at(-1);
  // 다른 사업·부서·회계의 금액을 한 흐름으로 잇지 않는다. 회계 미확인 행은 해당 쪽의 근거로만 표시한다.
  const consistent = latest && verified.length > 1 && verified.every(e => e.verified_row.account && rowKey(e.verified_row) === rowKey(latest.verified_row));
  return {
    basis: 'edition_unspecified',
    year,
    searched_editions: editions.length,
    found_editions: found.length,
    latest_found_edition: found.length ? found[found.length - 1].edition : null,
    verified_rows_comparable: !!consistent,
    latest_verified_row: latest ? { ...latest.verified_row, edition: latest.edition, budget_type: latest.budget_type,
      revision: latest.revision, document_id: latest.document_id, page: latest.page, page_url: latest.page_url } : null,
    departments,
    departments_differ: departments.length > 1,
    editions,
    note: EDITION_TIMELINE_NOTE + (departments.length > 1 ? ' ' + DEPARTMENT_MIX_NOTE : '')
      + (verified.length > 1 && !consistent ? ' 편성 간 동일 부서·사업명·회계·단위가 모두 확인되지 않아 회차 간 차이는 계산하지 마세요.' : ''),
  };
}
