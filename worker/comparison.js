// Search hits are candidates, not proof that business, account and amount align.
export function comparisonStatus(years, perYear) {
 const yearsInfo=years.map((year,i)=>({year,evidence_count:perYear[i]?.evidence?.length??0,budget_types:[...new Set((perYear[i]?.evidence??[]).map(e=>e.budget_type).filter(Boolean))],source_families:[...new Set((perYear[i]?.evidence??[]).map(e=>e.source_family).filter(Boolean))]}));
 const missing_years=yearsInfo.filter(y=>y.evidence_count===0).map(y=>y.year);
 const types=[...new Set(yearsInfo.flatMap(y=>y.budget_types))];
 return {status:'unverified',missing_years,years:yearsInfo,mixed_budget_types:types.length>1,reason:'검색 결과는 비교 후보입니다. 동일 사업·회계·편성 종류·회차와 금액 열을 원문에서 확인하기 전에는 비교 가능하다고 판정하지 마세요.'};
}
