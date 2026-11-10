import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hasReplacementCharacter,
  totalTableDocument,
  comparisonBudgetBasis,
  matchQuality,
  weakestQuality,
  trimSemanticEvidence,
  bridgeBusinessNames,
  asBridgedEvidence,
  businessRow,
  rollupBusinessName,
  businessRollup,
  compactEvidence,
  trimSemanticEvidence as trimForCompare,
} from '../worker/quality.js';

// 깨진 인코딩 문자(U+FFFD)가 섞인 검색어를 식별하는지 확인한다.
test('깨진 문자가 섞이면 true, 정상 문자열과 비문자열이면 false를 반환한다', () => {
  assert.equal(hasReplacementCharacter('성남�예산'), true);
  assert.equal(hasReplacementCharacter('성남 예산'), false);
  assert.equal(hasReplacementCharacter(undefined), false);
  assert.equal(hasReplacementCharacter(2026), false);
});

// 같은 연도 본예산의 총괄표만 골라야 하며, 추경·다른 연도·제목 불일치는 제외해야 한다.
test('총괄표 문서를 찾을 때 같은 연도 본예산 총괄표만 고른다', () => {
  const documents = [
    {
      id: 'supplementary',
      year: 2026,
      budget_type: '추경',
      title: '2026 제1회 추경 세입·세출예산규모 및 총괄표',
    },
    { id: 'other-year', year: 2025, budget_type: '본예산', title: '2025 세입·세출예산규모 및 총괄표' },
    { id: 'no-table', year: 2026, budget_type: '본예산', title: '2026 성과계획서' },
    {
      id: 'target',
      year: 2026,
      budget_type: '본예산',
      title: '2026 세입·세출예산규모 및 총괄표',
    },
  ];
  assert.equal(totalTableDocument(documents, 2026).id, 'target');
  assert.equal(totalTableDocument(documents, 2025).id, 'other-year');
});

test('총괄표 조회에서 연도가 정수가 아니면 null을 반환한다', () => {
  const documents = [{ id: 'target', year: 2026, budget_type: '본예산', title: '2026 총괄표' }];
  assert.equal(totalTableDocument(documents, 2026.5), null);
  assert.equal(totalTableDocument(documents, '2026'), null);
});

test('해당 연도 총괄표가 없으면 null을 반환한다', () => {
  const documents = [
    { id: 'supplementary', year: 2026, budget_type: '추경', title: '2026 제1회 추경 총괄표' },
    { id: 'no-table', year: 2026, budget_type: '본예산', title: '2026 성과계획서' },
  ];
  assert.equal(totalTableDocument(documents, 2026), null);
  assert.equal(totalTableDocument([], 2026), null);
});

// 예산 구분 기준은 질의 > 명시 파라미터 > 세출 기본값 > 세입 우선 순서로 정해진다.
test('명시된 질의 기준은 그대로 돌려준다', () => {
  assert.equal(comparisonBudgetBasis({ budget_type_basis: 'query' }), 'query');
});

test('편성 구분이 미지정이고 세출 우선이면 본예산 기본값을 사용한다', () => {
  assert.equal(
    comparisonBudgetBasis({ budget_type_basis: 'unspecified', source_preference: 'expenditure' }),
    'main_budget_default',
  );
});

test('편성 구분이 미지정이어도 budgetType 인자가 있으면 parameter를 사용한다', () => {
  assert.equal(
    comparisonBudgetBasis({ budget_type_basis: 'unspecified', source_preference: 'expenditure' }, '추경'),
    'parameter',
  );
});

test('편성 구분이 미지정이고 세입 우선이면 source_preference를 사용한다', () => {
  assert.equal(
    comparisonBudgetBasis({ budget_type_basis: 'unspecified', source_preference: 'revenue' }),
    'source_preference',
  );
});

// 근거 신뢰도는 verified > keyword > semantic_bridge > semantic_only > none 순으로 판정한다.
test('근거가 없으면 none을 반환한다', () => {
  assert.deepEqual(matchQuality([]), { level: 'none', basis: 'no_evidence' });
});

test('정확 구문 점수가 있는 근거는 verified로 판정한다', () => {
  const evidence = [{ id: 'a', retrieval_scores: { exact_phrase: true } }];
  assert.equal(matchQuality(evidence).level, 'verified');
});

