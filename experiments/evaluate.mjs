import worker from '../dist/server/index.js';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve('dist/client');
const env={ASSETS:{async fetch(req){try{return new Response(await readFile(path.resolve(root,'.'+new URL(req.url).pathname)))}catch{return new Response('',{status:404})}}}};
const cases=[
 {name:'2026 total',args:{query:'성남시 예산 얼마야?'},check:d=>d.answer_card?.rows[0]?.amount===3940847350&&d.evidence[0]?.id==='04ea9506e9f6283a0f89:p1'&&d.evidence[0]?.unit==='천원'},
 {name:'2026 youth rental',args:{query:'청년월세지원사업',year:2026,limit:2},check:d=>d.evidence[0]?.id==='32c9f094ec3f79fa18d0:p345'&&d.evidence[0]?.unit==='천원'&&d.evidence[0]?.text.includes('4,020,578')},
 {name:'2026 performance intent',args:{query:'청년월세지원사업 성과지표',limit:2},check:d=>d.evidence[0]?.id==='69db4859ea4e4c122505:p636'&&d.evidence[0]?.source_family==='performance'},
 {name:'2026 research center',args:{query:'판교 연구센터 예산',limit:2},check:d=>d.evidence[0]?.id==='ecf3620a37b739b371c6:p21'&&d.evidence[0]?.revision===1},
 {name:'2007 spreadsheet',args:{query:'2007년 본예산 중앙도서관 로비 조명보수공사 예산',limit:1},check:d=>d.evidence[0]?.id==='b6b50280e845dfee8282:p775'&&d.evidence[0]?.locator_kind==='text_block'&&d.evidence[0]?.pdf_page===null&&d.evidence[0]?.text.includes('J5125=4000')},
 {name:'no results',args:{query:'zzzzzzzzzzzz',year:2026},check:d=>d.evidence?.length===0},
 {name:'year comparison',args:{query:'2025년과 2026년 반도체 인력양성 예산 비교',limit:2},check:d=>d.per_year?.map(x=>x.filters?.year).join(',')==='2025,2026'&&d.evidence.every(e=>[2025,2026].includes(e.year))},
];
async function call(args){const t=performance.now();const res=await worker.fetch(new Request('https://test.local/public-mcp',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'budget_research',arguments:args}})}),env);const raw=await res.text(),parsed=JSON.parse(raw);return {ms:performance.now()-t,bytes:Buffer.byteLength(raw),data:parsed.result.structuredContent,error:parsed.result.isError};}
for(const c of cases){const first=await call(c.args);let warm=[];for(let i=0;i<5;i++)warm.push(await call(c.args));console.log(JSON.stringify({name:c.name,pass:!first.error&&!!c.check(first.data),first_ms:+first.ms.toFixed(2),warm_ms:warm.map(x=>+x.ms.toFixed(2)),bytes:first.bytes,ids:first.data?.evidence?.map(e=>e.id)}));if(c.name==='year comparison'&&process.argv.includes('--compact')){const compact=await call({...c.args,response_format:'compact'});const map=new Map(compact.data.evidence.map(e=>[e.id,e]));console.log(JSON.stringify({name:'compact',bytes:compact.bytes,ms:+compact.ms.toFixed(2),evidence_equal:JSON.stringify(compact.data.evidence)===JSON.stringify(first.data.evidence),references_valid:compact.data.per_year.every((x,i)=>JSON.stringify(x.evidence_ids.map(id=>map.get(id)))===JSON.stringify(first.data.per_year[i].evidence))}));}}
