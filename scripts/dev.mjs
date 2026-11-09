import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import worker from '../dist/server/index.js';
const root=path.resolve('dist/client');
const env={ASSETS:{async fetch(input){
 const p=path.resolve(root,'.'+new URL(typeof input==='string'?input:input.url).pathname);
 if(!p.startsWith(root+path.sep))return new Response('Not found',{status:404});
 try{return new Response(await readFile(p));}catch{return new Response('Not found',{status:404});}
}}};
const server=http.createServer(async(req,res)=>{
 try{
  const parts=[];let size=0;for await(const b of req){size+=b.length;if(size>65536){res.writeHead(413);res.end();return;}parts.push(b);}
  const request=new Request('http://127.0.0.1:8765'+req.url,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(parts)}:{})});
  const response=await worker.fetch(request,env,{waitUntil:p=>p.catch(console.error)});
  res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
 }catch(e){res.writeHead(500);res.end(e.message);}
});
server.listen(8765,'127.0.0.1',()=>console.log('Local: http://127.0.0.1:8765'));