test('분류 경로가 매칭된 근거는 verified로 판정한다', () => {
  const evidence = [{ id: 'a', classification: { matched_paths: ['노인/일자리'] } }];
  assert.equal(matchQuality(evidence).level, 'verified');
});

test('어휘 순위만 있는 근거는 keyword로 판정한다', () => {
  const evidence = [{ id: 'a', retrieval_scores: { lexical_rank: 3 } }];
  assert.equal(matchQuality(evidence).level, 'keyword');
});

test('lexical 모드에서는 점수가 없는 근거도 keyword로 판정한다', () => {
  const evidence = [{ id: 'a' }];
  assert.equal(matchQuality(evidence, 'lexical').level, 'keyword');
});

test('시 외 출처 범위(affiliate) 근거는 keyword로 판정한다', () => {
  const evidence = [{ id: 'a', source_scope: 'affiliate' }];
  assert.equal(matchQuality(evidence).level, 'keyword');
});

test('벡터 유사도만 있는 시 근거는 semantic_only로 판정한다', () => {
  const evidence = [{ id: 'a', source_scope: 'municipal', retrieval_scores: { lexical_rank: null } }];
  assert.equal(matchQuality(evidence).level, 'semantic_only');
});

test('bridge 근거와 벡터 전용 근거가 섞이면 semantic_bridge로 판정한다', () => {
  const bridge = { business_name: '노인일자리및사회활동지원확대', from_id: 'src' };
  const evidence = [
    { id: 'bridged', bridge, retrieval_scores: { method: 'semantic_bridge' } },
    { id: 'vector', source_scope: 'municipal', retrieval_scores: { lexical_rank: null } },
  ];
  assert.equal(matchQuality(evidence).level, 'semantic_bridge');
});

test('bridge 근거에 분류 경로가 있어도 직접 근거가 벡터뿐이면 verified가 아니다', () => {
  const bridge = { business_name: '노인일자리및사회활동지원확대', from_id: 'src' };
  const evidence = [
    { id: 'bridged', bridge, classification: { matched_paths: ['노인/일자리'] } },
    { id: 'vector', source_scope: 'municipal', retrieval_scores: { lexical_rank: null } },
  ];
  assert.equal(matchQuality(evidence).level, 'semantic_bridge');
});

// 연도별 신뢰도 중 가장 약한 등급을 대표로 쓴다.
test('여러 연도 신뢰도 중 가장 약한 등급을 반환한다', () => {
  const qualities = [{ level: 'verified' }, { level: 'semantic_only' }, { level: 'keyword' }];
  assert.deepEqual(weakestQuality(qualities), { level: 'semantic_only', basis: 'weakest_year' });
});

test('신뢰도 목록이 비어 있으면 none을 반환한다', () => {
  assert.equal(weakestQuality([]).level, 'none');
});

// 의미 유사 후보는 일치 구간 주변 1200자만 남기고, 원본은 바꾸지 않는다.
function semanticEvidence(extra = {}) {
  return {
    id: 'semantic-1',
    department: '노인정책과',
    text: '0123456789'.repeat(500),
    context: { start: 0, end: 5000, total_characters: 5000 },
    matched_chunk: { start: 3000, end: 3800 },
    classification: {
      department: '노인정책과',
      paths: ['노인/일자리/공공근로'],
      matched_paths: ['노인/일자리'],
    },
    ...extra,
  };
}

test('의미 유사 근거를 줄이면 일치 구간 주변 1200자만 남고 머리말 필드는 유지된다', () => {
  const original = semanticEvidence();
  const trimmed = trimSemanticEvidence(original);
  assert.equal(Array.from(trimmed.text).length, 1200);
  assert.equal(trimmed.text, original.text.slice(2800, 4000));
  assert.equal(trimmed.context.start, 2800);
  assert.equal(trimmed.context.end, 4000);
  assert.equal(trimmed.context.total_characters, 5000);
  assert.equal(trimmed.text_is_complete, false);
  assert.equal(trimmed.department, '노인정책과');
  assert.equal(trimmed.id, 'semantic-1');
  assert.deepEqual(trimmed.classification.paths, []);
  assert.deepEqual(trimmed.classification.matched_paths, []);
  assert.equal(trimmed.classification.paths_omitted, true);
  assert.equal(trimmed.classification.department, '노인정책과');
});

