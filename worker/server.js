import {budgetClassification} from './classification.js';
import {comparisonStatus} from './comparison.js';
import {EvidenceCache} from './evidence-cache.js';
import {Inflight} from './inflight.js';
import {verifiedTableContext} from './verified-table-context.js';
import {POLICY,SERVER_RULES,resolveQuery,isMunicipalTotal,totalAnswerCard,sourceFamily,sourceAllowed,sourcePriority} from './policy.js';
import {vectorSearch,rerank} from './semantic.js';
import {openapi} from './openapi.js';
import {retrievalWords,exactPhraseHit,businessTermsHit} from './retrieval-phrases.js';
const CATALOG=/*__CATALOG__*/null, HTML=/*__HTML__*/null, SEMANTIC=/*__SEMANTIC__*/null;
const DOCS=new Map(CATALOG.documents.map(d=>[d.id,d])), cache=new Map();

const RULES=SERVER_RULES;
const json=(x,status=200)=>new Response(JSON.stringify(x),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
function fail(m){throw new Error(m);}
function num(v,k,min,max){if(v===undefined||v===null||v==='')return;let n=Number(v);if(!Number.isInteger(n)||n<min||n>max)fail(k+' 값이 올바르지 않습니다.');return n;}
function args(a={}){if(!a||typeof a!=='object'||Array.isArray(a))fail('객체 인자가 필요합니다.');let b={...a,year:num(a.year,'year',1900,2100),limit:num(a.limit,'limit',1,20)??8,offset:num(a.offset,'offset',0,100000)??0,revision:num(a.revision,'revision',1,30)};
 if(a.query!==undefined&&(typeof a.query!=='string'||a.query.length>160))fail('검색어는 160자 이하 문자열이어야 합니다.');
 if(a.budget_type&&!['본예산','추경','결산','관련계획'].includes(a.budget_type))fail('지원하지 않는 예산 종류입니다.');return b;}
function match(d,a){return(!a.year||d.year===a.year)&&(!a.budget_type||d.budget_type===a.budget_type||(a.budget_type==='관련계획'&&sourceFamily(d)==='performance'))&&(!a.revision||d.revision===a.revision)&&(!a.category||d.category===a.category)&&(!a.document_id||d.id===a.document_id)&&sourceAllowed(d,a);}
async function asset(env,name){if(cache.has(name)){let x=cache.get(name);cache.delete(name);cache.set(name,x);return x;}
 if(!env.ASSETS)fail('검색 파일 저장소가 연결되지 않았습니다.');let r=await env.ASSETS.fetch(new Request('https://assets.local/corpus/'+name+'.json.gz'));if(!r.ok)fail('검색 파일 조회 실패: '+name);
 let x=await new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).json();if(cache.size>=2)cache.delete(cache.keys().next().value);cache.set(name,x);return x;}
let rankMetadata=null,rankLoading=null;
async function ranks(env){
 if(rankMetadata)return rankMetadata;if(rankLoading)return rankLoading;
 rankLoading=(async()=>{const r=await env.ASSETS.fetch(new Request('https://assets.local/corpus/rank.bin.gz'));if(!r.ok)fail('검색 메타데이터가 없습니다.');const b=await new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer(),v=new DataView(b),hash=Array.from(new Uint8Array(b,8,32),x=>x.toString(16).padStart(2,'0')).join('');if(v.getUint32(0,true)!==0x314c4253||v.getUint32(4,true)!==CATALOG.summary.snapshot_units||hash!==SEMANTIC.corpus_catalog_sha256||b.byteLength!==40+CATALOG.summary.snapshot_units*16)fail('검색 메타데이터 버전 불일치');return new Uint32Array(b,40);})();
 try{rankMetadata=await rankLoading;return rankMetadata;}finally{rankLoading=null;}
}
function groups(q){return retrievalWords(q).filter(w=>!['대한','관한'].includes(w)).slice(0,8).map(w=>({word:w,grams:/^[가-힣]+$/.test(w)?[...new Set(Array.from({length:w.length-1},(_,i)=>w.slice(i,i+2)))]:[w]}));}
function cite(d,p){let isBlock=d.locator_kind==='text_block',isArchive=d.filename.toLowerCase().endsWith('.zip'),member=p[6];
 let kind=isBlock?'text_block':isArchive?'archive_pdf_page':'pdf_page',pdfPage=isBlock?null:isArchive?(member?.page??null):p[1];
 let label=isBlock?'본문 블록 '+p[1]+' (쪽수 아님)':isArchive?(member?'ZIP '+member.member+' · PDF '+member.page+'쪽':'ZIP 내부 위치 '+p[1]+' (통합 쪽수 아님)'):'PDF '+p[1]+'쪽';
 const tableContext=verifiedTableContext(d,p[1],p[4]);
 return{document_id:d.id,title:d.title,year:d.year,...(tableContext?{table_context:tableContext}:{}),budget_type:d.budget_type,revision:d.revision,account:d.account,category:d.category,source_family:sourceFamily(d),page:p[1],pdf_page:pdfPage,locator_kind:kind,locator_label:label,archive_member:member?.member??null,printed_page:p[3],unit:p[2]||'원문 확인',unit_scope:p[2]?'원문 일부의 단위 표기입니다. 숫자에 직접 붙은 단위와 표제의 적용 범위를 확인하세요.':'단위 표기를 확인하지 못했습니다. 원문을 확인하세요.',source_url:d.url,page_url:isBlock||isArchive?d.url:d.url+'#page='+p[1],source_page:d.source_page,sha256:d.sha256};}
