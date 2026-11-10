import {createEncoder} from './semantic.js';

export const COUNCIL_CATEGORY='의회 예산심사 회의록';
export const normalizeBusiness=s=>String(s||'').normalize('NFC').replace(/\s+/g,'');
const dot=(a,b)=>a.reduce((n,x,i)=>n+x*b[i],0);
const shaPattern=/^[a-f0-9]{64}$/;
export function validateCouncilShard(d,data){
 if(!Array.isArray(data.passages)||data.passages.length!==d.indexed_blocks)throw Error('Council block count mismatch');
 const seen=new Set();
 for(const p of data.passages){
  if(!Number.isInteger(p.page)||p.page<1||seen.has(p.page)||typeof p.text!=='string'||!p.text.trim()||p.text.length>6000||p.owner_source_scope!=='municipal'||p.institution_id!=='seongnam'||p.year!==2026||p.budget_type!=='본예산'||p.revision!==0||p.document_stage!=='proposal_explained_in_minutes'||p.account!==null||p.attachment_body_verified!==false||p.link?.status!=='transcript_correspondence_verified')throw Error('Invalid council passage metadata');
  if(!Array.isArray(p.vector)||p.vector.length!==256||p.vector.some(v=>!Number.isFinite(v))||Math.abs(dot(p.vector,p.vector)-1)>0.001)throw Error('Invalid council vector');
  if(!shaPattern.test(p.transcript_sha256)||!p.department||!p.canonical_business_name||!Array.isArray(p.city_evidence)||!p.city_evidence.length)throw Error('Missing council provenance');
  seen.add(p.page);
 }
}
export function councilAllowed(p,a){
 const scope=a.policy?.institution_scope;
 if(scope?.basis==='municipal_only'||/의회\s*(?:자료|회의록)?\s*(?:제외|빼고)/.test(a.query||''))return false;
 if(['performance','revenue'].includes(a.policy?.source_preference))return false;
 if(a.policy?.excluded_budget_types?.includes(p.budget_type)||a.policy?.allowed_budget_types?.length&&!a.policy.allowed_budget_types.includes(p.budget_type))return false;
 if(a.year&&p.year!==a.year||a.budget_type&&p.budget_type!==a.budget_type||a.revision!=null&&p.revision!==a.revision||a.category&&a.category!==COUNCIL_CATEGORY)return false;
 if(p.owner_source_scope!=='municipal'||p.institution_id!=='seongnam')return false;
 if(a.policy?.department_scope?.names?.length&&!a.policy.department_scope.names.some(name=>normalizeBusiness(name)===normalizeBusiness(p.department)))return false;
 const q=normalizeBusiness(a.query),regions=q.match(/(?:수정|중원|분당)구/g)||[];
 if(regions.length&&!regions.some(r=>p.department.includes(r)))return false;
 if(/특별회계/.test(q)&&p.city_account!=='특별회계'||/일반회계/.test(q)&&p.city_account!=='일반회계')return false;
 const raw=String(a.query||''),conjunctions=new Set(['예산과','본예산과','추경예산과','결산과','사업과','지원과','금액과','설명과','자료과','편성과']);
 const departments=[...raw.matchAll(/(?:^|\s)([가-힣]{2,}(?:과|사업소|센터|지소)|재난안전관|공공의료정책관|공보관)(?=\s|의|에서|소관|$)/g)].map(m=>m[1]).filter(name=>!conjunctions.has(name)||raw.includes(name+' 소관')||raw.includes(name+' 담당')||raw.includes(name+' 부서'));
 if(departments.length&&!departments.some(department=>p.department.includes(department.trim())))return false;
 // These qualifiers distinguish different maternal-support appropriations.
 if(q.includes('추가형')&&!normalizeBusiness(p.canonical_business_name).includes('추가형'))return false;
 return true;
}
export function councilCitation(d,p){
 return{document_id:d.id,title:d.title,year:p.year,budget_type:p.budget_type,revision:p.revision,account:p.account,category:COUNCIL_CATEGORY,source_scope:'council',source_family:'council_minutes',institution_id:p.institution_id,institution_name:'성남시',publisher:'성남시의회',department:p.department,document_stage:p.document_stage,page:p.page,pdf_page:null,printed_page:null,locator_kind:'text_block',locator_label:'회의록 발언 블록 '+p.page+' (PDF 쪽수 아님)',unit:'원문 한글 금액 표기',meeting_date:d.meeting_date,source_url:d.url,page_url:d.url,source_page:d.url,sha256:d.sha256,explanation_page_reported:p.explanation_page_reported,explanation_page_basis:'회의록 발언에서 언급한 설명자료 쪽수; 첨부 PDF 위치는 미확인',attachment_url:p.attachment_url,attachment_body_verified:false,business_name:p.business_name,canonical_business_name:p.canonical_business_name,business_link:{...p.link,city_evidence:p.city_evidence},amounts:p.amounts};
}
export function matchingCityEvidence(p,evidence){
 const names=new Set([p.canonical_business_name,...(p.aliases||[])].map(normalizeBusiness));
 return evidence.filter(e=>e.source_scope==='municipal'&&e.year===p.year&&e.budget_type===p.budget_type&&(e.revision||0)===p.revision&&e.account===p.city_account&&normalizeBusiness(e.classification?.department||e.verified_council_anchor?.department)===normalizeBusiness(p.department)&&(e.verified_council_anchor&&p.link.link_id&&e.verified_council_anchor.link_id===p.link.link_id||e.classification?.matched_paths?.some(path=>names.has(normalizeBusiness(path.detailed_business))))).map(e=>e.id);
}
export function mergeCouncilLast(primary,council,limit){
 if(!council.length)return primary.slice(0,limit);
 if(!primary.length)return council.slice(0,limit);
 const reserve=Math.min(council.length,Math.max(0,limit-1),1);
 return[...primary.slice(0,limit-reserve),...council.slice(0,reserve)];
}
export function createCouncilReader(catalog){
 const docs=new Map((catalog?.documents||[]).map(d=>[d.id,d]));
 let cached=null;
 async function load(env){
  if(cached)return cached;
  const rows=[];
  for(const d of docs.values()){
   if(!/^[a-f0-9]{20}$/.test(d.shard))throw Error('Invalid council asset path');
   const r=await env.ASSETS.fetch(new Request('https://assets.local/council/'+d.shard+'.json.gz'));
   if(!r.ok)throw Error('의회 수록 자료를 읽지 못했습니다.');
   const data=await new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).json();validateCouncilShard(d,data);
   rows.push(...data.passages.map(p=>({d,p})));
  }
  cached=rows;return rows;
 }
 async function page(env,id,number){
  if(!docs.has(id))return null;
  const row=(await load(env)).find(({d,p})=>d.id===id&&p.page===number);
  if(!row)throw Error('해당 회의록 발언 블록은 색인에 없습니다. 첨부 설명자료 본문은 미수록입니다.');
  const {d,p}=row;
  return{...councilCitation(d,p),text:p.text,text_is_complete:true,classification:{status:'council_transcript_not_budget_table',department:p.department,matched_paths:[],note:'의회 발언입니다. 회계·편성목·통계목을 시 명세서에서 복사하여 의회 원문 값처럼 표시하지 마세요.'}};
 }
 async function search(env,a){
  const eligible=(catalog?.passages||[]).filter(p=>councilAllowed(p,a)&&(!a.document_id||p.document_id===a.document_id));
  if(!eligible.length)return[];
  const selected=new Set(eligible.map(p=>p.document_id+':'+p.page));
  const rows=(await load(env)).filter(({d,p})=>selected.has(d.id+':'+p.page));
  let enc,queryVector;
  if(a.mode!=='lexical'){enc=await createEncoder(env);const ids=enc.tokenize(a.query);await enc.ensure(ids);queryVector=enc.embed(ids);}
  const q=normalizeBusiness(a.query),hits=[];
  for(const {d,p} of rows){
   const names=[p.business_name,p.canonical_business_name,...p.aliases].map(normalizeBusiness);
   const exact=names.some(name=>q.includes(name));
   const lexical=exact||p.keywords.some(word=>q.includes(normalizeBusiness(word)));
   const cosine=queryVector?dot(queryVector,p.vector):null;
   if(a.mode==='lexical'?!lexical:a.mode==='vector'?(cosine??0)<0.55:!lexical&&(cosine??0)<0.55)continue;
   const score=(cosine??0)+(a.mode==='vector'?0:exact?0.4:lexical?0.15:0);
   hits.push({id:d.id+':p'+p.page,...councilCitation(d,p),score,excerpt:p.text,excerpt_is_partial:false,retrieval_scores:{method:a.mode==='lexical'?'council_lexical':a.mode==='vector'?'council_cosine':'council_hybrid_cosine',vectorized:a.mode!=='lexical',cosine,exact_business_name:exact,business_terms_match:lexical},council:true});
  }
  return hits.sort((x,y)=>y.score-x.score||x.page-y.page).slice(0,a.limit);
 }
 async function attachLinks(env,evidence){
  if(!evidence.some(e=>e.source_scope==='council'))return evidence;
  const rows=await load(env);
  for(const e of evidence.filter(e=>e.source_scope==='council')){
   const p=rows.find(r=>r.d.id===e.document_id&&r.p.page===e.page)?.p;
   if(p){const ids=matchingCityEvidence(p,evidence);e.business_link={...e.business_link,matched_city_evidence_ids:ids,matched_city_evidence:ids.map(id=>({id,basis:evidence.find(c=>c.id===id)?.verified_council_anchor?'verified_source_anchor':'classification_path'})),same_business_basis:'동일 연도·회차·회계·부서의 검토된 사업 경로 또는 원문 해시로 검증한 사전 대조 근거. 단순 페이지·금액 일치는 사용하지 않음'};}
  }
  return evidence;
 }
 async function anchorRequests(env,hits){
  // A single reviewed anchor must not narrow a question explicitly naming several businesses.
  const named=hits.filter(h=>h.retrieval_scores.exact_business_name||h.retrieval_scores.business_terms_match);
  if(new Set(named.map(h=>h.canonical_business_name)).size>1)return[];
  const hit=hits.find(h=>h.retrieval_scores.exact_business_name||h.retrieval_scores.business_terms_match||(h.retrieval_scores.cosine??0)>=0.65);
  if(!hit)return[];
  const p=(await load(env)).find(r=>r.d.id===hit.document_id&&r.p.page===hit.page)?.p;
  return p?p.city_evidence.map(e=>({...e,year:p.year,budget_type:p.budget_type,revision:p.revision,link_id:p.link.link_id,canonical_business_name:p.canonical_business_name})):[];
 }
 return{has:id=>docs.has(id),page,search,attachLinks,anchorRequests};
}
