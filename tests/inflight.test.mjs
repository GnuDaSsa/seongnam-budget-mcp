import test from 'node:test';import assert from 'node:assert/strict';import {Inflight} from '../worker/inflight.js';
test('same in-flight work coalesces, clones and cleans up on success',async()=>{
 const group=new Inflight(),binding={};let calls=0,release;const wait=new Promise(r=>release=r);
 const load=async()=>{calls++;await wait;return {value:{year:2026}}};
 const a=group.run(binding,'search','key',load),b=group.run(binding,'search','key',load);release();const [x,y]=await Promise.all([a,b]);assert.equal(calls,1);x.value.year=2025;assert.equal(y.value.year,2026);
 await group.run(binding,'search','key',async()=>{calls++;return {}});assert.equal(calls,2);
});
test('failure permits retry; distinct binding, kind and keys never share',async()=>{
 const group=new Inflight(),binding={};let calls=0;const fail=async()=>{calls++;throw Error('failure')};
 const r=await Promise.allSettled([group.run(binding,'search','x',fail),group.run(binding,'search','x',fail)]);assert(r.every(x=>x.status==='rejected'));assert.equal(calls,1);
 await group.run(binding,'search','x',async()=>{calls++;return {}});assert.equal(calls,2);
 let release;const gate=new Promise(r=>release=r);const run=()=>{calls++;return gate.then(()=>({}))};
 const ps=[group.run(binding,'search','x',run),group.run({},'search','x',run),group.run(binding,'evidence','x',run),group.run(binding,'search','y',run)];assert.equal(calls,6);release();await Promise.all(ps);
});
test('distinct in-flight entries above limit run separately and do not displace earlier work',async()=>{
 const group=new Inflight(1),binding={};let release,calls=0;const gate=new Promise(r=>release=r);const run=()=>{calls++;return gate.then(()=>({}))};
 const ps=[group.run(binding,'x','a',run),group.run(binding,'x','b',run),group.run(binding,'x','a',run)];assert.equal(calls,2);release();await Promise.all(ps);
});
