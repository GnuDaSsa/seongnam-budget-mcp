import test from 'node:test';
import assert from 'node:assert/strict';
import {editionTimelineEligible,editionsFor,lineRank,matchedLine,rankEditionHits,pickEditionHit,chooseConsistentHits,mergeEditionEvidence,editionTimeline} from '../worker/edition-timeline.js';
import {retrievalWords} from '../worker/retrieval-phrases.js';

const base={year:2025,year_scope:'single',policy:{years:[2025],institution_scope:{mode:'municipal'},source_preference:'expenditure',excluded_budget_types:[]}};

test('편성 비교·변화 표현과 상대 연도는 필수 검색어로 남지 않는다',()=>{
 assert.deepEqual(retrievalWords('2025년 청년월세 지원 예산 본예산이랑 추경 비교해줘'),['청년월세','지원']);
 assert.deepEqual(retrievalWords('작년 추경 공원 조성 예산'),['공원','조성']);
 assert.deepEqual(retrievalWords('2024년 청년월세 본예산 대비 추경 변화'),['청년월세']);
 assert.deepEqual(retrievalWords('2023년 3차 추경 공공근로 얼마나 늘었어'),['공공근로']);
 assert.deepEqual(retrievalWords('2025년 제2회 추가경정예산 청년월세'),['청년월세']);
 assert.deepEqual(retrievalWords('2021년 경로당 전월세보증금 예산 얼마야?'),['경로당','전월세보증금']);
});

test('편성을 특정하지 않은 단일 연도 세출 사업 질문만 회차별 근거 대상이다',()=>{
 assert.equal(editionTimelineEligible(base,['청년월세']),true);
 assert.equal(editionTimelineEligible({...base,budget_type:'추경'},['청년월세']),true,'추경만 말하고 회차가 없으면 모든 회차');
 assert.equal(editionTimelineEligible({...base,budget_type:'본예산'},['청년월세']),false,'본예산을 명시하면 그 범위를 따른다');
 assert.equal(editionTimelineEligible({...base,budget_type:'추경',revision:2},['청년월세']),false);
 assert.equal(editionTimelineEligible({...base,year_scope:'all'},['청년월세']),false);
 assert.equal(editionTimelineEligible({...base,policy:{...base.policy,years:[2024,2025]}},['청년월세']),false);
 assert.equal(editionTimelineEligible({...base,policy:{...base.policy,source_preference:'performance'}},['청년월세']),false);
 assert.equal(editionTimelineEligible({...base,policy:{...base.policy,excluded_budget_types:['추경']}},['청년월세']),false);
 assert.equal(editionTimelineEligible(base,[]),false,'사업 낱말이 없으면 회차별로 찾을 대상이 없다');
});

test('편성 목록은 본예산 먼저, 추경 회차 순이며 세출명세서만 본다',()=>{
 const docs=[
  {year:2025,budget_type:'추경',revision:3,title:'세출'},{year:2025,budget_type:'본예산',revision:null,title:'세출'},
  {year:2025,budget_type:'추경',revision:1,title:'세출'},{year:2025,budget_type:'추경',revision:1,title:'세출 중복'},
  {year:2025,budget_type:'추경',revision:2,title:'세입'},{year:2024,budget_type:'추경',revision:4,title:'세출'},{year:2025,budget_type:'결산',title:'세출'},
 ];
 const family=d=>d.title.startsWith('세출')?'expenditure':'revenue';
 assert.deepEqual(editionsFor(docs,base,{family}).map(e=>e.edition),['본예산','1회 추경','3회 추경']);
 assert.deepEqual(editionsFor(docs,{...base,budget_type:'추경'},{family}).map(e=>e.edition),['1회 추경','3회 추경']);
});

test('사업 행을 산출내역·집계표·반납 줄보다 앞에 둔다',()=>{
 const w=['청년월세'];
 assert.equal(lineRank('청년월세한시특별지원 1,500,000 1,440,000 60,000',w),0);
 assert.equal(lineRank('○청년월세한시특별지원 720,000,000원 720,000',w),1);
 assert.equal(lineRank('공공근로사업 595,000 595,000 0 0.00%',['공공근로']),2);
 assert.equal(lineRank('○2024년국비청년월세한시특별지원사업 집행잔액및이자반납 299,940원 300 0 300',w),3);
 assert.equal(lineRank('경로당임차 81,600 61,600 20,000',['경로당','전월세보증금']),10,'일부 낱말만 든 줄은 모든 낱말이 든 줄보다 뒤');
 assert.equal(lineRank('도서관 운영',w),null);
 assert.equal(matchedLine('머리말\n○청년월세 반납 300 0 300\n청년월세지원 4,020,578 1,440,000 2,580,578',w),'청년월세지원 4,020,578 1,440,000 2,580,578');
});

