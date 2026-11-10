import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import worker from '../dist/server/index.js';

// 정적 자산 환경: dist/client 아래 파일을 읽고, 의미 검색 토큰은 snapshot에서 보충한다.
const root = path.resolve('dist/client');
const env = {ASSETS: {async fetch(req) {
  const pathname = new URL(req.url).pathname;
  const p = path.resolve(root, '.' + pathname);
  if (!p.startsWith(root + path.sep)) return new Response('', {status: 403});
  try {
    return new Response(await readFile(p));
  } catch (error) {
    if (!/^\/semantic\/tokens-\d+\.bin\.gz$/.test(pathname)) return new Response('', {status: 404});
    try {
      return new Response(await readFile(path.resolve('snapshot', '.' + pathname)));
    } catch (snapshotError) {
      return new Response('', {status: 404});
    }
  }
}}};

async function get(route) {
  const r = await worker.fetch(new Request('https://test.local' + route), env);
  return {status: r.status, data: await r.json()};
}
async function research(query, extra = {}) {
  const {data, status} = await get('/api/research?' + new URLSearchParams({query, ...extra}));
  assert.equal(status, 200, query + ' 응답 상태');
  return data;
}

const BUDGET_PLAN_TYPES = ['본예산', '추경'];

// 규칙: 결산을 묻지 않은 질문은 예산편성 자료(본예산·추경)만 근거로 쓴다.
test('결산을 묻지 않은 사업 예산 질의는 본예산 또는 추경 근거만 반환한다', async () => {
  const queries = [
    '노인일자리 및 사회활동지원 예산',
    '2024년 청년 지원 사업 예산',
    '2025년 도로 유지보수 예산',
    '도서관 운영 예산',
    '정보통신과 2026년 예산',
  ];
  for (const query of queries) {
    const r = await research(query);
    assert(r.evidence.length >= 1, query + ': 근거가 1건 이상이어야 함');
    const types = r.evidence.map(e => e.budget_type);
    assert(types.every(t => BUDGET_PLAN_TYPES.includes(t)),
      query + ': 편성 구분 ' + JSON.stringify(types));
  }
});

test('결산을 묻지 않은 총액 질의는 첫 근거가 본예산이다', async () => {
  const r = await research('2025년 성남시 예산 총액');
  assert.equal(r.evidence[0].budget_type, '본예산');
});

test('연도 비교에서 편성 구분을 지정하지 않으면 모든 근거가 본예산이다', async () => {
  const r = await research('2024년 2026년 노인일자리 예산 비교');
  assert(r.evidence.length >= 1, '근거가 1건 이상이어야 함');
  const types = r.evidence.map(e => e.budget_type);
  assert(types.every(t => t === '본예산'), '편성 구분 ' + JSON.stringify(types));
});

test('결산을 명시한 질의는 결산 근거만 반환한다', async () => {
  const r = await research('2024년 결산 세출 집행액');
  assert(r.evidence.length >= 1, '근거가 1건 이상이어야 함');
  const types = r.evidence.map(e => e.budget_type);
  assert(types.every(t => t === '결산'), '편성 구분 ' + JSON.stringify(types));
});
