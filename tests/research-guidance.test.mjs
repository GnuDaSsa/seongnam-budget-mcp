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

test('순위 계산이 없으면 의미 유사 후보를 순위로 제시하지 말라고 안내한다', () => {
  const r = researchGuidance('2026년 본예산 세출 중 예산액이 가장 큰 세부사업 5개와 각각의 금액을 알려줘.', null, {level:'semantic_only'});
  assert.equal(r.status.ranking, 'not_computed');
  assert.match(r.note, /^질문한 사업/);
  assert.match(r.note, /완전한 금액순 순위는 계산되지 않았습니다/);
});

test('401-01 통계목 순위는 세부사업 총액 overview로 대신하지 않는다', () => {
  const r = researchGuidance('2026년 분당구 구조물관리과에서 세부사업 총액이 아니라 401-01 시설비 금액이 가장 큰 사업은?', {}, {level:'verified'});
  assert.equal(r.status.overview_intent, false);
  assert.match(r.note, /통계목 코드 기준 순위는 세부사업 총액 순위와 다르므로/);
  assert.doesNotMatch(r.note, /부서 총액·순위 질문에는 department_overview를 참고/);
});

test('사업명 불일치 analysis는 미확인을 먼저 밝히고 0원을 금지한다', () => {
  const r = researchGuidance('2026년 분당구 건설과에 달나라 지하철 조성사업 예산이 없는 게 확실해?', {}, {level:'semantic_only'}, {kind:'business_lookup', status:'no_name_match'});
  assert.match(r.note, /^미확인/);
  assert.match(r.note, /0원으로 적지 마세요/);
  assert.equal(r.status.business, 'not_verified');
});

test('완료된 행 분석이 있으면 사업 검증 상태와 안내가 일치한다', () => {
  const r = researchGuidance('2026년 수정구 사회복지과 기초연금 본예산의 국비 도비 시비와 합계', {}, {level:'semantic_only'}, {kind:'funding', status:'matched'});
  assert.equal(r.status.business, 'verified_statement_rows');
  assert.match(r.note, /^analysis는 원문 세출명세서 행/);
  assert.doesNotMatch(r.note, /질문한 사업과 요청한 재원·산출근거가 확인되지 않았습니다/);
});

test('완료된 순위 analysis가 있으면 미계산 경고를 붙이지 않는다', () => {
  const r = researchGuidance('2026년 본예산 일반회계 부서별 총액 상위 3개 부서', null, {level:'semantic_only'}, {kind:'ranking', status:'complete'});
  assert.equal(r.status.ranking, 'complete');
  assert.doesNotMatch(r.note, /계산되지 않았습니다/);
});

test('명시적 부서 순위 질문에서만 개요를 순위 참고자료로 안내한다', () => {
  const r = researchGuidance('AI반도체과 예산 중 가장 큰 사업', {}, {level:'verified'});
  assert.equal(r.status.overview_intent, true);
  assert.match(r.note, /department_overview/);
});
