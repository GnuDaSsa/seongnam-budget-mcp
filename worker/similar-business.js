import {postingQueryScope} from './retrieval-phrases.js';

// 같은 회계의 실제 사업 행을 다시 찾는 제한된 이름 변형이다.
export function similarBusinessCandidate(query){
 const scope=postingQueryScope(query,'expenditure');
 if(!scope.metadata.some(word=>word.endsWith('회계'))||!scope.query)return null;
 if(/제외|빼고|말고|\d{2,}/.test(query.replace(/(?:19|20)\d{2}/g,'')))return null;
 const requested=scope.query.replace(/\s/g,'');
 if(!/^[가-힣]{5,}$/.test(requested))return null;
 const similar=requested.endsWith('사업')?requested.slice(0,-2):requested.slice(0,-1);
 if(similar.length<4)return null;
 return {requested,similar};
}

export function hasBusinessRow(text,name){
 const compact=value=>value.replace(/\s/g,'').toLowerCase();
 return String(text||'').split('\n').some(line=>{
  const columns=line.trim().split(/\s{2,}/);
  const label=columns[0].replace(/^(?:\d{3}|\d{2})\s+/,'').replace(/^○\s*/,'');
  const basis=/^○/.test(columns[0]);
  return compact(label)===compact(name)&&(basis||columns.length>=3&&columns.slice(1).some(column=>/^[△▲-]?\d[\d,]*$/.test(column)));
 });
}

// 원문 행에서 한 글자 차이 또는 끝의 사업·비 차이만 유사 후보로 둔다.
export function similarBusinessRows(text,requested,stem){
 const clean=value=>value.replace(/\s/g,'').toLowerCase();
 const target=clean(requested),base=clean(stem);
 const oneEdit=(a,b)=>{
  if(Math.abs(a.length-b.length)>1)return false;
  if(a.length>b.length)[a,b]=[b,a];
  let i=0,j=0,differences=0;
  while(i<a.length&&j<b.length){
   if(a[i]===b[j]){i++;j++;continue;}
   if(++differences>1)return false;
   if(a.length===b.length)i++;
   j++;
  }
  return differences+(b.length-j)<=1;
 };
 return String(text||'').split('\n').flatMap(line=>{
  const columns=line.trim().split(/\s{2,}/),label=columns[0];
  const code=label.match(/^(\d{3}|\d{2})\s+(.+)$/),basis=label.match(/^○\s*(.+)$/);
  const name=code?.[2]||basis?.[1]||label,normalized=clean(name);
  if(!basis&&(columns.length<3||!columns.slice(1).some(column=>/^[△▲-]?\d[\d,]*$/.test(column))))return [];
  if(!/^[가-힣\s]+$/.test(name)||normalized===target)return [];
  if(!(normalized===base||oneEdit(normalized,target)))return [];
  const kind=basis?'calculation_basis':code?(code[1].length===3?'appropriation':'statistical_item'):'business_or_other_row';
  return [{name,kind,source_excerpt:line.trim()}];
 });
}