function termBucket(word){let h=2166136261;for(let b of new TextEncoder().encode(word))h=Math.imul(h^b,16777619)>>>0;return(h&255).toString(16).padStart(2,'0');}
function shardFor(globalPage){let lo=0,hi=CATALOG.shards.length-1;while(lo<=hi){let mid=(lo+hi)>>1,s=CATALOG.shards[mid];if(globalPage<s.offset)hi=mid-1;else if(globalPage>=s.offset+s.pages)lo=mid+1;else return s;}return null;}
const rank=(a,b)=>b.score-a.score||((DOCS.get(b.p[0]).year||0)-(DOCS.get(a.p[0]).year||0));
async function lexicalSearch(env,input){let a=args(input),q=(a.query||'').trim();if(q.length<2)fail('검색어를 두 글자 이상 입력하세요.');
 let gs=groups(q);if(!gs.length)gs=[{word:q,grams:[q]}];let posts=[],weight=0;
 for(let term of new Set(gs.flatMap(g=>g.grams))){let values=await asset(env,'terms-'+termBucket(term)),post=values[term]||[];if(!post.length)return{query:q,filters:{year:a.year??null,budget_type:a.budget_type??null,category:a.category??null},results:[],scanned_pages:0,matched_pages_before_dedup:0,coverage:CATALOG.summary,instructions:RULES};posts.push(post);weight+=Math.log(1+CATALOG.summary.snapshot_units/(1+post.length));}
 posts.sort((x,y)=>x.length-y.length);let eligible=new Set(posts[0]);for(let post of posts.slice(1)){let other=new Set(post);eligible=new Set([...eligible].filter(x=>other.has(x)));if(!eligible.size)break;}posts=null;
 const meta=await ranks(env);let candidates=[],scanned=0,matched=0;
 for(const gid of eligible){const d=CATALOG.documents[meta[gid*4]];if(!d||!match(d,a))continue;scanned++;matched++;let score=weight/Math.sqrt(Math.max(1200,meta[gid*4+1])/1500);if(meta[gid*4+2])score+=3;score+=2*sourcePriority(d,a);for(const g of gs)if(d.title.includes(g.word))score+=3;candidates.push({gid,d,score,hashId:meta[gid*4+3]});}
 candidates.sort((x,y)=>sourcePriority(y.d,a)-sourcePriority(x.d,a)||y.score-x.score||((y.d.year||0)-(x.d.year||0)));if(candidates.length>1000)candidates.length=1000;
 const seen=new Set(),selected=[];for(const c of candidates){if(seen.has(c.hashId))continue;seen.add(c.hashId);selected.push(c);if(selected.length>=a.limit)break;}
 const grouped=new Map(),hydrated=new Map();for(const c of selected){const sh=shardFor(c.gid);if(!grouped.has(sh.id))grouped.set(sh.id,{sh,items:[]});grouped.get(sh.id).items.push(c);}
 for(const {sh,items} of grouped.values()){
  const [index,texts]=await Promise.all([asset(env,'pages-'+sh.id),asset(env,'text-'+sh.id)]);
  for(const c of items){const pi=c.gid-sh.offset,p=index.pages[pi],raw=texts[pi],exact_match=exactPhraseHit(q,raw,c.d.title),business_match=businessTermsHit(q,raw,c.d.title),text=raw.replace(/[ \t]{2,}/g,' ').replace(/\n\s*\n/g,'\n'),exactExcerpt=exactPhraseHit(q,text,c.d.title),hit=exactExcerpt?Array.from(text).slice(0,exactExcerpt.start).join('').length:Math.max(0,...gs.map(g=>text.indexOf(g.word)).filter(n=>n>=0)),start=Math.max(0,hit-160);
   hydrated.set(c.gid,{id:c.d.id+':p'+p[1],...cite(c.d,p),gid:c.gid,score:Math.round(c.score*100)/100,excerpt:text.slice(start,start+1200),excerpt_is_partial:text.length>1200,exact_match,business_match,source_priority:sourcePriority(c.d,a)});
  }
 }
 const results=selected.map(c=>hydrated.get(c.gid));

 return{query:q,filters:{year:a.year??null,budget_type:a.budget_type??null,category:a.category??null},results,scanned_pages:scanned,matched_pages_before_dedup:matched,coverage:CATALOG.summary,instructions:RULES};}

