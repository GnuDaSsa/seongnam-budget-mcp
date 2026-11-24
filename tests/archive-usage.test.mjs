import assert from 'node:assert/strict';
import test from 'node:test';
import {prepareArchive} from '../scripts/archive-usage.mjs';

const now = new Date('2026-11-24T15:01:00Z');
function row(day, benchmark, unclassified, error = 0) {
  const total = benchmark + unclassified;
  return {day, total_calls: total, benchmark_calls: benchmark, unclassified_calls: unclassified,
    success_calls: total - error, error_calls: error};
}
function usage(...rows) {
  const result = {timezone: 'Asia/Seoul', first_day: rows[0]?.day ?? null, last_day: rows.at(-1)?.day ?? null, daily: rows};
  for (const key of ['total_calls', 'benchmark_calls', 'unclassified_calls', 'success_calls', 'error_calls']) {
    result[key] = rows.reduce((sum, entry) => sum + entry[key], 0);
  }
  return result;
}
const a = row('2026-11-24', 5, 4, 1), b = row('2026-11-25', 0, 3);

test('adds a new Korean calendar day and only publishes aggregate fields', () => {
  const next = usage(a, b);
  const received = {...next, arbitraryMetadata: 'private', daily: [a, {...b, query: 'private'}]};
  assert.deepEqual(prepareArchive(received, usage(a), now), next);
  assert.equal(prepareArchive(received, next, now), null);
});

test('empty, malformed and inconsistent results cannot overwrite an archive', () => {
  for (const invalid of [null, usage(), {...usage(a), total_calls: 8}, {...usage(a), last_day: b.day},
      usage(a, a), usage({...a, day: '2026-02-29'}), usage({...a, day: '2026-11-26'}),
      usage({...a, error_calls: -1}), usage({...a, unclassified_calls: '4'})]) {
    assert.throws(() => prepareArchive(invalid, usage(a), now));
  }
});

test('larger totals do not excuse a missing date or any decreasing bucket', () => {
  const more = row('2026-11-25', 20, 30);
  for (const invalid of [usage(more), usage(row(a.day, 4, 6, 1), more), usage(row(a.day, 5, 6, 0), more)]) {
    assert.throws(() => prepareArchive(invalid, usage(a), now), /누락되거나 감소/);
  }
});
