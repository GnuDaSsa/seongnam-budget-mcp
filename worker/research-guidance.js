// A department match does not establish that a requested business was found.
export function researchGuidance(query, overview, quality) {
  const text = String(query || '');
  const overviewIntent = /가장\s*(?:큰|작은|많은|적은|비싼)|(?:상위|하위)\s*\d*|순위|(?:부서|소관|해당\s*과|과의?)\s*(?:전체\s*)?(?:총예산|총액|예산\s*총액)/.test(text);
  const weak = ['semantic_only', 'none', 'semantic_bridge'].includes(quality?.level);
  const status = {
    department: overview ? 'overview_available' : 'not_verified',
    business: weak ? 'not_verified' : 'requires_source_review',
    requested_details: 'requires_source_review',
    overview_intent: overviewIntent,
  };
  let note = '';
  if (weak) note += '질문한 사업과 요청한 재원·산출근거가 확인되지 않았습니다. 부서가 확인되었다는 이유로 사업의 부재나 0원을 확정하지 마세요. ';
  if (overview && overviewIntent) note += '부서 총액·순위 질문에는 department_overview를 참고하되 편성 회차와 수록 범위를 밝히세요. ';
  else if (overview) note += 'department_overview는 부서 참고자료이며 질문한 사업이나 재원·산출근거를 확인한 결과가 아닙니다. 해당 사업의 원문 페이지와 요청 항목을 확인하세요. ';
  return { status, note };
}
