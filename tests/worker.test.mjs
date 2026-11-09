import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import worker from '../dist/server/index.js';
import {exactPhraseHit} from '../worker/retrieval-phrases.js';
const root=path.resolve('dist/client');
const env={ASSETS:{async fetch(req){let p=path.resolve(root,'.'+new URL(req.url).pathname);if(!p.startsWith(root+path.sep))return new Response('',{status:403});try{return new Response(await readFile(p));}catch{return new Response('',{status:404});}}}};
test('unqualified public queries are 2026 and total table bypasses vector work',async()=>{
 const {data:r,status}=await get('/api/research?query='+encodeURIComponent('성남시 예산 얼마야?'));
 assert.equal(status,200);assert.equal(r.filters.year,2026);assert.equal(r.query_interpretation.year_basis,'default');
 assert.equal(r.answer_card.rows[0].amount,3940847350);assert.equal(r.answer_card.rows[0].amount_krw,3940847350000);
 assert.equal(r.retrieval.mode,'verified_total_table');assert.equal(r.evidence[0].page,1);
 const e=r.evidence[0],{data:original}=await get('/api/page?'+new URLSearchParams({document_id:e.document_id,page:e.page}));
 const {instructions,...sourceEvidence}=original;
 assert(instructions);assert.equal(r.answer_policy,instructions);assert(!Object.hasOwn(e,'instructions'));
 for(const [key,value] of Object.entries(sourceEvidence))assert.deepEqual(e[key],value,'total evidence preserves '+key);
 assert.equal(e.source_url,'https://www.seongnam.go.kr/humanframe/file/sncity/bgt/2026/11608_1.pdf');
 const {data:s}=await get('/api/search?query='+encodeURIComponent('도서관'));
 assert.equal(s.filters.year,2026);assert(s.results.every(h=>h.year===2026));
 const legacy=(await rpc('tools/call',{name:'search',arguments:{query:'노인일자리'}})).result;
 const detail=(await rpc('tools/call',{name:'fetch',arguments:{id:legacy.structuredContent.results[0].id}})).result;
 assert.equal(detail.structuredContent.metadata.year,2026);
});
async function get(route){let r=await worker.fetch(new Request('https://test.local'+route),env);return{status:r.status,data:await r.json()};}
async function rpc(method,params){let r=await worker.fetch(new Request('https://test.local/mcp',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})}),env);return r.json();}
test('collection totals expose incomplete coverage',async()=>{let {data:s}=await get('/api/status');assert.equal(s.whole_city_coverage_complete,false);assert.equal(s.documents,Object.values(s.status_counts).reduce((a,b)=>a+b,0));assert(s.snapshot_pages>0);});
test('document inventory does not inherit the default expenditure search preference',async()=>{
 const catalog=JSON.parse(await readFile('snapshot/catalog.json','utf8')),{data:r}=await get('/api/documents?year=2026&limit=20');
 assert.equal(r.total,catalog.documents.filter(d=>d.year===2026).length);
 const {data:p}=await get('/api/documents?'+new URLSearchParams({year:2026,category:'성과계획서'}));assert(p.total>0);assert(p.documents.every(d=>d.category==='성과계획서'));
});
test('Korean retrieval returns real 2026 evidence and exact page',async()=>{let start=performance.now();let {data:s,status}=await get('/api/search?query='+encodeURIComponent('노인일자리')+'&year=2026&budget_type='+encodeURIComponent('본예산')+'&limit=5');assert.equal(status,200);assert(s.results.length>0);for(let h of s.results){assert.equal(h.year,2026);assert.equal(h.budget_type,'본예산');assert(h.source_url.startsWith('https://www.seongnam.go.kr/'));let {data:p}=await get('/api/page?document_id='+h.document_id+'&page='+h.pdf_page);assert(p.text.includes('일자리'));assert.equal(p.pdf_page,h.pdf_page);}console.log('2026 search+pages milliseconds:',Math.round(performance.now()-start));});
test('a verified budget total retains source units and numbers',async()=>{let {data:d}=await get('/api/documents?year=2026&limit=20');let doc=d.documents.find(x=>x.url.endsWith('/11608_1.pdf'));assert(doc);let {data:p}=await get('/api/page?document_id='+doc.id+'&page=1');assert(p.text.includes('3,940,847,350'));assert(p.text.includes('천원'));assert.equal(p.unit,'천원');});
test('invalid input, unknown pages and absent evidence do not invent answers',async()=>{assert.equal((await get('/api/search?query=x')).status,400);assert.equal((await get('/api/search?query=valid&year=abc')).status,400);assert.equal((await get('/api/page?document_id=missing&page=1')).status,400);let {data:s}=await get('/api/search?year=2026&query=zzzzzzzzzzzz');assert.deepEqual(s.results,[]);});
test('MCP modern and legacy discovery advertise read only tools',async()=>{assert.deepEqual((await rpc('server/discover')).result.supportedVersions,['2026-07-28']);assert.equal((await rpc('initialize',{protocolVersion:'2025-03-26'})).result.protocolVersion,'2025-03-26');let {result}=await rpc('tools/list');assert.equal(result.tools.length,8);assert(result.tools.every(t=>t.annotations.readOnlyHint));assert.equal((await rpc('tools/call',{name:'get_collection_status'})).result.isError,false);assert.equal((await rpc('tools/call',{name:'unknown'})).result.isError,true);assert.equal((await rpc('tools/call',{name:'get_collection_status',arguments:{url:'http://localhost'}})).result.isError,true);});
test('tool guidance prefers one research call and reserves page reads for insufficient evidence',async()=>{
 const list=(await rpc('tools/list')).result.tools,description=name=>list.find(t=>t.name===name).description;
 assert.match(description('budget_research'),/성남시.*본예산.*추경.*결산.*사업비/);
 assert.match(description('budget_research'),/법령 해석.*다른 지자체.*사용하지 않음/);
 assert.match(description('get_budget_page'),/부족.*잘렸.*불명확/);
 assert.match(description('get_budget_page'),/원문 전문을 요청/);
 assert.match(description('get_budget_page'),/충분하면 추가 조회 없이 답변/);
 assert.doesNotMatch(description('get_budget_page'),/금액을 답하기 전에 조회/);
 assert.match(description('search_budget'),/budget_research를 우선 사용/);
 assert.match(description('build_rag_context'),/기존 연동 호환용.*budget_research를 우선 사용/);
});
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