test('원래 경로가 없던 근거는 paths_omitted가 false다', () => {
  const trimmed = trimSemanticEvidence(semanticEvidence({ classification: { department: '노인정책과' } }));
  assert.equal(trimmed.classification.paths_omitted, false);
});

test('줄이는 과정에서 원본 근거 객체가 변경되지 않는다', () => {
  const original = semanticEvidence();
  const snapshot = structuredClone(original);
  trimSemanticEvidence(original);
  assert.deepEqual(original, snapshot);
  assert.equal(original.text.length, 5000);
  assert.equal(original.context.start, 0);
});

test('context가 없는 근거는 그대로 돌려준다', () => {
  const evidence = { id: 'plain', text: '본문' };
  assert.equal(trimSemanticEvidence(evidence), evidence);
});

// 사업명 연결은 질문과 충분히 가까운 근거에만 허용된다. 기본 픽스처는 유사도 기준을 넘는 점수를 쓴다.
const CLOSE_SCORES = { cosine: 0.6, token_maxsim: 0.7 };

// 성인지예산서 등 설명형 자료의 "사업명(회계) □사업개요" 머리에서 사업명을 읽는다.
test('사업개요 머리에서 사업명을 읽고 근거 id를 연결한다', () => {
  const evidence = [{
    id: 'desc-1',
    source_family: 'other',
    source_scope: 'municipal',
    retrieval_scores: CLOSE_SCORES,
    text: '노인일자리 및 사회활동지원확대(일반회계)\n□ 사업개요\n○사업목적: 노인 소득 보전',
  }];
  assert.deepEqual(bridgeBusinessNames(evidence), [
    { business_name: '노인일자리및사회활동지원확대', from_id: 'desc-1' },
  ]);
});

test('세출명세서(expenditure) 근거는 사업명 연결에서 무시한다', () => {
  const evidence = [{
    id: 'exp-1',
    source_family: 'expenditure',
    source_scope: 'municipal',
    retrieval_scores: CLOSE_SCORES,
    text: '노인일자리 및 사회활동지원확대(일반회계)\n□ 사업개요',
  }];
  assert.deepEqual(bridgeBusinessNames(evidence), []);
});

test('같은 사업명이 여러 근거에 있으면 한 번만 반환한다', () => {
  const text = '노인일자리 및 사회활동지원확대(일반회계)\n□ 사업개요';
  const evidence = [
    { id: 'first', source_family: 'other', source_scope: 'municipal', retrieval_scores: CLOSE_SCORES, text },
    { id: 'second', source_family: 'other', source_scope: 'municipal', retrieval_scores: CLOSE_SCORES, text },
  ];
  const result = bridgeBusinessNames(evidence);
  assert.equal(result.length, 1);
  assert.equal(result[0].from_id, 'first');
});

test('서로 다른 사업명이 세 개여도 최대 두 개만 반환한다', () => {
  const evidence = ['첫째 사업명', '둘째 사업명', '셋째 사업명'].map((name, index) => ({
    id: `desc-${index}`,
    source_family: 'other',
    source_scope: 'municipal',
    retrieval_scores: CLOSE_SCORES,
    text: `${name}(일반회계)\n□ 사업개요`,
  }));
  const result = bridgeBusinessNames(evidence);
  assert.equal(result.length, 2);
  assert.deepEqual(result.map(r => r.from_id), ['desc-0', 'desc-1']);
});

test('특별회계 표기의 사업개요 머리도 인식한다', () => {
  const evidence = [{
    id: 'water-1',
    source_family: 'other',
    source_scope: 'municipal',
    retrieval_scores: CLOSE_SCORES,
    text: '상수도 시설 개선(상수도사업특별회계)\n□ 사업개요',
  }];
  assert.deepEqual(bridgeBusinessNames(evidence), [
    { business_name: '상수도시설개선', from_id: 'water-1' },
  ]);
});

