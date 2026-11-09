import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import worker from '../dist/server/index.js';
const root=path.resolve('snapshot');
let reads=[];
const env={ASSETS:{async fetch(req){const name=new URL(req.url).pathname,started=performance.now();let bytes;try{bytes=await readFile(path.join(root,name));}catch{return new Response('',{status:404});}reads.push({name,bytes:bytes.length,elapsed_ms:performance.now()-started});return new Response(bytes);}}};
const tests=[{query:'청년 주거비 지원',year:2026},{query:'아이를 맡기는 시설 지원',year:2026},{query:'노인일자리'},{query:'도서관',year:2007}];
const results=[];
for(const args of tests){reads=[];let start=performance.now();const cpu=process.cpuUsage();const r=await worker.fetch(new Request('https://test.local/api/search?'+new URLSearchParams({...args,limit:5})),env);const data=await r.json();if(r.status!==200)throw Error(data.error);const frequencies=new Map();for(const x of reads)frequencies.set(x.name,(frequencies.get(x.name)||0)+1);const profile={query:args,elapsed_ms:Math.round(performance.now()-start),cpu:process.cpuUsage(cpu),memory:process.memoryUsage(),file_io_ms:Math.round(reads.reduce((a,b)=>a+b.elapsed_ms,0)),asset_reads:reads.length,duplicate_reads:reads.length-frequencies.size,bytes:reads.reduce((a,b)=>a+b.bytes,0),results:data.results.map(x=>({id:x.id,score:x.score,chunk:x.chunk})),retrieval:data.retrieval};results.push(profile);console.log(JSON.stringify(profile));}
await writeFile(process.argv[2]||'work/search-profile.json',JSON.stringify(results,null,2));
