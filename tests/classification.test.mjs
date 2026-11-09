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
 assert.equal(resolveQuery({query:'청년월세 세부사업과 예산 목'}).budget_type,'본예산');
 assert.equal(resolveQuery({query:'성과계획서의 세부사업'}).budget_type,'관련계획');
});