// 유사도 기준 경계: token_maxsim >= 0.6 이거나 (cosine >= 0.48 && token_maxsim >= 0.55) 일 때만 연결한다.
function bridgeCandidate(retrievalScores) {
  return [{
    id: 'desc-score',
    source_family: 'other',
    source_scope: 'municipal',
    retrieval_scores: retrievalScores,
    text: '노인일자리 및 사회활동지원확대(일반회계)\n□ 사업개요',
  }];
}

test('코사인이 낮고 토큰 최대 유사도도 기준 미만이면 사업명을 연결하지 않는다', () => {
  assert.deepEqual(bridgeBusinessNames(bridgeCandidate({ cosine: 0.39, token_maxsim: 0.5 })), []);
});

test('토큰 최대 유사도가 0.6 이상이면 코사인이 낮아도 사업명을 연결한다', () => {
  assert.deepEqual(bridgeBusinessNames(bridgeCandidate({ cosine: 0.32, token_maxsim: 0.61 })), [
    { business_name: '노인일자리및사회활동지원확대', from_id: 'desc-score' },
  ]);
});

test('코사인과 토큰 최대 유사도가 모두 기준을 넘지 못하면 연결하지 않는다', () => {
  assert.deepEqual(bridgeBusinessNames(bridgeCandidate({ cosine: 0.51, token_maxsim: 0.53 })), []);
});

test('retrieval_scores가 없는 근거는 사업명을 연결하지 않는다', () => {
  const evidence = bridgeCandidate(undefined);
  assert.deepEqual(bridgeBusinessNames(evidence), []);
});

// 세출명세서 근거에 사업명이 실제로 있을 때만 bridge 근거로 바꾼다.
test('세출 근거 본문에 사업명이 있으면 semantic_bridge 근거 객체를 반환한다', () => {
  const link = { business_name: '노인일자리및사회활동지원확대', from_id: 'desc-1' };
  const evidence = { id: 'exp-9', source_family: 'expenditure', text: '노인일자리 및 사회활동지원확대 2,000천원' };
  const bridged = asBridgedEvidence(evidence, link);
  assert.equal(bridged.id, 'exp-9');
  assert.equal(bridged.retrieval_scores.method, 'semantic_bridge');
  assert.equal(bridged.bridge.business_name, '노인일자리및사회활동지원확대');
  assert.equal(bridged.bridge.from_id, 'desc-1');
  assert.equal(bridged.bridge.basis, 'business_title_in_semantic_source');
});

test('세출 근거 본문에 사업명이 없으면 null을 반환한다', () => {
  const link = { business_name: '노인일자리및사회활동지원확대', from_id: 'desc-1' };
  const evidence = { id: 'exp-10', source_family: 'expenditure', text: '도서관 운영비 500천원' };
  assert.equal(asBridgedEvidence(evidence, link), null);
});

test('세출이 아닌 source_family 근거는 사업명이 있어도 null을 반환한다', () => {
  const link = { business_name: '노인일자리및사회활동지원확대', from_id: 'desc-1' };
  const evidence = { id: 'other-1', source_family: 'other', text: '노인일자리 및 사회활동지원확대' };
  assert.equal(asBridgedEvidence(evidence, link), null);
});

// ── 부서별 세부사업 행 읽기 ──────────────────────────────────────────────

// 사업 행 한 줄을 만든다. 열 구분은 두 칸 이상의 공백이다.
function amountLine(name, amount, previous, change) {
  return `   ${name}                    ${amount}    ${previous}   ${change}`;
}

test('사업 행에서 예산액·전년도·증감과 열 검증 결과를 읽는다', () => {
  const text = `머리말\n그 밖의 줄\n${amountLine('공공근로사업 추진', '871,000', '595,000', '276,000')}`;
  const row = businessRow(text, '공공근로사업추진');
  assert.equal(row.amount, 871000);
  assert.equal(row.previous_amount, 595000);
  assert.equal(row.change, 276000);
  assert.equal(row.columns_verified, true);
  assert.equal(row.source_line, 3);
});

test('증감이 음수(△)로 적힌 행도 읽고 열 검증을 통과한다', () => {
  const text = amountLine('공공근로사업 추진', '410,000', '1,155,000', '△745,000');
  const row = businessRow(text, '공공근로사업추진');
  assert.equal(row.change, -745000);
  assert.equal(row.columns_verified, true);
});

