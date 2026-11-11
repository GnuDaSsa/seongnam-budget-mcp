import {budgetClassification} from './classification.js';
import {POLICY,VERSION,SERVER_RULES,EVIDENCE_BOUNDARY,resolveQuery,isMunicipalTotal,totalAnswerCard,sourceFamily,sourceAllowed,sourcePriority,matchesRevision} from './policy.js';
import {vectorSearch,rerank} from './semantic.js';
import {openapi} from './openapi.js';
import {retrievalWords,exactPhraseHit,businessTermsHit,topicIntent,topicBusinessMatches} from './retrieval-phrases.js';
import {institutionScope,createAffiliateReader,eligibleAffiliateDocuments,mergeCityFirst,affiliateWords} from './affiliates.js';
import {createCouncilReader,mergeCouncilLast,councilAllowed,COUNCIL_CATEGORY} from './council.js';
import {requestedDepartments,canonicalDepartmentQuery,departmentMatches} from './departments.js';
import {departmentOverview} from './department-overview.js';
import {researchGuidance} from './research-guidance.js';
import {findStatementDocuments} from './analysis.js';
import {parseStatementRows} from './statement-rows.js';
import {buildAnalysis,analysisEligible} from './research-analysis.js';
import {createDiagnostics} from './diagnostics.js';
import {matchQuality,weakestQuality,trimSemanticEvidence,bridgeBusinessNames,asBridgedEvidence,comparisonBudgetBasis,totalTableDocument,hasReplacementCharacter,rollupBusinessName,businessRollup,compactEvidence} from './quality.js';
const CATALOG=/*__CATALOG__*/null, HTML=/*__HTML__*/null, SEMANTIC=/*__SEMANTIC__*/null;
const AFFILIATES=/*__AFFILIATES__*/null;
const COUNCIL=/*__COUNCIL__*/null;
const councilReader=createCouncilReader(COUNCIL);
function councilCoverage(){return{...COUNCIL?.summary,generated_at:COUNCIL?.generated_at,embedding:COUNCIL?.embedding,notice:'검증된 회의록 발언 3구간만 검색합니다. 6회의 전체 본문과 48개 첨부 원문을 모두 색인한 것이 아닙니다. 의회 발언은 제출안 설명이며 확정 예산은 시 명세서에서 확인합니다.'};}
const affiliateReader=createAffiliateReader(AFFILIATES||{institutions:[],documents:[]});
function resolved(input){const a=resolveQuery(input);a.policy.institution_scope=institutionScope(a.query,AFFILIATES?.institutions||[]);if(a.policy.institution_scope.mode!=='municipal')a.policy.notices.push('성남시 자료를 먼저 표시하며 명시한 산하기관 자체 자료를 별도로 조회합니다. 시 출연금과 기관 예산은 중복될 수 있어 합산하지 마세요.');return a;}
function affiliateCoverage(){return{...AFFILIATES?.summary,generated_at:AFFILIATES?.generated_at,institutions:AFFILIATES?.institutions||[],default_included:false,search_method:'lexical',vectorized:false};}
function requestedAffiliateCoverage(a){
 const ids=a.policy?.institution_scope.institution_ids||[],matching=eligibleAffiliateDocuments(AFFILIATES||{documents:[]},a);
 return{requested:ids.length>0,coverage_complete:false,year:a.year??null,method:'lexical',institutions:(AFFILIATES?.institutions||[]).filter(i=>ids.includes(i.id)).map(i=>({...i,indexed_documents_total:AFFILIATES.documents.filter(d=>d.institution_id===i.id).length,matching_documents:matching.filter(d=>d.institution_id===i.id).length,notice:matching.some(d=>d.institution_id===i.id)?'수록한 공개자료만 검색합니다. 전체 수집을 의미하지 않습니다.':'요청한 범위의 기관 자체 자료가 색인에 없습니다. 성남시 출연금 자료로 기관 전체 예산을 대신하지 마세요.'}))};
}
const RELEASE=/*__RELEASE__*/null;
const DOCS=new Map(CATALOG.documents.map(d=>[d.id,d])), cache=new Map();

