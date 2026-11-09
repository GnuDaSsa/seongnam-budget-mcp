// Uses the official SDK installed separately in ignored work/mcp-client.
import {Client} from '../work/mcp-client/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import {StreamableHTTPClientTransport} from '../work/mcp-client/node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.js';
import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const origin=process.argv[2]||'http://127.0.0.1:8765',checks=[];
const client=new Client({name:'seongnam-public-compatibility-check',version:'1.0.0'});
try{
 await client.connect(new StreamableHTTPClientTransport(new URL(origin+'/public-mcp')));checks.push({name:'SDK initialize',pass:true});
 const listed=await client.listTools();assert.equal(listed.tools.length,8);assert(listed.tools.every(t=>t.annotations.readOnlyHint));checks.push({name:'8 read-only tools',pass:true});
 for(const query of [{query:'청년 주거비 지원',year:2026},{query:'아이를 맡기는 시설 지원',year:2026},{query:'노인일자리'}]){
  let start=performance.now();const r=await client.callTool({name:'budget_research',arguments:query});assert(!r.isError);const data=r.structuredContent;assert(data.evidence.length>0);assert.equal(data.generation_performed,false);assert(data.evidence.every(e=>e.source_url&&e.unit&&e.text&&e.context));checks.push({name:'budget_research',query,milliseconds:Math.round(performance.now()-start),server_ms:data.elapsed_ms,timings_ms:data.retrieval.timings_ms,cache_hit:data.retrieval.cache_hit,first_source:data.evidence[0].page_url});
 }
 let start=performance.now();const s=await client.callTool({name:'search',arguments:{query:'2026년 청년 주거비 지원'}});assert(!s.isError);assert(s.structuredContent.results.length>0);assert(s.structuredContent.results.every(x=>x.id&&x.title&&x.url));checks.push({name:'standard search',pass:true,milliseconds:Math.round(performance.now()-start)});
 const h=s.structuredContent.results[0];start=performance.now();const f=await client.callTool({name:'fetch',arguments:{id:h.id}});assert(!f.isError);assert.equal(f.structuredContent.id,h.id);assert.equal(f.structuredContent.url,h.url);assert(f.structuredContent.text);checks.push({name:'standard fetch',pass:true,milliseconds:Math.round(performance.now()-start)});
 const invalid=await client.callTool({name:'fetch',arguments:{id:'https://example.com/private'}});assert.equal(invalid.isError,true);checks.push({name:'reject arbitrary URL',pass:true});
 const report={at:new Date().toISOString(),origin,sdk:'@modelcontextprotocol/sdk@1.32.2',authentication:'none',external_model_api:false,checks};
 if(process.argv[3])await writeFile(process.argv[3],JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await client.close();}
