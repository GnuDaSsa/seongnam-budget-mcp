import test from 'node:test';
import assert from 'node:assert/strict';
import { rankBusinesses, sumDepartments, compareEditions } from '../worker/budget-analytics.js';
const row = (department, amount, extra = {}) => ({year:2026, budget_type:'본예산', revision:null, account:'일반회계', department, policy_business:'복지', unit_business:'노인복지', business:'기초연금', unit:'천원', page_url:'https://example.test/' + department, amount, previous_amount:0, change:amount, columns_verified:true, ...extra});

test('명시 부서별 완전한 동일 사업만 더하고 누락은 0으로 취급하지 않는다', () => {
 const rows = [row('수정구',114003724), row('중원구',110922543), row('분당구',83191907)];
 const result = sumDepartments(rows,['수정구','중원구','분당구']);
 assert.equal(result.calculated_total.amount,308118174);
 const missing = sumDepartments(rows.slice(0,2),['수정구','중원구','분당구']);
 assert.equal(missing.calculated_total,null); assert.deepEqual(missing.missing_departments,['분당구']);
});
test('동일 출처 중복은 제거하고 값 충돌 및 회계 차이는 합계 확정을 막는다', () => {
 const a = row('수정구',10), duplicate = {...a,page_url:'https://example.test/duplicate'};
 assert.equal(sumDepartments([a,duplicate],['수정구']).calculated_total.amount,10);
 assert.equal(sumDepartments([a,{...duplicate,amount:11}],['수정구']).complete,false);
 assert.equal(sumDepartments([a,row('중원구',2,{account:'특별회계'})],['수정구','중원구']).complete,false);
});
test('추경 기정액 경정액 증감과 본예산 차이를 별도로 계산한다', () => {
 const main=row('중원구',100);
 const sup=row('중원구',125,{budget_type:'추경',revision:2,previous_amount:110,change:15});
 const r=compareEditions(main,sup);
 assert.equal(r.complete,true); assert.equal(r.comparison.difference_from_initial,25);
 assert.equal(r.comparison.amendment_change,15); assert.equal(r.comparison.previous_matches_initial,false);
 assert.equal(compareEditions(main,{...sup,change:16}).complete,false);
 assert.equal(compareEditions(main,{...sup,account:'특별회계'}).complete,false);
 assert.equal(compareEditions(main,null).comparison,null);
});
test('검증된 전체 수록 범위 없이는 전체 순위라고 표시하지 않는다', () => {
 const rows=[row('A',1),row('B',2)];
 assert.equal(rankBusinesses(rows).scope,'available_rows_only');
 const r=rankBusinesses(rows,{coverage:{complete:true}});
 assert.equal(r.complete,true); assert.equal(r.rows[0].amount,2);
 assert.equal(rankBusinesses([...rows,{...rows[0],amount:3}],{coverage:{complete:true}}).complete,false);
 assert.equal(rankBusinesses([rows[0],{...rows[1],budget_type:'추경',revision:1}],{coverage:{complete:true}}).complete,false);
 assert.equal(rankBusinesses([{...rows[0],policy_business:null}],{coverage:{complete:true}}).complete,false);
});
