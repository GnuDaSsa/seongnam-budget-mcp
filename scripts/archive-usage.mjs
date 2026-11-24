import {lstat, readFile, rename, unlink, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const endpoint = 'https://seongnam-budget-research-20261107.gnudas0923.chatgpt.site/api/traffic';
const fields = ['total_calls', 'benchmark_calls', 'unclassified_calls', 'success_calls', 'error_calls'];

function counts(row) {
  if (!row || fields.some(field => !Number.isSafeInteger(row[field]) || row[field] < 0) ||
      row.total_calls !== row.benchmark_calls + row.unclassified_calls ||
      row.total_calls !== row.success_calls + row.error_calls) {
    throw new Error('호출 분류별 합계가 일치하지 않습니다.');
  }
  return Object.fromEntries(fields.map(field => [field, row[field]]));
}

function snapshot(data, today) {
  if (data?.timezone !== 'Asia/Seoul' || !Array.isArray(data.daily) || !data.daily.length) {
    throw new Error('기록할 일별 집계가 없습니다.');
  }
  const total = counts(data);
  const daily = data.daily.map(row => {
    if (typeof row.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.day) ||
        new Date(row.day + 'T00:00:00Z').toISOString().slice(0, 10) !== row.day || row.day > today) {
      throw new Error('집계 날짜를 확인할 수 없습니다.');
    }
    const values = counts(row);
    if (!values.total_calls) throw new Error('빈 날짜 행은 보관하지 않습니다.');
    return {day: row.day, ...values};
  }).sort((a, b) => a.day.localeCompare(b.day));
  if (data.first_day !== daily[0].day || data.last_day !== daily.at(-1).day ||
      new Set(daily.map(row => row.day)).size !== daily.length ||
      fields.some(field => daily.reduce((sum, row) => sum + row[field], 0) !== total[field])) {
    throw new Error('누적 수치와 날짜별 기록이 일치하지 않습니다.');
  }
  return {timezone: data.timezone, first_day: data.first_day, last_day: data.last_day, ...total, daily};
}

export function prepareArchive(data, previous, now = new Date()) {
  const today = new Intl.DateTimeFormat('sv-SE', {timeZone: 'Asia/Seoul'}).format(now);
  const next = snapshot(data, today);
  if (previous) {
    const before = snapshot(previous, today);
    const byDay = new Map(next.daily.map(row => [row.day, row]));
    for (const row of before.daily) {
      const current = byDay.get(row.day);
      if (!current || fields.some(field => current[field] < row[field])) {
        throw new Error('기존 일별 기록이 누락되거나 감소했습니다. ' + row.day);
      }
    }
    if (JSON.stringify(next) === JSON.stringify(before)) return null;
  }
  return next;
}

async function archive(target) {
  if (!target) throw new Error('사용법: node scripts/archive-usage.mjs <보관할 JSON 경로>');
  let previous = null;
  try {
    if (!(await lstat(target)).isFile()) throw new Error('기존 보관본이 일반 파일이 아닙니다.');
    previous = JSON.parse(await readFile(target, 'utf8'));
    if (!previous || typeof previous !== 'object') throw new Error('기존 보관본 형식이 잘못되었습니다.');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const response = await fetch(endpoint, {redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(30000)});
  if (!response.ok) throw new Error('호출 현황 조회 실패 (HTTP ' + response.status + ')');
  const next = prepareArchive(await response.json(), previous);
  if (!next) {
    console.log('마지막 기록 이후 집계 변화가 없습니다.');
    return;
  }
  const temporary = target + '.tmp-' + process.pid;
  await writeFile(temporary, JSON.stringify(next, null, 2) + '\n', {flag: 'wx'});
  try {
    await rename(temporary, target);
  } finally {
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
  console.log(next.first_day + ' ~ ' + next.last_day + ' · ' + next.total_calls + '건');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await archive(process.argv[2]);
}
