import test from 'node:test';
import assert from 'node:assert/strict';
import {withoutQueryYears,exactQueryPhrases,exactPhraseHit,businessTermsHit,retrievalWords,topicIntent,topicBusinessMatches} from '../worker/retrieval-phrases.js';
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
