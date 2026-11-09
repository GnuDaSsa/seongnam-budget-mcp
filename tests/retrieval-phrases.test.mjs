import test from 'node:test';
import assert from 'node:assert/strict';
import {withoutQueryYears,exactQueryPhrases,exactPhraseHit,businessTermsHit,retrievalWords} from '../worker/retrieval-phrases.js';
test('year boilerplate leaves formal Korean labels and model identifiers intact',()=>{
 assert.equal(withoutQueryYears('2025년도 자본적위탁사업비').trim(),'자본적위탁사업비');
 assert.equal(withoutQueryYears('2025년 자본적위탁사업비').trim(),'자본적위탁사업비');
 assert.equal(withoutQueryYears('AB2025X 사업'),'AB2025X 사업');
 assert(exactQueryPhrases('성남시 2025년 본예산 공기관 등에 대한 자본적 위탁사업비 알려줘').phrases.includes('공기관등에대한자본적위탁사업비'));
 assert.deepEqual(exactQueryPhrases('403-01 자본적위탁사업비').phrases,[]);
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

test('explicit connective in source names stays in exact phrase without inventing it',()=>{
 const q='2026년 본예산 재난 및 재해 예방';const hit=exactPhraseHit(q,'재난및재해예방 414,400');
 assert.equal(hit?.phrase,'재난및재해예방');
 assert.equal(exactPhraseHit(q,'재난대응과 재해복구를 위한 예방사업'),null);
});
