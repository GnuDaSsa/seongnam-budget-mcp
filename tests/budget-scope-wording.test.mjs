import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveQuery } from '../worker/policy.js';
import { retrievalWords } from '../worker/retrieval-phrases.js';

// 자연어로 "추경 포함"을 말하면 본예산과 추경을 함께 본다.
test('추경 포함 질문은 편성 구분을 고르지 않고 본예산과 추경을 허용한다', () => {
  const r = resolveQuery({ query: 'AI반도체과 2026년도 예산 중 가장 비싼거 추경 포함' });
  assert.equal(r.budget_type, undefined);
  assert.deepEqual(r.policy.allowed_budget_types, ['본예산', '추경']);
});

test('추경까지·추경도 표현도 같은 허용 범위가 된다', () => {
  for (const query of ['도서관 예산 추경까지', '도서관 예산 추경도 알려줘']) {
    const r = resolveQuery({ query });
    assert.equal(r.budget_type, undefined, query);
    assert.deepEqual(r.policy.allowed_budget_types, ['본예산', '추경'], query);
  }
});

test('연도와 함께 추경 반영을 말하면 기존처럼 추경을 고른다', () => {
  const r = resolveQuery({ query: '2025년도 AI 관련 사업 추경 반영' });
  assert.equal(r.budget_type, '추경');
});

test('회차를 말한 추경 질문은 추경과 회차를 함께 얻는다', () => {
  const r = resolveQuery({ query: '도서관 3회 추경' });
  assert.equal(r.budget_type, '추경');
  assert.equal(r.revision, 3);
});

test('추경을 제외하라는 말은 excluded_budget_types에 추경을 넣는다', () => {
  const r = resolveQuery({ query: '도서관 추경 제외' });
  assert.ok(r.policy.excluded_budget_types.includes('추경'));
});

// 검색어에서 분석 요청어와 연도 표기를 걸러낸다.
test('분석 요청어와 예산 공통어를 검색어에서 뺀다', () => {
  const words = retrievalWords('AI반도체과 2026년도 예산 중 가장 비싼거 추경 포함');
  for (const excluded of ['가장', '비싼거', '포함', '예산', '추경']) {
    assert.equal(words.includes(excluded), false, excluded + ' 제외');
  }
  assert.ok(words.includes('반도체과'));
});

test('지출과 비율 같은 분석어를 빼고 사업명만 남긴다', () => {
  assert.deepEqual(retrievalWords('공공근로 지출과 시도비 비율'), ['공공근로']);
});

test('합성어 안의 지출 표현은 그대로 유지한다', () => {
  assert.deepEqual(retrievalWords('지출구조조정 추진'), ['지출구조조정', '추진']);
});
