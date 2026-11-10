#!/usr/bin/env node
// 성남시 예산 검색 정답셋 평가기 (측정 도구).
//
// 사용법
//   node scripts/evaluate-golden.mjs                       로컬 빌드(dist/server/index.js)를 직접 호출
//   node --use-system-ca scripts/evaluate-golden.mjs --base <URL>   원격 서버 평가
//   옵션: --category <이름>  특정 카테고리만 / --json  기계가 읽을 요약만 출력 / --strict  실패 시 종료 코드 1
//
// 정답셋: tests/fixtures/golden-queries.json (expect 조건 설명은 각 check* 함수 주석 참고)
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GOLDEN_PATH = path.join(ROOT, 'tests', 'fixtures', 'golden-queries.json');
const FORWARDED_ARGS = ['year', 'budget_type', 'revision', 'limit', 'mode'];
const REMOTE_CONCURRENCY = 4;
const SNIPPET_LENGTH = 60;
const EVIDENCE_PREVIEW_COUNT = 3;

/** 공백을 모두 제거해 비교용 문자열로 만든다. */
export function squash(value) {
  return String(value ?? '').replace(/\s+/g, '');
}

/** 조건 값이 배열이면 "그중 하나", 아니면 단일 값 비교. */
function equalsAny(actual, expected) {
  const candidates = Array.isArray(expected) ? expected : [expected];
  return candidates.some((candidate) => actual === candidate);
}

/**
 * matched_path: 한 경로(matched_paths 1개)가 아래 키를 모두 만족해야 한다.
 *   detailed_business(공백 무시 포함), combined_code(예: "201-01", 일치), statistical_item(통계목명 공백 무시 포함)
 */
function matchPath(candidate, wanted) {
  const business = squash(candidate.detailed_business);
  const item = squash(candidate.statistical_item?.name);
  if (wanted.detailed_business && !business.includes(squash(wanted.detailed_business))) return false;
  if (wanted.combined_code && candidate.combined_code !== wanted.combined_code) return false;
  if (wanted.statistical_item && !item.includes(squash(wanted.statistical_item))) return false;
  return true;
}

/** 근거 1건이 단일 필드 조건을 만족하는지 판정한다. */
function matchField(evidence, key, expected) {
  const classification = evidence.classification ?? {};
  switch (key) {
    case 'year':
    case 'budget_type':
    case 'revision':
    case 'source_family':
      return equalsAny(evidence[key] ?? null, expected);
    case 'department': {
      const actual = squash(classification.department);
      const wanted = Array.isArray(expected) ? expected : [expected];
      return wanted.some((name) => squash(name) === actual);
    }
    case 'text_includes': {
      const text = squash(evidence.text);
      return expected.every((needle) => text.includes(squash(needle)));
    }
    case 'matched_path_business': {
      const paths = classification.matched_paths ?? [];
      return paths.some((p) => squash(p.detailed_business).includes(squash(expected)));
    }
    case 'matched_path':
      return (classification.matched_paths ?? []).some((p) => matchPath(p, expected));
    default:
      throw new Error(`알 수 없는 근거 조건 키: ${key}`);
  }
}

/** 근거 1건이 조건 묶음(모든 키)을 만족하는지 판정한다. */
export function matchCondition(evidence, condition) {
  return Object.entries(condition).every(([key, value]) => matchField(evidence, key, value));
}

/** 조건 묶음에서 실제 근거 한 건이 어긋난 키 목록을 돌려준다(실패 설명용). */
function mismatchedKeys(evidence, condition) {
  return Object.entries(condition)
    .filter(([key, value]) => !matchField(evidence, key, value))
    .map(([key]) => key);
}

/** any_evidence: 상위 근거 중 하나가 조건을 모두 만족해야 한다. 배열이면 묶음마다 만족하는 근거가 필요. */
function checkAnyEvidence(evidenceList, spec) {
  const groups = Array.isArray(spec) ? spec : [spec];
  const failures = [];
  for (const group of groups) {
    if (evidenceList.some((e) => matchCondition(e, group))) continue;
    failures.push(`any_evidence 불만족: ${JSON.stringify(group)}`);
  }
  return failures;
}

