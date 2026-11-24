import test from 'node:test';
import assert from 'node:assert/strict';
import {withoutQueryYears,exactQueryPhrases,exactPhraseHit,businessTermsHit,retrievalWords,topicIntent,topicBusinessMatches,postingQueryScope} from '../worker/retrieval-phrases.js';
test('세입과 회계명은 문서 범위로 확인하고 항목명으로 후보를 찾는다',()=>{
 const scope=postingQueryScope('2024년 상수도 급수공사 수수료 세입 예산','revenue');
 assert.equal(scope.query,'급수공사 수수료');
 assert.deepEqual(scope.metadata,['상수도','세입']);
 const special=postingQueryScope('2024년 상수도공기업특별회계 세부사업 급수공사 편성목','expenditure');
 assert.equal(special.query,'급수공사');
 assert.deepEqual(special.metadata,['상수도공기업특별회계']);
 assert.equal(postingQueryScope('상수도관망 유지관리 사업','expenditure').query,null);
 const split=postingQueryScope('상수도 특별회계 급수공사 편성목','expenditure');
 assert.equal(split.query,'급수공사');
 assert.deepEqual(split.metadata,['상수도','특별회계']);
});
import {topicEditionOrder,distinctTopicBusinesses} from '../worker/topic-selection.js';
import {similarBusinessCandidate,hasBusinessRow,similarBusinessRows} from '../worker/similar-business.js';
test('회계 범위의 비 접미어 유사 후보는 원문 사업 행과 명칭을 확인한다',()=>{
 const candidate=similarBusinessCandidate('상수도 특별회계 급수공사비 통계목 알려줘');
 assert.deepEqual(candidate,{requested:'급수공사비',similar:'급수공사'});
 assert.deepEqual(similarBusinessCandidate('급수공사비 통계목 알려줘'),candidate);
 assert.equal(similarBusinessCandidate('상수도 특별회계 수도비'),null);
 assert(hasBusinessRow('정책\n   급수공사   1,420,420  1,420,780  △360',candidate.similar));
 assert(!hasBusinessRow('○ 급수공사 수수료  20,000',candidate.similar));
 assert(!hasBusinessRow('급수공사비  100  0  100',candidate.similar));
 assert(hasBusinessRow('  201 일반운영비  100  80  20','일반운영비'));
 assert(hasBusinessRow('  ○ 급수공사 수수료','급수공사수수료'));
 assert.deepEqual(similarBusinessCandidate('상수도 특별회계 급수 공사비 통계목'),candidate);
 assert.deepEqual(similarBusinessCandidate('일반회계 청년 주거 지원사업'),{requested:'청년주거지원사업',similar:'청년주거지원'});
 assert.deepEqual(similarBusinessCandidate('2026년 일반회계 기업혁신과 중소기업 디지털 전환 지원비 편성목',['기업혁신과']),{requested:'중소기업디지털전환지원비',similar:'중소기업디지털전환지원'});
 assert.deepEqual(similarBusinessRows('   청년주거지원  200  100  100\n   청년문화지원  100  80  20','청년주거지원사업','청년주거지원').map(row=>row.name),['청년주거지원']);
 assert.deepEqual(similarBusinessRows('   상수도관리  100  80  20','급수공사비','급수공사'),[]);
 assert.deepEqual(similarBusinessRows('  201 일반운영비  100  80  20','일반운영비용','일반운영비').map(row=>[row.name,row.kind]),[['일반운영비','appropriation']]);
 assert.deepEqual(similarBusinessRows('  01 사무관리비  100  80  20','사무관리비용','사무관리비').map(row=>[row.name,row.kind]),[['사무관리비','statistical_item']]);
 assert.deepEqual(similarBusinessRows('  ○ 급수공사 수수료','급수공사수수료비','급수공사수수료').map(row=>[row.name,row.kind]),[['급수공사 수수료','calculation_basis']]);
 assert.deepEqual(similarBusinessRows('  01 전산개발비  100  80  20','사무관리비용','사무관리비'),[]);
});
test('주제 검색에서 같은 사업의 다른 부서는 남기되 서로 다른 사업을 먼저 표시한다',()=>{
 const rows=[
  {text:'AI 어르신건강관리사업   100  20  80'},
  {text:'AI 어르신건강관리사업   200  20  180'},
  {text:'AI 인재양성사업   300  0  300'}
 ];
 assert.deepEqual(distinctTopicBusinesses(rows,row=>row.text),[rows[0],rows[2],rows[1]]);
});
test('주제 사업 행에서 실국 및 부서의 조직 합계를 제외한다',()=>{
 const intent=topicIntent('2026년 AI 관련 예산');
 const rows=topicBusinessMatches('AI혁신국   1,000  900  100\nAI반도체과  500  400  100\nAI 인재양성 사업  300  200  100',intent);
 assert.deepEqual(rows.map(row=>row.source_excerpt),['AI 인재양성 사업  300  200  100']);
});
test('주제 근거는 본예산 사업을 충분히 남기고 추경도 반영한다',()=>{
 const rows=['본1','본2','본3','본4','추1','추2','추3','추4'].map((name,index)=>({name,budget_type:index<4?'본예산':'추경',revision:index<4?null:index-3,year:2026}));
 const ordered=topicEditionOrder(rows,row=>row,5);
 assert.deepEqual(ordered.slice(0,5).map(row=>row.name),['본1','본2','본3','본4','추1']);
 const onlyRevisions=rows.slice(4);
 assert.deepEqual(topicEditionOrder(onlyRevisions,row=>row,5),onlyRevisions);
});
test('year boilerplate leaves formal Korean labels and model identifiers intact',()=>{
 assert.equal(withoutQueryYears('2025년도 자본적위탁사업비').trim(),'자본적위탁사업비');
 assert.equal(withoutQueryYears('2025년 자본적위탁사업비').trim(),'자본적위탁사업비');
 assert.equal(withoutQueryYears('AB2025X 사업'),'AB2025X 사업');
 assert(exactQueryPhrases('성남시 2025년 본예산 공기관 등에 대한 자본적 위탁사업비 알려줘').phrases.includes('공기관등에대한자본적위탁사업비'));
 assert.deepEqual(exactQueryPhrases('403-01 자본적위탁사업비').phrases,[]);
});
test('AI topic controls are separate from contents and topic evidence cannot be only a department name',()=>{
 for(const q of ['2025년도 Ai사업관련예산 찾아봐줘','2025년도 AI 관련 사업 추경 반영','2025년 인공지능 관련 사업 본예산과 추경 모두'])assert.equal(topicIntent(q).content_query,'AI');
 for(const q of ['AI반도체과 2025년도 예산','Email 예산','AIDS 사업','고병원성 AI 방역'])assert.equal(topicIntent(q),null,q);
 const t=topicIntent('AI 관련 사업');
 assert.equal(topicBusinessMatches('부서: AI반도체과\nAI반도체과   100  0  100\n팹리스기업지원   100  0  100',t).length,0);
 assert.equal(topicBusinessMatches('Email 서비스\nAIDS 지원\n고병원성 AI 방역\n행정운영경비(AI반도체과)',t).length,0);
 assert.equal(topicBusinessMatches('AI 인재양성지원사업   600,000  0  600,000\n인공지능 플랫폼   30,000',t).length,2);
 assert.equal(topicBusinessMatches('   AI어르신건강관리사업  100\n         201 일반운영비  100\n          01 사무관리비  100\n   청년교육사업  200',topicIntent('AI 청년교육')).length,0);
});
test('output requests are removed but bounded business terms must all be present',()=>{
 assert.deepEqual(retrievalWords('도서관지원과 소관 임대수입 세입'),['도서관지원과','임대수입','세입']);
 assert.deepEqual(retrievalWords('반도체 소재 지원 예산'),['반도체','소재','지원']);
 assert.deepEqual(retrievalWords('산성동 소재 주차장 부지 사용료 세입'),['산성동','주차장','부지','사용료','세입']);
 assert.deepEqual(retrievalWords('청년월세지원사업 통계목 보여줘'),['청년월세지원사업']);
 const h=businessTermsHit('판교 연구센터 예산','😀 판교시스템반도체연구센터조성 26,299,000');assert(h);assert.deepEqual(h.words,['판교','연구센터']);
 assert.equal(businessTermsHit('판교 연구센터 예산','판교동 주민자치센터 운영'),null);
 assert.equal(businessTermsHit('판교 연구센터','판교'+'가'.repeat(1000)+'연구센터'),null);
 assert.equal(businessTermsHit('403-02 자본적위탁사업비','403 자치단체등자본이전 02 공기관등에대한자본적위탁사업비'),null);
});
test('exact phrase is contiguous after whitespace normalization, with original codepoint offsets',()=>{
 const text='😀 머리말\n공기관 등에 대한 자본적\n위탁 사업비 220,000';
 const h=exactPhraseHit('2025년도 자본적 위탁사업비',text);
 assert(h);assert.equal(Array.from(text).slice(h.start,h.end).join('').replace(/\s/g,''),'자본적위탁사업비');
 assert.equal(exactPhraseHit('자본적위탁사업비','자본 본적 적위 위탁 탁사 사업 업비'),null);
 assert.equal(exactPhraseHit('자본적위탁사업비','공기관등에대한경상적위탁사업비'),null);
 assert.equal(exactPhraseHit('자본적 위탁사업비','자본적 이전\n공기관등에대한경상적위탁사업비'),null);
 assert.deepEqual(exactPhraseHit('자본적위탁사업비','😀İ자본적위탁사업비'),{phrase:'자본적위탁사업비',start:2,end:10});
 assert.equal(exactPhraseHit('주택과 자본적위탁사업비',text,'교통기획과'),null);
 assert(exactPhraseHit('주택과 자본적위탁사업비',text,'도시주택국 주택과'));
 const separated='자본적위탁사업비'+ '나'.repeat(1000)+'주택과 자본적위탁사업비';
 assert(exactPhraseHit('주택과 자본적위탁사업비',separated).start>1000);
});
// 이슈 #1 회귀: "예산+과" 접속 표현과 끝의 출력 요청은 필수 검색어가 아니고, 실제 부서·조건어는 남는다.
test('budget-and conjunction and a trailing output request are not required terms',()=>{
 assert.deepEqual(retrievalWords('2026년 본예산 공공와이파이 유지관리 예산과 통계목'),['공공와이파이','유지관리']);
 assert.deepEqual(retrievalWords('2026년 본예산 공공와이파이 유지관리 예산 통계목'),['공공와이파이','유지관리']);
 assert.deepEqual(retrievalWords('2026년 본예산 청년월세 지원사업의 예산과 편성목, 통계목을 원문 페이지와 함께 알려주세요.'),['청년월세','지원사업']);
 assert.deepEqual(retrievalWords('청년월세 예산을 알려줘'),['청년월세']);
 assert.deepEqual(retrievalWords('2026년 성남시 본예산 총예산이 얼마나 되나요?'),[]);
});
// 이슈 #1 잔여 변형 회귀: 부서로 인식된 "예산과와 총예산"의 토큰도 "예산과"로 정리된다.
test('예산과 with a trailing particle keeps one 예산과 term when recognized as a department',()=>{
 const base=retrievalWords('2026년 예산과 총예산이 얼마인가요?');
 assert.deepEqual(base,['예산과']);
 for(const q of ['2026년 예산과와 총예산이 얼마인가요?','2026년 예산과랑 총예산이 얼마야?','2026년 예산과하고 총예산이 얼마인가요?'])assert.deepEqual(retrievalWords(q),base,q);
 // 대조: 사업명 뒤 오타형은 필수 검색어에서 계속 제외되지 않고 그대로 남는다(부서 아님).
 assert(retrievalWords('청년월세 예산과와 집행액').some(w=>w==='예산과와'));
});
test('department 예산과, conditions, codes and look-alike nouns stay as terms',()=>{
 assert.deepEqual(retrievalWords('예산과 기본경비 예산'),['예산과','기본경비']);
 assert.deepEqual(retrievalWords('행정기획조정실 예산과 통계목'),['행정기획조정실','예산과']);
 assert.deepEqual(retrievalWords('2026년 예산과의 총예산이 얼마인가요?'),['예산과']);
 assert.deepEqual(retrievalWords('청년월세 제외 주거급여 집행 잔액 이월'),['청년월세','제외','주거급여','집행','잔액','이월']);
 assert.deepEqual(retrievalWords('201-01 사무관리비 통계목'),['201','01','사무관리비']);
 assert.deepEqual(retrievalWords('홈페이지 유지관리 알려줘'),['홈페이지','유지관리']);
 assert.deepEqual(retrievalWords('지급 근거 알려줘'),['지급','근거']);
 assert.deepEqual(retrievalWords('시민회의 예산'),['시민회의']);
 assert.deepEqual(retrievalWords('비교과 프로그램 운영'),['비교과','프로그램','운영']);
 const text='공공와이파이 유지관리  120,000\n광역버스 유지관리  80,000';
 assert.deepEqual(businessTermsHit('2026년 본예산 공공와이파이 유지관리 예산과 통계목',text)?.words,['공공와이파이','유지관리']);
 assert.equal(businessTermsHit('마을버스 유지관리 예산과 통계목',text),null);
});
