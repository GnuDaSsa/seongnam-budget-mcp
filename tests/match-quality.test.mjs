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
