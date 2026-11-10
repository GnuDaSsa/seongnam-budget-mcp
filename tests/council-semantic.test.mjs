import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {createEncoder} from '../worker/semantic.js';
import {createCouncilReader} from '../worker/council.js';
import {resolveQuery} from '../worker/policy.js';
import {institutionScope} from '../worker/affiliates.js';
import worker from '../dist/server/index.js';
const root=path.resolve('snapshot');
const env={ASSETS:{async fetch(req){const p=path.resolve(root,'.'+new URL(req.url).pathname);if(!p.startsWith(root+path.sep))throw Error('Invalid test asset path');return new Response(await readFile(p));}}};
const catalog=JSON.parse(await readFile('snapshot/council/catalog.json','utf8'));
const resolve=query=>{const a=resolveQuery({query,mode:'vector',limit:3});a.policy.institution_scope=institutionScope(query,[]);return a;};
async function research(query,extras={}){const r=await worker.fetch(new Request('https://test.local/api/research?'+new URLSearchParams({query,year:2026,...extras})),env);assert.equal(r.status,200);return r.json();}
test('stored council vectors are reproducible native Potion embeddings, municipal index unchanged',async()=>{
 const enc=await createEncoder(env);let count=0;
 for(const d of catalog.documents){const data=JSON.parse(gunzipSync(await readFile('snapshot/council/'+d.shard+'.json.gz')));for(const p of data.passages){const ids=enc.tokenize(p.embedding_text);await enc.ensure(ids);const v=enc.embed(ids);assert(Math.max(...v.map((x,i)=>Math.abs(x-p.vector[i])))<1e-6);count++;}}
 assert.equal(count,3);assert.equal(catalog.summary.attachment_bodies_indexed,0);
 const semantic=JSON.parse(await readFile('snapshot/semantic/manifest.json','utf8'));
 assert.equal(catalog.embedding.model,semantic.model);assert.equal(catalog.embedding.revision,semantic.model_revision);
 assert.equal(createHash('sha256').update(await readFile('snapshot/catalog.json')).digest('hex'),semantic.corpus_catalog_sha256);
});
test('council cosine retrieves paraphrased explanations and rejects unrelated questions',async()=>{
 const reader=createCouncilReader(catalog);
 for(const [query,expected] of [['출산 가정에 건강관리사를 보내 산후 회복을 돕는 사업','산모신생아'],['암환자 치료비를 지원하는 사업','암환자']]){
  const hits=await reader.search(env,resolve(query));assert(hits.length>0,query);assert(hits[0].business_name.includes(expected));assert.equal(hits[0].retrieval_scores.vectorized,true);assert(hits[0].retrieval_scores.cosine>=0.55);
 }
 for(const query of ['도서관','노인일자리','아이를 맡기는 시설 지원','분당구 산모신생아','산모신생아 추가형'])assert.deepEqual(await reader.search(env,resolve(query)),[],query);
});
test('built MCP returns city first with accurately labeled council text and stable raw fetch',async()=>{
 const r=await research('성남시민건강박람회');assert.equal(r.evidence[0].source_scope,'municipal');
 const c=r.evidence.find(e=>e.source_scope==='council');assert(c);assert.equal(c.pdf_page,null);assert.equal(c.explanation_page_reported,88);assert.equal(c.account,null);assert.equal(c.attachment_body_verified,false);assert.equal(c.document_stage,'proposal_explained_in_minutes');assert.equal(c.business_link.production_indexed,true);
 assert(c.business_link.matched_city_evidence_ids.includes(r.evidence[0].id),'whole PDF and departmental PDF connect through business path');
 const response=await worker.fetch(new Request('https://test.local/api/page?'+new URLSearchParams({document_id:c.document_id,page:c.page})),env);const p=await response.json();assert.equal(p.text,c.text);assert.equal(p.page_url,c.source_url);
 for(const query of ['시청 자료만 성남시민건강박람회','2026년 제3회 추경 성남시민건강박람회','분당구보건소 성남시민건강박람회','보건행정과 성남시민건강박람회','특별회계 성남시민건강박람회']){
  const negative=await research(query,{mode:'lexical'});assert(!negative.evidence.some(e=>e.source_scope==='council'),query);
 }
 const status=await (await worker.fetch(new Request('https://test.local/api/status'),env)).json();assert.equal(status.council.searchable_passages,3);assert.equal(status.council.attachment_metadata,48);assert.equal(status.council.attachment_bodies_indexed,0);
});
test('natural language explanations hydrate reviewed city anchors rather than unrelated vector pages',async()=>{
 for(const [query,pages] of [['성남시민건강박람회 편성 이유 의회 설명',[39]],['중원구 산모신생아 건강관리 지원사업 전환형 본예산 설명',[577,578]],['중원구 암환자 의료비 감소 이유',[582]],['성남시민건강박람회 예산과 편성 이유',[39]]]){
  const r=await research(query),city=r.evidence.filter(e=>e.source_scope==='municipal'),c=r.evidence.find(e=>e.source_scope==='council');
  assert(c,query);assert.deepEqual(city.map(e=>e.page),pages,query);assert.equal(r.evidence[0].source_scope,'municipal');
  assert(city.every(e=>e.verified_council_anchor.department==='중원구보건소건강증진과'));assert.deepEqual(c.business_link.matched_city_evidence_ids,city.map(e=>e.id));
  assert(c.business_link.matched_city_evidence.every(e=>e.basis==='verified_source_anchor'));
 }
 const excluded=await research('복지정책과 암환자 의료비');assert(!excluded.evidence.some(e=>e.source_scope==='council'));
});