test('세 금액이 서로 맞지 않는 행은 열 검증이 실패한다', () => {
  const text = amountLine('공공근로사업 추진', '100', '50', '10');
  const row = businessRow(text, '공공근로사업추진');
  assert.equal(row.columns_verified, false);
});

test('이름이 없는 텍스트는 null을 반환한다', () => {
  const text = amountLine('도서관 운영', '871,000', '595,000', '276,000');
  assert.equal(businessRow(text, '공공근로사업추진'), null);
});

test('이름이 더 긴 다른 사업의 행은 일치로 보지 않는다', () => {
  const text = amountLine('공공근로사업 추진지원', '871,000', '595,000', '276,000');
  assert.equal(businessRow(text, '공공근로사업추진'), null);
});

test('세출명세서 경로에서 묶음 기준 세부사업명을 정규화해 얻는다', () => {
  const evidence = [{
    id: 'exp-1',
    source_family: 'expenditure',
    classification: { matched_paths: [{ detailed_business: '공공근로사업 추진' }] },
  }];
  assert.equal(rollupBusinessName(evidence), '공공근로사업추진');
});

test('경로가 없거나 세출명세서가 아니면 묶음 이름은 null이다', () => {
  assert.equal(rollupBusinessName([{ id: 'a', source_family: 'expenditure' }]), null);
  assert.equal(rollupBusinessName([{
    id: 'b',
    source_family: 'other',
    classification: { matched_paths: [{ detailed_business: '공공근로사업 추진' }] },
  }]), null);
});

// ── 부서별 묶음 합계 ──────────────────────

// 부서 하나의 세출명세서 쪽을 만든다.
function deptPage(id, department, amount, previous, change, extra = {}) {
  return {
    id,
    source_family: 'expenditure',
    year: 2024,
    budget_type: '본예산',
    unit: '천원',
    classification: { department },
    text: `부서 머리말\n${amountLine('공공근로사업 추진', amount, previous, change)}`,
    page_url: `https://example.test/${id}`,
    locator_label: id,
    ...extra,
  };
}

const FOUR_DEPARTMENTS = [
  deptPage('p1', '복지정책과', '754,000', '500,000', '254,000'),
  deptPage('p2', '노인정책과', '2,000,000', '1,000,000', '1,000,000'),
  deptPage('p3', '일자리정책과', '1,312,500', '800,000', '512,500'),
  deptPage('p4', '사회복지과', '2,366,200', '1,500,000', '866,200'),
];

test('부서가 다른 네 쪽의 행을 모아 네 부서와 금액 합계를 계산한다', () => {
  const rollup = businessRollup(FOUR_DEPARTMENTS, '공공근로사업추진', '본예산', false);
  assert.equal(rollup.rows.length, 4);
  assert.equal(rollup.departments.length, 4);
  assert.equal(rollup.calculated_total.amount, 754000 + 2000000 + 1312500 + 2366200);
  assert.equal(rollup.edition, '본예산');
  assert.equal(rollup.calculated_total.unit, '천원');
  assert.equal(rollup.rows_may_be_incomplete, false);
});

test('부서 미확인 행은 같은 금액의 특정 부서 행에 임의 대응하지 않고 합계를 억제한다', () => {
  const noDept = deptPage('whole', null, '100,000', '50,000', '50,000');
  const withDept = deptPage('dept', '정보통신과', '100,000', '50,000', '50,000');
  const otherDept = deptPage('other', '복지정책과', '100,000', '50,000', '50,000');
  const forward = businessRollup([noDept, withDept, otherDept], '공공근로사업추진', '본예산', false);
  const backward = businessRollup([otherDept, withDept, noDept], '공공근로사업추진', '본예산', false);
  for (const rollup of [forward, backward]) {
    assert.equal(rollup.rows.length, 3);
    assert.deepEqual(new Set(rollup.rows.map(row => row.id)), new Set(['whole', 'dept', 'other']));
    assert.equal(rollup.calculated_total, null);
  }
});

