import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {councilAllowed,createCouncilReader,matchingCityEvidence,mergeCouncilLast,normalizeBusiness,validateCouncilShard} from '../worker/council.js';
import {resolveQuery} from '../worker/policy.js';
import {institutionScope} from '../worker/affiliates.js';

const resolve=query=>{const a=resolveQuery({query});a.limit=4;a.mode='lexical';a.policy.institution_scope=institutionScope(query,[]);return a;};
const p={page:1,document_id:'a'.repeat(20),year:2026,budget_type:'본예산',revision:0,owner_source_scope:'municipal',institution_id:'seongnam',department:'중원구보건소건강증진과',city_account:'일반회계',account:null,text:'설명자료 67쪽 산모신생아 건강관리 지원사업(전환형)입니다.',business_name:'산모신생아 건강관리 지원사업(전환형)',canonical_business_name:'산모신생아건강관리지원사업(전환사업)',aliases:['산모신생아 건강관리 지원사업(전환형)'],keywords:['산모신생아','건강관리사'],vector:[1,...Array(255).fill(0)],document_stage:'proposal_explained_in_minutes',attachment_body_verified:false,explanation_page_reported:67,transcript_sha256:'b'.repeat(64),city_evidence:[{source_url:'https://www.seongnam.go.kr/budget.pdf',page:577}],link:{status:'transcript_correspondence_verified',attachment_relation_status:'pending_original_document'}};
const d={id:p.document_id,shard:p.document_id,indexed_blocks:1,title:'의회 검증 발언',url:'https://www.sncouncil.go.kr/record/recordView.do?key=test',sha256:'c'.repeat(64),meeting_date:'2025-12-08'};
test('council passages enforce budget year, edition, owner, account and department restrictions',()=>{
 assert(councilAllowed(p,resolve('2026년 중원구보건소 산모신생아 본예산')));
 assert(councilAllowed(p,resolve('산모신생아 예산과 편성 이유')));
 assert(councilAllowed(p,resolve('성남시민건강박람회 예산과 편성 이유')));
 for(const query of ['복지정책과 암환자 의료비','여성가족과 암환자 의료비','예산과 소관 암환자'])assert.equal(councilAllowed(p,resolve(query)),false,query);
 for(const query of ['2025년 산모신생아','2026년 제3회 추경 산모신생아','분당구보건소 산모신생아','수정구 산모신생아','보건행정과 산모신생아','감염병관리센터 산모신생아','특별회계 산모신생아','시청 자료만 산모신생아','의회 자료 제외 산모신생아','산모신생아 성과계획','산모신생아 세입 예산','산모신생아 추가형'])assert.equal(councilAllowed(p,resolve(query)),false,query);
 assert.equal(councilAllowed({...p,owner_source_scope:'affiliate'},resolve('산모신생아')),false);
 assert.equal(councilAllowed({...p,institution_id:'scmc'},resolve('산모신생아')),false);
 assert.notEqual(normalizeBusiness('산모신생아(추가형)'),normalizeBusiness('산모신생아(전환형)'));
});
test('only acquired reviewed passages are searchable; unavailable attachment metadata is never fetched',async()=>{
 let urls=[];const env={ASSETS:{fetch:async request=>{urls.push(request.url);return new Response(gzipSync(JSON.stringify({passages:[p]})));}}};
 const reader=createCouncilReader({documents:[d],passages:[p],attachments:[{attachment_url:'https://invalid.example/file.pdf',document_title:'도서관 설명자료',attachment_body_acquired:false}]});
 assert.deepEqual(await reader.search(env,resolve('2025년 산모신생아')),[]);assert.equal(urls.length,0);
 assert.deepEqual(await reader.search(env,resolve('도서관 설명자료')),[]);
 const hits=await reader.search(env,resolve('산모신생아'));
 assert.deepEqual(await reader.anchorRequests(env,[hits[0],{...hits[0],canonical_business_name:'성남시민건강박람회추진'}]),[],'multi-business query does not collapse to a single curated anchor');
 assert.equal(hits.length,1);assert.equal(hits[0].source_scope,'council');assert.equal(hits[0].document_stage,'proposal_explained_in_minutes');
 const e=await reader.page(env,d.id,1);assert.equal(e.pdf_page,null);assert.equal(e.locator_kind,'text_block');assert.equal(e.explanation_page_reported,67);assert.equal(e.account,null);assert.equal(e.page_url,d.url);assert.equal(e.attachment_body_verified,false);
 assert(urls.every(url=>url.startsWith('https://assets.local/council/')));
 await assert.rejects(reader.page(env,d.id,67),/블록은 색인에 없습니다/);
});
test('business linking recognizes alternative PDF copies but not other businesses on a page',()=>{
 const city={id:'different-pdf:p20',source_scope:'municipal',year:2026,budget_type:'본예산',revision:null,account:'일반회계',classification:{department:p.department,matched_paths:[{detailed_business:p.canonical_business_name}]}};
 assert.deepEqual(matchingCityEvidence(p,[city]),[city.id]);
 for(const different of [{year:2025},{revision:3},{account:'특별회계'},{source_scope:'affiliate'},{classification:{department:'분당구보건소건강증진과',matched_paths:city.classification.matched_paths}},{classification:{department:p.department,matched_paths:[{detailed_business:'산모신생아건강관리지원사업(추가형)'}]}},{classification:{department:p.department,matched_paths:[]}}])assert.deepEqual(matchingCityEvidence(p,[{...city,...different}]),[]);
});
test('city evidence stays first, no inferred sums or overwritten source stage',()=>{
 const city=[{id:'city1'},{id:'city2'}],council=[{id:'council1'}];
 assert.deepEqual(mergeCouncilLast(city,council,3).map(e=>e.id),['city1','city2','council1']);
 assert.deepEqual(mergeCouncilLast(city,council,1).map(e=>e.id),['city1']);
 assert.deepEqual(mergeCouncilLast([],council,2),council);
});
test('malformed vectors and acquired-attachment claims fail ingestion validation',()=>{
 validateCouncilShard(d,{passages:[p]});
 for(const patch of [{vector:Array(256).fill(0)},{vector:[1]},{vector:[NaN,...Array(255).fill(0)]},{attachment_body_verified:true},{account:'일반회계'},{document_stage:'approved'}])assert.throws(()=>validateCouncilShard(d,{passages:[{...p,...patch}]}));
});
