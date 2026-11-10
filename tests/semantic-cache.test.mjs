import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {createEncoder} from '../worker/semantic.js';

// Synthetic in-memory rows: no corpus reads, network calls, or concurrent load.
function assets(){
 const requests=new Map();
 return {requests,env:{ASSETS:{async fetch(req){
  const name=new URL(req.url).pathname.split('/').at(-1);
  requests.set(name,(requests.get(name)||0)+1);
  let bytes;
  if(name==='vocab.bin.gz')bytes=Buffer.alloc(12);
  else if(name==='common.bin.gz')bytes=Buffer.alloc(4);
  else if(name==='centroids.bin.gz')bytes=Buffer.alloc(256*4);
  else if(name==='page-docs.bin.gz')bytes=Buffer.alloc(2);
  else {
   const match=/^tokens-(\d+)\.bin\.gz$/.exec(name);
   assert(match,'unexpected asset '+name);
   const count=2048,start=Number(match[1])*count;
   bytes=Buffer.alloc(8+count*4+count*256);
   bytes.writeUInt32LE(start,0);bytes.writeUInt32LE(count,4);
   for(let i=0;i<count;i++){
    bytes.writeFloatLE(0.5,8+i*4);
    bytes[8+count*4+i*256]=2;
   }
  }
  return new Response(gzipSync(bytes));
 }}}};
}

test('active encoders retain their rows when another encoder trims shared cache',async()=>{
 const {env,requests}=assets();
 const first=await createEncoder(env);
 await first.ensure([2]);
 const expected=first.tokenVector(2),weight=first.tokenWeight(2),embedding=first.embed([2]);
 assert.equal(weight,1);

 const second=await createEncoder(env);
 await second.ensure([2]);
 assert.equal(requests.get('tokens-0.bin.gz'),1,'reuse the shared row without refetching');
 // Fill exactly one row beyond the cache boundary while first remains active.
 await second.ensure(Array.from({length:8192},(_,i)=>i+3));
 const third=await createEncoder(env);
 assert.deepEqual(first.tokenVector(2),expected);
 assert.equal(first.tokenWeight(2),weight);
 assert.deepEqual(first.embed([2]),embedding);
 assert.deepEqual(second.tokenVector(2),expected,'shared-cache hits must also be pinned');

 const before=requests.get('tokens-0.bin.gz');
 await third.ensure([2]);
 assert.equal(requests.get('tokens-0.bin.gz'),before+1,'new encoders reload the evicted shared row');
 assert.deepEqual(third.tokenVector(2),expected);
});
