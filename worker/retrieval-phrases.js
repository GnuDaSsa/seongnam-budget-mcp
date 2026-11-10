// Exact matches supplement semantic ranking; postings alone never prove a phrase.
const boilerplate=new Set(['성남','성남시','예산','예산은','본예산','추경','결산','관련계획','얼마','얼마야','얼마인가요','알려줘','알려주세요','찾아줘','찾아주세요','조회','조회해줘','관련','기준','통계목','편성목','세부사업','예산목','보여줘','보여주세요','금액','내역','세출예산','세출예산서','사업명세서','성과계획','성과계획서','성과지표','성과목표']);
for(const word of ['본예산과','추경과','결산과','성과계획서와','비교','및','세부사업과','통계목도','통계목은','편성목은','최종','최신','마지막','최종예산','최신예산','마지막예산'])boilerplate.add(word);
export function withoutQueryYears(query){return query.replace(/(?<![\p{L}\p{N}])(?:19|20)\d{2}(?:\s*(?:년도|년)(?:과|와|의|에서|에는|에|은|는|도|부터|까지|보다|대비)?)?(?![\p{L}\p{N}])/gu,' ');}
function compact(text){return text.toLowerCase().replace(/\s/gu,'');}
// 분석 요청어는 원문 사업 행에 없는 경우가 많다. 필수 검색어로 두면 키워드 검색이 0건이 되므로 조사만 떼고 제외한다.
const analytic=new Set(['지출','지출액','비율','비중','시도비','국도비','현황','추이','증감','변화','분담','구성','얼마나','가장','제일','비싼','비싼거','비싼것','큰','큰거','큰것','많은','적은','최대','최고','최소','상위','하위','순위','포함']);
const isAnalytic=w=>analytic.has(w)||analytic.has(w.replace(/(?:과|와|의|은|는|이|가|을|를|도|으로|로)$/,''));
export function retrievalWords(query){return(withoutQueryYears(query).toLowerCase().match(/[가-힣]+|[a-z]+|\d[\d,]*/g)||[]).filter(w=>w.length>=2&&!boilerplate.has(w)&&!isAnalytic(w));}

// Topic requests are not department requests. Keep control language out of both
// embeddings and postings, and require the topic in a business line, not a header.
export function topicIntent(query){
 const topic=/(?<![a-z])ai(?![a-z]|\s*반\s*도\s*체\s*과)|인공\s*지능/i.test(query)&&!/조류\s*인플루엔자|고병원성|가금|방역/.test(query);
 if(!topic)return null;
 let content=withoutQueryYears(query).replace(/(?:제\s*)?\d+\s*(?:회|차)\s*(?:추경|추가경정)/g,' ')
  .replace(/사업\s*관련\s*예산|관련\s*사업(?:\s*예산)?/g,' ')
  .replace(/본예산|추가경정|추경|결산|최신|최종|마지막/g,' ')
  .replace(/반영(?:해서|하여|해줘|해주세요|해)?|포함(?:해서|하여|해줘|해주세요|해)?|찾아봐줘|찾아줘|알려줘|보여줘|제외(?:하고)?|빼고|말고|아니라|대신|모두|까지/g,' ')
  .replace(/(?:^|\s)(?:성남시|성남|관련|사업|예산|예산을|예산은|및|와|과|만|은|는|이)(?=\s|$)/g,' ').replace(/\s+/g,' ').trim();
 content=content.replace(/인공\s*지능|(?<![a-z])ai(?![a-z])/gi,'AI');
 return{topic:'artificial_intelligence',aliases:['AI','인공지능'],content_query:content||'AI',basis:'explicit_topic_words',department_inferred:false};
}
export function topicBusinessMatches(text,intent){
 if(!intent)return[];
 const matches=[],topic=/(?<![a-z])ai(?![a-z])|인공\s*지능/i,other=retrievalWords(intent.content_query).filter(w=>w!=='ai'&&w!=='인공지능');
 let offset=0;const lines=String(text).split('\n');
 for(let i=0;i<lines.length;i++){
  const line=lines[i],start=offset;offset+=Array.from(line).length+1;
  if(!topic.test(line)||/^\s*(?:부서|정책|단위)\s*[:：]/.test(line)||/^\s*AI\s*반도체과(?:\s|$)/i.test(line)||/조류\s*인플루엔자|고병원성|가금|방역|(?:재무활동|행정운영경비)\s*\(\s*AI\s*반도체과/i.test(line))continue;
  // Never borrow another business on the same page to satisfy extra terms.
  const context=line.toLowerCase().replace(/\s/g,'');
  if(other.some(w=>!context.includes(w)))continue;
  matches.push({source_line:i+1,source_excerpt:line.trim(),start,end:start+Array.from(line).length,basis:'topic_in_original_business_line'});
 }
 return matches;
}
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