/** all_evidence: 모든 근거가 조건을 만족해야 한다(근거가 없으면 실패). */
function checkAllEvidence(evidenceList, spec) {
  if (evidenceList.length === 0) return ['all_evidence 불만족: 근거가 없음'];
  const bad = evidenceList.filter((e) => !matchCondition(e, spec));
  if (bad.length === 0) return [];
  const keys = [...new Set(bad.flatMap((e) => mismatchedKeys(e, spec)))];
  return [`all_evidence 불만족: ${bad.length}/${evidenceList.length}건이 ${keys.join(',')} 조건 위반`];
}

/** answer_card_total: answer_card.rows[0].amount(천원)가 정수와 같아야 한다. */
function checkAnswerCardTotal(response, expected) {
  const actual = response.answer_card?.rows?.[0]?.amount;
  if (actual === expected) return [];
  return [`answer_card_total 불일치: 기대 ${expected}, 실제 ${actual ?? '없음'}`];
}

/** match_quality_in: match_quality.level 이 배열 안의 값이어야 한다. */
function checkMatchQuality(response, allowed) {
  const level = response.match_quality?.level;
  if (level === undefined) return ['match_quality_in 판정 불가: 응답에 match_quality 없음'];
  if (allowed.includes(level)) return [];
  return [`match_quality_in 불일치: 기대 ${allowed.join('|')}, 실제 ${level}`];
}

/** evidence_count_min / evidence_count_max 판정. */
function checkEvidenceCount(evidenceList, expect) {
  const failures = [];
  const count = evidenceList.length;
  if (expect.evidence_count_min !== undefined && count < expect.evidence_count_min) {
    failures.push(`evidence_count_min 위반: ${count} < ${expect.evidence_count_min}`);
  }
  if (expect.evidence_count_max !== undefined && count > expect.evidence_count_max) {
    failures.push(`evidence_count_max 위반: ${count} > ${expect.evidence_count_max}`);
  }
  return failures;
}

/** 응답 1건에 대해 expect 전체를 판정하고 실패 사유 목록을 돌려준다. */
export function judge(response, expect) {
  const all = Array.isArray(response.evidence) ? response.evidence : [];
  const evidenceList = expect.top_k ? all.slice(0, expect.top_k) : all;
  const failures = [];
  if (expect.any_evidence) failures.push(...checkAnyEvidence(evidenceList, expect.any_evidence));
  if (expect.all_evidence) failures.push(...checkAllEvidence(evidenceList, expect.all_evidence));
  if (expect.answer_card_total !== undefined) {
    failures.push(...checkAnswerCardTotal(response, expect.answer_card_total));
  }
  if (expect.match_quality_in) failures.push(...checkMatchQuality(response, expect.match_quality_in));
  failures.push(...checkEvidenceCount(evidenceList, expect));
  return failures;
}

/** 질의 항목을 /api/research 경로로 만든다. */
export function buildRoute(item) {
  const params = new URLSearchParams({query: item.query});
  for (const key of FORWARDED_ARGS) {
    const value = item.args?.[key];
    if (value !== undefined && value !== null) params.set(key, String(value));
  }
  return `/api/research?${params}`;
}

/** 로컬 빌드를 직접 불러 fetch 함수를 만든다(tests/worker.test.mjs 의 env 주입 방식과 동일). */
async function createLocalFetcher() {
  const clientRoot = path.join(ROOT, 'dist', 'client');
  const snapshotRoot = path.join(ROOT, 'snapshot');
  const tokenPattern = /^\/semantic\/tokens-\d+\.bin\.gz$/;
  const readUnder = async (root, pathname) => {
    const file = path.resolve(root, '.' + pathname);
    if (!file.startsWith(root + path.sep)) return null;
    try {
      return await readFile(file);
    } catch {
      return null; // 파일이 없으면 호출자가 다음 위치를 시도한다
    }
  };
  const env = {
    ASSETS: {
      async fetch(request) {
        const pathname = new URL(request.url).pathname;
        const body = (await readUnder(clientRoot, pathname))
          ?? (tokenPattern.test(pathname) ? await readUnder(snapshotRoot, pathname) : null);
        return body ? new Response(body) : new Response('', {status: 404});
      },
    },
  };
  const worker = (await import(pathToFileURL(path.join(ROOT, 'dist', 'server', 'index.js')))).default;
  return async (route) => {
    const response = await worker.fetch(new Request('https://test.local' + route), env);
    return response.json();
  };
}