function retrievalStatus(){let {doc_ids,clusters,source_files,...m}=SEMANTIC;return {...m,clusters:clusters.length,vectorization_complete:SEMANTIC.pages===CATALOG.summary.snapshot_units,hybrid_search:true,reranking_enabled:true,cross_encoder:false};}
async function uncachedSearch(env,input){
 let a=args(input),q=(a.query||'').trim();if(q.length<2)fail('검색어를 두 글자 이상 입력하세요.');
 if(a.mode==='lexical')return {...await lexicalSearch(env,a),retrieval:{mode:'lexical',reranked:false}};
 if(a.mode&&!['hybrid','vector'].includes(a.mode))fail('mode는 hybrid, vector, lexical 중 하나입니다.');
 const started=Date.now(),allowed=new Set(SEMANTIC.doc_ids.map((id,i)=>match(DOCS.get(id),a)?i:-1).filter(i=>i>=0));
 const vec=await vectorSearch(env,SEMANTIC,q,allowed),vectorDone=Date.now(),lex=a.mode==='vector'?{results:[],scanned_pages:0,matched_pages_before_dedup:0}:await lexicalSearch(env,{...a,limit:20}),lexicalDone=Date.now();
 const union=new Map();vec.hits.forEach((h,i)=>union.set(h.gid,{...h,rrf:1/(60+i+1),vector_rank:i+1,lexical_rank:null}));
 lex.results.forEach((h,i)=>{let c=union.get(h.gid)||{gid:h.gid,rrf:0,vector_rank:null};c.rrf+=1/(60+i+1);c.lexical_rank=i+1;c.exact_match=h.exact_match;c.business_match=h.business_match;c.source_priority=h.source_priority;union.set(h.gid,c);});
 let selected=[...union.values()].sort((x,y)=>Number(!!y.exact_match)-Number(!!x.exact_match)||Number(!!y.business_match)-Number(!!x.business_match)||(y.source_priority||0)-(x.source_priority||0)||y.rrf-x.rrf).slice(0,SEMANTIC.rerank_candidates),candidates=[];
 const grouped=new Map();for(const c of selected){const sh=shardFor(c.gid);if(!grouped.has(sh.id))grouped.set(sh.id,{sh,items:[]});grouped.get(sh.id).items.push(c);}
 const loadedCandidates=new Map();
 // Read each shard once and release its full page arrays before the next shard.
 for(const {sh,items} of grouped.values()){
  const [idx,texts]=await Promise.all([asset(env,'pages-'+sh.id),asset(env,'text-'+sh.id)]);
  for(let c of items){const pi=c.gid-sh.offset,p=idx.pages[pi],text=texts[pi],d=DOCS.get(p[0]);if(!match(d,a))continue;
   const chars=Array.from(text),exact=a.mode==='vector'?null:exactPhraseHit(q,text,d.title);c.exact_match=exact;c.business_match=a.mode==='vector'?null:businessTermsHit(q,text,d.title);c.source_priority=sourcePriority(d,a);
   const verified=exact||c.business_match;
   if(verified){c.start=Math.max(0,verified.start-120);c.end=Math.min(chars.length,Math.max(c.start+800,verified.end));}
   if(c.start===undefined){let words=groups(q).map(g=>g.word),found=words.map(w=>text.indexOf(w)).filter(n=>n>=0),hit=found.length?Math.min(...found):0;c.start=Math.max(0,Array.from(text.slice(0,hit)).length-120);c.end=Math.min(chars.length,c.start+800);}
   loadedCandidates.set(c.gid,{...c,p,d,text:chars.slice(c.start,c.end).join(''),full_length:chars.length,classification:budgetClassification(text,d,q)});
  }
 }
 candidates=selected.map(c=>loadedCandidates.get(c.gid)).filter(Boolean);

 const hydrated=Date.now();await rerank(vec,candidates);if(a.mode!=='vector')candidates.sort((x,y)=>Number(!!y.exact_match)-Number(!!x.exact_match)||Number(!!y.business_match)-Number(!!x.business_match)||Number(!!y.classification.matched_paths.length)-Number(!!x.classification.matched_paths.length)||y.source_priority-x.source_priority||y.score-x.score);const rerankedAt=Date.now();let seen=new Set(),results=[];
 const verifiedOnly=a.mode!=='vector'&&candidates.some(c=>c.exact_match||c.business_match);
 for(let c of candidates){if(seen.has(c.p[4])||(verifiedOnly&&!c.exact_match&&!c.business_match))continue;if(!c.lexical_rank&&!c.exact_match&&!c.business_match&&c.cosine<0.2)continue;seen.add(c.p[4]);results.push({id:c.d.id+':p'+c.p[1],...cite(c.d,c.p),source_family:c.classification.status==='layout_extracted'?'expenditure':sourceFamily(c.d),gid:c.gid,score:+c.score.toFixed(6),excerpt:c.text,classification:c.classification,excerpt_is_partial:c.start>0||c.end<c.full_length,chunk:{start:c.start,end:c.end,offset_unit:'Unicode code points'},retrieval_scores:{cosine:+c.cosine.toFixed(6),token_maxsim:+c.maxsim.toFixed(6),rrf:+c.rrf.toFixed(6),vector_rank:c.vector_rank,lexical_rank:c.lexical_rank,exact_phrase:c.exact_match?.phrase??null,business_terms:c.business_match?.words??null}});if(results.length>=a.limit)break;}
 return {query:q,filters:{year:a.year??null,budget_type:a.budget_type??null,category:a.category??null},results,scanned_pages:lex.scanned_pages,matched_pages_before_dedup:lex.matched_pages_before_dedup,retrieval:{mode:a.mode||'hybrid',embedding_model:SEMANTIC.model,dimensions:SEMANTIC.dimensions,index:SEMANTIC.index_type,nprobe:SEMANTIC.nprobe,vector_chunks_scanned:vec.scanned,vector_candidates:vec.hits.length,lexical_candidates:lex.results.length,reranker:SEMANTIC.reranker,reranker_type:SEMANTIC.reranker_type,reranked:true,reranked_candidates:candidates.length,exact_phrase_candidates:candidates.filter(c=>c.exact_match).length,business_term_candidates:candidates.filter(c=>c.business_match).length,timings_ms:{vector:vectorDone-started,lexical:lexicalDone-vectorDone,hydrate:hydrated-lexicalDone,rerank:rerankedAt-hydrated},elapsed_ms:Date.now()-started},coverage:CATALOG.summary,instructions:RULES};
}

