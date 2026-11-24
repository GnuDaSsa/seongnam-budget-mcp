import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {recordToolUsage,getMcpUsage} from '../worker/traffic.js';

function usageDatabase(t) {
 const sqlite = new DatabaseSync(':memory:');
 t.after(() => sqlite.close());
 sqlite.exec(readFileSync(new URL('../drizzle/0000_mcp_usage_daily.sql',import.meta.url),'utf8'));
 return {
  prepare(sql) {
   const statement = sqlite.prepare(sql);
   return {
    bind(...args) {
     return {async run() { statement.run(...args); return {success:true}; }};
    },
    async all() { return {success:true,results:statement.all()}; },
   };
  },
 };
}

test('successful schema read with no usage yields zero with no date range',async t => {
 const summary = await getMcpUsage(usageDatabase(t));
 assert.equal(summary.total_calls,0);
 assert.equal(summary.first_day,null);
 assert.equal(summary.last_day,null);
 assert.deepEqual(summary.daily,[]);
});

test('KST days, successes and failures, and marked benchmark calls roll up separately',async t => {
 const db = usageDatabase(t);
 const beforeMidnight = Date.parse('2026-11-24T14:59:59.999Z');
 const afterMidnight = beforeMidnight + 1;
 await Promise.all(Array.from({length:40},() => recordToolUsage(db,'untracked-client',false,beforeMidnight)));
 assert.equal(await recordToolUsage(db,'SeongnamBudgetQA/1.0',false,afterMidnight),true);
 assert.equal(await recordToolUsage(db,'SeongnamBudgetQA/1.0',true,afterMidnight),true);
 assert.equal(await recordToolUsage(db,'different-client',true,afterMidnight),true);
 const summary = await getMcpUsage(db);
 assert.equal(summary.timezone,'Asia/Seoul');
 assert.equal(summary.first_day,'2026-11-24');
 assert.equal(summary.last_day,'2026-11-25');
 assert.equal(summary.total_calls,43);
 assert.equal(summary.success_calls,41);
 assert.equal(summary.error_calls,2);
 assert.equal(summary.benchmark_calls,2);
 assert.equal(summary.unclassified_calls,41);
 assert.deepEqual(summary.daily.map(row => [row.day,row.benchmark_calls,row.unclassified_calls,row.total_calls]),
  [['2026-11-24',0,40,40],['2026-11-25',2,1,3]]);
 assert.doesNotMatch(JSON.stringify(summary),/untracked-client|different-client|SeongnamBudgetQA/);
});

test('unavailable storage does not report a false zero or expose internal error details',async () => {
 const missing = undefined;
 const broken = {prepare() {throw new Error('private backend failure detail');}};
 for (const db of [missing,broken]) {
  assert.equal(await recordToolUsage(db,null,false,Date.now()),false);
  await assert.rejects(getMcpUsage(db),{message:'호출 집계 저장소를 조회할 수 없습니다.'});
 }
});
