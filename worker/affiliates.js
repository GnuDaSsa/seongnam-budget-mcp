import {retrievalWords} from './retrieval-phrases.js';
import {sourceAllowed} from './policy.js';

const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const scopeNoun='(?:산하\\s*기관|출자\\s*[·ㆍ/]?\\s*출연\\s*기관|출자\\s*기관|출연\\s*기관|공사\\s*[·ㆍ/]?\\s*공단)';
const negative='(?:\\s*자체)?(?:\\s*(?:자료|예산))?(?:은|는|을|를|도)?\\s*(?:제외(?:하고|해서|한|해)?|빼고|빼서|말고|포함하지\\s*(?:않고|말고|않은|않아)?|포함\\s*안(?:하고|한)?)';
export function institutionScope(query,institutions=[]){
 const q=String(query||''),named=[],excluded=[];
 let clean=q,cityClean=q;
 for(const institution of institutions){
  const names=[institution.name,...(institution.aliases||[])].filter(Boolean).sort((a,b)=>b.length-a.length);
  const pattern=names.map(n=>escape(n).replace(/\s+/g,'\\s*')).join('|');
  if(!pattern)continue;
  const rx=new RegExp('(?:'+pattern+')','gi');
  if(rx.test(q)){
   if(new RegExp('(?:'+pattern+')'+negative,'i').test(q)){excluded.push(institution.id);cityClean=cityClean.replace(new RegExp('(?:'+pattern+')'+negative,'gi'),' ');}
   else named.push(institution.id);
   clean=clean.replace(new RegExp('(?:'+pattern+')'+negative,'gi'),' ').replace(rx,' ');
  }
 }
 const denied=new RegExp(scopeNoun+negative).test(q);
 const municipalOnly=/(?:시청|성남시|시)\s*(?:자료|예산서|예산)(?:에\s*(?:있는|실린))?\s*(?:만|한정)|(?:시청|성남시)\s*예산서에\s*(?:있는|실린).*(?:만|한정)/.test(q);
 const all=!denied&&(new RegExp(scopeNoun+'(?:도|까지|를|을|의)?\\s*(?:포함|포괄|함께|같이|예산|자료|결산)').test(q)||new RegExp(scopeNoun+'(?:도|까지)(?:\\s|$)').test(q));
 const enabled=!municipalOnly&&!denied&&(all||named.length>0);
 const cleanScope=text=>text.replace(new RegExp(scopeNoun+negative,'g'),' ').replace(new RegExp(scopeNoun+'(?:도|까지|를|을|의)?\\s*(?:(?:포함|포괄)(?:해서|하여|한|해|하고)?|함께|같이)?','g'),' ').replace(/\s+/g,' ').trim();
 clean=cleanScope(clean);
 return{mode:enabled?'municipal_and_affiliates':'municipal',basis:municipalOnly?'municipal_only':denied?'excluded':all?'explicit_all':named.length?'named_institution':'default',institution_ids:enabled?(all?institutions.map(i=>i.id):named).filter(id=>!excluded.includes(id)):[],excluded_institution_ids:excluded,retrieval_query:enabled?(clean||'예산'):q,city_retrieval_query:cleanScope(cityClean)||'예산',city_first:true};
}
export function affiliateAllowed(d,a){
 const scope=a.policy?.institution_scope;
 return scope?.mode==='municipal_and_affiliates'&&scope.institution_ids.includes(d.institution_id)&&(!a.year||d.year===a.year)&&(!a.budget_type||d.budget_type===a.budget_type)&&(!a.revision||d.revision===a.revision)&&(!a.category||d.category===a.category)&&(!a.document_id||d.id===a.document_id)&&sourceAllowed(d,a);
}
export function eligibleAffiliateDocuments(catalog,a){
 let docs=catalog.documents.filter(d=>affiliateAllowed(d,a));
 if(a.budget_type==='추경'&&!a.revision&&/최신|마지막|최종/.test(a.query)){
  const key=d=>d.institution_id+':'+d.year,latest=new Map();for(const d of docs)latest.set(key(d),Math.max(latest.get(key(d))||0,d.revision||0));
  docs=docs.filter(d=>(d.revision||0)===latest.get(key(d)));
 }
 return docs;
}
export function affiliateCitation(d,p){
 return{document_id:d.id,title:d.title,year:d.year,budget_type:d.budget_type,revision:d.revision,account:d.account,category:d.category,source_scope:'affiliate',institution_id:d.institution_id,institution_name:d.institution_name,detail_level:d.detail_level,document_stage:d.document_stage||'as_published',refresh_status:d.refresh_status??null,refresh_error:d.refresh_error??null,source_family:'affiliate_budget',page:p.page,pdf_page:p.page,locator_kind:'pdf_page',locator_label:'PDF '+p.page+'쪽',printed_page:p.printed_page??null,unit:p.unit||'원문 확인',source_url:d.url,page_url:d.url+'#page='+p.page,source_page:d.source_page,sha256:d.sha256};
}
export function createAffiliateReader(catalog){
 const docs=new Map(catalog.documents.map(d=>[d.id,d]));
 async function pages(env,d){
  if(!/^[a-f0-9]{20}$/.test(d.shard))throw Error('산하기관 자료 경로가 올바르지 않습니다.');
  const response=await env.ASSETS.fetch(new Request('https://assets.local/affiliates/'+d.shard+'.json.gz'));
  if(!response.ok)throw Error('산하기관 자료 조회 실패: '+d.institution_name);
  const data=await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).json();
  return data.pages;
 }
 async function page(env,id,number){
  const d=docs.get(id);if(!d)return null;
  const p=(await pages(env,d)).find(p=>p.page===number);if(!p)throw Error('해당 산하기관 페이지는 색인에 없습니다.');
  return{...affiliateCitation(d,p),text:p.text,text_is_complete:true,classification:{status:'not_extracted',matched_paths:[],note:'기관 자체 서식입니다. 원문에 없는 시 예산 분류를 추정하지 마세요.'}};
 }
 async function search(env,a){
  if(a.policy?.institution_scope.mode!=='municipal_and_affiliates')return[];
  const words=affiliateWords(a.policy.institution_scope.retrieval_query);
  const hits=[];
  for(const d of eligibleAffiliateDocuments(catalog,a)){
   for(const p of await pages(env,d)){
    const body=p.text.replace(/\s/g,''),title=d.title.replace(/\s/g,'');
    if(words.length&&!words.every(w=>body.includes(w)||title.includes(w)))continue;
    const score=words.reduce((n,w)=>n+(body.includes(w)?1:0)+(title.includes(w)?2:0),0)+(p.page===1?0.1:0);
    const pos=words.map(w=>p.text.indexOf(w)).filter(n=>n>=0),start=Math.max(0,(pos.length?Math.min(...pos):0)-180);
    hits.push({id:d.id+':p'+p.page,...affiliateCitation(d,p),score,excerpt:p.text.slice(start,start+1800),excerpt_is_partial:p.text.length>1800,retrieval_scores:{method:'affiliate_lexical',vectorized:false},affiliate:true});
   }
  }
  hits.sort((x,y)=>y.score-x.score||(y.year||0)-(x.year||0)||x.institution_id.localeCompare(y.institution_id)||x.page-y.page);
  const seen=new Set();return hits.filter(h=>{const key=h.institution_id+':'+h.document_id+':'+h.page;if(seen.has(key))return false;seen.add(key);return true;}).slice(0,a.limit);
 }
 return{has:id=>docs.has(id),page,search};
}
export function affiliateWords(query){return retrievalWords(query).filter(w=>!['포함해서','포함','전체','총괄','총액','합계','최신','최종','마지막'].includes(w)&&!/^(?:예산|자체|기관|자료|내역)(?:은|는|만|을|를|의|도|과|와|까지)?$/.test(w));}
export function mergeCityFirst(city,affiliates,limit){
 if(!affiliates.length)return city.slice(0,limit);
 if(!city.length)return affiliates.slice(0,limit);
 const cityCount=Math.min(city.length,Math.max(1,Math.ceil(limit/2))),affiliateCount=Math.min(affiliates.length,limit-cityCount);
 return[...city.slice(0,Math.min(city.length,limit-affiliateCount)),...affiliates.slice(0,affiliateCount)];
}