// Public corpus results only. No persistent question logs or external model API.
const searchCache=new Map();let cacheBytes=0;
const inflight=new Inflight();
function coalesce(env,kind,key,load){return inflight.run(env.ASSETS,kind,key,load);}
async function search(env,input){
 const a=resolveQuery(args(input));if(a.policy.years.length>1)fail('여러 연도 비교는 budget_research를 사용하거나 각 연도로 조회하세요.');
 const key=JSON.stringify([a.query,a.year,a.year_scope,a.budget_type,a.revision,a.category,a.document_id,a.mode||'hybrid',a.limit,a.policy]);
 const cached=searchCache.get(key),now=Date.now();
 if(cached&&cached.expires>now){const r=JSON.parse(cached.json);r.retrieval={...r.retrieval,cache_hit:true,original_elapsed_ms:r.retrieval?.elapsed_ms??null,elapsed_ms:0};return r;}
 return coalesce(env,'search',key,async()=>{const r=await uncachedSearch(env,a);r.query_interpretation=a.policy;r.retrieval={...r.retrieval,cache_hit:false};const body=JSON.stringify(r),bytes=body.length*2;
  if(searchCache.has(key)){cacheBytes-=searchCache.get(key).bytes;searchCache.delete(key);}
  if(bytes<500000){while(searchCache.size>=12||cacheBytes+bytes>2000000){const k=searchCache.keys().next().value;cacheBytes-=searchCache.get(k).bytes;searchCache.delete(k);}searchCache.set(key,{json:body,bytes,expires:Date.now()+300000});cacheBytes+=bytes;}
  return r;});
}
// Bounded, transient cache of already-produced evidence. Keys include every
// input used for text boundaries, query-specific classification and scores.
const evidenceCache=new EvidenceCache();
function evidenceKey(h,full,query){return JSON.stringify([SEMANTIC.corpus_catalog_sha256,h.id,h.gid,h.chunk??null,h.retrieval_scores??null,full,query]);}
async function evidenceFor(env,hits,full=false,query=''){
 const key=JSON.stringify(hits.map(h=>evidenceKey(h,full,query)));
 return coalesce(env,'evidence',key,()=>loadEvidence(env,hits,full,query));
}
async function loadEvidence(env,hits,full=false,query=''){
 const grouped=new Map(),out=new Map();for(const h of hits){const key=evidenceKey(h,full,query),entry=evidenceCache.get(key);
  if(entry){out.set(h.id,entry);continue;}
  const sh=shardFor(h.gid);if(!sh)continue;if(!grouped.has(sh.id))grouped.set(sh.id,{sh,items:[]});grouped.get(sh.id).items.push(h);}
 for(const {sh,items} of grouped.values()){
  const [index,texts]=await Promise.all([asset(env,'pages-'+sh.id),asset(env,'text-'+sh.id)]);
  for(const h of items){const i=h.gid-sh.offset,p=index.pages[i],text=texts[i],chars=Array.from(text),start=full?0:Math.max(0,(h.chunk?.start??0)-900),end=full?chars.length:Math.min(chars.length,Math.max(start+6000,h.chunk?.end??0));
   const value={id:h.id,...cite(DOCS.get(p[0]),p),source_family:sourceFamily(DOCS.get(p[0]),text),text:chars.slice(start,end).join(''),text_is_complete:start===0&&end===chars.length,classification:budgetClassification(text,DOCS.get(p[0]),query),context:{start,end,total_characters:chars.length,offset_unit:'Unicode code points'},matched_chunk:h.chunk??null,retrieval_scores:h.retrieval_scores??null};out.set(h.id,value);evidenceCache.set(evidenceKey(h,full,query),value);
  }
 }
 return hits.map(h=>out.get(h.id)).filter(Boolean);
}
async function research(env,input,internal=false){
 const started=Date.now(),a=resolveQuery(args(input));
 const explicitYears=[...new Set([...a.query.matchAll(/(?<![0-9A-Za-z])((?:19|20)\d{2})(?![0-9A-Za-z])/g)].map(m=>Number(m[1])))];
 if(!internal&&input.year!==undefined&&explicitYears.length>1&&/비교/.test(a.query))fail('여러 연도 비교에서 year 하나를 지정하면 비교 범위가 줄어듭니다. year 인자를 빼고 다시 조회하세요.');
 if(a.policy.years.length>1){
  const per_year=await Promise.all(a.policy.years.map(year=>research(env,{...input,year,limit:Math.min(a.limit,2)},true)));
  const evidence=per_year.flatMap(r=>r.evidence);
  const yearsOutput=input.response_format==='compact'?per_year.map(({evidence,...rest})=>({...rest,evidence_ids:evidence.map(e=>e.id)})):per_year;
  return{question:a.query,query_interpretation:a.policy,comparison:comparisonStatus(a.policy.years,per_year),per_year:yearsOutput,evidence,generation_performed:false,answer_policy:RULES,next_action:'연도별 동일 사업·동일 문서 종류·동일 회계 범위만 비교하세요. 누락된 연도는 확인 불가이며 0원이 아닙니다.',elapsed_ms:Date.now()-started};
 }
 if(a.policy.comparison_budget_types.length>1&&!input.budget_type&&a.policy.source_preference!=='mixed'){
  const types=a.policy.comparison_budget_types;
  const per_type=[];for(const budget_type of types)per_type.push(await research(env,{...input,budget_type,limit:Math.min(a.limit,2)},true));
  const evidence=per_type.flatMap(r=>r.evidence),missing_types=types.filter((_,i)=>!per_type[i].evidence.length);
  const typesOutput=input.response_format==='compact'?per_type.map(({evidence,...rest})=>({...rest,evidence_ids:evidence.map(e=>e.id)})):per_type;
  return{question:a.query,query_interpretation:a.policy,type_comparison:{status:'unverified',requested_types:types,missing_types,reason:'문서 종류별 검색 후보입니다. 동일 사업·회계·금액 열과 단위를 원문에서 확인하기 전에는 직접 비교하지 마세요.'},per_type:typesOutput,evidence,generation_performed:false,answer_policy:RULES,next_action:'요청한 문서 종류별 근거를 구분하고, 누락된 종류는 확인 불가로 표시하세요. 동일 사업·회계·단위와 금액 열을 확인하기 전에는 비교 수치를 확정하지 마세요.',elapsed_ms:Date.now()-started};
 }
 if(a.budget_type==='추경'&&!a.revision&&/최신|마지막|최종/.test(a.query)){
  const revisions=CATALOG.documents.filter(d=>match(d,a)&&d.revision).map(d=>d.revision);
  if(revisions.length){a.revision=Math.max(...revisions);a.policy.notices.push('수록된 추경 중 최종 '+a.revision+'회 기준입니다. 이후 공개자료의 완전 수집을 보장하지 않습니다.');}
 }
 const coverage={snapshot_at:CATALOG.summary.generated_at,whole_city_coverage_complete:false,searchable_locations:CATALOG.summary.snapshot_units,failed_documents:CATALOG.summary.status_counts.failed,unindexed_pdf_pages:CATALOG.summary.unindexed_pdf_pages};
 if(a.year===2026&&!a.revision&&!a.category&&(!a.budget_type||a.budget_type==='본예산')&&isMunicipalTotal(a.query)){
  const doc=CATALOG.documents.find(d=>d.year===2026&&d.url.endsWith('/11608_1.pdf'));
  if(doc){const {instructions,...p}=await page(env,{document_id:doc.id,page:1}),e={id:doc.id+':p1',...p,text_is_complete:true,context:{start:0,end:Array.from(p.text).length,total_characters:Array.from(p.text).length,offset_unit:'Unicode code points'}},card=totalAnswerCard(e);
   if(card)return{question:a.query,filters:{year:a.year,budget_type:'본예산'},query_interpretation:{...a.policy,budget_type_basis:a.budget_type?'specified':'total_default'},answer_card:card,evidence:[e],retrieval:{mode:'verified_total_table',reranked:false,reason:'검증된 본예산 총괄표 직접 조회'},coverage,generation_performed:false,answer_policy:RULES,next_action:'answer_card의 수치와 공식 원문 근거로 바로 답하세요. 기준 연도와 본예산 기준임을 밝히고 동일 내용을 재검색하지 마세요.',elapsed_ms:Date.now()-started};
  }
 }
 const r=await search(env,{...a,limit:Math.min(a.limit,4)}),evidence=await evidenceFor(env,r.results,false,a.query);
 return{question:a.query,filters:r.filters,query_interpretation:a.policy,source_selection:{preference:a.policy.source_preference,returned_families:[...new Set(evidence.map(e=>e.source_family))],returned_budget_types:[...new Set(evidence.map(e=>e.budget_type))],note:'문서 종류를 지정하지 않은 사업 질문은 세출명세서를 우선합니다. 본예산·추경을 함께 찾을 수 있으며 반환된 편성 구분과 회차를 각각 표시하세요. 성과계획서는 편성 내역을 대신하지 않습니다.'},evidence,retrieval:r.retrieval,coverage,generation_performed:false,
  next_action:evidence.length?'제공된 원문 근거로 직접 답하세요. 연도와 문서 종류를 밝히세요. 충분한 근거가 있으면 같은 질문을 재검색하거나 수집 현황을 먼저 호출하지 마세요. 표 대응이 불분명하거나 필요한 문맥이 잘렸을 때만 전문을 확인하세요.':'현재 범위에서 근거를 찾지 못했습니다. 검색 실패를 예산 부재로 해석하지 마세요. 다른 연도로 조용히 대체하지 마세요.',answer_policy:RULES,elapsed_ms:Date.now()-started};
}