test('baseline questions retain traceable chunks under expenditure source policy',async()=>{
 const baseline=JSON.parse(await readFile('tests/retrieval-regression.json','utf8'));
 for(const b of baseline){const {data:r}=await get('/api/search?'+new URLSearchParams({...b.query,limit:5}));
  // The old ranking included performance plans. Preserve traceability, not that order.
  assert(r.results.length);assert(r.results.every(h=>h.source_family!=='performance'&&Number.isFinite(h.score)));
  let fallback=false;for(const h of r.results){if(!h.retrieval_scores.exact_phrase)fallback=true;else{assert(!fallback);assert(h.excerpt.replace(/\s/g,'').includes(h.retrieval_scores.exact_phrase));}
   const {data:p}=await get('/api/page?'+new URLSearchParams({document_id:h.document_id,page:h.page}));assert.equal(h.excerpt,Array.from(p.text).slice(h.chunk.start,h.chunk.end).join(''));
   if(h.retrieval_scores.exact_phrase){const exact=exactPhraseHit(b.query.query,p.text,p.title),start=Math.max(0,exact.start-120),end=Math.min(Array.from(p.text).length,Math.max(start+800,exact.end));assert.deepEqual(h.chunk,{start,end,offset_unit:'Unicode code points'});}
  }
 }
});
test('business and accounting requests prefer statement rows, while performance remains explicit',async()=>{
 for(const query of ['청년월세지원사업','청년월세지원사업 통계목 보여줘']){
  const {data:r,status}=await get('/api/research?'+new URLSearchParams({query,limit:4}));assert.equal(status,200);
  assert.equal(r.evidence[0].id,'32c9f094ec3f79fa18d0:p345');assert(r.evidence.every(e=>e.source_family!=='performance'));
  const p=r.evidence[0].classification.matched_paths[0];assert.equal(p.combined_code,'301-01');assert.match(p.source_excerpt,/4,020,578/);
 }
 const {data:p}=await get('/api/research?'+new URLSearchParams({query:'청년월세지원사업 성과지표'}));
 assert.equal(p.evidence[0].id,'69db4859ea4e4c122505:p636');assert(p.evidence.every(e=>e.source_family==='performance'));
 const {data:mixed}=await get('/api/research?'+new URLSearchParams({query:'본예산과 성과계획서 비교 청년월세지원사업'}));
 assert(mixed.evidence.some(e=>e.source_family==='performance'));assert(mixed.evidence.some(e=>e.source_family==='expenditure'));
 assert(mixed.evidence.every(e=>e.source_family==='performance'||e.budget_type==='본예산'));
});
test('noncontiguous research-center name retains its supplementary statement and correct codes',async()=>{
 for(const query of ['판교 연구센터 예산','판교 연구센터 통계목']){
  const {data:r}=await get('/api/research?'+new URLSearchParams({query}));
  assert.equal(r.evidence[0].id,'ecf3620a37b739b371c6:p21');assert.equal(r.evidence[0].budget_type,'추경');assert.equal(r.evidence[0].revision,1);
  assert(r.evidence.every(e=>e.text.includes('연구센터')));assert.equal(r.evidence[0].classification.matched_paths[0].combined_code,'401-01');
 }
 const {data:base}=await get('/api/research?'+new URLSearchParams({query:'본예산 판교 연구센터 예산'}));assert(base.evidence.every(e=>e.budget_type==='본예산'));
 const {data:revision}=await get('/api/research?'+new URLSearchParams({query:'판교 연구센터 예산',budget_type:'추경',revision:1}));assert(revision.evidence.every(e=>e.budget_type==='추경'&&e.revision===1));
});
test('capital consignment queries return exact 2025 source phrases before semantic alternatives',async()=>{
 const inputs=[{query:'2025년도 자본적위탁사업비'},{query:'2025년 자본적위탁사업비'},{query:'자본적위탁사업비',year:2025},{query:'자본적 위탁사업비',year:2025},{query:'공기관 등에 대한 자본적 위탁사업비',year:2025},{query:'2025년 본예산 자본적위탁사업비'}];
 for(const input of inputs){const {status,data:r}=await get('/api/search?'+new URLSearchParams({...input,limit:4}));assert.equal(status,200);assert.equal(r.results.length,4);
  for(const h of r.results){assert.equal(h.year,2025);assert(h.excerpt.replace(/\s/g,'').includes('자본적위탁사업비'));assert(h.retrieval_scores.exact_phrase);if(input.query.includes('본예산'))assert.equal(h.budget_type,'본예산');}
 }
 const {data:dept}=await get('/api/search?'+new URLSearchParams({query:'주택과 자본적위탁사업비',year:2025,budget_type:'본예산',limit:1}));
 assert.equal(dept.results[0].id,'0d36d672095ebcb1fede:p8');assert.equal(dept.results[0].budget_type,'본예산');assert(dept.results[0].excerpt.includes('220,000'));
 const {data:lex}=await get('/api/search?'+new URLSearchParams({query:'2025년도 자본적위탁사업비',mode:'lexical',limit:4}));
 assert(lex.results.every(h=>h.excerpt.replace(/\s/g,'').includes('자본적위탁사업비')));
 const {data:vector}=await get('/api/search?'+new URLSearchParams({query:'2025년도 자본적위탁사업비',mode:'vector',limit:4}));
 assert.equal(vector.retrieval.exact_phrase_candidates,0);assert(vector.results.every(h=>h.retrieval_scores.exact_phrase===null));
 const r=(await rpc('tools/call',{name:'budget_research',arguments:{query:'2025년도 자본적위탁사업비',limit:4}})).result;
 assert.equal(r.isError,false);assert.equal(r.structuredContent.evidence.length,4);assert(r.structuredContent.evidence.every(e=>e.text.replace(/\s/g,'').includes('자본적위탁사업비')&&e.year===2025));
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

test('comparison reports unverified evidence, respects limit and keeps source provenance',async()=>{
 const {result:r}=await rpc('tools/call',{name:'budget_research',arguments:{query:'2025년과 2026년 반도체 인력양성 예산 비교',limit:1}});
 assert.equal(r.isError,false);const d=r.structuredContent;
 assert.equal(d.comparison.status,'unverified');assert.equal(d.per_year.length,2);
 assert(d.per_year.every(y=>y.evidence.length<=1));
 assert.deepEqual(d.comparison.missing_years,d.comparison.years.filter(y=>!y.evidence_count).map(y=>y.year));
 for(const e of d.evidence){const {data:p,status}=await get('/api/page?'+new URLSearchParams({document_id:e.document_id,page:e.page}));assert.equal(status,200);assert.equal(e.text,Array.from(p.text).slice(e.context.start,e.context.end).join(''));assert.equal(e.unit,p.unit);assert.equal(e.source_url,p.source_url);assert.equal(e.year,p.year);}
});

test('compact comparison preserves complete evidence through explicit references',async()=>{
 const args={query:'2025년과 2026년 반도체 인력양성 예산 비교',limit:2};
 const full=(await rpc('tools/call',{name:'budget_research',arguments:args})).result.structuredContent;
 const compact=(await rpc('tools/call',{name:'budget_research',arguments:{...args,response_format:'compact'}})).result.structuredContent;
 assert.deepEqual(compact.evidence,full.evidence);assert.deepEqual(compact.comparison,full.comparison);
 for(let i=0;i<full.per_year.length;i++){
  const index=new Map(compact.evidence.map(e=>[e.id,e]));
  assert.deepEqual(compact.per_year[i].evidence_ids.map(id=>index.get(id)),full.per_year[i].evidence);
 }
 assert(Buffer.byteLength(JSON.stringify(compact))<Buffer.byteLength(JSON.stringify(full)));
});

test('verified Excel context is scoped to matching source block',async()=>{
 const q='2007년 본예산 중앙도서관 로비 조명보수공사 예산';
 const {data:r,status}=await get('/api/research?'+new URLSearchParams({query:q,limit:1}));assert.equal(status,200);
 const e=r.evidence[0];assert.equal(e.id,'b6b50280e845dfee8282:p775');assert.equal(e.unit,'원문 확인');assert.equal(e.pdf_page,null);
 assert.equal(e.table_context.amount_cell,'J5125');assert.equal(e.table_context.unit_header.cell,'I2');assert.equal(e.table_context.amount,4000);
 const {data:p}=await get('/api/page?'+new URLSearchParams({document_id:e.document_id,page:e.page}));assert.deepEqual(p.table_context,e.table_context);
 const {data:other}=await get('/api/page?'+new URLSearchParams({document_id:e.document_id,page:774}));assert.equal(other.table_context,undefined);
});

test('repeat research reuses bounded evidence without asset reads or changing sources',async()=>{
 const query='2026년 본예산 청년월세 지원사업';const url='/api/research?'+new URLSearchParams({query,limit:4});
 const first=await get(url);assert.equal(first.status,200);assert(first.data.evidence.length>1);
 const strict={ASSETS:{fetch(){throw Error('unexpected asset read')}}};
 const res=await worker.fetch(new Request('https://test.local'+url),strict);assert.equal(res.status,200);const second=await res.json();
 assert.deepEqual(second.evidence,first.data.evidence);assert.equal(second.retrieval.cache_hit,true);
 const different=await get('/api/research?'+new URLSearchParams({query:'2025년 본예산 청년월세 지원사업',limit:4}));
 assert(different.data.evidence.every(e=>e.year===2025));
});

test('simultaneous repeated and mixed-year questions retain matching evidence',async()=>{
 const query='2026년 본예산 청년월세 지원사업';const url='/api/research?'+new URLSearchParams({query,limit:2});
 const responses=await Promise.all(Array.from({length:8},()=>get(url)));assert(responses.every(x=>x.status===200));
 for(const r of responses)assert.deepEqual(r.data.evidence,responses[0].data.evidence);
 const mixed=await Promise.all([2025,2026].map(year=>get('/api/research?'+new URLSearchParams({query:'청년월세',year,budget_type:'본예산',limit:2}))));
 assert(mixed.every((r,i)=>r.status===200&&r.data.evidence.every(e=>e.year===[2025,2026][i]&&e.budget_type==='본예산')));
});

test('contradictory year controls return an explicit error and normal request still works',async()=>{
 for(const args of [{query:'2025년 청년월세',year:2026},{query:'2025년 도서관 예산',year_scope:'all'}]){
  const {result:r}=await rpc('tools/call',{name:'budget_research',arguments:args});assert.equal(r.isError,true);assert.match(r.content[0].text,/충돌|다릅니다/);
 }
 const {result:ok}=await rpc('tools/call',{name:'budget_research',arguments:{query:'2025년 본예산 청년월세',limit:1}});assert.equal(ok.isError,false);assert(ok.structuredContent.evidence.every(e=>e.year===2025&&e.budget_type==='본예산'));
});

test('same-year budget and settlement comparison searches both explicit types independently',async()=>{
 const {result:r}=await rpc('tools/call',{name:'budget_research',arguments:{query:'2025년 본예산과 결산 청년월세 비교',limit:2}});
 assert.equal(r.isError,false);const d=r.structuredContent;assert.equal(d.type_comparison.status,'unverified');assert.deepEqual(d.type_comparison.requested_types,['본예산','결산']);
 assert.deepEqual(d.per_type.map(p=>p.filters.budget_type),['본예산','결산']);assert(d.per_type.every(p=>p.evidence.every(e=>e.year===2025&&e.budget_type===p.filters.budget_type)));
 assert.deepEqual(d.type_comparison.missing_types,d.per_type.filter(p=>!p.evidence.length).map(p=>p.filters.budget_type));
 assert(!d.evidence.some(e=>e.budget_type==='추경'));
});

test('type comparison compact form retains references and mixed performance intent',async()=>{
 const args={query:'2025년 본예산과 결산 청년월세 비교',limit:1};
 const full=(await rpc('tools/call',{name:'budget_research',arguments:args})).result.structuredContent;
 const compact=(await rpc('tools/call',{name:'budget_research',arguments:{...args,response_format:'compact'}})).result.structuredContent;
 const byId=new Map(compact.evidence.map(e=>[e.id,e]));assert.deepEqual(compact.per_type.map(p=>p.evidence_ids.map(id=>byId.get(id))),full.per_type.map(p=>p.evidence));
});

test('explicit multi-year comparison does not silently narrow to year parameter',async()=>{
 const {result:r}=await rpc('tools/call',{name:'budget_research',arguments:{query:'2025년과 2026년 청년월세 비교',year:2025}});
 assert.equal(r.isError,true);assert.match(r.content[0].text,/year 인자를 빼고/);
 const {result:ok}=await rpc('tools/call',{name:'budget_research',arguments:{query:'2025년과 2026년 청년월세 비교',limit:1}});
 assert.equal(ok.isError,false);assert.deepEqual(ok.structuredContent.per_year.map(p=>p.filters.year),[2025,2026]);
});

test('page unit does not claim to apply to every amount in mixed-unit text',async()=>{
 const {data:p,status}=await get('/api/page?document_id=fe0548f98abd4cb6599b&page=417');assert.equal(status,200);
 assert.equal(p.unit,'원');assert.match(p.unit_scope,/직접 붙은 단위/);assert.match(p.text,/2,735백만원/);assert.match(p.text,/단위\s*:\s*원/);
});

test('cached research does not wait behind an unrelated blocked cold search',async()=>{
 const url='/api/research?'+new URLSearchParams({query:'2026년 본예산 청년월세 지원사업',limit:2});
 const warm=await get(url);assert.equal(warm.status,200);assert(warm.data.evidence.length);
 let unblock,signalBlocked;const barrier=new Promise(r=>unblock=r),blocked=new Promise(r=>signalBlocked=r);
 const blockedEnv={ASSETS:{async fetch(req){signalBlocked();await barrier;return env.ASSETS.fetch(req);}}};
 const cold=worker.fetch(new Request('https://test.local/api/research?'+new URLSearchParams({query:'2026년 본예산 업무용 차량 운영 세부사업',limit:1})),blockedEnv);
 let timer;try{
  await Promise.race([blocked,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('cold search did not start')),2000)})]);clearTimeout(timer);
  const fast=await Promise.race([get(url),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('cached search waited behind cold search')),2000)})]);clearTimeout(timer);
  assert.equal(fast.status,200);assert.deepEqual(fast.data.evidence,warm.data.evidence);
 }finally{clearTimeout(timer);unblock();await cold;}
});
