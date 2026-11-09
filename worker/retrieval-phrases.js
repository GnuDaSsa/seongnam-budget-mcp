// Exact matches supplement semantic ranking; postings alone never prove a phrase.
const boilerplate=new Set(['성남','성남시','예산','예산은','본예산','추경','결산','관련계획','얼마','얼마야','얼마인가요','알려줘','알려주세요','찾아줘','찾아주세요','조회','조회해줘','관련','기준']);
export function withoutQueryYears(query){return query.replace(/(?<![\p{L}\p{N}])(?:19|20)\d{2}(?:\s*(?:년도|년))?(?![\p{L}\p{N}])/gu,' ');}
function compact(text){return text.toLowerCase().replace(/\s/gu,'');}
export function exactQueryPhrases(query){
 const core=withoutQueryYears(query),words=(core.toLowerCase().match(/[가-힣]+|[a-z]+|\d[\d,]*/g)||[]).filter(w=>w.length>=2&&!boilerplate.has(w));
 if(/\d/.test(core))return{words,phrases:[]}; // Do not reinterpret account codes as independent amounts.
 const withoutDepartment=words.filter(w=>!(/^[가-힣]{3,}$/.test(w)&&/(?:과|국|팀|사업소|담당관)$/.test(w)));
 const phrases=[...new Set([words.join(''),withoutDepartment.join('')])].filter(w=>/^[가-힣]{4,}$/.test(w));
 return{words,phrases};
}
export function exactPhraseHit(query,text,title=''){
 const {words,phrases}=exactQueryPhrases(query);if(!phrases.length)return null;
 const chars=Array.from(text),positions=[],normalized=[];
 for(let i=0;i<chars.length;i++)if(!/\s/u.test(chars[i])){const lower=chars[i].toLowerCase();for(let j=0;j<lower.length;j++)positions.push(i);normalized.push(lower);}
 const body=normalized.join('');
 for(const phrase of phrases){let at=-1;while((at=body.indexOf(phrase,at+1))>=0){
  const hit={phrase,start:positions[at],end:positions[at+phrase.length-1]+1},start=Math.max(0,hit.start-120),end=Math.min(chars.length,Math.max(start+800,hit.end));
  const context=compact(title)+'\n'+compact(chars.slice(start,end).join(''));
  if(words.every(w=>context.includes(w)))return hit;
 }}
 return null;
}
