import test from 'node:test';
import assert from 'node:assert/strict';
import {EvidenceCache} from '../worker/evidence-cache.js';
test('TTL, clone isolation and replacement cannot return stale evidence',()=>{
 let now=0;const c=new EvidenceCache({maxBytes:4000,maxEntries:3,ttlMs:10,now:()=>now});
 assert(c.set('a',{text:'원문',data:{year:2025}}));let x=c.get('a');x.data.year=2026;assert.equal(c.get('a').data.year,2025);
 now=9;assert(c.get('a'));now=10;assert.equal(c.get('a'),null);assert.deepEqual(c.stats(),{entries:0,estimated_bytes:0});
 assert(c.set('a',{text:'new'}));assert.equal(c.get('a').text,'new');
});
test('LRU, keys, unicode and oversized entries remain within estimated bounds',()=>{
 let now=0;const c=new EvidenceCache({maxBytes:1300,maxEntries:3,ttlMs:10,now:()=>now});
 for(let i=0;i<10000;i++){c.set('질문'+i,{text:'가😀'.repeat(i%80)});const s=c.stats();assert(s.entries<=3);assert(s.estimated_bytes<=1300);}
 assert.equal(c.set('x'.repeat(1000),{text:'x'}),false);assert.equal(c.get('x'.repeat(1000)),null);
 c.set('a',{x:1});c.set('b',{x:2});c.set('c',{x:3});c.get('a');c.set('d',{x:4});assert.equal(c.get('b'),null);assert.equal(c.get('a').x,1);
 now=11;c.set('fresh',{x:5});assert.equal(c.stats().entries,1);assert.equal(c.get('fresh').x,5);
});
