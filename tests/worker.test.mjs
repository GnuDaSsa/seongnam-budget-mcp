import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import worker from '../dist/server/index.js';
const root=path.resolve('dist/client');
const env={ASSETS:{async fetch(req){let p=path.resolve(root,'.'+new URL(req.url).pathname);if(!p.startsWith(root+path.sep))return new Response('',{status:403});try{return new Response(await readFile(p));}catch{return new Response('',{status:404});}}}};
test('unqualified public queries are 2026 and total table bypasses vector work',async()=>{
 const {data:r,status}=await get('/api/research?query='+encodeURIComponent('성남시 예산 얼마야?'));
 assert.equal(status,200);assert.equal(r.filters.year,2026);assert.equal(r.query_interpretation.year_basis,'default');
 assert.equal(r.answer_card.rows[0].amount,3940847350);assert.equal(r.answer_card.rows[0].amount_krw,3940847350000);
 assert.equal(r.retrieval.mode,'verified_total_table');assert.equal(r.evidence[0].page,1);
 const {data:s}=await get('/api/search?query='+encodeURIComponent('도서관'));
 assert.equal(s.filters.year,2026);assert(s.results.every(h=>h.year===2026));
 const legacy=(await rpc('tools/call',{name:'search',arguments:{query:'노인일자리'}})).result;
 const detail=(await rpc('tools/call',{name:'fetch',arguments:{id:legacy.structuredContent.results[0].id}})).result;
 assert.equal(detail.structuredContent.metadata.year,2026);
});
async function get(route){let r=await worker.fetch(new Request('https://test.local'+route),env);return{status:r.status,data:await r.json()};}
async function rpc(method,params){let r=await worker.fetch(new Request('https://test.local/mcp',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})}),env);return r.json();}
test('collection totals expose incomplete coverage',async()=>{let {data:s}=await get('/api/status');assert.equal(s.whole_city_coverage_complete,false);assert.equal(s.documents,Object.values(s.status_counts).reduce((a,b)=>a+b,0));assert(s.snapshot_pages>0);});
test('Korean retrieval returns real 2026 evidence and exact page',async()=>{let start=performance.now();let {data:s,status}=await get('/api/search?query='+encodeURIComponent('노인일자리')+'&year=2026&budget_type='+encodeURIComponent('본예산')+'&limit=5');assert.equal(status,200);assert(s.results.length>0);for(let h of s.results){assert.equal(h.year,2026);assert.equal(h.budget_type,'본예산');assert(h.source_url.startsWith('https://www.seongnam.go.kr/'));let {data:p}=await get('/api/page?document_id='+h.document_id+'&page='+h.pdf_page);assert(p.text.includes('일자리'));assert.equal(p.pdf_page,h.pdf_page);}console.log('2026 search+pages milliseconds:',Math.round(performance.now()-start));});
test('a verified budget total retains source units and numbers',async()=>{let {data:d}=await get('/api/documents?year=2026&limit=20');let doc=d.documents.find(x=>x.url.endsWith('/11608_1.pdf'));assert(doc);let {data:p}=await get('/api/page?document_id='+doc.id+'&page=1');assert(p.text.includes('3,940,847,350'));assert(p.text.includes('천원'));assert.equal(p.unit,'천원');});
test('invalid input, unknown pages and absent evidence do not invent answers',async()=>{assert.equal((await get('/api/search?query=x')).status,400);assert.equal((await get('/api/search?query=valid&year=abc')).status,400);assert.equal((await get('/api/page?document_id=missing&page=1')).status,400);let {data:s}=await get('/api/search?year=2026&query=zzzzzzzzzzzz');assert.deepEqual(s.results,[]);});
test('MCP modern and legacy discovery advertise read only tools',async()=>{assert.deepEqual((await rpc('server/discover')).result.supportedVersions,['2026-07-28']);assert.equal((await rpc('initialize',{protocolVersion:'2025-03-26'})).result.protocolVersion,'2025-03-26');let {result}=await rpc('tools/list');assert.equal(result.tools.length,8);assert(result.tools.every(t=>t.annotations.readOnlyHint));assert.equal((await rpc('tools/call',{name:'get_collection_status'})).result.isError,false);assert.equal((await rpc('tools/call',{name:'unknown'})).result.isError,true);assert.equal((await rpc('tools/call',{name:'get_collection_status',arguments:{url:'http://localhost'}})).result.isError,true);});
test('MCP rejects parse errors and cross-origin requests',async()=>{let r=await worker.fetch(new Request('https://test.local/mcp',{method:'POST',headers:{'content-type':'application/json'},body:'{'}),env);assert.equal(r.status,400);r=await worker.fetch(new Request('https://test.local/api/status',{headers:{origin:'https://evil.invalid'}}),env);assert.equal(r.status,403);});
test('public MCP works without authentication headers',async()=>{let r=await worker.fetch(new Request('https://test.local/public-mcp',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/list'})}),env);assert.equal(r.status,200);assert.equal((await r.json()).result.tools.length,8);});
test('browser script compiles after locator and audience changes',async()=>{let html=await readFile('web/index.html','utf8');let scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];assert.equal(scripts.length,1);new vm.Script(scripts[0][1]);assert(html.includes('/public-mcp'));assert(!html.includes('사이트는 소유자 전용'));});
test('non-PDF evidence uses a text block and never invents PDF page numbers',async()=>{let catalog=JSON.parse(await readFile('snapshot/catalog.json','utf8'));let doc=catalog.documents.find(d=>d.locator_kind==='text_block'&&d.shards.length);assert(doc,'At least one actual office attachment must be indexed');let {data:p,status}=await get('/api/page?document_id='+doc.id+'&page=1');assert.equal(status,200);assert.equal(p.pdf_page,null);assert.equal(p.locator_kind,'text_block');assert.equal(p.page_url,doc.url);assert(p.text.includes('PDF 페이지 번호 아님'));assert(!p.page_url.includes('#page='));});
test('oldest annual budget can be searched separately from current budgets',async()=>{let {status,data:s}=await get('/api/search?query='+encodeURIComponent('도서관')+'&year=2007&limit=3');assert.equal(status,200);assert(s.results.length>0);assert(s.results.every(x=>x.year===2007));});
test('MCP bounds request bodies and rejects wrong argument types',async()=>{let r=await worker.fetch(new Request('https://test.local/public-mcp',{method:'POST',headers:{'content-type':'application/json'},body:'x'.repeat(70000)}),env);assert.equal(r.status,413);let result=await rpc('tools/call',{name:'search_budget',arguments:{query:'도서관',year:'2026'}});assert.equal(result.result.isError,true);});
test('RAG supplies traceable evidence without pretending to run generation',async()=>{let {result:r}=await rpc('tools/call',{name:'build_rag_context',arguments:{query:'노인일자리',year:2026,budget_type:'본예산',limit:1}});assert.equal(r.isError,false);assert.equal(r.structuredContent.generation_performed,false);assert(r.structuredContent.evidence.length>0);assert(r.structuredContent.evidence.length<=4);assert(r.structuredContent.evidence.every(p=>p.text&&p.source_url&&p.sha256));});
test('all-year query completes using term buckets and valid currency labels',async()=>{let begin=performance.now(),{data:r,status}=await get('/api/search?query='+encodeURIComponent('노인일자리')+'&year_scope=all&limit=5');assert.equal(status,200);assert(r.results.length>0);assert(r.scanned_pages>0);assert(r.results.every(p=>p.unit==='원문 확인'||p.unit.split(' / ').every(u=>['원','천원','백만원','억원'].includes(u))));console.log('all-year search milliseconds:',Math.round(performance.now()-begin));});

test('natural language retrieves and reranks vector evidence when lexical matching finds nothing',async()=>{
 let query=encodeURIComponent('아이를 맡기는 시설 지원'),{data:r,status}=await get('/api/search?year=2026&query='+query);
 assert.equal(status,200);assert.equal(r.retrieval.lexical_candidates,0);assert(r.retrieval.vector_candidates>0);assert.equal(r.retrieval.reranked,true);assert.equal(r.retrieval.dimensions,256);assert(r.results.every(h=>h.year===2026&&h.chunk&&Number.isFinite(h.retrieval_scores.token_maxsim)));assert(r.results.some(h=>/어린이집|보육/.test(h.excerpt)));
 let {data:v}=await get('/api/search?year=2026&budget_type='+encodeURIComponent('본예산')+'&mode=vector&query='+query);assert(v.results.length>0);assert(v.results.every(h=>h.year===2026&&h.budget_type==='본예산'));
});

test('optimization preserves result IDs, ranks, scores and chunk boundaries',async()=>{
 const baseline=JSON.parse(await readFile('tests/retrieval-regression.json','utf8'));
 for(const b of baseline){const {data:r}=await get('/api/search?'+new URLSearchParams({...b.query,limit:5}));assert.deepEqual(r.results.map(({id,score,chunk})=>({id,score,chunk})),b.results);}
});
test('research returns exact bounded evidence with coverage in one anonymous call',async()=>{
 const r=(await rpc('tools/call',{name:'budget_research',arguments:{query:'청년 주거비 지원',year:2026,limit:2}})).result;
 assert.equal(r.isError,false);const d=r.structuredContent;assert.equal(d.generation_performed,false);assert.equal(d.evidence.length,2);assert.equal(d.coverage.whole_city_coverage_complete,false);
 for(const e of d.evidence){const {data:p}=await get('/api/page?'+new URLSearchParams({document_id:e.document_id,page:e.page}));assert.equal(e.text,Array.from(p.text).slice(e.context.start,e.context.end).join(''));assert(e.text.length<=12000);assert.equal(e.source_url,p.source_url);assert.equal(e.unit,p.unit);}
 assert(d.evidence[0].text.includes('청년'));
});
test('standard search/fetch have citation URLs, complete text and output schemas',async()=>{
 const list=(await rpc('tools/list')).result.tools;assert(list.find(t=>t.name==='search').outputSchema);assert(list.find(t=>t.name==='fetch').outputSchema);
 const s=(await rpc('tools/call',{name:'search',arguments:{query:'2026년 청년 주거비 지원'}})).result;assert.equal(s.isError,false);assert.deepEqual(JSON.parse(s.content[0].text),s.structuredContent);
 const h=s.structuredContent.results[0];assert(h.id&&h.title&&h.url.includes('seongnam.go.kr'));
 const f=(await rpc('tools/call',{name:'fetch',arguments:{id:h.id}})).result;assert.equal(f.isError,false);assert.equal(f.structuredContent.url,h.url);assert(f.structuredContent.text);assert.equal(f.structuredContent.metadata.year,2026);
 assert.equal((await rpc('tools/call',{name:'fetch',arguments:{id:'https://localhost/secrets'}})).result.isError,true);
});
test('cache avoids asset reads and isolates filters; no external generation key is needed',async()=>{
 const a='/api/search?'+new URLSearchParams({query:'청년 주거비 지원',year:2026,limit:3});await get(a);
 const strict={ASSETS:{fetch(){throw Error('Cache should not reread assets');}}};const r=await worker.fetch(new Request('https://test.local'+a),strict);assert.equal(r.status,200);const d=await r.json();assert.equal(d.retrieval.cache_hit,true);assert(d.results.every(h=>h.year===2026));
 const {data:old}=await get('/api/search?'+new URLSearchParams({query:'청년 주거비 지원',year:2007,limit:3}));assert(old.results.every(h=>h.year===2007));
 const {data:openapi}=await get('/openapi.json');assert.deepEqual(openapi.security,[]);assert(openapi.paths['/api/research'].get.operationId);assert(!Object.values(openapi.paths).some(v=>v.post));
 const source=await readFile('worker/server.js','utf8');assert(!source.includes('api.openai.com'));assert(!source.includes('OPENAI_API_KEY'));assert(!source.includes('answer_budget'));
});