async function page(env,input){let a=args(input);if(typeof a.document_id!=='string'||!DOCS.has(a.document_id))fail('문서를 찾을 수 없습니다.');let n=num(a.page,'page',1,100000);if(!n)fail('검색 결과의 page 값이 필요합니다.');let d=DOCS.get(a.document_id);
 for(let shard of d.shards){let idx=await asset(env,'pages-'+shard),i=idx.pages.findIndex(p=>p[0]===d.id&&p[1]===n);if(i>=0){let texts=await asset(env,'text-'+shard);return{...cite(d,idx.pages[i]),text:texts[i],classification:budgetClassification(texts[i],d),instructions:RULES};}}fail('해당 페이지는 색인에 없습니다. 스캔·미처리 상태를 확인하세요.');}
function documents(input){let a=resolveQuery(args(input));if(a.policy.years.length>1)fail('문서 목록은 연도별로 조회하세요.');a.policy.source_preference='explicit';let q=(a.query||'').trim().toLowerCase(),rows=CATALOG.documents.filter(d=>match(d,a)&&(!q||d.title.toLowerCase().includes(q))).sort((x,y)=>(y.year||0)-(x.year||0));return{total:rows.length,offset:a.offset,query_interpretation:a.policy,documents:rows.slice(a.offset,a.offset+a.limit).map(({shards,...d})=>d)};}
const properties={query:{type:'string',description:'자연어 질문 또는 사업명·부서명, 2~160자',minLength:2,maxLength:160},mode:{type:'string',enum:['hybrid','vector','lexical'],description:'기본 hybrid: 키워드+벡터 검색, RRF 결합, 토큰 의미 리랭킹'},year:{type:'integer',description:'회계연도. 질문에도 없으면 2026년. 질문의 명시 연도 우선.',minimum:1900,maximum:2100},year_scope:{type:'string',enum:['single','all'],description:'기본 single. 전체/역대 연도를 명시 요청한 경우에만 all'},budget_type:{type:'string',enum:['본예산','추경','결산','관련계획']},revision:{type:'integer',minimum:1,maximum:30},category:{type:'string',description:'자료 분류'},limit:{type:'integer',minimum:1,maximum:20,default:8}};
const schema=(p,r=[])=>({type:'object',properties:p,required:r,additionalProperties:false}),annotations={readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false};
const TOOLS=[{name:'search_budget',description:'상세 검색용: 성남시 예산 원문의 검색 모드·필터별 요약과 관련도 점수가 필요할 때 사용. 일반 예산 질문은 원문 근거까지 반환하는 budget_research를 우선 사용. 미지정 연도는 2026년.',inputSchema:schema(properties,['query']),annotations},
 {name:'get_budget_page',description:'사용자가 원문 전문을 요청했거나 검색 근거가 부족하거나 잘렸거나 표의 열 대응이 불명확할 때 page 값으로 전문·단위·출처 확인. budget_research 근거가 충분하면 추가 조회 없이 답변. PDF 쪽수와 HWP/엑셀 본문 블록을 구분.',inputSchema:schema({document_id:{type:'string'},page:{type:'integer',minimum:1}},['document_id','page']),annotations},
 {name:'list_budget_documents',description:'문서와 실패·미처리 상태를 연도·예산종류별로 확인할 때 사용.',inputSchema:schema({...properties,offset:{type:'integer',minimum:0}}),annotations},
 {name:'get_collection_status',description:'검색 가능 범위, 수집 누락, OCR 필요, 마지막 스냅샷 시각을 확인. 전체 수집 완료라고 추정하지 말 것.',inputSchema:schema({}),annotations},
 {name:'build_rag_context',description:'기존 연동 호환용: 상위 4개 원문 페이지/본문 블록 전문과 인용 규칙을 반환. 일반 예산 질문은 budget_research를 우선 사용. 생성 모델을 호출하지 않음.',inputSchema:schema(properties,['query']),annotations}];
