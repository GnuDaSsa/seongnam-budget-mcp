import test from 'node:test';
import assert from 'node:assert/strict';
import {withoutQueryYears,exactQueryPhrases,exactPhraseHit} from '../worker/retrieval-phrases.js';
test('year boilerplate leaves formal Korean labels and model identifiers intact',()=>{
 assert.equal(withoutQueryYears('2025년도 자본적위탁사업비').trim(),'자본적위탁사업비');
 assert.equal(withoutQueryYears('2025년 자본적위탁사업비').trim(),'자본적위탁사업비');
 assert.equal(withoutQueryYears('AB2025X 사업'),'AB2025X 사업');
 assert(exactQueryPhrases('성남시 2025년 본예산 공기관 등에 대한 자본적 위탁사업비 알려줘').phrases.includes('공기관등에대한자본적위탁사업비'));
 assert.deepEqual(exactQueryPhrases('403-01 자본적위탁사업비').phrases,[]);
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
