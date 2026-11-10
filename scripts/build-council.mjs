// Build only reviewed council passages using the same local Potion encoder as queries.
// Usage: node scripts/build-council.mjs --input <research-package-directory>
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {createEncoder} from '../worker/semantic.js';
import {validateCouncilShard,COUNCIL_CATEGORY} from '../worker/council.js';

const hash=b=>createHash('sha256').update(b).digest('hex');
const inputArg=process.argv.indexOf('--input');
if(inputArg<0||!process.argv[inputArg+1])throw Error('Use --input with the reviewed research package');
const input=path.resolve(process.argv[inputArg+1]),root=process.cwd(),out=path.join(root,'snapshot/council');
const readJson=async p=>JSON.parse((await readFile(p,'utf8')).replace(/^\ufeff/,''));
const records=await readJson(path.join(input,'budget_records.json'));
const links=await readJson(path.join(input,'business_links.json'));
const attachments=await readJson(path.join(input,'council_catalog/catalog.json'));
const municipal=await readJson(path.join(input,'municipal_evidence.json'));
const sources=await readJson(path.join(input,'sources.json'));
const baseCatalog=await readFile('snapshot/catalog.json'),baseManifest=await readFile('snapshot/semantic/manifest.json');
const semantic=JSON.parse(baseManifest);
const env={ASSETS:{async fetch(req){
 const pathname=new URL(req.url).pathname;
 if(!/^\/semantic\/(?:vocab|common|centroids|page-docs|tokens-\d+)\.bin\.gz$/.test(pathname))throw Error('Unexpected encoder asset');
 // Throw on missing local files: no remote fallback while building data.
 return new Response(await readFile(path.join(root,'snapshot',pathname.slice(1))));
}}};
const enc=await createEncoder(env),documents=[],passages=[],packedFiles=[];
const meetingSources=sources.filter(s=>s.source_kind==='council_meeting_html');
for(const s of meetingSources){
 if(!/^[\w-]+$/.test(s.source_id))throw Error('Invalid meeting id');
 if(hash(await readFile(path.join(input,'council_catalog',s.source_id+'.html')))!==s.source_sha256)throw Error('Meeting HTML changed: '+s.source_id);
}
if(links.length!==3||records.length!==6||meetingSources.length!==6||attachments.length!==48)throw Error('Unexpected reviewed pilot scope; review new input before extending');
if(attachments.some(a=>a.attachment_body_acquired||a.ocr_used)||new Set(attachments.map(a=>a.attachment_url)).size!==attachments.length)throw Error('Attachment provenance mismatch');
const grouped=new Map();
for(const link of links){
 if(link.status!=='transcript_correspondence_verified'||link.attachment_relation_status!=='pending_original_document'||link.merge_records||link.sum_amounts)throw Error('Unreviewed business link');
 const c=records.find(r=>r.record_id===link.right_record_id),city=records.find(r=>r.record_id===link.left_record_id);
 if(!c||!city||c.document_stage!=='proposal_explained_in_minutes'||c.attachment_body_verified!==false||city.document_stage!=='published_budget'||c.account!==null)throw Error('Invalid linked source stage');
 for(const key of ['year','budget_type','revision','department','institution_id','source_scope'])if(c[key]!==city[key])throw Error('Business link scope mismatch: '+key);
 if(c.source_scope!=='municipal'||c.institution_id!=='seongnam'||c.year!==2026||c.budget_type!=='본예산'||c.revision!==0)throw Error('Outside reviewed municipal pilot');
 const source=meetingSources.find(s=>s.source_id===c.source_id);
 if(!source||source.source_url!==c.source_url)throw Error('Missing meeting source');
 const transcript=await readFile(path.join(input,'council_catalog',c.source_id+'.txt'),'utf8');
 if(!transcript.includes(c.source_excerpt)||!c.source_excerpt.includes('설명자료 '+c.explanation_page_reported+'쪽'))throw Error('Exact quoted passage missing');
 if(!transcript.replace(/\s+/g,'').includes('이어서2026년도본예산안에대하여설명드리겠습니다.'))throw Error('Budget year context missing');
 const attachment=attachments.find(a=>a.attachment_url===c.attachment_url);
 if(!attachment||attachment.meeting_url!==c.source_url||attachment.budget_year!==c.year||attachment.budget_type!=='본예산안')throw Error('Attachment metadata mismatch');
 if(c.delta_krw!==city.delta_krw||c.amount_krw!==null&&c.amount_krw!==city.amount_krw)throw Error('Reviewed amount comparison changed');
 const cityEvidence=city.pdf_pages.map(page=>{
  const e=municipal.evidence.find(e=>e.document_id===city.source_id&&e.page===page);
  if(!e||e.sha256!==city.pdf_sha256||e.classification?.department!==city.department)throw Error('Missing city evidence');
  return{document_id:e.document_id,page:e.page,page_url:e.page_url,source_url:e.source_url,sha256:e.sha256,department:city.department,account:city.account,business_name:city.business_name,document_stage:city.document_stage};
 });
 const id=hash(c.source_url).slice(0,20);
 if(!grouped.has(id))grouped.set(id,{source,rows:[]});
 const aliases=[...new Set([city.business_name,c.business_name,...(city.source_label_fragments?.length>1?[city.source_label_fragments[0]]:[])])];
 const keywords=c.business_name.includes('산모')?['산모신생아','산모 신생아','산후관리','건강관리사']:c.business_name.includes('암환자')?['암환자','암 환자']:['성남시민건강박람회','시민건강박람회','건강박람회'];
 const embeddingText=c.year+'년 '+c.budget_type+' '+c.department+' '+city.business_name+'\n'+c.source_excerpt;
 const ids=enc.tokenize(embeddingText);await enc.ensure(ids);const vector=Array.from(enc.embed(ids));
 grouped.get(id).rows.push({page:grouped.get(id).rows.length+1,text:c.source_excerpt,embedding_text:embeddingText,vector,year:c.year,budget_type:c.budget_type,revision:c.revision,owner_source_scope:c.source_scope,institution_id:c.institution_id,department:c.department,account:null,city_account:city.account,business_name:c.business_name,canonical_business_name:city.business_name,aliases,keywords,document_stage:c.document_stage,explanation_page_reported:c.explanation_page_reported,attachment_url:c.attachment_url,attachment_body_verified:false,transcript_sha256:hash(Buffer.from(transcript)),text_line_start:c.text_line_start,city_evidence:cityEvidence,link:{...link,production_indexed:true},amounts:{proposal_total_krw:c.amount_krw,proposal_delta_krw:c.delta_krw,published_total_krw:city.amount_krw,published_delta_krw:city.delta_krw,comparison:link.total_amount_check,do_not_sum:true}});
}
await mkdir(out,{recursive:true});
for(const [id,{source,rows}] of grouped){
 const d={id,shard:id,title:'2026 본예산안 · 중원구보건소 건강증진과 · 제307회 문화복지체육위원회 제5차 회의록 검증 발언',year:2026,budget_type:'본예산',revision:0,category:COUNCIL_CATEGORY,url:source.source_url,source_scope:'council',institution_id:'seongnam',institution_name:'성남시',publisher:'성남시의회',meeting_date:source.meeting_date,sha256:source.source_sha256,status:'indexed_text',indexed_units:rows.length,indexed_blocks:rows.length,page_count:null,indexed_pages:0,locator_kind:'text_block',document_stage:'proposal_explained_in_minutes'};
 const data={schema_version:1,passages:rows};validateCouncilShard(d,data);
 const bytes=gzipSync(Buffer.from(JSON.stringify(data)));
 d.shard_sha256=hash(bytes);d.shard_bytes=bytes.length;
 await writeFile(path.join(out,id+'.json.gz'),bytes);documents.push(d);
 packedFiles.push({path:'council/'+id+'.json.gz',bytes:bytes.length,sha256:d.shard_sha256});
 passages.push(...rows.map(({text,embedding_text,vector,city_evidence,link,amounts,...p})=>({...p,document_id:id})));
}
const catalog={schema_version:1,generated_at:new Date().toISOString(),embedding:{model:semantic.model,revision:semantic.model_revision,dimensions:256,method:'native Potion token mean+L2, exact cosine flat sidecar',vectorized:true},summary:{captured_meetings:meetingSources.length,searchable_meetings:documents.length,searchable_passages:passages.length,attachment_metadata:attachments.length,attachment_bodies_indexed:0,business_links:links.length,ocr_used:false,coverage_complete:false},documents,passages,meetings:meetingSources.map(s=>({source_url:s.source_url,meeting_date:s.meeting_date,sha256:s.source_sha256,acquisition_status:s.acquisition_status})),attachments:attachments.map(({meeting_html_sha256,captured_utc,...a})=>a),source_package_hashes:Object.fromEntries(await Promise.all(['budget_records.json','business_links.json','municipal_evidence.json','sources.json','council_catalog/catalog.json'].map(async f=>[f,hash(await readFile(path.join(input,f)))])))};
await writeFile(path.join(out,'catalog.json'),JSON.stringify(catalog,null,2)+'\n');
const assets=await readJson(path.join(root,'snapshot/assets.json'));
assets.files=[...assets.files.filter(f=>!f.path.startsWith('council/')),...packedFiles];
await writeFile(path.join(root,'snapshot/assets.json'),JSON.stringify(assets,null,2)+'\n');
if(hash(await readFile('snapshot/catalog.json'))!==hash(baseCatalog)||hash(await readFile('snapshot/semantic/manifest.json'))!==hash(baseManifest))throw Error('Municipal index unexpectedly changed');
console.log(JSON.stringify(catalog.summary));
