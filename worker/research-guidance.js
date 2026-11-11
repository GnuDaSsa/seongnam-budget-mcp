// A department match does not establish that a requested business was found.
// A ranking question is answered only by a computed ranking over enumerated
// statement rows; search candidates or a department overview are not a ranking.
const RANK_WORDS = /가장\s*(?:큰|작은|많은|적은|비싼)|(?:상위|하위)\s*\d*|순위|\d+\s*위|최대|최소|TOP\s*\d+/i;
const STAT_CODE = /(?<!\d)\d{3}-\d{2}(?!\d)/;
const DEPARTMENT_TOTAL = /(?:부서|소관|해당\s*과|과의?)\s*(?:전체\s*)?(?:총예산|총액|예산\s*총액)/;

export function rankingRequested(query) {
  return RANK_WORDS.test(String(query || ''));
}

// analysis: null or the server's `analysis` block ({kind, status, ...}).
export function researchGuidance(query, overview, quality, analysis = null) {
  const text = String(query || '');
  const ranking = rankingRequested(text);
  // 통계목 코드 순위는 세부사업 총액 overview로 답할 수 없다.
  const statRanking = ranking && STAT_CODE.test(text);
  const overviewIntent = !statRanking && (ranking || DEPARTMENT_TOTAL.test(text));
  const weak = ['semantic_only', 'none', 'semantic_bridge'].includes(quality?.level);
  const analysed = analysis && ['complete', 'matched', 'calculated', 'compared', 'verified'].includes(analysis.status);
  const status = {
    department: overview ? 'overview_available' : 'not_verified',
    business: analysed ? 'verified_statement_rows' : weak ? 'not_verified' : 'requires_source_review',
    requested_details: analysed ? 'see_analysis' : 'requires_source_review',
    overview_intent: overviewIntent,
    ranking: ranking ? (analysis?.kind === 'ranking' ? analysis.status : 'not_computed') : 'not_requested',
  };
  let note = '';
  if (analysis) {
    if (analysed) note += 'analysis는 원문 세출명세서 행을 순서대로 읽어 계산한 결과입니다. analysis.scope의 연도·편성·회계·단위·계층과 각 행의 원문 쪽을 함께 밝히고 analysis 값을 우선 사용하세요. 계산 합계는 계산값으로 표시하세요. ';
    else if (analysis.status === 'partial_scope') note += 'analysis.items는 analysis.scope(연도·편성·회계)에 한정해 부서 합계 대조를 마친 순위입니다. ' + (analysis.reason || '') + ' 그 범위를 답변 첫머리에 밝히고 각 행의 원문 쪽을 인용하세요. ';
    else {
      if (analysis.status === 'no_name_match') note += '미확인: 질문한 사업명이 읽은 세출명세서 행에서 확인되지 않았습니다. 이는 0원이나 사업 부재의 확정이 아니며 보고서에 0원으로 적지 마세요. ';
      note += 'analysis가 완료되지 않았습니다(status: ' + analysis.status + '). analysis.reason과 누락 범위를 밝히고 미확인 값이나 합계를 확정하지 마세요. ';
    }
    if (analysis.notices?.length) note += analysis.notices.join(' ') + ' ';
  }
  if (ranking && analysis?.kind === 'ranking' && analysis.status === 'partial_scope') {
    note += '요청한 전체 범위(모든 회계 또는 추경 반영)의 순위는 계산되지 않았습니다. analysis.scope 밖의 회계나 편성을 포함한 1위나 전체 순위로 표현하지 마세요. ';
  } else if (ranking && !(analysis?.kind === 'ranking' && analysis.status === 'complete')) {
    note += '요청한 범위의 완전한 금액순 순위는 계산되지 않았습니다. 의미 유사 후보, 검색 결과 순서, department_overview의 일부 목록을 전체 순위나 1위로 제시하지 마세요. ';
    if (statRanking) note += '통계목 코드 기준 순위는 세부사업 총액 순위와 다르므로 department_overview의 세부사업 금액순 목록으로 대신하지 마세요. ';
  }
  if (weak && !analysed && analysis?.status !== 'partial_scope') note += '질문한 사업과 요청한 재원·산출근거가 확인되지 않았습니다. 부서가 확인되었다는 이유로 사업의 부재나 0원을 확정하지 마세요. ';
  if (overview && overviewIntent && !analysed) note += '부서 총액·순위 질문에는 department_overview를 참고하되 편성 회차와 수록 범위를 밝히세요. ';
  else if (overview && !overviewIntent) note += 'department_overview는 부서 참고자료이며 질문한 사업이나 재원·산출근거를 확인한 결과가 아닙니다. 해당 사업의 원문 페이지와 요청 항목을 확인하세요. ';
  // 미확인 사업 안내가 앞서도록 순서를 고정한다.
  if (weak && !analysed && !analysis) note = note.replace(/^(.*?)(질문한 사업과 요청한 재원·산출근거가 확인되지 않았습니다\. 부서가 확인되었다는 이유로 사업의 부재나 0원을 확정하지 마세요\. )/, '$2$1');
  return { status, note };
}
