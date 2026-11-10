export const normalizeDepartment=value=>String(value||'').normalize('NFKC').toLowerCase().replace(/\s+/g,'');
export function statementDepartment(text){
 for(const line of String(text).split('\n').slice(0,12)){
  const m=line.match(/^\s*부서\s*[:：]\s*(.*?)(?:\s{2,}|$)/);
  if(m?.[1]?.trim())return m[1].trim();
 }
 return null;
}
export function requestedDepartments(query,index){
 const normalized=normalizeDepartment(query),ambiguous=new Set(['예산과']);
 const namedBudgetDepartment=/^(?:성남시)?예산과(?:의)?20\d{2}(?:년도|년)?/.test(normalized)||/^(?:성남시)?20\d{2}(?:년도|년)?예산과(?:의)?(?:본예산|추경|결산|예산)/.test(normalized);
 const found=index.departments.filter(d=>normalized.includes(d.key)&&(!ambiguous.has(d.key)||namedBudgetDepartment||new RegExp(d.key+'(?:소관|담당|부서)|(?:부서|담당)'+d.key).test(normalized)));
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