TOOLS.unshift({name:'budget_research',description:'성남시 본예산·추경·결산·사업비·부서별 예산·연도별 비교 질문에 먼저 사용. 법령 해석이나 다른 지자체 예산 조회에는 사용하지 않음. 사업비는 세출예산사업명세서를 우선하며 성과계획·지표 질문은 계획서를 조회. 원문 근거·단위·인용 URL과 부서·세부사업·편성목·통계목 및 해당 행을 한 번에 반환. 미지정 연도는 2026년, 비교는 최대 3개 연도. 근거가 충분하면 바로 답변. 생성 모델 없음.',inputSchema:schema({...properties,response_format:{type:'string',enum:['full','compact'],description:'기본 full. compact는 비교 결과 per_year의 evidence 대신 최상위 evidence를 참조하는 evidence_ids를 반환합니다.'}},['query']),annotations},
 {name:'search',description:'ChatGPT 호환 검색. 인용 가능한 id/title/url 반환. 질문에 연도가 없으면 2026년, 전체 연도는 질문에 명시.',inputSchema:schema({query:properties.query},['query']),annotations},
 {name:'fetch',description:'search 결과 id로 원문 페이지/본문 블록 전문과 인용 URL 조회. id는 search 결과 값을 그대로 사용.',inputSchema:schema({id:{type:'string',maxLength:100}},['id']),annotations});