const RULES=SERVER_RULES;
const nextAction=text=>text+' '+EVIDENCE_BOUNDARY;
const json=(x,status=200)=>new Response(JSON.stringify(x),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
function fail(m){throw new Error(m);}
function num(v,k,min,max){if(v===undefined||v===null||v==='')return;let n=Number(v);if(!Number.isInteger(n)||n<min||n>max)fail(k+' 값이 올바르지 않습니다.');return n;}
function args(a={}){if(!a||typeof a!=='object'||Array.isArray(a))fail('객체 인자가 필요합니다.');let b={...a,year:num(a.year,'year',1900,2100),limit:num(a.limit,'limit',1,20)??8,offset:num(a.offset,'offset',0,100000)??0,revision:num(a.revision,'revision',1,30)};
 if(a.query!==undefined&&(typeof a.query!=='string'||a.query.length>160))fail('검색어는 160자 이하 문자열이어야 합니다.');
 if(hasReplacementCharacter(a.query))fail('검색어 인코딩이 올바르지 않습니다. UTF-8로 보내세요.');
 if(a.budget_type&&!['본예산','추경','결산','관련계획'].includes(a.budget_type))fail('지원하지 않는 예산 종류입니다.');return b;}
function match(d,a){return !!d&&d.source_scope!=='affiliate'&&/^https:\/\/www\.seongnam\.go\.kr\//.test(d.url)&&(!a.department_doc_ids||a.department_doc_ids.has(d.id))&&(!a.year||d.year===a.year)&&(!a.budget_type||d.budget_type===a.budget_type||(a.budget_type==='관련계획'&&sourceFamily(d)==='performance'))&&matchesRevision(d,a)&&(!a.latest_city_revisions||d.revision===a.latest_city_revisions[d.year])&&(!a.category||d.category===a.category)&&(!a.document_id||d.id===a.document_id)&&sourceAllowed(d,a);}
async function asset(env,name){if(cache.has(name)){let x=cache.get(name);cache.delete(name);cache.set(name,x);return x;}
 if(!env.ASSETS)fail('검색 파일 저장소가 연결되지 않았습니다.');let r=await env.ASSETS.fetch(new Request('https://assets.local/corpus/'+name+'.json.gz'));if(!r.ok)fail('검색 파일 조회 실패: '+name);
 let x=await new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).json();if(cache.size>=2)cache.delete(cache.keys().next().value);cache.set(name,x);return x;}
let rankMetadata=null,rankLoading=null;
let departmentIndex=null;
async function departmentScoped(env,a){
 if(!departmentIndex){const data=await asset(env,'departments');if(data.schema_version!==1||data.corpus_catalog_sha256!==SEMANTIC.corpus_catalog_sha256||!Array.isArray(data.departments))fail('부서 검색 메타데이터 버전 불일치');departmentIndex=data;}
 const departments=requestedDepartments(a.query,departmentIndex),rows=departments.flatMap(d=>d.locations);
 a.departments=departments;a.department_rows=rows;a.department_gids=departments.length?new Set(rows.map(p=>p[0])):null;a.department_doc_ids=departments.length?new Set(rows.map(p=>CATALOG.documents[p[1]].id)):null;
 a.policy.department_scope={names:departments.map(d=>d.name),basis:departments.length?'exact_original_header':'unspecified',organizational_rename_inferred:false};
 let topicQuery=canonicalDepartmentQuery(a.query,departments);for(const d of departments)topicQuery=topicQuery.replace(d.name,' ');
 a.topic_intent=topicIntent(topicQuery);
 a.policy.topic_scope=a.topic_intent;
 a.policy.content_query=a.topic_intent?.content_query||a.query;
 if(a.topic_intent&&!a.budget_type&&!a.policy.allowed_budget_types.length&&a.policy.source_preference==='expenditure')a.policy.allowed_budget_types=['본예산','추경'].filter(t=>!a.policy.excluded_budget_types.includes(t));
 return a;
}
function departmentAvailability(a){
 if(!a.departments?.length)return null;
 const editions=new Map();
 for(const [gid,docIndex,number] of a.department_rows){
  const d=CATALOG.documents[docIndex];if(a.year&&d.year!==a.year||sourceFamily(d)!=='expenditure')continue;
  const key=[d.year,d.budget_type,d.revision||0,d.account].join(':');
  if(!editions.has(key))editions.set(key,{year:d.year,budget_type:d.budget_type,revision:d.revision,account:d.account,document_id:d.id,title:d.title,source_url:d.url,page:number,page_url:d.url+'#page='+number,department_names:a.departments.filter(dep=>dep.locations.some(p=>p[0]===gid)).map(dep=>dep.name)});
 }
 return{requested_departments:a.departments.map(d=>d.name),same_year_only:!!a.year,automatic_substitution:false,available_editions:[...editions.values()].sort((x,y)=>(x.year||0)-(y.year||0)||(x.revision||0)-(y.revision||0)),note:'원문 부서 머리말이 확인된 수록 편성만 안내합니다. 요청한 본예산에 해당 부서가 없으면 추경으로 자동 대체하거나 다른 부서명을 같은 조직으로 추정하지 않습니다.'};
}
async function ranks(env){
 if(rankMetadata)return rankMetadata;if(rankLoading)return rankLoading;
 rankLoading=(async()=>{const r=await env.ASSETS.fetch(new Request('https://assets.local/corpus/rank.bin.gz'));if(!r.ok)fail('검색 메타데이터가 없습니다.');const b=await new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer(),v=new DataView(b),hash=Array.from(new Uint8Array(b,8,32),x=>x.toString(16).padStart(2,'0')).join('');if(v.getUint32(0,true)!==0x314c4253||v.getUint32(4,true)!==CATALOG.summary.snapshot_units||hash!==SEMANTIC.corpus_catalog_sha256||b.byteLength!==40+CATALOG.summary.snapshot_units*16)fail('검색 메타데이터 버전 불일치');return new Uint32Array(b,40);})();
 try{rankMetadata=await rankLoading;return rankMetadata;}finally{rankLoading=null;}
}
function groups(q){return retrievalWords(q).filter(w=>!['대한','관한'].includes(w)).slice(0,8).map(w=>({word:w,grams:/^[가-힣]+$/.test(w)?[...new Set(Array.from({length:w.length-1},(_,i)=>w.slice(i,i+2)))]:[w]}));}
function cite(d,p){let isBlock=d.locator_kind==='text_block',isArchive=d.filename.toLowerCase().endsWith('.zip'),member=p[6];
 let kind=isBlock?'text_block':isArchive?'archive_pdf_page':'pdf_page',pdfPage=isBlock?null:isArchive?(member?.page??null):p[1];
 let label=isBlock?'본문 블록 '+p[1]+' (쪽수 아님)':isArchive?(member?'ZIP '+member.member+' · PDF '+member.page+'쪽':'ZIP 내부 위치 '+p[1]+' (통합 쪽수 아님)'):'PDF '+p[1]+'쪽';
 return{document_id:d.id,title:d.title,year:d.year,budget_type:d.budget_type,revision:d.revision,account:d.account,category:d.category,source_scope:'municipal',institution_id:'seongnam',institution_name:'성남시',source_family:sourceFamily(d),page:p[1],pdf_page:pdfPage,locator_kind:kind,locator_label:label,archive_member:member?.member??null,printed_page:p[3],unit:p[2]||'원문 확인',source_url:d.url,page_url:isBlock||isArchive?d.url:d.url+'#page='+p[1],source_page:d.source_page,sha256:d.sha256};}
function termBucket(word){let h=2166136261;for(let b of new TextEncoder().encode(word))h=Math.imul(h^b,16777619)>>>0;return(h&255).toString(16).padStart(2,'0');}
function shardFor(globalPage){let lo=0,hi=CATALOG.shards.length-1;while(lo<=hi){let mid=(lo+hi)>>1,s=CATALOG.shards[mid];if(globalPage<s.offset)hi=mid-1;else if(globalPage>=s.offset+s.pages)lo=mid+1;else return s;}return null;}
const rank=(a,b)=>b.score-a.score||((DOCS.get(b.p[0]).year||0)-(DOCS.get(a.p[0]).year||0));
async function lexicalSearch(env,input){let a=args(input),q=(a.query||'').trim();if(q.length<2)fail('검색어를 두 글자 이상 입력하세요.');
 if(a.topic_intent&&input.topic_candidate_limit===64)a.limit=64;
 if(input.rollup_candidate_limit===ROLLUP_CANDIDATES)a.limit=ROLLUP_CANDIDATES;
 let gs=groups(q);if(!gs.length)gs=[{word:q,grams:[q]}];let posts=[],weight=0;
 for(let term of new Set(gs.flatMap(g=>g.grams))){let values=await asset(env,'terms-'+termBucket(term)),post=values[term]||[];if(!post.length)return{query:q,filters:{year:a.year??null,budget_type:a.budget_type??null,category:a.category??null},results:[],scanned_pages:0,matched_pages_before_dedup:0,coverage:CATALOG.summary,instructions:RULES};posts.push(post);weight+=Math.log(1+CATALOG.summary.snapshot_units/(1+post.length));}
 posts.sort((x,y)=>x.length-y.length);let eligible=new Set(posts[0]);for(let post of posts.slice(1)){let other=new Set(post);eligible=new Set([...eligible].filter(x=>other.has(x)));if(!eligible.size)break;}posts=null;
 const meta=await ranks(env);let candidates=[],scanned=0,matched=0;
 for(const gid of eligible){const d=CATALOG.documents[meta[gid*4]];if(!d||!match(d,a)||a.department_gids&&!a.department_gids.has(gid))continue;scanned++;matched++;let score=weight/Math.sqrt(Math.max(1200,meta[gid*4+1])/1500);if(meta[gid*4+2])score+=3;score+=2*sourcePriority(d,a);for(const g of gs)if(d.title.includes(g.word))score+=3;candidates.push({gid,d,score,hashId:meta[gid*4+3]});}
 candidates.sort((x,y)=>sourcePriority(y.d,a)-sourcePriority(x.d,a)||y.score-x.score||((y.d.year||0)-(x.d.year||0)));if(candidates.length>1000)candidates.length=1000;
 const seen=new Set(),selected=[];for(const c of candidates){if(seen.has(c.hashId))continue;seen.add(c.hashId);selected.push(c);if(selected.length>=a.limit)break;}
 const grouped=new Map(),hydrated=new Map();for(const c of selected){const sh=shardFor(c.gid);if(!grouped.has(sh.id))grouped.set(sh.id,{sh,items:[]});grouped.get(sh.id).items.push(c);}
 for(const {sh,items} of grouped.values()){
  const [index,texts]=await Promise.all([asset(env,'pages-'+sh.id),asset(env,'text-'+sh.id)]);
  for(const c of items){const pi=c.gid-sh.offset,p=index.pages[pi],raw=texts[pi],exact_match=exactPhraseHit(q,raw,c.d.title),business_match=businessTermsHit(q,raw,c.d.title),text=raw.replace(/[ \t]{2,}/g,' ').replace(/\n\s*\n/g,'\n'),exactExcerpt=exactPhraseHit(q,text,c.d.title),hit=exactExcerpt?Array.from(text).slice(0,exactExcerpt.start).join('').length:Math.max(0,...gs.map(g=>text.indexOf(g.word)).filter(n=>n>=0)),start=Math.max(0,hit-160);
   const topic_matches=topicBusinessMatches(raw,a.topic_intent);
   if(!departmentMatches(raw,a.departments)||a.topic_intent&&!topic_matches.length)continue;
   hydrated.set(c.gid,{id:c.d.id+':p'+p[1],...cite(c.d,p),gid:c.gid,score:Math.round(c.score*100)/100,excerpt:text.slice(start,start+1200),excerpt_is_partial:text.length>1200,exact_match,business_match,topic_matches,source_priority:sourcePriority(c.d,a)});
  }
 }
 const results=selected.map(c=>hydrated.get(c.gid)).filter(Boolean);

 return{query:q,filters:{year:a.year??null,budget_type:a.budget_type??null,category:a.category??null},results,scanned_pages:scanned,matched_pages_before_dedup:matched,coverage:CATALOG.summary,instructions:RULES};}

function retrievalStatus(){let {doc_ids,clusters,source_files,...m}=SEMANTIC;return {...m,clusters:clusters.length,vectorization_complete:SEMANTIC.pages===CATALOG.summary.snapshot_units,hybrid_search:true,reranking_enabled:true,cross_encoder:false};}
function editionDiverse(items,documentFor){
 const seen=new Set(),first=[],rest=[];
 for(const item of items){const d=documentFor(item),key=[d.year,d.budget_type,d.revision||0].join(':');if(!seen.has(key)){seen.add(key);first.push(item);}else rest.push(item);}
 return first.concat(rest);
}
async function topicLexicalSearch(env,a){
 if(!a.topic_intent)return lexicalSearch(env,a);
 const merged=new Map();let base,scanned=0,matched=0;
 for(const alias of a.topic_intent.aliases){
  const r=await lexicalSearch(env,{...a,query:a.topic_intent.content_query.replace(/(?<![a-z])AI(?![a-z])/gi,alias),topic_candidate_limit:64});base=r;scanned+=r.scanned_pages;matched+=r.matched_pages_before_dedup;
  for(const h of r.results)if(!merged.has(h.gid))merged.set(h.gid,h);
 }
 return{...base,query:a.query,results:[...merged.values()].sort((x,y)=>y.score-x.score),scanned_pages:scanned,matched_pages_before_dedup:matched};
}
async function uncachedSearch(env,input){
 let a=args(input),q=(a.query||'').trim();if(q.length<2)fail('검색어를 두 글자 이상 입력하세요.');
 if(a.mode==='lexical'){const r=await topicLexicalSearch(env,a);r.results=(a.topic_intent?editionDiverse(r.results,h=>DOCS.get(h.document_id)):r.results).slice(0,a.limit);return {...r,retrieval:{mode:'lexical',reranked:false}};}
 if(a.mode&&!['hybrid','vector'].includes(a.mode))fail('mode는 hybrid, vector, lexical 중 하나입니다.');
 const started=Date.now(),allowed=new Set(SEMANTIC.doc_ids.map((id,i)=>match(DOCS.get(id),a)?i:-1).filter(i=>i>=0));
 const vectorQuery=a.topic_intent?a.topic_intent.content_query.replace(/(?<![a-z])AI(?![a-z])/gi,'AI 인공지능')+' 사업':q;
 const vec=await vectorSearch(env,SEMANTIC,vectorQuery,allowed,64,a.department_gids),vectorDone=Date.now(),lex=a.mode==='vector'?{results:[],scanned_pages:0,matched_pages_before_dedup:0}:await topicLexicalSearch(env,{...a,limit:20}),lexicalDone=Date.now();
 const union=new Map();vec.hits.forEach((h,i)=>union.set(h.gid,{...h,rrf:1/(60+i+1),vector_rank:i+1,lexical_rank:null}));
 lex.results.forEach((h,i)=>{let c=union.get(h.gid)||{gid:h.gid,rrf:0,vector_rank:null};c.rrf+=1/(60+i+1);c.lexical_rank=i+1;c.exact_match=h.exact_match;c.business_match=h.business_match;c.topic_matches=h.topic_matches;c.source_priority=h.source_priority;union.set(h.gid,c);});
 let selected=[...union.values()].sort((x,y)=>Number(!!y.topic_matches?.length)-Number(!!x.topic_matches?.length)||Number(!!y.exact_match)-Number(!!x.exact_match)||Number(!!y.business_match)-Number(!!x.business_match)||(y.source_priority||0)-(x.source_priority||0)||y.rrf-x.rrf),candidates=[];
 if(a.topic_intent){const meta=await ranks(env);selected=editionDiverse(selected,h=>CATALOG.documents[meta[h.gid*4]]);}selected=selected.slice(0,SEMANTIC.rerank_candidates);
 const grouped=new Map();for(const c of selected){const sh=shardFor(c.gid);if(!grouped.has(sh.id))grouped.set(sh.id,{sh,items:[]});grouped.get(sh.id).items.push(c);}
 const loadedCandidates=new Map();
 // Read each shard once and release its full page arrays before the next shard.
 for(const {sh,items} of grouped.values()){
  const [idx,texts]=await Promise.all([asset(env,'pages-'+sh.id),asset(env,'text-'+sh.id)]);
  for(let c of items){const pi=c.gid-sh.offset,p=idx.pages[pi],text=texts[pi],d=DOCS.get(p[0]);if(!match(d,a)||!departmentMatches(text,a.departments))continue;
   c.topic_matches=topicBusinessMatches(text,a.topic_intent);if(a.topic_intent&&!c.topic_matches.length)continue;
   const chars=Array.from(text),exact=a.mode==='vector'?null:exactPhraseHit(q,text,d.title);c.exact_match=exact;c.business_match=a.mode==='vector'?null:businessTermsHit(q,text,d.title);c.source_priority=sourcePriority(d,a);
   const verified=c.topic_matches[0]||exact||c.business_match;
   if(verified){c.start=Math.max(0,verified.start-120);c.end=Math.min(chars.length,Math.max(c.start+800,verified.end));}
   if(c.start===undefined){let words=groups(q).map(g=>g.word),found=words.map(w=>text.indexOf(w)).filter(n=>n>=0),hit=found.length?Math.min(...found):0;c.start=Math.max(0,Array.from(text.slice(0,hit)).length-120);c.end=Math.min(chars.length,c.start+800);}
   loadedCandidates.set(c.gid,{...c,p,d,text:chars.slice(c.start,c.end).join(''),full_length:chars.length,classification:budgetClassification(text,d,q)});
  }
 }
 candidates=selected.map(c=>loadedCandidates.get(c.gid)).filter(Boolean);

 const hydrated=Date.now();await rerank(vec,candidates);if(a.mode!=='vector')candidates.sort((x,y)=>Number(!!y.exact_match)-Number(!!x.exact_match)||Number(!!y.business_match)-Number(!!x.business_match)||Number(!!y.classification.matched_paths.length)-Number(!!x.classification.matched_paths.length)||y.source_priority-x.source_priority||y.score-x.score);const rerankedAt=Date.now();let seen=new Set(),results=[];
 if(a.topic_intent)candidates=editionDiverse(candidates,c=>c.d);
 const verifiedOnly=!a.topic_intent&&a.mode!=='vector'&&candidates.some(c=>c.exact_match||c.business_match);
 for(let c of candidates){if(seen.has(c.p[4])||(verifiedOnly&&!c.exact_match&&!c.business_match))continue;if(!c.lexical_rank&&!c.exact_match&&!c.business_match&&c.cosine<0.2)continue;seen.add(c.p[4]);results.push({id:c.d.id+':p'+c.p[1],...cite(c.d,c.p),source_family:c.classification.status==='layout_extracted'?'expenditure':sourceFamily(c.d),gid:c.gid,score:+c.score.toFixed(6),excerpt:c.text,classification:c.classification,topic_matches:c.topic_matches,excerpt_is_partial:c.text.length<c.full_length,chunk:{start:c.start,end:c.end,offset_unit:'Unicode code points'},retrieval_scores:{cosine:+c.cosine.toFixed(6),token_maxsim:+c.maxsim.toFixed(6),rrf:+c.rrf.toFixed(6),vector_rank:c.vector_rank,lexical_rank:c.lexical_rank,exact_phrase:c.exact_match?.phrase??null,business_terms:c.business_match?.words??null}});if(results.length>=a.limit)break;}
 return {query:q,filters:{year:a.year??null,budget_type:a.budget_type??null,category:a.category??null},results,scanned_pages:lex.scanned_pages,matched_pages_before_dedup:lex.matched_pages_before_dedup,retrieval:{mode:a.mode||'hybrid',embedding_model:SEMANTIC.model,dimensions:SEMANTIC.dimensions,index:SEMANTIC.index_type,nprobe:SEMANTIC.nprobe,vector_chunks_scanned:vec.scanned,vector_candidates:vec.hits.length,lexical_candidates:lex.results.length,reranker:SEMANTIC.reranker,reranker_type:SEMANTIC.reranker_type,reranked:true,reranked_candidates:candidates.length,exact_phrase_candidates:candidates.filter(c=>c.exact_match).length,business_term_candidates:candidates.filter(c=>c.business_match).length,timings_ms:{vector:vectorDone-started,lexical:lexicalDone-vectorDone,hydrate:hydrated-lexicalDone,rerank:rerankedAt-hydrated},elapsed_ms:Date.now()-started},coverage:CATALOG.summary,instructions:RULES};
}

// Public corpus results only. No persistent question logs or external model API.
const searchCache=new Map();let cacheBytes=0;
async function verifiedCouncilAnchors(env,hits){
 const anchors=[];
 for(const expected of await councilReader.anchorRequests(env,hits)){
  const original=await page(env,{document_id:expected.document_id,page:expected.page}),{instructions,...p}=original;
  if(p.source_scope!=='municipal'||p.sha256!==expected.sha256||p.source_url!==expected.source_url||p.year!==expected.year||p.budget_type!==expected.budget_type||(p.revision||0)!==expected.revision||p.account!==expected.account||p.classification?.department&&p.classification.department!==expected.department)throw Error('의회 연결 시 예산 원문 검증 불일치');
  anchors.push({id:p.document_id+':p'+p.page,...p,excerpt:p.text,excerpt_is_partial:false,classification:budgetClassification(p.text,DOCS.get(p.document_id),expected.canonical_business_name),verified_council_anchor:{link_id:expected.link_id,department:expected.department,canonical_business_name:expected.canonical_business_name,basis:'verified_source_anchor',sha256:expected.sha256},retrieval_scores:{method:'verified_council_business_anchor',vectorized:false}});
 }
 return anchors;
}
async function search(env,input){
 const a=await departmentScoped(env,resolved(args(input)));if(a.policy.years.length>1)fail('여러 연도 비교는 budget_research를 사용하거나 각 연도로 조회하세요.');
 const key=JSON.stringify([a.query,a.year,a.year_scope,a.budget_type,a.revision,a.category,a.document_id,a.mode||'hybrid',a.limit,a.policy]);
 const cached=searchCache.get(key),now=Date.now();
 if(cached&&cached.expires>now){const r=JSON.parse(cached.json);r.retrieval={...r.retrieval,cache_hit:true,original_elapsed_ms:r.retrieval?.elapsed_ms??null,elapsed_ms:0};return r;}
 const cityInput={...a,query:canonicalDepartmentQuery(a.topic_intent?.content_query||a.policy.institution_scope.city_retrieval_query,a.departments)};
 if(cityInput.budget_type==='추경'&&!cityInput.revision&&/최신|마지막|최종/.test(a.query)){const docs=CATALOG.documents.filter(d=>match(d,cityInput)&&d.revision);if(docs.length){const latest={};for(const d of docs)latest[d.year]=Math.max(latest[d.year]||0,d.revision);cityInput.latest_city_revisions=latest;}}
 const r=await uncachedSearch(env,cityInput),affiliateHits=await affiliateReader.search(env,a),councilHits=await councilReader.search(env,a);
 const anchors=await verifiedCouncilAnchors(env,councilHits);
 r.query=a.query;r.results=mergeCouncilLast(mergeCityFirst(anchors.length?anchors:r.results,affiliateHits,a.limit),councilHits,a.limit);r.query_interpretation=a.policy;r.retrieval={...r.retrieval,cache_hit:false,affiliate_search:{requested:a.policy.institution_scope.mode==='municipal_and_affiliates',method:'lexical',vectorized:false,candidates:affiliateHits.length},council_search:{method:a.mode==='lexical'?'lexical':'native_potion_cosine',vectorized:a.mode!=='lexical',candidates:councilHits.length,verified_city_anchors:anchors.length}};r.filters.source_scope=a.policy.institution_scope.mode;r.coverage={...r.coverage,requested_affiliates:requestedAffiliateCoverage(a),council:councilCoverage()};
 r.department_availability=r.results.length?null:departmentAvailability(a);
 const body=JSON.stringify(r),bytes=body.length*2;
 if(searchCache.has(key)){cacheBytes-=searchCache.get(key).bytes;searchCache.delete(key);}
 if(bytes<500000){while(searchCache.size>=12||cacheBytes+bytes>2000000){const k=searchCache.keys().next().value;cacheBytes-=searchCache.get(k).bytes;searchCache.delete(k);}searchCache.set(key,{json:body,bytes,expires:now+300000});cacheBytes+=bytes;}
 return r;
}
async function evidenceFor(env,hits,full=false,query=''){
 const grouped=new Map(),out=new Map();for(const h of hits){if(h.verified_council_anchor){const {excerpt,excerpt_is_partial,...e}=h;out.set(h.id,{...e,text_is_complete:true});continue;}if(h.source_scope==='council'){const p=await councilReader.page(env,h.document_id,h.page);if(p)out.set(h.id,{id:h.id,...p,retrieval_scores:h.retrieval_scores});continue;}if(h.source_scope==='affiliate'){const p=await affiliateReader.page(env,h.document_id,h.page);if(p)out.set(h.id,{id:h.id,...p,retrieval_scores:h.retrieval_scores});continue;}const sh=shardFor(h.gid);if(!sh)continue;if(!grouped.has(sh.id))grouped.set(sh.id,{sh,items:[]});grouped.get(sh.id).items.push(h);}
 for(const {sh,items} of grouped.values()){
  const [index,texts]=await Promise.all([asset(env,'pages-'+sh.id),asset(env,'text-'+sh.id)]);
  for(const h of items){const i=h.gid-sh.offset,p=index.pages[i],text=texts[i],chars=Array.from(text),start=full?0:Math.max(0,(h.chunk?.start??0)-900),end=full?chars.length:Math.min(chars.length,Math.max(start+6000,h.chunk?.end??0));
   out.set(h.id,{id:h.id,...cite(DOCS.get(p[0]),p),source_family:sourceFamily(DOCS.get(p[0]),text),text:chars.slice(start,end).join(''),text_is_complete:start===0&&end===chars.length,classification:budgetClassification(text,DOCS.get(p[0]),query),topic_matches:topicBusinessMatches(text,topicIntent(query)),context:{start,end,total_characters:chars.length,offset_unit:'Unicode code points'},matched_chunk:h.chunk??null,retrieval_scores:h.retrieval_scores??null});
  }
 }
 return councilReader.attachLinks(env,hits.map(h=>out.get(h.id)).filter(Boolean));
}
const YEAR_COMPARISON_NOTE='연도별 동일 사업·동일 문서 종류·동일 회계 범위만 비교하세요. 누락된 연도는 확인 불가이며 0원이 아닙니다.';
const NEXT_BY_QUALITY={
 none:'현재 범위에서 근거를 찾지 못했습니다. 검색 실패를 예산 부재로 해석하지 마세요. 다른 연도로 조용히 대체하지 마세요.',
 semantic_only:'의미 유사 후보만 찾았습니다. 질의어가 원문에서 확인되지 않았으므로 같은 사업이라고 단정하지 마세요. 후보에 보이는 실제 사업명으로 한 번 재검색하거나 get_budget_page로 확인하고, 확인되지 않으면 수록 자료로 확인 불가라고 답하세요.',
 semantic_bridge:'질문과 의미가 비슷한 설명 자료의 사업명(bridge.business_name)으로 세출명세서를 다시 찾았습니다. 그 사업이 질문이 뜻한 사업이라는 대응은 추정이므로 사업명을 밝히고 답하세요. 연도와 문서 종류를 밝히세요.',
 found:'제공된 원문 근거로 직접 답하세요. 연도와 문서 종류를 밝히세요. 충분한 근거가 있으면 같은 질문을 재검색하거나 수집 현황을 먼저 호출하지 마세요. 표 대응이 불분명하거나 필요한 문맥이 잘렸을 때만 전문을 확인하세요.'
};
// 편성 구분이 없는 연도 비교는 연도별 본예산으로 맞추고, 근거 본문은 최상위 evidence에 한 번만 싣는다.
async function compareYears(env,input,a,started){
 const basis=comparisonBudgetBasis(a.policy,a.budget_type),aligned=basis==='main_budget_default';
 a.policy.comparison_budget_basis=basis;
 if(aligned)a.policy.notices.push('연도 비교: 편성 구분을 지정하지 않아 연도별 본예산 기준으로 맞췄습니다. 추경·결산 비교는 질문에 명시하세요.');
 const compact=a.policy.years.length>POLICY.max_comparison_years;
 if(compact)a.policy.notices.push('4개 이상 연도 조회: 연도별 사업 행 주변만 간추려 반환했습니다. 전문은 get_budget_page로 확인하세요.');
 const yearly=await Promise.all(a.policy.years.map(year=>research(env,{...input,year,year_slice:true,limit:2,compact,...(aligned?{budget_type:'본예산'}:{})})));
 const per_year=yearly.map(({evidence,...rest})=>({...rest,evidence_ids:evidence.map(e=>e.id)}));
 return{question:a.query,query_interpretation:a.policy,per_year,evidence:yearly.flatMap(r=>r.evidence),match_quality:weakestQuality(yearly.map(r=>r.match_quality)),generation_performed:false,answer_policy:RULES,next_action:nextAction(YEAR_COMPARISON_NOTE),elapsed_ms:Date.now()-started};
}
// 해당 연도 본예산 총괄표 1쪽을 직접 읽는다. 합계 대조가 되면 answer_card, 안 되면 원문만 반환한다.
async function totalTable(env,a,coverage,started){
 const doc=totalTableDocument(CATALOG.documents,a.year);if(!doc)return null;
 let original;
 try{original=await page(env,{document_id:doc.id,page:1});}
 catch(error){a.policy.notices.push('본예산 총괄표 1쪽을 색인에서 읽지 못해 일반 검색으로 조회했습니다: '+error.message);return null;}
 const {instructions,...p}=original,length=Array.from(p.text).length;
 const e={id:doc.id+':p1',...p,text_is_complete:true,context:{start:0,end:length,total_characters:length,offset_unit:'Unicode code points'}},card=totalAnswerCard(e);
 const base={question:a.query,filters:{year:a.year,budget_type:'본예산'},query_interpretation:{...a.policy,budget_type_basis:a.budget_type?'specified':'total_default'}};
 if(card)return{...base,answer_card:card,evidence:[e],retrieval:{mode:'verified_total_table',reranked:false,reason:'검증된 본예산 총괄표 직접 조회'},match_quality:{level:'verified',basis:'verified_total_table'},coverage,generation_performed:false,answer_policy:RULES,next_action:nextAction('answer_card의 수치와 공식 원문 근거로 바로 답하세요. 기준 연도와 본예산 기준임을 밝히고 동일 내용을 재검색하지 마세요.'),elapsed_ms:Date.now()-started};
 if(!/합\s*계\s+[0-9][0-9,]+/.test(p.text)){a.policy.notices.push('본예산 총괄표 원문에서 합계 금액이 추출되지 않아 일반 검색으로 조회했습니다.');return null;}
 return{...base,evidence:[e],retrieval:{mode:'total_table_unverified',reranked:false,reason:'본예산 총괄표 원문 직접 조회. 단위 또는 합계 자동 대조 실패'},match_quality:{level:'keyword',basis:'total_table_document'},coverage,generation_performed:false,answer_policy:RULES,next_action:nextAction('본예산 총괄표 원문을 반환했지만 단위 또는 합계의 자동 대조에 실패했습니다. 원문 표에서 금액과 단위를 직접 확인해 인용하고, 단위가 불명확하면 금액을 확정하지 마세요.'),elapsed_ms:Date.now()-started};
}
// 의미 유사 후보의 실제 사업명으로 세출명세서를 키워드 재검색한다. 사업명이 원문에 있는 근거만 연결한다.
async function bridgeToStatements(env,a,found){
 const bridged=[];
 for(const link of bridgeBusinessNames(found)){
  const hits=(await lexicalSearch(env,{...a,query:link.business_name,limit:3,mode:undefined})).results;
  const evidence=await evidenceFor(env,hits,false,link.business_name);
  bridged.push(...evidence.map(e=>asBridgedEvidence(e,link)).filter(Boolean).slice(0,2));
 }
 return bridged;
}
const OVERVIEW_PAGE_LIMIT=80;
// 부서를 하나 명시한 질문: 그 연도의 본예산과 수록된 추경 회차에서 부서 머리말이 확인된 쪽을 모두 읽어 총액·세부사업 금액을 정리한다.
async function departmentOverviewFor(env,a){
 if(a.departments?.length!==1||!a.year)return null;
 const editions=new Map();
 for(const [gid,docIndex] of a.department_rows){
  const d=CATALOG.documents[docIndex];if(d.year!==a.year||!['본예산','추경'].includes(d.budget_type)||!match(d,a))continue;
  const key=(d.budget_type==='본예산'?0:1)+':'+String(d.revision||0).padStart(2,'0');
  if(!editions.has(key))editions.set(key,new Map());
  const docs=editions.get(key);if(!docs.has(docIndex))docs.set(docIndex,[]);docs.get(docIndex).push(gid);
 }
 // 같은 편성이 전체본과 부서별 PDF로 중복 수록된 경우 쪽이 가장 많은 문서 하나만 읽는다.
 const selected=[...editions.keys()].sort().map(key=>[...editions.get(key).entries()].sort((x,y)=>y[1].length-x[1].length||x[0]-y[0])[0]);
 let remaining=OVERVIEW_PAGE_LIMIT,truncated=false;const result=[];
 for(const [docIndex,gids] of selected){
  const d=CATALOG.documents[docIndex],pages=[];
  for(const gid of gids.sort((x,y)=>x-y)){
   if(remaining<=0){truncated=true;break;}remaining--;
   const sh=shardFor(gid);if(!sh)continue;const [index,texts]=await Promise.all([asset(env,'pages-'+sh.id),asset(env,'text-'+sh.id)]);
   const p=index.pages[gid-sh.offset],c=cite(d,p);pages.push({page:c.page,page_url:c.page_url,unit:c.unit,text:texts[gid-sh.offset]});
  }
  result.push({budget_type:d.budget_type,revision:d.revision,document_id:d.id,title:d.title,pages});
 }
 return departmentOverview(a.departments[0].name,a.year,result,truncated);
}
const ROLLUP_CANDIDATES=40;
// 같은 세부사업이 여러 부서에 편성됐는지 같은 편성(기본 본예산) 안에서 키워드로 다시 모은다.
async function rollupAcrossDepartments(env,a,evidence){
 const name=rollupBusinessName(evidence);if(!name)return null;
 const edition=a.budget_type||'본예산',query=a.policy.institution_scope.city_retrieval_query;
 const hits=(await lexicalSearch(env,{...a,query,budget_type:edition,limit:20,rollup_candidate_limit:ROLLUP_CANDIDATES,mode:undefined})).results;
 return businessRollup(await evidenceFor(env,hits,false,query),name,edition,hits.length>=ROLLUP_CANDIDATES);
}
// 세출명세서 "전체" 문서 하나를 쪽 순서대로 모두 읽어 행으로 만든다. 메모리 한도 때문에 최근 2개 문서만 보관한다.
const STATEMENT_DOCS=findStatementDocuments(CATALOG).documents,SHARDS=new Map(CATALOG.shards.map(s=>[s.id,s])),rowCache=new Map();
async function statementRows(env,doc,diag){
 if(rowCache.has(doc.document_id)){const x=rowCache.get(doc.document_id);rowCache.delete(doc.document_id);rowCache.set(doc.document_id,x);diag?.count('cache_hits');return x.rows;}
 if(doc.all_pages_indexed!==true||!Number.isInteger(doc.page_count)||doc.page_count<1)fail('전체 쪽의 색인 상태를 확인할 수 없어 행 집계를 중단합니다.');
 diag?.count('cache_misses');
 const pages=[],gids=new Map();
 for(const shard of doc.shards){const sh=SHARDS.get(shard);if(!sh)fail('세출명세서 색인 조각을 찾을 수 없습니다.');const [index,texts]=await Promise.all([asset(env,'pages-'+shard),asset(env,'text-'+shard)]);diag?.count('assets_read',2);
  index.pages.forEach((p,i)=>{if(p[0]===doc.document_id&&typeof texts[i]==='string'){pages.push({page:p[1],unit:p[2],text:texts[i]});gids.set(p[1],sh.offset+i);}});}
 pages.sort((x,y)=>x.page-y.page);
 if(pages.length!==doc.page_count||pages.some((p,i)=>p.page!==i+1))fail('원문 쪽이 누락되거나 중복되어 행 집계를 중단합니다.');
 const rows=parseStatementRows(pages,{document_id:doc.document_id,year:doc.year,edition:doc.budget_type==='추경'?doc.revision+'회 추경':'본예산',account:doc.account_group==='원문 확인'?null:doc.account_group});
 diag?.count('rows_read',rows.length);
 if(rowCache.size>=2)rowCache.delete(rowCache.keys().next().value);rowCache.set(doc.document_id,{rows,gids});
 return rows;
}
const pageUrl=(documentId,page)=>{const d=DOCS.get(documentId);return d?d.url+'#page='+page:null;};
// analysis가 가리킨 원문 쪽(최대 3쪽)을 해당 행 주변으로 잘라 evidence로 만든다.
async function analysisEvidence(env,analysis,query){
 const hits=[];
 for(const s of analysis?.source_pages||[]){
  const gid=rowCache.get(s.document_id)?.gids.get(s.page);if(gid===undefined)continue;
  const sh=shardFor(gid),texts=await asset(env,'text-'+sh.id),text=texts[gid-sh.offset]||'';
  const before=text.split('\n').slice(0,Math.max(0,(s.source_line||1)-1)).join('\n'),start=Array.from(before).length;
  hits.push({id:s.document_id+':p'+s.page,gid,chunk:{start:Math.max(0,start-300),end:start+1500},retrieval_scores:{method:'statement_row_index',source_line:s.source_line}});
 }
 return hits.length?(await evidenceFor(env,hits,false,query)).map(e=>({...e,statement_row:true})):[];
}
async function research(env,input){
 const started=Date.now(),diag=createDiagnostics(),a=await departmentScoped(env,resolved(args(input)));
 if(a.policy.years.length>1)return compareYears(env,input,a,started);
 if(a.year_scope!=='all'&&a.policy.institution_scope.mode==='municipal'&&a.budget_type==='추경'&&!a.revision&&/최신|마지막|최종/.test(a.query)){
  const revisions=CATALOG.documents.filter(d=>match(d,a)&&d.revision).map(d=>d.revision);
  if(revisions.length){a.revision=Math.max(...revisions);a.policy.notices.push('수록된 추경 중 최종 '+a.revision+'회 기준입니다. 이후 공개자료의 완전 수집을 보장하지 않습니다.');}
 }
 const coverage={snapshot_at:CATALOG.summary.generated_at,whole_city_coverage_complete:false,searchable_locations:CATALOG.summary.snapshot_units,failed_documents:CATALOG.summary.status_counts.failed,unindexed_pdf_pages:CATALOG.summary.unindexed_pdf_pages,requested_affiliates:requestedAffiliateCoverage(a),council:councilCoverage()};
 if(a.policy.institution_scope.mode==='municipal'&&!a.departments?.length&&!a.topic_intent&&!a.document_id&&a.year&&!a.revision&&!a.category&&(!a.budget_type||a.budget_type==='본예산')&&isMunicipalTotal(a.query)){
  const total=await totalTable(env,a,coverage,started);if(total)return total;
  if(!a.budget_type){a.budget_type='본예산';a.policy.budget_type_basis='total_default';}
 }
 const r=await diag.span('search')(()=>search(env,{...a,limit:a.topic_intent?a.limit:Math.min(a.limit,4)})),found=await diag.span('evidence')(()=>evidenceFor(env,r.results,false,a.topic_intent?.content_query||a.policy.institution_scope.city_retrieval_query));
 let evidence=found,match_quality=matchQuality(found,r.retrieval?.mode);
 // 순위·합계·편성 비교·재원·사업 확인은 검색 후보가 아니라 세출명세서 전체 행에서 계산한다.
 let analysis=null;
 if(!input.year_slice&&analysisEligible(a)){
  try{analysis=await diag.span('analysis')(()=>buildAnalysis(a,{documents:STATEMENT_DOCS,loadRows:doc=>statementRows(env,doc,diag),urlFor:pageUrl}));}
  catch(error){diag.markPartial();analysis={kind:'unknown',status:'error',method:'statement_row_index',reason:'세출명세서 행 계산 중 오류가 발생해 계산 결과를 반환하지 않았습니다. 순위·합계를 확정하지 마세요.',notices:[]};}
 }
 const analysed=analysis&&['complete','matched','calculated','compared'].includes(analysis.status);
 if(analysis?.source_pages?.length&&(analysed||analysis.status==='partial_scope')){
  const rowEvidence=await analysisEvidence(env,analysis,a.policy.institution_scope.city_retrieval_query);
  if(rowEvidence.length){const ids=new Set(rowEvidence.map(e=>e.id));evidence=[...rowEvidence,...found.filter(e=>!ids.has(e.id)).slice(0,analysed?1:2)];match_quality={level:'verified',basis:'statement_row_index'};}
 }
 if(match_quality.level==='semantic_only'){
  const bridged=a.topic_intent?[]:await diag.span('bridge')(()=>bridgeToStatements(env,a,found)),sources=new Set(bridged.map(e=>e.bridge.from_id));
  evidence=[...bridged,...found.filter(e=>sources.has(e.id)),...found.filter(e=>!sources.has(e.id))].slice(0,6).map(e=>e.bridge?e:trimSemanticEvidence(e));
  match_quality=matchQuality(evidence,r.retrieval?.mode);
 }
 const rollupEligible=!analysis&&match_quality.level==='verified'&&!a.departments?.length&&!a.topic_intent&&a.policy.institution_scope.mode==='municipal'&&a.policy.source_preference==='expenditure';
 const business_rollup=rollupEligible?await diag.span('rollup')(()=>rollupAcrossDepartments(env,a,evidence)):null;
 if(input.compact)evidence=evidence.map(compactEvidence);
 const department_overview=a.policy.institution_scope.mode==='municipal'&&a.policy.source_preference==='expenditure'&&!a.topic_intent?await diag.span('overview')(()=>departmentOverviewFor(env,a)):null;
 const guidance=researchGuidance(a.query,department_overview,match_quality,analysis);
 if(a.departments?.length>1&&!(analysis?.kind==='department_sum'&&analysis.status==='calculated'))guidance.note='여러 부서가 요청됐지만 모든 부서의 같은 사업과 금액을 검증해 합산한 결과는 아닙니다. 누락된 부서를 확인하고 전체 합계를 확정하지 마세요. '+guidance.note;
 if(a.policy.comparison_budget_types?.includes('본예산')&&a.policy.comparison_budget_types.includes('추경')&&!(analysis?.kind==='edition_compare'&&analysis.status==='compared'))guidance.note='본예산과 추경의 같은 사업 및 기정액·경정액·증감액을 각각 원문에서 확인하기 전에는 비교를 완료한 것으로 표시하지 마세요. '+guidance.note;
 const rollupNote=business_rollup?.departments.length>1?'같은 세부사업이 '+business_rollup.departments.length+'개 부서에 편성되어 있습니다. business_rollup.rows의 부서별 금액을 모두 제시하고 합계는 계산값임을 밝히세요. ':'';
 return{question:a.query,filters:r.filters,query_interpretation:a.policy,source_selection:{preference:a.policy.source_preference,returned_families:[...new Set(evidence.map(e=>e.source_family))],returned_budget_types:[...new Set(evidence.map(e=>e.budget_type))],note:'문서 종류를 지정하지 않은 사업 질문은 세출명세서를 우선합니다. 본예산·추경을 함께 찾을 수 있으며 반환된 편성 구분과 회차를 각각 표시하세요. 성과계획서는 편성 내역을 대신하지 않습니다.'},evidence,match_quality,analysis,business_rollup,department_overview,retrieval:r.retrieval,coverage,department_availability:r.department_availability,topic_coverage:a.topic_intent?{complete:false,annual_final_budget_reconstructed:false,selection:"relevant_business_lines_with_edition_diversity",returned_locations:evidence.length,requested_limit:a.limit}:null,generation_performed:false,
  verification_status:guidance.status,next_action:nextAction(guidance.note+rollupNote+(NEXT_BY_QUALITY[match_quality.level]||NEXT_BY_QUALITY.found)),answer_policy:RULES,diagnostics:diag.toJSON(),elapsed_ms:Date.now()-started};
}

async function page(env,input){let a=args(input);if(typeof a.document_id!=='string'||(!DOCS.has(a.document_id)&&!affiliateReader.has(a.document_id)&&!councilReader.has(a.document_id)))fail('문서를 찾을 수 없습니다.');let n=num(a.page,'page',1,100000);if(!n)fail('검색 결과의 page 값이 필요합니다.');if(councilReader.has(a.document_id))return{...await councilReader.page(env,a.document_id,n),instructions:RULES};if(affiliateReader.has(a.document_id))return{...await affiliateReader.page(env,a.document_id,n),instructions:RULES};let d=DOCS.get(a.document_id);
 for(let shard of d.shards){let idx=await asset(env,'pages-'+shard),i=idx.pages.findIndex(p=>p[0]===d.id&&p[1]===n);if(i>=0){let texts=await asset(env,'text-'+shard);return{...cite(d,idx.pages[i]),text:texts[i],classification:budgetClassification(texts[i],d),instructions:RULES};}}fail('해당 페이지는 색인에 없습니다. 스캔·미처리 상태를 확인하세요.');}
function documents(input){let a=resolved(args(input));if(a.policy.years.length>1)fail('문서 목록은 연도별로 조회하세요.');a.policy.source_preference='explicit';let q=(a.query?a.policy.institution_scope.city_retrieval_query:'').trim().toLowerCase(),rows=CATALOG.documents.filter(d=>match(d,a)&&(!q||d.title.toLowerCase().includes(q))).sort((x,y)=>(y.year||0)-(x.year||0)).map(d=>({...d,source_scope:'municipal',institution_id:'seongnam',institution_name:'성남시'}));const affiliateQ=affiliateWords(a.policy.institution_scope.retrieval_query);rows.push(...eligibleAffiliateDocuments(AFFILIATES||{documents:[]},a).filter(d=>affiliateQ.every(w=>d.title.includes(w))).sort((x,y)=>(y.year||0)-(x.year||0)));rows.push(...(COUNCIL?.documents||[]).filter(d=>(!q||d.title.toLowerCase().includes(q))&&(!a.document_id||d.id===a.document_id)&&(COUNCIL.passages||[]).some(p=>p.document_id===d.id&&councilAllowed(p,a))));return{total:rows.length,offset:a.offset,query_interpretation:a.policy,documents:rows.slice(a.offset,a.offset+a.limit).map(({shards,...d})=>d)};}
const properties={query:{type:'string',description:'자연어 질문 또는 사업명·부서명, 2~160자. 후속 요청도 직전 주제·명시 연도와 새 편성 조건을 함께 전달(서버는 대화 기억 없음)',minLength:2,maxLength:160},mode:{type:'string',enum:['hybrid','vector','lexical'],description:'기본 hybrid: 키워드+벡터 검색, RRF 결합, 토큰 의미 리랭킹'},year:{type:'integer',description:'회계연도. 질문에도 없으면 2026년. 질문의 명시 연도 우선.',minimum:1900,maximum:2100},year_scope:{type:'string',enum:['single','all'],description:'기본 single. 전체/역대 연도를 명시 요청한 경우에만 all'},budget_type:{type:'string',enum:['본예산','추경','결산','관련계획']},revision:{type:'integer',minimum:1,maximum:30},category:{type:'string',description:'자료 분류'},limit:{type:'integer',minimum:1,maximum:20,default:8}};
const schema=(p,r=[])=>({type:'object',properties:p,required:r,additionalProperties:false}),annotations={readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false};
const TOOLS=[{name:'search_budget',description:'상세 검색용: 성남시 예산 원문의 검색 모드·필터별 요약과 관련도 점수가 필요할 때 사용. 일반 예산 질문은 원문 근거까지 반환하는 budget_research를 우선 사용. 미지정 연도는 2026년.',inputSchema:schema(properties,['query']),annotations},
 {name:'get_budget_page',description:'사용자가 원문 전문을 요청했거나 검색 근거가 부족하거나 잘렸거나 표의 열 대응이 불명확할 때 page 값으로 전문·단위·출처 확인. budget_research 근거가 충분하면 추가 조회 없이 답변. PDF 쪽수와 HWP/엑셀 본문 블록을 구분.',inputSchema:schema({document_id:{type:'string'},page:{type:'integer',minimum:1}},['document_id','page']),annotations},
 {name:'list_budget_documents',description:'문서와 실패·미처리 상태를 연도·예산종류별로 확인할 때 사용.',inputSchema:schema({...properties,offset:{type:'integer',minimum:0}}),annotations},
 {name:'get_collection_status',description:'검색 가능 범위, 수집 누락, 스캔·이미지 제외 상태, 마지막 스냅샷 시각을 확인. 전체 수집 완료라고 추정하지 말 것. ocr_required 표시는 검색 제외 상태이며 OCR 실행 계획이 아닙니다.',inputSchema:schema({}),annotations},
 {name:'build_rag_context',description:'기존 연동 호환용: 상위 4개 원문 페이지/본문 블록 전문과 인용 규칙을 반환. 일반 예산 질문은 budget_research를 우선 사용. 생성 모델을 호출하지 않음.',inputSchema:schema(properties,['query']),annotations}];
TOOLS.unshift({name:'budget_research',description:'성남시 본예산·추경·결산·사업비·부서별 예산·연도별 비교 질문에 먼저 사용. 법령 해석이나 다른 지자체 예산 조회에는 사용하지 않음. 사업비는 세출예산사업명세서를 우선하며 성과계획·지표 질문은 계획서를 조회. 원문 근거·단위·인용 URL과 부서·세부사업·편성목·통계목 및 해당 행을 한 번에 반환. 미지정 연도는 2026년. 3개 연도까지는 근거 본문을, 4~8개 연도는 연도별 사업 행을 간추려 반환. 같은 세부사업이 여러 부서에 있으면 business_rollup으로 부서별 행을, 부서를 하나 명시하면 department_overview로 그 부서의 편성별 총액과 세부사업 금액순 목록을 함께 반환. 순위·여러 부서 합계·본예산과 추경 비교·재원 질문은 세출명세서 전체 행에서 계산한 analysis(상태·범위·원문 쪽 포함)를 반환하며 complete가 아닌 순위는 전체 순위가 아님. 근거가 충분하면 바로 답변. 생성 모델 없음.',inputSchema:schema(properties,['query']),annotations},
 {name:'search',description:'ChatGPT 호환 검색. 인용 가능한 id/title/url 반환. 질문에 연도가 없으면 2026년, 전체 연도는 질문에 명시.',inputSchema:schema({query:properties.query},['query']),annotations},
 {name:'fetch',description:'search 결과 id로 원문 페이지/본문 블록 전문과 인용 URL 조회. id는 search 결과 값을 그대로 사용.',inputSchema:schema({id:{type:'string',maxLength:100}},['id']),annotations});
const TITLES={budget_research:'성남 예산 근거 조회',search:'성남 예산 검색',fetch:'예산 원문 읽기',search_budget:'예산 상세 검색',get_budget_page:'원문 페이지 조회',list_budget_documents:'예산 문서 목록',get_collection_status:'수집 범위 확인',build_rag_context:'예산 근거 묶음'};for(const t of TOOLS){t.title=TITLES[t.name];t.annotations={...t.annotations,title:t.title};}
for(const t of TOOLS)t.description+=' '+EVIDENCE_BOUNDARY;
for(const t of TOOLS.filter(t=>['budget_research','search_budget','search','list_budget_documents','build_rag_context'].includes(t.name)))t.description+=' 시 예산서를 먼저 표시하고 검증된 의회 회의록 발언을 보충합니다. 의회 발언은 제출안 설명이며 첨부 설명자료 원문 확인과 구분합니다. 시청 자료만 요청하면 의회 근거를 제외합니다. 질문에 산하기관 포함 또는 특정 기관명을 명시하면 해당 기관 자체 공개자료도 검색하며 시 자료를 먼저 표시합니다. 기관 예산과 시 출연금을 중복 합산하지 마세요.';
TOOLS.find(t=>t.name==='search').outputSchema=schema({results:{type:'array',items:schema({id:{type:'string'},title:{type:'string'},url:{type:'string'}},['id','title','url'])}},['results']);
TOOLS.find(t=>t.name==='fetch').outputSchema=schema({id:{type:'string'},title:{type:'string'},text:{type:'string'},url:{type:'string'},metadata:{type:'object',additionalProperties:true}},['id','title','text','url','metadata']);
async function tool(env,name,a){let def=TOOLS.find(t=>t.name===name);if(!def)fail('알 수 없는 도구입니다.');if(!a||typeof a!=='object'||Array.isArray(a))fail('객체 인자가 필요합니다.');for(let k of Object.keys(a)){let p=def.inputSchema.properties[k],v=a[k];if(!p)fail('허용되지 않은 인자: '+k);if(p.type==='string'&&typeof v!=='string'||p.type==='integer'&&!Number.isInteger(v))fail('잘못된 인자 형식: '+k);if(p.enum&&!p.enum.includes(v)||p.minimum!==undefined&&v<p.minimum||p.maximum!==undefined&&v>p.maximum||p.minLength!==undefined&&v.length<p.minLength||p.maxLength!==undefined&&v.length>p.maxLength)fail('허용 범위를 벗어난 인자: '+k);}for(let k of def.inputSchema.required)if(a[k]===undefined)fail('필수 인자: '+k);
 if(name==='budget_research')return research(env,a);
 if(name==='search'){const r=await search(env,{query:a.query,limit:8});return{results:r.results.map(h=>({id:h.id,title:h.title+' · '+h.locator_label,url:h.page_url}))};}
 if(name==='fetch'){const m=a.id.match(/^([a-f0-9]{20}):p([1-9][0-9]{0,5})$/);if(!m)fail('search 결과의 id를 그대로 사용하세요.');const p=await page(env,{document_id:m[1],page:Number(m[2])});const {text,...metadata}=p;return{id:a.id,title:p.title+' · '+p.locator_label,text,url:p.page_url,metadata};}
 if(name==='search_budget')return search(env,a);if(name==='get_budget_page')return page(env,a);if(name==='list_budget_documents')return documents(a);if(name==='get_collection_status')return{...CATALOG.summary,query_policy:POLICY,release:RELEASE,affiliates:affiliateCoverage(),council:councilCoverage(),retrieval:retrievalStatus(),categories:[...new Set(CATALOG.documents.map(d=>d.category)),COUNCIL_CATEGORY],instructions:RULES};
 let r=await search(env,{...a,limit:4}),evidence=await evidenceFor(env,r.results,true);return{question:a.query,query_interpretation:r.query_interpretation,evidence,retrieval:r.retrieval,answer_policy:RULES,generation_performed:false,coverage:r.coverage};}
async function mcp(req,env){if(req.method!=='POST')return new Response(JSON.stringify({error:'Use JSON-RPC POST'}),{status:405,headers:{'content-type':'application/json','allow':'POST'}});if(!req.headers.get('content-type')?.includes('application/json'))return json({error:'application/json required'},415);if(Number(req.headers.get('content-length'))>65536)return json({error:'Request too large'},413);let chunks=[],size=0,reader=req.body?.getReader();if(reader){while(true){let {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>65536){await reader.cancel();return json({error:'Request too large'},413);}chunks.push(value);}}let bytes=new Uint8Array(size),at=0;for(let c of chunks){bytes.set(c,at);at+=c.byteLength;}let rpc;try{rpc=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{return json({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Parse error'}},400);}
 if(!rpc||rpc.jsonrpc!=='2.0'||typeof rpc.method!=='string'||Array.isArray(rpc))return json({jsonrpc:'2.0',id:rpc?.id??null,error:{code:-32600,message:'Invalid Request'}},400);let respond=result=>json({jsonrpc:'2.0',id:rpc.id??null,result});
 if(rpc.method.startsWith('notifications/'))return new Response(null,{status:202});
 if(rpc.method==='server/discover')return respond({supportedVersions:['2026-07-28'],serverInfo:{name:'seongnam-budget',version:VERSION+(RELEASE?.source_sha?'+'+RELEASE.source_sha.slice(0,12):'')},capabilities:{tools:{}},instructions:RULES});
 if(rpc.method==='initialize')return respond({protocolVersion:['2025-11-25','2025-06-18','2025-03-26'].includes(rpc.params?.protocolVersion)?rpc.params.protocolVersion:'2025-11-25',capabilities:{tools:{}},serverInfo:{name:'seongnam-budget',version:VERSION+(RELEASE?.source_sha?'+'+RELEASE.source_sha.slice(0,12):'')},instructions:RULES});
 if(rpc.method==='ping')return respond({});if(rpc.method==='tools/list')return respond({tools:TOOLS});if(rpc.method==='tools/call'){try{let data=await tool(env,rpc.params?.name,rpc.params?.arguments||{});return respond({content:[{type:'text',text:JSON.stringify(data)}],structuredContent:data,isError:false});}catch(e){return respond({content:[{type:'text',text:e.message}],isError:true});}}
 return json({jsonrpc:'2.0',id:rpc.id??null,error:{code:-32601,message:'Method not found'}});}
export default{async fetch(req,env){let u=new URL(req.url),origin=req.headers.get('origin');if(origin&&origin!==u.origin)return json({error:'Origin not allowed'},403);try{
 if(u.pathname==='/mcp'||u.pathname==='/public-mcp')return await mcp(req,env);if(req.method!=='GET')return json({error:'Method not allowed'},405);
 if(u.pathname==='/')return new Response(HTML,{headers:{'content-type':'text/html; charset=utf-8','x-content-type-options':'nosniff','content-security-policy':"default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'"}});
 if(u.pathname==='/api/status')return json({...CATALOG.summary,query_policy:POLICY,release:RELEASE,affiliates:affiliateCoverage(),council:councilCoverage(),retrieval:retrievalStatus(),categories:[...new Set(CATALOG.documents.map(d=>d.category)),COUNCIL_CATEGORY],asset_binding:!!env.ASSETS});let a=Object.fromEntries(u.searchParams);
 if(u.pathname==='/openapi.json')return json(openapi(u.origin));if(u.pathname==='/api/research')return json(await research(env,a));if(u.pathname==='/api/search')return json(await search(env,a));if(u.pathname==='/api/page')return json(await page(env,a));if(u.pathname==='/api/documents')return json(documents(a));if(u.pathname==='/api/tools')return json(TOOLS);return json({error:'Not found'},404);
 }catch(e){return json({error:e.message},400);}}};
