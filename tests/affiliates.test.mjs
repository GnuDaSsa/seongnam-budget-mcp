import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {institutionScope,eligibleAffiliateDocuments,createAffiliateReader,mergeCityFirst} from '../worker/affiliates.js';
import {resolveQuery} from '../worker/policy.js';
const institutions=[{id:'youth',name:'성남시청소년청년재단',aliases:['청소년재단']},{id:'culture',name:'성남문화재단',aliases:['문화재단']}];
const resolve=query=>{const a=resolveQuery({query});a.limit=4;a.policy.institution_scope=institutionScope(query,institutions);return a;};
test('default scope is city only regardless of broad or historical wording',()=>{
 for(const q of ['청소년 예산','전체 예산','역대 예산','모든 예산'])assert.equal(resolve(q).policy.institution_scope.mode,'municipal');
 assert.deepEqual(resolve('산하기관도 포함해서 청소년 예산').policy.institution_scope.institution_ids,['youth','culture']);
 assert.deepEqual(resolve('산하기관까지 알려줘').policy.institution_scope.institution_ids,['youth','culture']);
 assert.deepEqual(resolve('출자기관 예산도 포함').policy.institution_scope.institution_ids,['youth','culture']);
 assert.deepEqual(resolve('성남문화재단 예산').policy.institution_scope.institution_ids,['culture']);
});
test('exclusions and explicit city-only intent override institution name detection',()=>{
 for(const q of ['출연기관 제외하고 청소년 예산','산하기관 자료는 제외하고 예산','시청 예산서에 있는 문화재단 출연금만','성남시 자료만 문화재단','시 예산만 문화재단'])assert.equal(resolve(q).policy.institution_scope.mode,'municipal',q);
 assert.deepEqual(resolve('문화재단 빼고 산하기관 포함').policy.institution_scope.institution_ids,['youth']);
 assert.equal(resolve('문화재단 예산 제외하고 청소년 예산').policy.institution_scope.mode,'municipal');
 assert.equal(resolve('성남문화재단 자체 예산은 제외하고 청소년 예산').policy.institution_scope.mode,'municipal');
 assert.equal(resolve('성남문화재단 자체 예산은 제외하고 청소년 예산').policy.institution_scope.city_retrieval_query,'청소년 예산');
 assert.equal(resolve('산하기관 포함하지 않고 청소년 예산').policy.institution_scope.city_retrieval_query,'청소년 예산');
 assert.equal(resolve('청소년 예산').policy.institution_scope.mode,'municipal');
});
test('scope instructions are removed from retrieval terms, original question remains',()=>{
 const a=resolve('2026년 산하기관도 포함해서 청소년 예산');
 assert.equal(a.query,'2026년 산하기관도 포함해서 청소년 예산');
 assert.equal(a.policy.institution_scope.retrieval_query,'2026년 청소년 예산');
 const b=resolve('성남문화재단 예산');assert.equal(b.policy.institution_scope.retrieval_query,'예산');assert.equal(b.policy.institution_scope.city_retrieval_query,'성남문화재단 예산');
});
const documents=institutions.map((i,n)=>({id:String(n+1).repeat(20),shard:String(n+1).repeat(20),institution_id:i.id,institution_name:i.name,title:i.name+' 2026 본예산 총괄표',year:2026,budget_type:'본예산',source_scope:'affiliate',detail_level:'summary',url:'https://example.org/'+i.id+'.pdf'}));
test('sidecar is never fetched without explicit scope, named results retain attribution',async()=>{
 let reads=[];const env={ASSETS:{fetch:async req=>{reads.push(req.url);return new Response(gzipSync(JSON.stringify({pages:[{page:1,text:'청소년 사업 예산 1,000\n문화 사업 예산 2,000',unit:'천원'}]})));}}};
 const reader=createAffiliateReader({institutions,documents});
 assert.deepEqual(await reader.search(env,resolve('청소년 예산')),[]);assert.equal(reads.length,0);
 const hits=await reader.search(env,resolve('문화재단 예산'));assert.equal(reads.length,1);assert.equal(hits.length,1);assert.equal(hits[0].institution_id,'culture');assert.equal(hits[0].detail_level,'summary');assert.equal(hits[0].retrieval_scores.vectorized,false);
 const p=await reader.page(env,hits[0].document_id,1);assert.equal(p.institution_name,'성남문화재단');assert.equal(p.text_is_complete,true);assert.equal(p.pdf_page,1);
 await reader.search(env,resolve('청소년 예산'));assert.equal(reads.length,2,'default request after an expanded one does not reuse expanded scope');
 assert.equal((await reader.search(env,resolve('문화재단 예산만'))).length,1);
});
test('latest supplementary budgets are chosen per institution',()=>{
 const docs=[{...documents[0],budget_type:'추경',revision:1},{...documents[0],budget_type:'추경',revision:2},{...documents[1],budget_type:'추경',revision:1}];
 const a=resolve('최신 추경 산하기관 포함');assert.deepEqual(eligibleAffiliateDocuments({documents:docs},a).map(d=>[d.institution_id,d.revision]),[['youth',2],['culture',1]]);
 const old={...documents[0],year:2025,budget_type:'추경',revision:1},all=resolve('역대 최신 추경 산하기관 포함');assert(eligibleAffiliateDocuments({documents:[...docs,old]},all).includes(old));
});
test('expanded results reserve affiliate evidence while keeping city first without adding amounts',()=>{
 const city=[{id:'c1'},{id:'c2'},{id:'c3'},{id:'c4'}],others=[{id:'a1'},{id:'a2'}];
 assert.deepEqual(mergeCityFirst(city,others,4).map(x=>x.id),['c1','c2','a1','a2']);
 assert.deepEqual(mergeCityFirst(city,others,1).map(x=>x.id),['c1']);
 assert.deepEqual(mergeCityFirst(city,[],4),city);
});
