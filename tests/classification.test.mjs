import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {budgetClassification} from '../worker/classification.js';
import {resolveQuery} from '../worker/policy.js';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/youth-budget-page345.json',import.meta.url),'utf8'));
test('real multi-business page keeps the correct unit and accounting codes',()=>{
 const r=budgetClassification(fixture.text,fixture);
 assert.equal(r.department,'청년청소년과');assert.equal(r.policy_business,'청년복지증진');
 const rent=r.paths.find(x=>x.detailed_business==='청년월세지원사업');
 assert(rent);assert.equal(rent.unit_business,'청년생활안정지원');
 assert.deepEqual(rent.appropriation,{code:'301',name:'일반보전금'});
 assert.deepEqual(rent.statistical_item,{code:'01',name:'사회보장적수혜금(국고보조재원)'});
 const interest=r.paths.find(x=>x.statistical_item.code==='08');
 assert.equal(interest.detailed_business,'청년주거복지지원');assert.equal(interest.appropriation.code,'307');
 assert.equal(interest.statistical_item.name,'이차보전금');
 assert(r.paths.some(x=>x.unit_business==='청년역량지원'&&x.appropriation.code==='207'));
});
test('unsupported layouts and plans never fabricate appropriation codes',()=>{
 assert.deepEqual(budgetClassification('청년월세지원사업 4,021 백만원').paths,[]);
 assert.equal(resolveQuery({query:'청년월세 세부사업과 예산 목'}).policy.source_preference,'expenditure');
 assert.equal(resolveQuery({query:'성과계획서의 세부사업'}).policy.source_preference,'performance');
});
test('matched paths identify only the requested business and preserve source rows',()=>{
 const r=budgetClassification(fixture.text,fixture,'청년월세지원사업 통계목 보여줘');
 assert.equal(r.matched_paths.length,1);const p=r.matched_paths[0];
 assert.equal(p.detailed_business,'청년월세지원사업');assert.equal(p.combined_code,'301-01');
 assert.match(p.source_excerpt,/4,020,578/);assert.equal(fixture.text.split('\n')[p.source_line-1].trim(),p.source_excerpt);
 assert.deepEqual(budgetClassification(fixture.text,fixture,'없는사업 통계목').matched_paths,[]);
});
test('unsupported business indentation cannot inherit a previous business',()=>{
 const text='부서: 교통과\n정책: 교통사업\n단위: 버스\n부서ㆍ정책ㆍ단위(회계)ㆍ세부사업ㆍ편성목\n   이전사업  100\n         403 자치단체등자본이전  100\n          02 공기관등에대한자본적위탁사업비  100\n    성남시S-BRT 구축  12000000\n         401 시설비및부대비  12000000\n          01 시설비  12000000';
 const r=budgetClassification(text,{},'이전사업');assert.equal(r.paths[1].detailed_business,null);assert.equal(r.matched_paths.length,1);
});
