// Exact matches supplement semantic ranking; postings alone never prove a phrase.
const boilerplate=new Set(['성남','성남시','예산','예산은','본예산','추경','결산','관련계획','얼마','얼마야','얼마인가요','알려줘','알려주세요','찾아줘','찾아주세요','조회','조회해줘','관련','기준','통계목','편성목','세부사업','예산목','보여줘','보여주세요','금액','내역','세출예산','세출예산서','사업명세서','성과계획','성과계획서','성과지표','성과목표']);
for(const word of ['본예산과','추경과','결산과','성과계획서와','비교','및','세부사업과','통계목도','통계목은','편성목은'])boilerplate.add(word);
export function withoutQueryYears(query){return query.replace(/(?<![\p{L}\p{N}])(?:19|20)\d{2}(?:\s*(?:년도|년))?(?![\p{L}\p{N}])/gu,' ');}
function compact(text){return text.toLowerCase().replace(/\s/gu,'');}
export function retrievalWords(query){return(withoutQueryYears(query).toLowerCase().match(/[가-힣]+|[a-z]+|\d[\d,]*/g)||[]).filter(w=>w.length>=2&&!boilerplate.has(w));}
export function exactQueryPhrases(query){
 const core=withoutQueryYears(query),words=retrievalWords(query);
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

// A long business term anchors a bounded window; postings alone are not evidence.
export function businessTermsHit(query,text,title=''){
 const words=retrievalWords(query);if(words.length<2||words.some(w=>/\d/.test(w)))return null;
 const anchors=words.filter(w=>/^[가-힣]{4,}$/.test(w));if(!anchors.length)return null;
 const chars=Array.from(text),positions=[],normalized=[];
 for(let i=0;i<chars.length;i++)if(!/\s/u.test(chars[i])){const lower=chars[i].toLowerCase();for(let j=0;j<lower.length;j++)positions.push(i);normalized.push(lower);}
 const body=normalized.join('');
 for(const anchor of anchors){let at=-1;while((at=body.indexOf(anchor,at+1))>=0){
  const start=positions[at],end=positions[at+anchor.length-1]+1,lo=Math.max(0,start-120),hi=Math.min(chars.length,Math.max(lo+800,end));
  const context=compact(title)+'\n'+compact(chars.slice(lo,hi).join(''));
  if(words.every(w=>context.includes(w)))return{words,start,end};
 }}return null;
}
