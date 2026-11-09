const base=process.env.WORKER_URL||'http://127.0.0.1:8787';
const start=performance.now();const results=await Promise.all(Array.from({length:40},async(_,i)=>{
 const year=2007+i,args={query:'도서관 예산',year,limit:1};
 try{const res=await fetch(base+'/public-mcp',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:i,method:'tools/call',params:{name:'budget_research',arguments:args}}),signal:AbortSignal.timeout(120000)});const body=await res.json(),r=body.result;return {year,status:res.status,isError:r?.isError,error:r?.isError?r.content?.[0]?.text:null,years:r?.structuredContent?.evidence?.map(e=>e.year)};}catch(e){return {year,status:0,isError:true,error:String(e)}}
}));
console.log(JSON.stringify({wall_ms:+(performance.now()-start).toFixed(2),total:results.length,success:results.filter(r=>r.status===200&&!r.isError).length,overload:results.filter(r=>r.isError&&r.error?.includes('동시 검색 요청')).length,other_errors:results.filter(r=>r.isError&&!r.error?.includes('동시 검색 요청')),year_mismatches:results.filter(r=>r.years?.some(y=>y!==r.year)),results}));
