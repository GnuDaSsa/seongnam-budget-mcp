import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import worker from '../dist/server/index.js';
const root=path.resolve('snapshot');
const env={ASSETS:{async fetch(req){const file=path.resolve(root,'.'+new URL(req.url).pathname);if(!file.startsWith(root+path.sep))throw Error('Invalid asset path');return new Response(await readFile(file));}}};
async function research(query,args={}){const res=await worker.fetch(new Request('https://test.local/api/research?'+new URLSearchParams({query,year:2025,...args})),env);assert.equal(res.status,200);return res.json();}
test('AI semiconductor department 2025 search finds only actual owning department in all retrieval modes',async()=>{
 for(const mode of ['lexical','hybrid','vector']){
  const r=await research('AI반도체과 2025년도 예산',{mode});assert(r.evidence.length>0,mode);assert(r.evidence.every(e=>e.year===2025&&e.classification.department==='AI반도체과'&&e.budget_type==='추경'),mode);
 }
 for(const query of ['ai 반도체과의 2025년 예산','A I 반 도 체 과 2025 예산']){const r=await research(query);assert(r.evidence.length>0,query);assert(r.evidence.every(e=>e.classification.department==='AI반도체과'));}
});
test('missing AI 2025 main budget stays empty and separately identifies verified supplement editions',async()=>{
 for(const mode of ['lexical','hybrid','vector']){
  const r=await research('AI반도체과 2025년도 예산',{mode,budget_type:'본예산'});assert.deepEqual(r.evidence,[]);assert.equal(r.department_availability.automatic_substitution,false);assert.deepEqual(r.department_availability.available_editions.map(e=>e.revision),[2,3,4]);assert(r.department_availability.available_editions.every(e=>e.year===2025&&e.budget_type==='추경'&&e.department_names.includes('AI반도체과')&&e.source_url.startsWith('https://www.seongnam.go.kr/')));
 }
 const explicit=await research('AI반도체과의 2025년 최종 본예산');assert.deepEqual(explicit.evidence,[]);assert.equal(explicit.filters.budget_type,'본예산');
});
test('AI latest collected budget is revision 4 and explicit revision or main budget wins',async()=>{
 for(const query of ['2025년 AI반도체과 최종 예산','AI 반도체과 최신예산']){
  const r=await research(query);assert(r.evidence.length>0);assert(r.evidence.every(e=>e.budget_type==='추경'&&e.revision===4&&e.classification.department==='AI반도체과'));
 }
 const chosen=await research('AI반도체과 최신 추경',{revision:2});assert(chosen.evidence.length>0);assert(chosen.evidence.every(e=>e.revision===2));
 const main=await research('AI반도체과 최종 예산',{budget_type:'본예산'});assert.deepEqual(main.evidence,[]);
 const city=await research('도시계획과 본예산');assert(city.evidence.length>0);assert(city.evidence.every(e=>e.classification.department==='도시계획과'));
 for(const query of ['예산과 2025년도 예산','2025년 예산과 예산']){const r=await research(query);assert(r.evidence.length>0);assert(r.evidence.every(e=>e.classification.department==='예산과'));}
});
