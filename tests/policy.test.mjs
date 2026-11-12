import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveQuery,isMunicipalTotal,totalAnswerCard,sourceFamily,sourceAllowed,matchesRevision} from '../worker/policy.js';
// 이슈 #1 잔여 변형 회귀: 부서 예산과 뒤에 조사·접속어가 붙어도 시 전체 총액으로 답하지 않는다.
test('예산과 followed by a particle or connective never falls to the municipal total',()=>{
 for(const q of ['2026년 예산과와 총예산이 얼마인가요?','2026년 예산과랑 총예산이 얼마야?','2026년 예산과 및 총예산이 얼마인가요?','예산과와 총액','2026년 예산과하고 총예산','2026년 예산과이랑 총예산'])assert(!isMunicipalTotal(q),q);
 // 대조: 시 전체 총액 질문은 그대로 직행한다.
 for(const q of ['2026년 총예산이 얼마인가요?','성남시 2026년도 본예산의 총금액을 알려주세요.','2026년 일반회계와 특별회계 총예산','성남시 세입예산과 세출예산 총액'])assert(isMunicipalTotal(q),q);
 assert(!isMunicipalTotal('2026년 본예산과 추경 총예산이 얼마인가요?'));
});
test('main budget and supplementary comparison preserve both editions and scope the revision',()=>{
 const q=resolveQuery({query:'2026년 중원구 사회복지과 기초연금 본예산과 1회 추경에서 기정액 경정액 증감액을 각각 비교해줘.'});
 assert.deepEqual(q.policy.comparison_budget_types,['본예산','추경']);assert.deepEqual(q.policy.allowed_budget_types,['본예산','추경']);assert.equal(q.revision,1);
 assert.equal(q.policy.source_preference,'expenditure');assert.equal(q.budget_type,undefined);
 assert(matchesRevision({budget_type:'본예산',revision:0},q));assert(matchesRevision({budget_type:'추경',revision:1},q));assert(!matchesRevision({budget_type:'추경',revision:2},q));
 const only=resolveQuery({query:'기초연금 1회 추경'});assert(!matchesRevision({budget_type:'본예산',revision:0},only));
 assert.throws(()=>resolveQuery({query:'1회 추경과 2회 추경 비교'}),/여러 추경 회차/);
});
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
test('explicit natural-language budget scope corrects stale parameters and preserves exclusions',()=>{
 const corrected=resolveQuery({query:'2025년도 AI 관련 사업 추경 반영',budget_type:'본예산'});
 assert.equal(corrected.budget_type,'추경');assert.equal(corrected.policy.conflicts[0].resolution,'explicit_query_precedence');
 const both=resolveQuery({query:'AI 사업 본예산과 추경 모두',budget_type:'본예산'});
 assert.equal(both.budget_type,undefined);assert.deepEqual(both.policy.allowed_budget_types,['본예산','추경']);assert(!sourceAllowed({budget_type:'결산'},both));
 const main=resolveQuery({query:'AI 사업 본예산만 추경 제외',budget_type:'추경'});assert.equal(main.budget_type,'본예산');assert(!sourceAllowed({budget_type:'추경'},main));
 assert.equal(resolveQuery({query:'본예산은 제외하고 AI 사업 제2회 추경',budget_type:'본예산'}).revision,2);
 assert.equal(resolveQuery({query:'AI 사업 최신 예산',budget_type:'본예산'}).budget_type,'본예산');
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
// 이슈 #1 회귀: 질문에 적힌 연도·범위를 year 인자가 조용히 덮어쓰지 않는다.
test('explicit query years survive a different year parameter and the conflict is visible',()=>{
 const single=resolveQuery({query:'2025년 본예산 청년월세 한시 특별지원 예산',year:2026});
 assert.equal(single.year,2025);assert.deepEqual(single.policy.years,[2025]);
 assert.deepEqual(single.policy.conflicts,[{field:'year',parameter:2026,query_years:[2025],resolution:'explicit_query_precedence'}]);
 assert(single.policy.notices.some(n=>n.includes('year 인자')));
 assert.equal(single.policy.budget_type_basis,'query');
 const pair=resolveQuery({query:'2025년과 2026년 청년월세 예산 비교',year:2026});
 assert.equal(pair.year,undefined);assert.deepEqual(pair.policy.years,[2025,2026]);assert.equal(pair.policy.conflicts[0].field,'year');
 assert.deepEqual(resolveQuery({query:'2024~2026년 도서관 비교',year:2025}).policy.years,[2024,2025,2026]);
 const same=resolveQuery({query:'2025년 청년월세',year:2025});assert.equal(same.year,2025);assert.deepEqual(same.policy.conflicts,[]);
 const all=resolveQuery({query:'역대 도서관 예산',year:2026});
 assert.equal(all.year_scope,'all');assert.equal(all.year,undefined);assert.equal(all.policy.conflicts[0].query_year_scope,'all');
 assert.throws(()=>resolveQuery({query:'도서관',year:1800}),/year/);
});
test('relative years follow the fixed 2026 policy and a prior-year baseline is not the lookup year',()=>{
 const last=resolveQuery({query:'작년 본예산 청년월세 지원사업 예산',year:2026});
 assert.equal(last.year,2025);assert.deepEqual(last.policy.conflicts[0].query_years,[2025]);
 const current=resolveQuery({query:'올해 본예산 청년월세 지원사업 예산',year:2025});
 assert.equal(current.year,2026);assert.equal(current.policy.year_basis,'relative');assert.equal(current.policy.conflicts[0].parameter,2025);
 const baseline=resolveQuery({query:'올해 청년월세 전년도 대비 증가액'});
 assert.equal(baseline.year,2026);assert.equal(baseline.policy.year_basis,'relative');assert(baseline.policy.notices.some(n=>n.includes('비교 기준')));
 assert.equal(resolveQuery({query:'청년월세 전년도 대비 증가액'}).policy.year_basis,'default');
 assert.equal(resolveQuery({query:'청년월세 작년보다 얼마나 늘었나'}).year,2026);
 assert.equal(resolveQuery({query:'작년 대비 올해 청년월세 증가액'}).year,2026);
 assert.equal(resolveQuery({query:'2025년 청년월세 전년도 대비 증가액'}).year,2025);
 assert.equal(resolveQuery({query:'전년도 청년월세 예산'}).year,2025);
 assert.equal(resolveQuery({query:'금년 도서관 예산'}).year,2026);
 assert.deepEqual(resolveQuery({query:'작년과 올해 청년월세 비교'}).policy.years,[2025,2026]);
 assert.deepEqual(resolveQuery({query:'올해와 내년 도서관 비교'}).policy.years,[2026,2027]);
});
test('a resolved query re-enters with the same years and only an internal slice narrows a comparison',()=>{
 for(const input of [{query:'2025년 본예산 청년월세',year:2026},{query:'작년 청년월세',year:2026},{query:'올해 청년월세 전년도 대비 증가액'},{query:'2025년과 2026년 청년월세 비교',year:2026},{query:'역대 도서관 예산',year:2026},{query:'도서관'},{query:'도서관',year:2024}]){
  const first=resolveQuery(input),again=resolveQuery(first);
  assert.equal(again.year,first.year,input.query);assert.deepEqual(again.policy.years,first.policy.years,input.query);
  assert.equal(again.year_scope,first.year_scope,input.query);assert.deepEqual(again.policy.conflicts,first.policy.conflicts,input.query);
 }
 const slice=resolveQuery({query:'2025년과 2026년 청년월세 예산 비교',year:2025,year_slice:true});
 assert.equal(slice.year,2025);assert.deepEqual(slice.policy.conflicts,[]);assert.equal(slice.policy.year_basis,'comparison_slice');
 assert.equal(resolveQuery({query:'작년과 올해 청년월세 비교',year:2026,year_slice:true}).year,2026);
 assert.deepEqual(resolveQuery({query:'2025년과 2026년 청년월세 예산 비교',year:2024,year_slice:true}).policy.years,[2025,2026]);
 assert.deepEqual(resolveQuery({query:'2025년과 2026년 청년월세 예산 비교',year:2025,year_slice:'true'}).policy.years,[2025,2026]);
});
// 이슈 #1 회귀: 정중한 총예산 질문은 총괄표로, 예산과(부서) 질문은 시 전체 총액으로 넓히지 않는다.
test('polite municipal total wording is recognised while 예산과 and other editions stay out',()=>{
 for(const q of ['2026년 성남시 본예산 총예산','2026년 성남시 본예산 총예산이 얼마나 되나요?','성남시 2026년도 본예산의 총금액을 알려주세요.','올해 성남시 총예산은 얼마입니까?','성남시 세입예산과 세출예산 총액'])assert(isMunicipalTotal(q),q);
 for(const q of ['2026년 예산과 총예산이 얼마인가요?','2026년 예산과의 총예산','성남시 예산과 총액 얼마야','2026년 추경 총예산이 얼마나 되나요?','2025년 결산 총액을 알려주세요.','도서관 총예산이 얼마나 되나요?','청년월세 총금액을 알려주세요.'])assert(!isMunicipalTotal(q),q);
});