const TITLES={budget_research:'성남 예산 근거 조회',search:'성남 예산 검색',fetch:'예산 원문 읽기',search_budget:'예산 상세 검색',get_budget_page:'원문 페이지 조회',list_budget_documents:'예산 문서 목록',get_collection_status:'수집 범위 확인',build_rag_context:'예산 근거 묶음'};for(const t of TOOLS){t.title=TITLES[t.name];t.annotations={...t.annotations,title:t.title};}
TOOLS.find(t=>t.name==='search').outputSchema=schema({results:{type:'array',items:schema({id:{type:'string'},title:{type:'string'},url:{type:'string'}},['id','title','url'])}},['results']);
TOOLS.find(t=>t.name==='fetch').outputSchema=schema({id:{type:'string'},title:{type:'string'},text:{type:'string'},url:{type:'string'},metadata:{type:'object',additionalProperties:true}},['id','title','text','url','metadata']);
async function tool(env,name,a){let def=TOOLS.find(t=>t.name===name);if(!def)fail('알 수 없는 도구입니다.');if(!a||typeof a!=='object'||Array.isArray(a))fail('객체 인자가 필요합니다.');for(let k of Object.keys(a)){let p=def.inputSchema.properties[k],v=a[k];if(!p)fail('허용되지 않은 인자: '+k);if(p.type==='string'&&typeof v!=='string'||p.type==='integer'&&!Number.isInteger(v))fail('잘못된 인자 형식: '+k);if(p.enum&&!p.enum.includes(v)||p.minimum!==undefined&&v<p.minimum||p.maximum!==undefined&&v>p.maximum||p.minLength!==undefined&&v.length<p.minLength||p.maxLength!==undefined&&v.length>p.maxLength)fail('허용 범위를 벗어난 인자: '+k);}for(let k of def.inputSchema.required)if(a[k]===undefined)fail('필수 인자: '+k);
 if(name==='budget_research')return research(env,a);
 if(name==='search'){const r=await search(env,{query:a.query,limit:8});return{results:r.results.map(h=>({id:h.id,title:h.title+' · '+h.locator_label,url:h.page_url}))};}
 if(name==='fetch'){const m=a.id.match(/^([a-f0-9]{20}):p([1-9][0-9]{0,5})$/);if(!m)fail('search 결과의 id를 그대로 사용하세요.');const p=await page(env,{document_id:m[1],page:Number(m[2])});const {text,...metadata}=p;return{id:a.id,title:p.title+' · '+p.locator_label,text,url:p.page_url,metadata};}
 if(name==='search_budget')return search(env,a);if(name==='get_budget_page')return page(env,a);if(name==='list_budget_documents')return documents(a);if(name==='get_collection_status')return{...CATALOG.summary,query_policy:POLICY,retrieval:retrievalStatus(),categories:[...new Set(CATALOG.documents.map(d=>d.category))],instructions:RULES};
 let r=await search(env,{...a,limit:4}),evidence=await evidenceFor(env,r.results,true);return{question:a.query,query_interpretation:r.query_interpretation,evidence,retrieval:r.retrieval,answer_policy:RULES,generation_performed:false,coverage:CATALOG.summary};}
