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
