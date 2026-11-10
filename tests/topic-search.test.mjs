import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import worker from '../dist/server/index.js';
const root=path.resolve('snapshot');
const env={ASSETS:{async fetch(req){const file=path.resolve(root,'.'+new URL(req.url).pathname);assert(file.startsWith(root+path.sep));try{return new Response(await readFile(file));}catch{return new Response('',{status:404});}}}};
async function research(query,args={}){const r=await worker.fetch(new Request('https://local/api/research?'+new URLSearchParams({query,...args})),env);const data=await r.json();assert.equal(r.status,200,JSON.stringify(data));return data;}
function verifiedTopic(r){
 assert(r.evidence.length>0);assert(r.evidence.every(e=>e.year===2025&&e.topic_matches.length));
 for(const e of r.evidence){assert(e.topic_matches.every(m=>!/고병원성|AIDS|Email|^부서:|^AI반도체과\s/.test(m.source_excerpt)));assert(e.classification.matched_paths.every(p=>/AI|인공지능/i.test(p.detailed_business||'')));}
 assert(r.evidence.some(e=>e.classification.department!=='AI반도체과'));
}
function newProjects(r){
 const training=r.evidence.find(e=>e.document_id==='06d79475c7e497d55e09'&&e.page===37),manufacturing=r.evidence.find(e=>e.document_id==='50e8821707e680074442'&&e.page===9);
 assert(training,'AI training revision 3 must survive ranking');assert(manufacturing,'manufacturing AI revision 4 must survive ranking');
 assert(training.topic_matches.some(m=>/AI 인재양성지원사업\s+600,000/.test(m.source_excerpt)));assert(manufacturing.topic_matches.some(m=>/제조AI.*700,000/.test(m.source_excerpt)));
 assert(!manufacturing.classification.matched_paths.some(p=>/팹리스/.test(p.detailed_business||'')));
}
test('joined AI topic query searches municipal business contents and preserves both new supplement projects',async()=>{
 const r=await research('2025년도 Ai사업관련예산 찾아봐줘');verifiedTopic(r);newProjects(r);assert.deepEqual(r.query_interpretation.department_scope.names,[]);
 assert(r.evidence.length>4);assert(r.evidence.some(e=>e.budget_type==='본예산'));assert(r.evidence.every(e=>['본예산','추경'].includes(e.budget_type)));
});
test('reflect supplements is a control request, including a stale main-budget argument',async()=>{
 for(const args of [{},{budget_type:'본예산'}]){const r=await research('2025년도 AI 관련 사업 추경 반영',args);verifiedTopic(r);newProjects(r);assert(r.retrieval.lexical_candidates>0);assert(r.evidence.every(e=>e.budget_type==='추경'));assert(r.query_interpretation.notices.some(n=>n.includes('연간 전체')));if(args.budget_type)assert.equal(r.query_interpretation.conflicts[0].resolution,'explicit_query_precedence');}
 const joined=await research('2025년도 Ai사업관련예산 찾아봐줘 추경 반영');newProjects(joined);
});
test('topic scopes preserve both editions, explicit only/excluded kinds, revisions and result limits',async()=>{
 const both=await research('2025년 인공지능 관련 사업 본예산과 추경 모두');verifiedTopic(both);newProjects(both);assert.deepEqual(new Set(both.evidence.map(e=>e.budget_type)),new Set(['본예산','추경']));
 const main=await research('2025년 AI 관련 사업 본예산만 추경 제외',{budget_type:'추경'});assert(main.evidence.length);assert(main.evidence.every(e=>e.budget_type==='본예산'));
 const rev=await research('2025년 AI 관련 사업 제2회 추경');assert(rev.evidence.length);assert(rev.evidence.every(e=>e.revision===2));
 const limited=await research('2025년 AI 관련 사업 추경 반영',{limit:2});assert.equal(limited.evidence.length,2);
});
test('explicit departments remain separate from topic contents, including spaced department spellings',async()=>{
 const department=await research('AI 반 도 체 과 2025년 예산');assert.equal(department.query_interpretation.topic_scope,null);assert(department.evidence.length);assert(department.evidence.every(e=>e.classification.department==='AI반도체과'));
 const topical=await research('AI 반도체과 2025년 인공지능 사업');assert.equal(topical.query_interpretation.content_query,'AI');assert(topical.evidence.length);assert(topical.evidence.every(e=>e.classification.department==='AI반도체과'&&e.topic_matches.length));
});
