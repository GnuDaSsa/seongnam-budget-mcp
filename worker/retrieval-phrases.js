import {budgetDivisionRequested} from './departments.js';
// Exact matches supplement semantic ranking; postings alone never prove a phrase.
const boilerplate=new Set(['되나요','됩니까','얼마입니까','성남','성남시','예산','예산은','본예산','추경','결산','관련계획','얼마','얼마야','얼마인가요','알려줘','알려주세요','찾아줘','찾아주세요','조회','조회해줘','관련','기준','통계목','편성목','세부사업','예산목','보여줘','보여주세요','금액','내역','세출예산','세출예산서','사업명세서','성과계획','성과계획서','성과지표','성과목표']);
for(const word of ['본예산과','추경과','결산과','성과계획서와','비교','및','세부사업과','통계목도','통계목은','편성목은','최종','최신','마지막','최종예산','최신예산','마지막예산'])boilerplate.add(word);
export function withoutQueryYears(query){return query.replace(/(?<![\p{L}\p{N}])(?:19|20)\d{2}(?:\s*(?:년도|년)(?:과|와|의|에서|에는|에|은|는|도|부터|까지|보다|대비)?)?(?![\p{L}\p{N}])/gu,' ');}
function compact(text){return text.toLowerCase().replace(/\s/gu,'');}
// 분석 요청어는 원문 사업 행에 없는 경우가 많다. 필수 검색어로 두면 키워드 검색이 0건이 되므로 조사만 떼고 제외한다.
const analytic=new Set(['지출','지출액','비율','비중','시도비','국도비','현황','추이','증감','변화','분담','구성','얼마나','가장','제일','비싼','비싼거','비싼것','큰','큰거','큰것','많은','적은','최대','최고','최소','상위','하위','순위','포함']);
const isAnalytic=w=>analytic.has(w)||analytic.has(w.replace(/(?:과|와|의|은|는|이|가|을|를|도|으로|로)$/,''));
// 끝에 붙은 출력 요청("원문 페이지와 함께 알려주세요")은 사업 행에 없으므로 마지막 절만 떼어 낸다. 본문 중간의 낱말은 건드리지 않는다.
const OUTPUT_TAIL=/(?<![가-힣a-z0-9])(?:원문\s*)?(?:(?:페이지|쪽수|쪽|링크|출처)(?:와|과|도|까지)?\s*)?(?:(?:함께|같이)\s*)?(?:알려\s*주세요|알려줘|보여\s*주세요|보여줘|정리해\s*주세요|정리해줘|찾아\s*주세요|찾아줘|조회해\s*주세요|조회해줘)\s*[.?!？。]*\s*$/;
// 조사가 붙어도 검색어가 아닌 편성·출력 항목. "예산과"는 부서(예산과)로 확인된 질문에서만 남긴다.
const fieldWords=new Set(['성남시','예산','본예산','추경','결산','총예산','총액','총규모','총금액','통계목','편성목','세부사업','예산목','금액','내역']);
const PARTICLE=/(?:으로|로|을|를|은|는|이|가|도|의|만|과|와)$/;
const GENITIVE_NOUN=/(?:회의|협의|합의|심의|건의|논의|결의|동의|강의|문의|편의|주의|정의|질의|창의|유의|상의|임의|수의|예의|고의|토의|발의|품의|제의|항의|숙의|민의|대의|도의|신의|호의|자의|부의|모의|총의)$/;
export function retrievalWords(query){
 const division=budgetDivisionRequested(query),isDivision=w=>division&&/^예산과(?:의|에서|가|는|은|와|랑|이랑|하고)?$/.test(w);
 const tokens=withoutQueryYears(query).toLowerCase().replace(OUTPUT_TAIL,' ').match(/[가-힣]+|[a-z]+|\d[\d,]*/g)||[];
 const dropped=w=>!isDivision(w)&&(w.length<2||boilerplate.has(w)||isAnalytic(w)||fieldWords.has(w.replace(PARTICLE,'')));
 const words=[];
 tokens.forEach((w,i)=>{
  if(isDivision(w)){words.push('예산과');return;}
  if(dropped(w))return;
  // "지원사업의 예산"처럼 편성·출력 항목 앞에 붙은 소유격만 뗀다.
  const next=tokens[i+1];
  words.push(w.length>=4&&w.endsWith('의')&&!GENITIVE_NOUN.test(w)&&next!==undefined&&dropped(next)?w.slice(0,-1):w);
 });
 return words;
}

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