async function mcp(req,env){if(req.method!=='POST')return new Response(JSON.stringify({error:'Use JSON-RPC POST'}),{status:405,headers:{'content-type':'application/json','allow':'POST'}});if(!req.headers.get('content-type')?.includes('application/json'))return json({error:'application/json required'},415);if(Number(req.headers.get('content-length'))>65536)return json({error:'Request too large'},413);let chunks=[],size=0,reader=req.body?.getReader();if(reader){while(true){let {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>65536){await reader.cancel();return json({error:'Request too large'},413);}chunks.push(value);}}let bytes=new Uint8Array(size),at=0;for(let c of chunks){bytes.set(c,at);at+=c.byteLength;}let body=new TextDecoder().decode(bytes);let rpc;try{rpc=JSON.parse(body);}catch{return json({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Parse error'}},400);}
 if(!rpc||rpc.jsonrpc!=='2.0'||typeof rpc.method!=='string'||Array.isArray(rpc))return json({jsonrpc:'2.0',id:rpc?.id??null,error:{code:-32600,message:'Invalid Request'}},400);let respond=result=>json({jsonrpc:'2.0',id:rpc.id??null,result});
 if(rpc.method.startsWith('notifications/'))return new Response(null,{status:202});
 if(rpc.method==='server/discover')return respond({supportedVersions:['2026-07-28'],serverInfo:{name:'seongnam-budget',version:'0.3.0'},capabilities:{tools:{}},instructions:RULES});
 if(rpc.method==='initialize')return respond({protocolVersion:['2025-11-25','2025-06-18','2025-03-26'].includes(rpc.params?.protocolVersion)?rpc.params.protocolVersion:'2025-11-25',capabilities:{tools:{}},serverInfo:{name:'seongnam-budget',version:'0.3.0'},instructions:RULES});
 if(rpc.method==='ping')return respond({});if(rpc.method==='tools/list')return respond({tools:TOOLS});if(rpc.method==='tools/call'){try{let data=await tool(env,rpc.params?.name,rpc.params?.arguments||{});return respond({content:[{type:'text',text:JSON.stringify(data)}],structuredContent:data,isError:false});}catch(e){return respond({content:[{type:'text',text:e.message}],isError:true});}}
 return json({jsonrpc:'2.0',id:rpc.id??null,error:{code:-32601,message:'Method not found'}});}
export default{async fetch(req,env){let u=new URL(req.url),origin=req.headers.get('origin');if(origin&&origin!==u.origin)return json({error:'Origin not allowed'},403);try{
 if(u.pathname==='/mcp'||u.pathname==='/public-mcp')return await mcp(req,env);if(req.method!=='GET')return json({error:'Method not allowed'},405);
 if(u.pathname==='/')return new Response(HTML,{headers:{'content-type':'text/html; charset=utf-8','x-content-type-options':'nosniff','content-security-policy':"default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'"}});
 if(u.pathname==='/api/status')return json({...CATALOG.summary,query_policy:POLICY,retrieval:retrievalStatus(),categories:[...new Set(CATALOG.documents.map(d=>d.category))],asset_binding:!!env.ASSETS});let a=Object.fromEntries(u.searchParams);
 if(u.pathname==='/openapi.json')return json(openapi(u.origin));if(u.pathname==='/api/research')return json(await research(env,a));if(u.pathname==='/api/search')return json(await search(env,a));if(u.pathname==='/api/page')return json(await page(env,a));if(u.pathname==='/api/documents')return json(documents(a));if(u.pathname==='/api/tools')return json(TOOLS);return json({error:'Not found'},404);
 }catch(e){return json({error:e.message},400);}}};
