// Public checks send no authentication headers, tokens or cookies.
import {writeFile} from 'node:fs/promises';
const origin=process.argv[2]||'https://seongnam-budget-research-20261107.gnudas0923.chatgpt.site';
const output=process.argv[3];const checks=[];
async function get(path){let start=performance.now(),r=await fetch(origin+path,{signal:AbortSignal.timeout(60000)}),data=await r.json().catch(()=>({error:'Non-JSON HTTP '+r.status}));checks.push({path,status:r.status,milliseconds:Math.round(performance.now()-start)});if(!r.ok)throw Error(JSON.stringify(data));return data;}
async function rpc(method,params){let start=performance.now(),r=await fetch(origin+'/public-mcp',{method:'POST',headers:{'content-type':'application/json','accept':'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(60000)}),data=await r.json().catch(()=>({error:'Non-JSON HTTP '+r.status}));checks.push({method,status:r.status,milliseconds:Math.round(performance.now()-start),isError:data.result?.isError??false});if(!r.ok||data.error||data.result?.isError)throw Error(JSON.stringify(data));return data.result;}
let status=await get('/api/status');
let search=await get('/api/search?'+new URLSearchParams({query:'노인일자리',year:2026,limit:2}));
if(!search.results.length)throw Error('No evidence');
let h=search.results[0];let page=await get('/api/page?'+new URLSearchParams({document_id:h.document_id,page:h.page}));
if(!page.text||page.source_url!==h.source_url)throw Error('Broken citation');
await rpc('server/discover');await rpc('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'anonymous-probe',version:'1'}});
let tools=await rpc('tools/list');if(tools.tools.length!==8)throw Error('Wrong tools');
await rpc('tools/call',{name:'search_budget',arguments:{query:'도서관',year:2007,limit:2}});
let all=await get('/api/search?'+new URLSearchParams({query:'노인일자리',limit:2}));
if(!all.results.length)throw Error('All-year search failed');
if(!status.retrieval?.vectorization_complete||!status.retrieval?.reranking_enabled)throw Error('Semantic index not enabled');
let semantic=await get('/api/search?'+new URLSearchParams({query:'아이를 맡기는 시설 지원',year:2026,mode:'vector',limit:5}));
if(!semantic.retrieval?.reranked||!semantic.results.some(h=>/어린이집|보육/.test(h.excerpt)))throw Error('Vector + reranking failed');
let rag=await rpc('tools/call',{name:'build_rag_context',arguments:{query:'청년 주거비 지원',year:2026}});
if(!rag.structuredContent?.retrieval?.reranked||!rag.structuredContent?.evidence?.length)throw Error('RAG evidence not reranked');
let report={at:new Date().toISOString(),origin,authentication:'none',summary:status,checks};
if(output)await writeFile(output,JSON.stringify(report,null,2));
console.log(JSON.stringify({documents:status.documents,pdf_pages:status.snapshot_pages,text_blocks:status.snapshot_text_blocks,checks},null,2));
