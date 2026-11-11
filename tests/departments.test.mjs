import test from 'node:test';
import assert from 'node:assert/strict';
import {statementDepartment,normalizeDepartment,requestedDepartments,canonicalDepartmentQuery,departmentMatches} from '../worker/departments.js';
import {resolveQuery} from '../worker/policy.js';
const index={departments:['AI반도체과','미래산업과','도시계획과','예산과'].map(name=>({name,key:normalizeDepartment(name),locations:[]}))};
test('department names match explicit headings across case and spaces without organizational aliases',()=>{
 for(const q of ['AI반도체과 2025년도 예산','ai 반도체과의 2025년 예산','A I 반 도 체 과 본예산']){
  const found=requestedDepartments(q,index);assert.deepEqual(found.map(d=>d.name),['AI반도체과']);assert(canonicalDepartmentQuery(q,found).includes('AI반도체과'));assert(departmentMatches('부서: AI반도체과\n정책: 산업',found));assert(!departmentMatches('부서: 미래산업과\n행정운영경비(AI반도체과)',found));
 }
 assert.equal(statementDepartment('부서: AI반도체과\n정책: 산업'),'AI반도체과');
 assert.deepEqual(requestedDepartments('사업 예산과 편성 이유',index),[]);
 assert.deepEqual(requestedDepartments('예산과 소관 예산',index).map(d=>d.name),['예산과']);
 for(const q of ['예산과 2025년도 예산','2025년 예산과 예산','성남시 예산과의 2025년 본예산'])assert.deepEqual(requestedDepartments(q,index).map(d=>d.name),['예산과']);
 assert.deepEqual(requestedDepartments('사업 예산과 2025년 편성 이유',index),[]);
});
test('latest budget means collected latest supplement unless kind or revision is explicitly chosen',()=>{
 const latest=resolveQuery({query:'2025년 AI반도체과 최종 예산'});assert.equal(latest.budget_type,'추경');assert.equal(latest.policy.budget_type_basis,'latest_budget_query');
 assert.equal(resolveQuery({query:'AI반도체과 최신 본예산'}).budget_type,'본예산');
 assert.equal(resolveQuery({query:'AI반도체과 최종 예산',budget_type:'본예산'}).budget_type,'본예산');
 assert.equal(resolveQuery({query:'AI반도체과 최신 예산',budget_type:'결산'}).budget_type,'결산');
 assert.equal(resolveQuery({query:'AI반도체과 최신 추경',revision:2}).revision,2);
});
// 이슈 #1 회귀: 총예산·총액·조사·어순이 달라도 예산과(부서)를 인식하고, "예산+과" 접속 표현은 부서로 보지 않는다.
test('예산과 is a department with total wording but not as a budget-and conjunction',()=>{
 for(const q of ['2026년 예산과 총예산이 얼마인가요?','2026년 예산과의 총예산','예산과 총액','성남시 예산과 2026년 총규모','2026년도 성남시 예산과 전체 예산','예산과 기본경비 예산','행정기획조정실 예산과 통계목','예산과에서 편성한 사업','2026년 예산과 예산','예산과 소관 예산'])assert.deepEqual(requestedDepartments(q,index).map(d=>d.name),['예산과'],q);
 for(const q of ['2026년 본예산 공공와이파이 유지관리 예산과 통계목','청년월세 지원사업의 예산과 편성목, 통계목','청년월세 예산과 가장 큰 통계목','본예산과의 차이','세입예산과 세출예산 총액','2026년 본예산과 추경 비교','사업 예산과 총액'])assert.deepEqual(requestedDepartments(q,index),[],q);
});
