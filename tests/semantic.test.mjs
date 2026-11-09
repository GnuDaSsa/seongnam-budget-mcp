import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {createEncoder,vectorSearch,rerank} from '../worker/semantic.js';
const root=path.resolve('snapshot');
const env={ASSETS:{async fetch(req){let p=path.resolve(root,'.'+new URL(req.url).pathname);if(!p.startsWith(root+path.sep))return new Response('',{status:403});try{return new Response(await readFile(p));}catch{return new Response('',{status:404});}}}};
test('Korean tokenizer and quantized embedding match offline Python output',async()=>{
 const enc=await createEncoder(env),fixtures=JSON.parse(await readFile('tests/embedding-fixtures.json','utf8'));
 for(let f of fixtures){let ids=enc.tokenize(f.text);assert.deepEqual(ids,f.ids,f.text);await enc.ensure(ids);let v=enc.embed(ids),error=Math.max(...v.map((x,i)=>Math.abs(x-f.vector[i])));assert(error<1e-5,f.text+': '+error);}
});
test('semantic reranking scores passage meaning and returns actual model scores',async()=>{
 let enc=await createEncoder(env),ids=enc.tokenize('노인이 일자리를 얻도록 돕는 사업');await enc.ensure(ids);let q=enc.embed(ids);
 let c=await rerank({enc,ids,q},[{text:'도서관 도서 구입 및 자료실 운영',rrf:1/61},{text:'노인일자리 및 사회활동 지원 사업 어르신 일자리 참여',rrf:1/61}]);
 assert(c[0].text.includes('노인일자리'));assert(c[0].maxsim>c[1].maxsim);assert(Number.isFinite(c[0].score));
});
test('every searchable location is covered and assets use nonempty IVF lists',async()=>{
 let m=JSON.parse(await readFile('snapshot/semantic/manifest.json','utf8')),c=JSON.parse(await readFile('snapshot/catalog.json','utf8'));
 assert.equal(m.pages,c.summary.snapshot_units);assert.equal(m.chunks,m.clusters.reduce((a,b)=>a+b,0));assert(m.chunks>m.pages);assert.equal(m.dimensions,256);assert(m.quantization_mean_cosine>0.999);assert(m.source_sha256['model.safetensors'].length===64);
});