/** 원격 서버용 fetch 함수를 만든다. */
function createRemoteFetcher(base) {
  const origin = base.replace(/\/+$/, '');
  return async (route) => {
    const response = await fetch(origin + route);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  };
}

/** 근거 1건을 사람이 읽을 한 줄 요약으로 만든다. */
function summarizeEvidence(evidence) {
  const revision = evidence.revision ? `#${evidence.revision}` : '';
  const text = String(evidence.text ?? '').replace(/\s+/g, ' ').slice(0, SNIPPET_LENGTH);
  const department = evidence.classification?.department ?? '-';
  return `${evidence.year} ${evidence.budget_type}${revision} ${evidence.source_family} [${department}] ${text}`;
}

/** 항목 1건을 질의·판정해 결과 객체로 돌려준다. 호출 오류도 실패로 기록한다. */
async function evaluateItem(item, fetchRoute) {
  try {
    const response = await fetchRoute(buildRoute(item));
    const failures = judge(response, item.expect ?? {});
    const top = (response.evidence ?? []).slice(0, EVIDENCE_PREVIEW_COUNT).map(summarizeEvidence);
    return {id: item.id, category: item.category, query: item.query, passed: failures.length === 0, failures, top};
  } catch (error) {
    return {id: item.id, category: item.category, query: item.query, passed: false,
      failures: [`호출 오류: ${error.message}`], top: []};
  }
}

/** 제한된 동시성으로 항목을 순서대로 평가한다(결과 순서는 입력 순서 유지). */
async function evaluateAll(items, fetchRoute, concurrency) {
  const results = new Array(items.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await evaluateItem(items[index], fetchRoute);
    }
  };
  await Promise.all(Array.from({length: concurrency}, worker));
  return results;
}

/** 결과를 카테고리별로 집계한다. */
export function summarize(results) {
  const categories = {};
  for (const result of results) {
    const entry = (categories[result.category] ??= {passed: 0, total: 0});
    entry.total += 1;
    if (result.passed) entry.passed += 1;
  }
  const passed = results.filter((r) => r.passed).length;
  const rate = results.length ? passed / results.length : 0;
  return {total: results.length, passed, rate: Number(rate.toFixed(4)), categories};
}

/** 사람이 읽는 보고서를 출력한다. */
function printReport(summary, results) {
  console.log('카테고리별 통과');
  for (const [name, {passed, total}] of Object.entries(summary.categories)) {
    console.log(`  ${name.padEnd(16)} ${passed}/${total}`);
  }
  console.log(`전체 통과율: ${summary.passed}/${summary.total} (${(summary.rate * 100).toFixed(1)}%)`);
  for (const result of results.filter((r) => !r.passed)) {
    console.log(`\n[실패] ${result.id} (${result.category}) ${result.query}`);
    for (const failure of result.failures) console.log(`  - ${failure}`);
    for (const line of result.top) console.log(`  · ${line}`);
    if (result.top.length === 0) console.log('  · (근거 없음)');
  }
}

/** 명령행 인자를 해석한다. */
function parseArgs(argv) {
  const options = {base: null, category: null, json: false, strict: false};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--base') options.base = argv[++i];
    else if (arg === '--category') options.category = argv[++i];
    else if (arg === '--json') options.json = true;
    else if (arg === '--strict') options.strict = true;
    else throw new Error(`알 수 없는 옵션: ${arg}`);
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const golden = JSON.parse(await readFile(GOLDEN_PATH, 'utf8'));
  const items = golden.items.filter((item) => !options.category || item.category === options.category);
  if (items.length === 0) throw new Error('평가할 항목이 없습니다(카테고리 이름을 확인하세요).');
  const fetchRoute = options.base ? createRemoteFetcher(options.base) : await createLocalFetcher();
  const results = await evaluateAll(items, fetchRoute, options.base ? REMOTE_CONCURRENCY : 1);
  const summary = summarize(results);
  if (options.json) {
    const failures = results.filter((r) => !r.passed);
    console.log(JSON.stringify({...summary, failures}, null, 2));
  } else {
    printReport(summary, results);
  }
  if (options.strict && summary.passed < summary.total) process.exitCode = 1;
}

// 모듈로 불러올 때(정답셋 작성 보조 스크립트 등)는 실행하지 않는다.
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error('평가 실패:', error.message);
    process.exitCode = 2;
  });
}
