import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const base=process.env.WORKER_URL||'http://127.0.0.1:8787';
const pids=(process.env.WORKER_PIDS||'').split(',').filter(x=>/^\d+$/.test(x));
const cases=[
 {query:'2007년 본예산 중앙도서관 로비 조명보수공사',limit:2},
 {query:'2025년 본예산 시청 직장 어린이집 운영',limit:2},
 {query:'2026년 본예산 청년월세 지원사업',limit:2},
 {query:'2024년 결산 수내도서관 건립',limit:2},
 {query:'2025년 본예산 시스템반도체산업 육성',limit:2},
 {query:'2026년 본예산 재난 및 재해 예방',limit:2},
 {query:'2025년 결산 청년월세 한시 특별지원',limit:2},
 {query:'2026년 본예산 작은도서관 공립문고 운영',limit:2}
];
let peak=0,samples=0;function sample(){if(!pids.length)return;try{const values=execFileSync('ps',['-o','rss=','-p',pids.join(',')],{encoding:'utf8'}).trim().split(/\s+/).map(Number);if(values.length===pids.length&&values.every(Number.isFinite)){peak=Math.max(peak,values.reduce((a,b)=>a+b,0));samples++;}}catch{}}
async function call(args){const started=performance.now();try{const r=await fetch(base+'/public-mcp',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'budget_research',arguments:args}}),signal:AbortSignal.timeout(120000)});const body=await r.json(),x=body.result?.structuredContent;return {status:r.status,isError:body.result?.isError??true,ms:+(performance.now()-started).toFixed(2),server_ms:x?.elapsed_ms,ids:x?.evidence?.map(e=>e.id),years:x?.evidence?.map(e=>e.year),types:x?.evidence?.map(e=>e.budget_type),units:x?.evidence?.map(e=>e.unit),hash:x?createHash('sha256').update(JSON.stringify(x.evidence)).digest('hex'):null,error:body.result?.isError?body.result.content?.[0]?.text:null};}catch(e){return {status:0,isError:true,ms:+(performance.now()-started).toFixed(2),error:String(e)};}}
for(const phase of ['first','repeat']){peak=0;samples=0;sample();const timer=setInterval(sample,75),start=performance.now();const results=await Promise.all(cases.map(call));clearInterval(timer);sample();console.log(JSON.stringify({phase,wall_ms:+(performance.now()-start).toFixed(2),sampled_rss_kib:peak,rss_samples:samples,results}));}
