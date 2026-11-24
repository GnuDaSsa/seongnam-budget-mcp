import {retrievalWords,postingQueryScope} from './retrieval-phrases.js';
import {EVIDENCE_BOUNDARY} from './policy.js';

const compact = value => String(value || '').toLowerCase().replace(/\s+/g, '');

// Posting lists and vector ranks nominate pages. An older year can replace the
// starting year only when the requested subject is identifiable in the source.
export function directYearHit(hit, scope) {
  if (!hit || hit.year !== scope.year || hit.bridge) return false;
  if (hit.match_kind === 'similar' && hit.similar_business?.original_name) return true;
  if (hit.source_scope === 'affiliate') return true; // affiliateReader checks every requested word.
  if (scope.topic_intent) return Boolean(hit.topic_matches?.length);
  if (hit.source_scope === 'council') return false; // council evidence has separate verified city anchors.
  if (hit.verified_council_anchor) return true;
  const seekingAppropriation = scope.policy.source_preference === 'expenditure';
  const repayment = /반납|반환|집행잔액|이자반납/;
  const excludeRepayments = seekingAppropriation && !repayment.test(scope.query);
  const matches = hit.classification?.matched_paths || [];
  if (matches.some(p => !excludeRepayments || !repayment.test([p.detailed_business,p.statistical_item?.name,p.source_excerpt].join(' ')))) return true;
  const body = hit.text || hit.excerpt || '';
  const department = compact(hit.classification?.department || body.match(/^\s*부서\s*[:：]\s*(\S+)/m)?.[1]);
  let query = scope.policy.institution_scope.city_retrieval_query;
  for (const d of scope.departments || []) {
    if (department === compact(d.name)) query = query.replace(d.name, ' ');
  }
  const posting=postingQueryScope(query,scope.policy.source_preference);
  if(posting.query&&posting.metadata.some(word=>!compact([hit.title,hit.account].join(' ')).includes(compact(word))))return false;
  const words = retrievalWords(posting.query||query).map(compact);
  if (!words.length) return Boolean(department && scope.departments?.some(d => department === compact(d.name)));
  return body.split('\n').some(line => {
    const value = compact(line);
    if (excludeRepayments && repayment.test(value)) return false;
    return words.every(word => value.includes(word));
  });
}

export function hasYearEvidence(result, scope) {
  if (result.answer_card) return true;
  if (result.edition_timeline?.latest_verified_row) return true;
  if (result.analysis?.status === 'partial_scope' && result.analysis.items?.length && result.analysis.source_pages?.length) return true;
  if (result.retrieval?.mode?.startsWith('total_table_')) return false;
  if (['complete','matched','calculated','compared','new_in_revision'].includes(result.analysis?.status)) return true;
  return (result.evidence || result.results || []).some(hit => directYearHit(hit, scope));
}

export async function lookupYears(scope, {run, hasEvidence = hasYearEvidence, priorYears, probe}) {
  const first = await run(scope);
  if (scope.policy.year_basis !== 'default' || scope.document_id || scope.pinned_single_year) return first;
  const searched = [scope.year];
  function report(result, matched) {
    const note = matched === scope.year ? '' : matched
      ? searched.slice(0,-1).join('·')+'년에서 질문에 맞는 근거를 확인하지 못해 '+matched+'년 자료를 반환했습니다. 답변에 실제 근거 연도와 편성을 밝히세요.'
      : searched[0]+'년부터 '+searched.at(-1)+'년까지 수록 범위에서 질문에 맞는 직접 근거를 확인하지 못했습니다.';
    const policy = result.query_interpretation;
    return {...result, query_interpretation:{...policy, year_search:{start_year:scope.year, searched_years:searched, matched_year:matched},
      notices:[...policy.notices,...(note?[note]:[])]}, ...(note && result.next_action ? {next_action:note+' '+result.next_action} : {})};
  }
  if (hasEvidence(first, scope)) return report(first, scope.year);
  const candidates = await priorYears();
  for (const {year, possible} of candidates) {
    searched.push(year);
    if (!possible) continue;
    const older = {...scope, year, policy:{...scope.policy, years:[year], year_basis:'historical_fallback',
      notices:scope.policy.notices.filter(n => !n.startsWith('연도 미지정'))}};
    if (!await probe(older)) continue;
    const result = await run(older);
    if (hasEvidence(result, older)) return report(result, year);
  }
  const unresolved = {...first};
  if (first.results) unresolved.results = [];
  if (first.match_quality) {
    // Keep clearly identified related reading, without promoting a rejected
    // candidate or an unrelated department overview into a budget answer.
    if (['verified','keyword'].includes(first.match_quality.level)) {
      unresolved.evidence = [];
      unresolved.match_quality = {level:'none',basis:'no_direct_year_evidence'};
    }
    unresolved.business_rollup = unresolved.edition_timeline = unresolved.department_overview = null;
    unresolved.analysis = null;
    unresolved.verification_status = {...first.verification_status,business:'not_verified',department:'not_verified',requested_details:'not_verified'};
    unresolved.next_action = '수록 자료로 질문 대상의 예산을 확인할 수 없습니다. 의미 유사 후보가 있으면 참고자료로 표시하고 금액은 확정하지 마세요. '+EVIDENCE_BOUNDARY;
  }
  return report(unresolved, null);
}
