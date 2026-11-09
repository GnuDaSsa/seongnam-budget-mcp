import {pathToFileURL} from 'node:url';
import {readFile} from 'node:fs/promises';import path from 'node:path';import {createHash} from 'node:crypto';
const worker=(await import(pathToFileURL(process.env.BENCH_SERVER||path.resolve('dist/server/index.js')))).default;
const root=path.resolve('dist/client');let reads=[];
const env={ASSETS:{async fetch(req){let name=new URL(req.url).pathname;reads.push(name);try{return new Response(await readFile(path.resolve(root,'.'+name)))}catch{return new Response('',{status:404})}}}};
// Candidate relevance phrases were selected from source documents, not search output.
const cases=[
 ['xlsx exact',{query:'2007년 본예산 중앙도서관 로비 조명보수공사 예산',limit:4},2007,'본예산','중앙도서관로비조명보수공사'],
 ['xlsx similar facility',{query:'2007년 본예산 여성문화회관 수영장 조명보수공사',limit:4},2007,'본예산','여성문화회관수영장조명보수공사'],
 ['xlsx spacing',{query:'2007년 본예산 중앙도서관 로비 조명 보수 공사',limit:4},2007,'본예산','중앙도서관로비조명보수공사'],
 ['2026 youth precise',{query:'2026년 본예산 청년월세 지원사업',limit:4},2026,'본예산','청년월세지원사업'],
 ['2026 youth variant',{query:'2026년 청년 월세 지원사업 본예산',limit:4},2026,'본예산','청년월세지원사업'],
 ['2025 previous program',{query:'2025년 본예산 청년월세 한시 특별지원',limit:4},2025,'본예산','청년월세한시특별지원'],
 ['2025 childcare',{query:'2025년 본예산 시청 직장 어린이집 운영',limit:4},2025,'본예산','시청직장어린이집운영'],
 ['2025 semiconductor',{query:'2025년 본예산 시스템반도체산업 육성',limit:4},2025,'본예산','시스템반도체산업육성'],
 ['2026 library',{query:'2026년 본예산 작은도서관 공립문고 운영',limit:4},2026,'본예산','작은도서관공립문고운영'],
 ['2026 disaster',{query:'2026년 본예산 재난 및 재해 예방',limit:4},2026,'본예산','재난및재해예방'],
 ['2026 disability',{query:'2026년 본예산 무인민원발급기 시각장애인',limit:4},2026,'본예산','시각장애인'],
 ['2025 youth original wording',{query:'2025년 본예산 청년월세한시특별지원',limit:4},2025,'본예산','청년월세한시특별지원'],
 ['2025 settlement',{query:'2025년 결산 청년월세 한시 특별지원',limit:4},2025,'결산','청년월세한시특별지원'],
 ['2024 settlement',{query:'2024년 결산 수내도서관 건립',limit:4},2024,'결산','수내도서관건립'],
 ['missing year',{query:'2099년 본예산 중앙도서관 로비 조명보수공사',limit:4},2099,'본예산',null],
 ['nonsense',{query:'zzzzzzzzzzzz',year:2026,limit:4},2026,null,null],
];
async function call(args){reads=[];const start=performance.now(),res=await worker.fetch(new Request('https://test.local/public-mcp',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'budget_research',arguments:args}})}),env);const payload=await res.json();return {ms:+(performance.now()-start).toFixed(2),reads:reads.length,files:[...reads],data:payload.result.structuredContent,error:payload.result.isError};}
for(const [name,args,year,type,expected] of cases){let r=await call(args),warm=await call(args),e=r.data?.evidence||[];let norm=s=>(s||'').replace(/\s/g,'');let relevant=expected?e.some(x=>norm(x.text).includes(expected)):e.length===0;let filter=e.every(x=>x.year===year&&(!type||x.budget_type===type));console.log(JSON.stringify({name,relevant,filter,first_ms:r.ms,warm_ms:warm.ms,first_reads:r.reads,warm_reads:warm.reads,warm_files:warm.files,evidence_sha256:createHash('sha256').update(JSON.stringify(e)).digest('hex'),core_evidence_sha256:createHash('sha256').update(JSON.stringify(e.map(({unit_scope,...rest})=>rest))).digest('hex'),returned:e.map(x=>({id:x.id,year:x.year,type:x.budget_type,unit:x.unit})),timings:r.data?.retrieval?.timings_ms,error:r.error}));}
