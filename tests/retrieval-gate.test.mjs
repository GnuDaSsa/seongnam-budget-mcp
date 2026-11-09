import test from 'node:test';import assert from 'node:assert/strict';import {RetrievalGate} from '../worker/retrieval-gate.js';
test('bounds concurrency, queues FIFO and releases permits even on failure',async()=>{
 const gate=new RetrievalGate({maxActive:2,maxQueued:3});let active=0,peak=0,order=[],release=[];
 const task=i=>gate.run(async()=>{order.push(i);active++;peak=Math.max(peak,active);await new Promise(r=>release[i]=r);active--;if(i===2)throw Error('expected');return i;});
 const jobs=[0,1,2,3,4].map(task);assert.deepEqual(gate.stats(),{active:2,queued:3});
 await assert.rejects(gate.run(async()=>1),/동시 검색/);
 release[0]();await jobs[0];await Promise.resolve();assert.deepEqual(order,[0,1,2]);
 release[1]();await jobs[1];await Promise.resolve();assert.deepEqual(order,[0,1,2,3]);
 release[2]();await assert.rejects(jobs[2],/expected/);await Promise.resolve();assert.deepEqual(order,[0,1,2,3,4]);
 release[3]();release[4]();await Promise.all([jobs[3],jobs[4]]);assert.equal(peak,2);assert.deepEqual(gate.stats(),{active:0,queued:0});
 assert.equal(await gate.run(async()=>7),7);
});
test('invalid limits are rejected',()=>{assert.throws(()=>new RetrievalGate({maxActive:0}));assert.throws(()=>new RetrievalGate({maxQueued:-1}));});

test('default gate admits one expensive task at a time',async()=>{
 const gate=new RetrievalGate();let release,secondStarted=false;
 const first=gate.run(()=>new Promise(r=>release=r));const second=gate.run(async()=>{secondStarted=true;return 2});
 assert.deepEqual(gate.stats(),{active:1,queued:1});assert.equal(secondStarted,false);release(1);
 assert.equal(await first,1);assert.equal(await second,2);assert.equal(secondStarted,true);assert.deepEqual(gate.stats(),{active:0,queued:0});
});

test('expired waiter is removed and later queued work retains its permit and order',async()=>{
 const callbacks=new Map();let nextId=0;const gate=new RetrievalGate({maxActive:1,maxQueued:2,waitTimeoutMs:100,setTimer:fn=>{const id=++nextId;callbacks.set(id,fn);return id},clearTimer:id=>callbacks.delete(id)});
 let release;const first=gate.run(()=>new Promise(r=>release=r));let expiredStarted=false;
 const expired=gate.run(async()=>{expiredStarted=true});const rejected=assert.rejects(expired,/대기 시간이 초과/);
 const later=gate.run(async()=>42);assert.deepEqual(gate.stats(),{active:1,queued:2});callbacks.get(1)();callbacks.delete(1);await rejected;
 assert.equal(expiredStarted,false);assert.deepEqual(gate.stats(),{active:1,queued:1});release();await first;assert.equal(await later,42);
 assert.deepEqual(gate.stats(),{active:0,queued:0});assert.equal(callbacks.size,0);
});

test('timeout of all waiting work never consumes or releases the active permit',async()=>{
 const callbacks=[];const gate=new RetrievalGate({maxQueued:2,waitTimeoutMs:100,setTimer:fn=>(callbacks.push(fn),callbacks.length),clearTimer:()=>{}});
 let release;const first=gate.run(()=>new Promise(r=>release=r));const waiting=[gate.run(async()=>1),gate.run(async()=>2)];const outcomes=Promise.allSettled(waiting);
 callbacks.forEach(fn=>fn());assert((await outcomes).every(x=>x.status==='rejected'));assert.deepEqual(gate.stats(),{active:1,queued:0});
 release();await first;assert.deepEqual(gate.stats(),{active:0,queued:0});assert.equal(await gate.run(async()=>3),3);
});

test('invalid timeout is rejected',()=>{assert.throws(()=>new RetrievalGate({waitTimeoutMs:0}));assert.throws(()=>new RetrievalGate({waitTimeoutMs:2147483648}));});

test('full default queue times out cleanly without starting stale work',async()=>{
 const timers=new Map();let seq=0;const gate=new RetrievalGate({setTimer:fn=>{const id=++seq;timers.set(id,fn);return id},clearTimer:id=>timers.delete(id)});
 let release,started=0;const first=gate.run(()=>new Promise(r=>release=r));const pending=Array.from({length:24},()=>gate.run(async()=>{started++}));const outcomes=Promise.allSettled(pending);
 await assert.rejects(gate.run(async()=>{}),/동시 검색/);assert.deepEqual(gate.stats(),{active:1,queued:24});
 for(const fn of [...timers.values()])fn();assert((await outcomes).every(x=>x.status==='rejected'));assert.equal(started,0);assert.deepEqual(gate.stats(),{active:1,queued:0});
 release();await first;assert.deepEqual(gate.stats(),{active:0,queued:0});assert.equal(await gate.run(async()=>9),9);
});