test('회차 후보는 사업 행이 보이는 쪽을 먼저 고른다',()=>{
 const results=[
  {gid:1,exact_match:true,excerpt:'○2024년도비청년월세한시특별지원사업 집행잔액및이자반납 49,577 0 49,577'},
  {gid:2,business_match:true,excerpt:'청년월세한시특별지원 2,920,200 1,500,000 1,420,200'},
 ];
 assert.equal(pickEditionHit(results,['청년월세']).hit.gid,2);
 assert.equal(pickEditionHit([], ['청년월세']),null);
 assert.deepEqual(rankEditionHits(results,['청년월세']).map(x=>x.match),['business_terms','exact']);
});

test('기준 부서 행을 회차마다 우선하고, 부서 미상 집계표만 있으면 흐름에 넣지 않는다',()=>{
 const c=(gid,department,rank=0)=>({hit:{gid},match:'exact',rank,department});
 const picks=chooseConsistentHits([
  {edition:'본예산',budget_type:'본예산',candidates:[c(1,'중원구사회복지과')]},
  {edition:'3회 추경',budget_type:'추경',candidates:[c(2,'분당구사회복지과'),c(3,'중원구사회복지과',1)]},
  {edition:'4회 추경',budget_type:'추경',candidates:[c(4,null,2)]},
  {edition:'5회 추경',budget_type:'추경',candidates:[c(5,'수정구사회복지과')]},
  {edition:'1회 추경',budget_type:'추경',candidates:[]},
 ]);
 assert.equal(picks[1].hit.gid,3,'같은 부서 행 우선');
 assert.equal(picks[2].hit,undefined);assert.equal(picks[2].unanchored,true);
 assert.equal(picks[3].hit.gid,5);assert.equal(picks[3].department_consistent,false,'다른 부서밖에 없으면 표시');
 assert.equal(picks[4].hit,undefined);
});

test('회차별 근거를 앞에 두고 중복 없이 합치며, 부서가 섞이면 알린다',()=>{
 const E=(id,budget_type,revision=null)=>({id,budget_type,revision});
 const weak=mergeEditionEvidence([E('a','본예산'),E('b','추경',2)],[E('b','추경',2),E('c','본예산'),E('d','본예산'),E('e','본예산'),E('f','본예산'),E('g','본예산')],{foundFirst:false,cap:6});
 assert.deepEqual(weak.map(e=>e.id),['a','b','c','d','e','f'],'약한 기존 근거 앞에 회차 근거');
 const strong=mergeEditionEvidence([E('x','본예산'),E('y','추경',2),E('z','추경',3)],[E('a','본예산'),E('b','추경',3)],{cap:8});
 assert.equal(mergeEditionEvidence([E('y','추경',2)],[E('a','본예산'),E('b','본예산')],{cap:2}).length,2,'요청 근거 수를 넘지 않음');
 assert.deepEqual(strong.map(e=>e.id),['a','b','y'],'확인된 기존 근거 순서를 지키고 빠진 회차만 덧붙임');
 const t=editionTimeline(2025,[
  {edition:'본예산',budget_type:'본예산',revision:null,match:'exact',department:'청년청소년과',evidence:{document_id:'d1',page:357,page_url:'u#page=357',text:'청년월세한시특별지원 1,440,000 0 1,440,000'}},
  {edition:'1회 추경',budget_type:'추경',revision:1},
  {edition:'2회 추경',budget_type:'추경',revision:2,match:'exact',department:'청년청소년과',evidence:{document_id:'d2',page:70,page_url:'u#page=70',text:'청년월세한시특별지원 1,500,000 1,440,000 60,000'}},
 ],['청년월세']);
 assert.equal(t.found_editions,2);assert.equal(t.searched_editions,3);assert.equal(t.latest_found_edition,'2회 추경');
 assert.equal(t.departments_differ,false);assert.equal(t.editions[1].found,false);
 assert.equal(t.editions[2].matched_line,'청년월세한시특별지원 1,500,000 1,440,000 60,000');
 assert.match(t.note,/0원이나 사업 부재로 단정하지/);
 const mixed=editionTimeline(2025,[{edition:'본예산',budget_type:'본예산',department:'A과',evidence:{text:''}},{edition:'1회 추경',budget_type:'추경',revision:1,department:'B과',evidence:{text:''}}],['x']);
 assert.equal(mixed.departments_differ,true);assert.match(mixed.note,/부서가 다른 행을 한 사업의 증감 흐름으로 잇지/);
});