test('금액이 같은 다른 부서는 모두 남기고 같은 부서의 중복 수록만 한 번 센다', () => {
  const first = deptPage('whole-a', 'A과', '100', '0', '100');
  const duplicate = deptPage('dept-a', 'A과', '100', '0', '100');
  const second = deptPage('dept-b', 'B과', '100', '0', '100');
  const rollup = businessRollup([first, duplicate, second], '공공근로사업추진', '본예산');
  assert.equal(rollup.rows.length, 2);
  assert.deepEqual(new Set(rollup.departments), new Set(['A과', 'B과']));
  assert.equal(rollup.calculated_total.amount, 200);
});

test('부서가 확인되지 않은 별도 출처 행끼리도 금액만으로 합치지 않는다', () => {
  const rollup = businessRollup([
    deptPage('unknown-a', null, '100', '0', '100'),
    deptPage('unknown-b', null, '100', '0', '100'),
  ], '공공근로사업추진', '본예산');
  assert.equal(rollup.rows.length, 2);
  assert.equal(rollup.calculated_total, null);
});

for (const [label, extra] of [
  ['연도', {year: 2025}],
  ['편성 종류', {budget_type: '본예산', revision: null}],
  ['추경 회차', {revision: 2}],
  ['금액 단위', {unit: '원'}],
]) {
  test(`${label}가 다른 부서 행은 합산하지 않는다`, () => {
    const edition = {budget_type: '추경', revision: 1};
    const rollup = businessRollup([
      deptPage('a', 'A과', '100', '0', '100', edition),
      deptPage('b', 'B과', '200', '0', '200', {...edition, ...extra}),
    ], '공공근로사업추진', '추경');
    assert.equal(rollup.rows.length, 2);
    assert.equal(rollup.calculated_total, null);
  });
}

test('같은 연도와 추경 회차의 서로 다른 부서는 합산할 수 있다', () => {
  const edition = {budget_type: '추경', revision: 1};
  const rollup = businessRollup([
    deptPage('a', 'A과', '100', '0', '100', edition),
    deptPage('b', 'B과', '200', '0', '200', edition),
  ], '공공근로사업추진', '추경');
  assert.equal(rollup.calculated_total.amount, 300);
});

test('같은 부서의 같은 숫자라도 단위가 다르면 중복으로 없애지 않는다', () => {
  const rollup = businessRollup([
    deptPage('a', 'A과', '100', '0', '100'),
    deptPage('b', 'A과', '100', '0', '100', {unit: '원'}),
  ], '공공근로사업추진', '본예산');
  assert.equal(rollup.rows.length, 2);
  assert.equal(rollup.calculated_total, null);
});

for (const [label, extra] of [
  ['연도 미확인', {year: null}],
  ['편성 종류 미확인', {budget_type: null}],
  ['금액 단위 미확인', {unit: null}],
  ['추경 회차 미확인', {budget_type: '추경', revision: null}],
]) {
  test(`${label} 행끼리는 동일 편성으로 추정하여 합산하지 않는다`, () => {
    const rollup = businessRollup([
      deptPage('a', 'A과', '100', '0', '100', extra),
      deptPage('b', 'B과', '200', '0', '200', extra),
    ], '공공근로사업추진', '본예산');
    assert.equal(rollup.rows.length, 2);
    assert.equal(rollup.calculated_total, null);
  });
}

test('공백 부서와 공백만 다른 같은 부서 행으로 합계를 만들지 않는다', () => {
  for (const departments of [[' ', 'B과'], ['A 과', 'A과']]) {
    const rollup = businessRollup([
      deptPage('a', departments[0], '100', '0', '100'),
      deptPage('b', departments[1], '200', '0', '200'),
    ], '공공근로사업추진', '본예산');
    assert.equal(rollup.calculated_total, null);
  }
});

test('본예산의 null과 0 회차는 같은 편성으로 처리한다', () => {
  const rollup = businessRollup([
    deptPage('a', 'A과', '100', '0', '100', {revision: null}),
    deptPage('b', 'B과', '200', '0', '200', {revision: 0}),
  ], '공공근로사업추진', '본예산');
  assert.equal(rollup.calculated_total.amount, 300);
});

test('안전한 정수 범위를 넘는 합계는 반환하지 않는다', () => {
  const rollup = businessRollup([
    deptPage('a', 'A과', '9,007,199,254,740,991', '0', '9,007,199,254,740,991'),
    deptPage('b', 'B과', '1', '0', '1'),
  ], '공공근로사업추진', '본예산');
  assert.equal(rollup.calculated_total, null);
});