test('stalled watchdog fails queued and new work without releasing the active permit',async()=>{
 let fire,release;const gate=new RetrievalGate({activeTimeoutMs:30,setWatchdog:fn=>(fire=fn,1),clearWatchdog:()=>{}});
 const active=gate.run(()=>new Promise(r=>release=r));const queued=gate.run(async()=>{throw Error('queued work must not start')});const rejected=assert.rejects(queued,/처리가 지연/);
 fire();await rejected;assert.equal(gate.isStalled(),true);assert.deepEqual(gate.stats(),{active:1,queued:0});
 await assert.rejects(gate.run(async()=>99),/처리가 지연/);assert.deepEqual(gate.stats(),{active:1,queued:0});
 release('original result');assert.equal(await active,'original result');assert.equal(gate.isStalled(),false);assert.deepEqual(gate.stats(),{active:0,queued:0});assert.equal(await gate.run(async()=>7),7);
});

test('another completion cannot clear a watchdog belonging to a still-running task',async()=>{
 const watchdogs=[];const gate=new RetrievalGate({maxActive:2,setWatchdog:fn=>(watchdogs.push(fn),watchdogs.length),clearWatchdog:()=>{}});let releaseA,releaseB;
 const a=gate.run(()=>new Promise(r=>releaseA=r)),b=gate.run(()=>new Promise(r=>releaseB=r));watchdogs[0]();releaseB('b');assert.equal(await b,'b');assert.equal(gate.isStalled(),true);assert.deepEqual(gate.stats(),{active:1,queued:0});
 await assert.rejects(gate.run(async()=>0),/처리가 지연/);releaseA('a');assert.equal(await a,'a');assert.equal(gate.isStalled(),false);assert.equal(await gate.run(async()=>1),1);
});

test('one simulated disconnected consumer cannot cancel an already shared result',async()=>{
 const {Inflight}=await import('../worker/inflight.js');let fire,release,calls=0;const gate=new RetrievalGate({setWatchdog:fn=>(fire=fn,1),clearWatchdog:()=>{}}),group=new Inflight(),binding={};
 const load=()=>gate.run(()=>{calls++;return new Promise(r=>release=r)});const leader=group.run(binding,'search','same',load),follower=group.run(binding,'search','same',load);
 const controller=new AbortController();const abandoned=Promise.race([leader,new Promise((_,reject)=>controller.signal.addEventListener('abort',()=>reject(Error('client disconnected')),{once:true}))]);controller.abort();await assert.rejects(abandoned,/client disconnected/);
 fire();assert.equal(gate.isStalled(),true);assert.equal(calls,1);assert.deepEqual(gate.stats(),{active:1,queued:0});release({year:2026,text:'원문'});const [a,b]=await Promise.all([leader,follower]);assert.deepEqual(a,b);assert.equal(gate.isStalled(),false);
});

test('invalid watchdog interval is rejected',()=>{assert.throws(()=>new RetrievalGate({activeTimeoutMs:0}));assert.throws(()=>new RetrievalGate({activeTimeoutMs:2147483648}));});

test('stalled work that rejects clears only its own watchdog and permits recovery',async()=>{
 let fire,rejectWork;const gate=new RetrievalGate({setWatchdog:fn=>(fire=fn,1),clearWatchdog:()=>{}});
 const active=gate.run(()=>new Promise((_,reject)=>rejectWork=reject));const failed=assert.rejects(active,/upstream failed/);fire();assert.equal(gate.isStalled(),true);
 rejectWork(Error('upstream failed'));await failed;assert.equal(gate.isStalled(),false);assert.deepEqual(gate.stats(),{active:0,queued:0});assert.equal(await gate.run(async()=>5),5);
});

test('multiple stalled tasks require every stalled task to settle before recovery',async()=>{
 const watches=[];const gate=new RetrievalGate({maxActive:2,setWatchdog:fn=>(watches.push(fn),watches.length),clearWatchdog:()=>{}});let releaseA,releaseB;
 const a=gate.run(()=>new Promise(r=>releaseA=r)),b=gate.run(()=>new Promise(r=>releaseB=r));watches[0]();watches[1]();releaseA('a');assert.equal(await a,'a');
 assert.equal(gate.isStalled(),true);await assert.rejects(gate.run(async()=>0),/처리가 지연/);releaseB('b');assert.equal(await b,'b');assert.equal(gate.isStalled(),false);assert.equal(await gate.run(async()=>2),2);
});
