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