test('후보가 잘렸으면 합계 없이 행이 불완전할 수 있다고 표시한다', () => {
  const rollup = businessRollup(FOUR_DEPARTMENTS, '공공근로사업추진', '본예산', true);
  assert.equal(rollup.calculated_total, null);
  assert.equal(rollup.rows_may_be_incomplete, true);
  assert.equal(rollup.rows.length, 4);
});

test('한 행이라도 열 검증에 실패하면 합계를 내지 않는다', () => {
  const pages = [...FOUR_DEPARTMENTS.slice(0, 3), deptPage('p4', '사회복지과', '100', '50', '10')];
  const rollup = businessRollup(pages, '공공근로사업추진', '본예산', false);
  assert.equal(rollup.rows.length, 4);
  assert.equal(rollup.calculated_total, null);
});

test('세출명세서가 아닌 쪽은 묶음에서 제외한다', () => {
  const other = { ...deptPage('o1', '기타과', '9,999,999', '1', '9,999,998'), source_family: 'other' };
  const rollup = businessRollup([...FOUR_DEPARTMENTS, other], '공공근로사업추진', '본예산', false);
  assert.equal(rollup.rows.length, 4);
  assert.equal(rollup.departments.includes('기타과'), false);
});

test('해당 세부사업 행이 하나도 없으면 null을 반환한다', () => {
  assert.equal(businessRollup(FOUR_DEPARTMENTS, '도서관운영', '본예산', false), null);
  assert.equal(businessRollup(FOUR_DEPARTMENTS, null, '본예산', false), null);
});

// ── 긴 기간 조회용 근거 축소 ─────────────────────────────────────────────

// 4,000자짜리 세출 본문을 만든다. 40번째 줄에 사업 행을 둔다.
function longEvidence(extra = {}) {
  const lines = Array.from({ length: 80 }, (_, i) => `줄${i + 1}`.padEnd(48, '.'));
  lines[39] = amountLine('공공근로사업 추진', '871,000', '595,000', '276,000');
  const text = lines.join('\n');
  return {
    id: 'long-1',
    source_family: 'expenditure',
    text,
    context: { start: 0, end: Array.from(text).length, total_characters: Array.from(text).length },
    classification: {
      department: '노인정책과',
      paths: ['경로1', '경로2'],
      matched_paths: [{ detailed_business: '공공근로사업 추진', source_line: 40 }],
    },
    ...extra,
  };
}

test('긴 세출 근거를 줄이면 사업 행이 남고 1,500자 이하가 되며 경로는 비운다', () => {
  const original = longEvidence();
  const compact = compactEvidence(original);
  assert(Array.from(compact.text).length <= 1500, '1,500자 이하');
  assert(compact.text.includes(amountLine('공공근로사업 추진', '871,000', '595,000', '276,000')));
  assert.deepEqual(compact.classification.paths, []);
  assert.equal(compact.classification.paths_omitted, true);
});

test('경로 목록은 여섯 개까지만 남긴다', () => {
  const matched = Array.from({ length: 8 }, (_, i) => ({ detailed_business: `사업${i}`, source_line: 40 }));
  const compact = compactEvidence(longEvidence({ classification: { paths: [], matched_paths: matched } }));
  assert.equal(compact.classification.matched_paths.length, 6);
  assert.equal(compact.classification.paths_omitted, false);
});

test('경로가 없는 근거는 trimSemanticEvidence와 같은 결과이고 1,200자 이하다', () => {
  const evidence = longEvidence({ classification: { department: '노인정책과' } });
  const compact = compactEvidence(evidence);
  assert.deepEqual(compact, trimForCompare(evidence));
  assert(Array.from(compact.text).length <= 1200);
});

test('줄이는 과정에서 원본 근거 객체가 변경되지 않는다', () => {
  const original = longEvidence();
  const snapshot = structuredClone(original);
  compactEvidence(original);
  assert.deepEqual(original, snapshot);
});

test('context가 없는 근거는 그대로 돌려준다', () => {
  const evidence = { id: 'plain', text: '본문' };
  assert.equal(compactEvidence(evidence), evidence);
});
