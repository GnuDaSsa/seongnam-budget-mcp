import test from 'node:test';
import assert from 'node:assert/strict';
import {researchGuidance} from '../worker/research-guidance.js';

test('부서 개요가 있어도 의미 유사만으로 사업 부재나 0원을 확정하지 않는다', () => {
  const r = researchGuidance('2026년 분당구 건설과에 달나라 지하철 조성사업 예산이 없는 게 확실해?', {}, {level:'semantic_only'});
  assert.equal(r.status.department, 'overview_available');
  assert.equal(r.status.business, 'not_verified');
  assert.match(r.note, /^질문한 사업/);
  assert.match(r.note, /부재나 0원을 확정하지 마세요/);
  assert.doesNotMatch(r.note, /부서 총액·순위 질문에는/);
});

test('사업 재원 질문에서 부서 개요를 해당 사업의 근거로 오인하지 않는다', () => {
  const r = researchGuidance('수정구 사회복지과 기초연금의 국비 도비 시비를 알려줘', {}, {level:'verified'});
  assert.equal(r.status.requested_details, 'requires_source_review');
  assert.match(r.note, /해당 사업의 원문 페이지/);
});

test('명시적 부서 순위 질문에서만 개요를 순위 참고자료로 안내한다', () => {
  const r = researchGuidance('AI반도체과 예산 중 가장 큰 사업', {}, {level:'verified'});
  assert.equal(r.status.overview_intent, true);
  assert.match(r.note, /department_overview/);
});
