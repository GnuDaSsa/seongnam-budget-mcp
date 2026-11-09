import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveQuery,isMunicipalTotal,totalAnswerCard,sourceFamily,sourceAllowed} from '../worker/policy.js';
test('omitted year is fixed at 2026, explicit old and relative years survive',()=>{
 assert.equal(resolveQuery({query:'노인일자리 얼마야'}).year,2026);
 assert.equal(resolveQuery({query:'2007년 도서관'}).year,2007);
 assert.equal(resolveQuery({query:'도서관',year:2024}).year,2024);
 assert.equal(resolveQuery({query:'작년 도서관'}).year,2025);
 assert.equal(resolveQuery({query:'내년 예산'}).year,2027);
});
test('source family is independent of phase and explicit intents survive',()=>{
 const plan={title:'2026 성과계획서',category:'성과계획서',budget_type:'본예산'};
 assert.equal(sourceFamily(plan),'performance');
 assert(!sourceAllowed(plan,resolveQuery({query:'청년월세지원사업 통계목'})));
 assert(sourceAllowed(plan,resolveQuery({query:'청년월세지원사업 성과지표'})));
 assert.equal(resolveQuery({query:'판교 연구센터 통계목'}).budget_type,undefined);
 assert.equal(resolveQuery({query:'제1회 추경 연구센터 통계목'}).budget_type,'추경');
 assert.equal(resolveQuery({query:'연구센터 결산'}).policy.source_preference,'explicit');
 assert.equal(resolveQuery({query:'지방세 세입'}).policy.source_preference,'revenue');
 assert.equal(resolveQuery({query:'본예산과 성과계획서 비교'}).policy.source_preference,'mixed');
 const mixed=resolveQuery({query:'본예산과 성과계획서 비교'});
 assert(sourceAllowed(plan,mixed));assert(sourceAllowed({budget_type:'본예산'},mixed));assert(!sourceAllowed({budget_type:'추경'},mixed));assert(!sourceAllowed({budget_type:'결산'},mixed));
 const settled=resolveQuery({query:'결산과 성과계획서 비교'});assert(sourceAllowed(plan,settled));assert(sourceAllowed({budget_type:'결산'},settled));assert(!sourceAllowed({budget_type:'본예산'},settled));
 assert(sourceAllowed(plan,resolveQuery({query:'청년월세지원사업',category:'성과계획서'})));
 assert.equal(resolveQuery({query:'청년월세 성과계획서',budget_type:'추경'}).budget_type,'추경');
});
test('all years requires explicit intent and cannot silently override a year',()=>{
 assert.equal(resolveQuery({query:'모든 예산'}).year,2026);
 assert.equal(resolveQuery({query:'역대 도서관 예산'}).year,undefined);
 assert.equal(resolveQuery({query:'도서관',year_scope:'all'}).policy.all_years,true);
 assert.throws(()=>resolveQuery({query:'도서관',year:2026,year_scope:'all'}));
});
test('comparison ranges retain each year and bound server work',()=>{
 assert.deepEqual(resolveQuery({query:'2024~2026년 도서관 비교'}).policy.years,[2024,2025,2026]);
 assert.deepEqual(resolveQuery({query:'2024년과 2026년 비교'}).policy.years,[2024,2026]);
 assert.throws(()=>resolveQuery({query:'2007~2026년 비교'}));
});
test('budget kinds and supplementary revision are inferred without collapsing comparisons',()=>{
 assert.equal(resolveQuery({query:'2024년 결산'}).budget_type,'결산');
 assert.equal(resolveQuery({query:'제2회 추경 노인일자리'}).revision,2);
 assert.equal(resolveQuery({query:'본예산과 성과계획서 비교'}).budget_type,undefined);
});
test('municipal fast path does not swallow a department or business total',()=>{
 assert(isMunicipalTotal('성남시 예산 얼마야?'));
 assert(isMunicipalTotal('2026년 본예산 총규모'));
 assert(!isMunicipalTotal('청년 월세 예산 얼마야?'));
 assert(!isMunicipalTotal('도서관 전체 예산'));
});
test('answer card requires source unit and a reconciled total',()=>{
 const e={text:'합 계 100\n일반회계 70\n특별회계 30',unit:'천원',year:2026,id:'test',page_url:'https://www.seongnam.go.kr/example.pdf#page=1'};
 assert.equal(totalAnswerCard(e).rows[0].amount_krw,100000);
 assert.equal(totalAnswerCard({...e,unit:'백만원'}),null);
 assert.equal(totalAnswerCard({...e,text:e.text.replace('100','99')}),null);
});
