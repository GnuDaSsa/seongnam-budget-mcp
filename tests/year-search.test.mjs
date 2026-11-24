import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import worker from '../dist/server/index.js';
import {directYearHit} from '../worker/year-search.js';
test('이전 연도 판정은 제목의 회계·세입 범위와 본문의 항목을 함께 확인한다',()=>{
 const scope={year:2024,query:'상수도 급수공사 수수료 세입',departments:[],policy:{source_preference:'revenue',institution_scope:{city_retrieval_query:'상수도 급수공사 수수료 세입'}}};
 const hit={year:2024,title:'상수도공기업특별회계 세입예산사업명세서',text:'○ 급수공사 수수료  1,000'};
 assert(directYearHit(hit,scope));
 assert(!directYearHit({...hit,title:'하수도 세입예산사업명세서'},scope));
});

const env={ASSETS:{async fetch(req){
 const path=new URL(req.url).pathname;
 return new Response(await readFile(resolve('snapshot','.'+path)));
}}};
async function call(tool,query,options={},environment=env){
 const request=new Request('https://test.local/public-mcp',{method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:tool,arguments:{query,...options}}})});
 const {result}=await (await worker.fetch(request,environment)).json();
 assert.equal(result.isError,false,result.content?.[0]?.text?.slice(0,150));
 return result.structuredContent;
}
test('연도 생략 시 가장 최근 사업 근거를 찾을 때까지 내림차순으로 원문을 확인한다',async()=>{
 for(const [query,year,revision] of [['여성플러스센터설치공사',2024,2],['구미교난간화단조성및꽃식재',2021,3]]){
  const r=await call('budget_research',query,{mode:'lexical',limit:1});
  assert.equal(r.query_interpretation.year_search.matched_year,year);
  assert.deepEqual(r.query_interpretation.year_search.searched_years,Array.from({length:2027-year},(_,i)=>2026-i));
  assert.equal(r.evidence[0].year,year);
  assert.equal(r.evidence[0].revision,revision);
  assert.match(r.next_action,new RegExp(year+'년'));
 }
});
test('상세 검색과 호환 도구도 과거 원문을 반환하며 명시 연도와 본예산은 유지한다',async()=>{
 const query='여성플러스센터설치공사';
 for(const name of ['search_budget','build_rag_context','search']){
  const r=await call(name,query,name==='search'?{}:{mode:'lexical'});
  if(name==='search')assert.match(r.results[0].url,/2024/);
  else {
   assert.equal(r.query_interpretation.year_search.matched_year,2024);
   assert.equal((r.results||r.evidence)[0].year,2024);
  }
 }
 const main=await call('budget_research',query,{mode:'lexical',budget_type:'본예산'});
 assert.equal(main.query_interpretation.year_search.matched_year,2024);
 assert(main.evidence.every(e=>e.budget_type==='본예산'));
 const pinned=await call('budget_research','2026년 '+query,{mode:'lexical'});
 assert.equal(pinned.query_interpretation.year_search,undefined);
 assert(pinned.evidence.every(e=>e.year===2026));
});
test('완전 미일치도 수록 연도 전체를 점검하고 금액을 확정하지 않는다',async()=>{
 const r=await call('budget_research','zzxxxyyy123456',{mode:'lexical'});
 assert.equal(r.query_interpretation.year_search.matched_year,null);
 assert(r.query_interpretation.year_search.searched_years.at(-1)<=2008);
 assert.equal(r.answer_card,undefined);
});
test('부서의 미확인 사업은 이전 연도마다 부서 전체 명세서를 다시 읽지 않는다',async()=>{
 const historicalText=[];
 const observed={ASSETS:{fetch(req){
  const file=new URL(req.url).pathname;
  if(/\/text-(?:19\d\d|20[01]\d|202[0-5])-/.test(file))historicalText.push(file);
  return env.ASSETS.fetch(req);
 }}};
 const r=await call('budget_research','노인복지과 zzxxxyyy123456',{mode:'lexical',limit:1},observed);
 assert.equal(r.query_interpretation.year_search.matched_year,null);
 assert.equal(r.department_overview,null);
 assert.equal(r.verification_status.business,'not_verified');
 assert.deepEqual(historicalText,[]);
});
