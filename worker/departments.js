export const normalizeDepartment=value=>String(value||'').normalize('NFKC').toLowerCase().replace(/\s+/g,'');
export function statementDepartment(text){
 for(const line of String(text).split('\n').slice(0,12)){
  const m=line.match(/^\s*부서\s*[:：]\s*(.*?)(?:\s{2,}|$)/);
  if(m?.[1]?.trim())return m[1].trim();
 }
 return null;
}
// "예산과"는 부서명과 "예산+과" 접속 표현의 글자가 같다. 질문 첫머리, 실국명 뒤, 부서에만 붙는 조사처럼 문맥이 확인될 때만 부서로 본다.
const YEAR='20\\d{2}(?:년도|년)?';
const BUDGET_DIVISION=[
 new RegExp('^(?:성남시)?예산과(?:의)?'+YEAR),
 new RegExp('^(?:성남시)?'+YEAR+'(?:성남시)?예산과(?:의)?(?:본예산|추경|결산|예산|총|전체|기본경비)'),
 /^(?:성남시)?예산과(?:의)?(?:총|전체|기본경비)/,
 /예산과(?:소관|담당|부서)|(?:부서|담당)예산과/,
 /조정실예산과/
];
export function budgetDivisionRequested(query){
 const normalized=normalizeDepartment(query);
 return BUDGET_DIVISION.some(r=>r.test(normalized))||/(?:^|[\s,])예산과(?:에서|가)(?=[\s,]|$)/.test(String(query||'').normalize('NFKC'));
}
export function requestedDepartments(query,index){
 const normalized=normalizeDepartment(query),ambiguous=new Set(['예산과']);
 const namedBudgetDepartment=budgetDivisionRequested(query);
 // 구를 병렬로 열거하고 부서명을 마지막에 한 번만 쓴 경우, 실제 색인에 있는 이름만 확장한다.
 // 구 단독 언급이나 명칭이 다른 부서까지 추정해서 추가하지 않는다.
 const districts=['수정구','중원구','분당구'], expanded=new Set();
 const suffixes=new Set(index.departments.flatMap(d=>districts.filter(prefix=>d.key.startsWith(prefix)&&d.key.length>prefix.length).map(prefix=>d.key.slice(prefix.length))));
 for(const suffix of suffixes){
  const escaped=suffix.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const pattern=new RegExp('((?:수정구|중원구|분당구)(?:(?:[·ㆍ,/]|와|과|및)+(?:수정구|중원구|분당구))+)' + escaped,'g');
  for(const match of normalized.matchAll(pattern))for(const district of match[1].match(/수정구|중원구|분당구/g)||[])expanded.add(district+suffix);
 }
 const found=index.departments.filter(d=>(normalized.includes(d.key)||expanded.has(d.key))&&(!ambiguous.has(d.key)||namedBudgetDepartment));
 // Prefer a qualified 보건소/구 department name over its shorter suffix.
 return found.filter(d=>!found.some(other=>other.key!==d.key&&other.key.includes(d.key)));
}
export function canonicalDepartmentQuery(query,departments){
 let text=query;
 for(const d of departments){const pattern=Array.from(d.name.replace(/\s/g,'')).map(c=>c.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('\\s*');text=text.replace(new RegExp(pattern+'(?:의|은|는|을|를)?','gi'),d.name);}
 return text;
}
export function departmentMatches(text,departments){
 if(!departments?.length)return true;
 const name=normalizeDepartment(statementDepartment(text));
 return departments.some(d=>d.key===name);
}
