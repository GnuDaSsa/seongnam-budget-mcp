import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
const manifest=JSON.parse(await readFile('snapshot/assets.json','utf8'));
const digest=b=>createHash('sha256').update(b).digest('hex');
const checkOnly=process.argv.includes('--check');
let cursor=0,downloaded=0,verified=0;
async function run(){while(cursor<manifest.files.length){const f=manifest.files[cursor++];
 if(!/^(?:(?:corpus|semantic)\/[a-zA-Z0-9_.-]+|affiliates\/[a-f0-9]{20}\.json\.gz)$/.test(f.path))throw Error('Invalid asset path');
 const target=path.resolve('snapshot',f.path);let current;try{current=await readFile(target);}catch{}
 if(current&&current.length===f.bytes&&digest(current)===f.sha256){verified++;continue;}
 if(checkOnly)throw Error('Missing or mismatched asset: '+f.path);
 const origin=f.path.startsWith('semantic/tokens-')?manifest.token_origin:manifest.origin;
 const res=await fetch(origin+'/'+f.path,{signal:AbortSignal.timeout(120000)});
 if(!res.ok)throw Error('HTTP '+res.status+' '+f.path);
 const bytes=Buffer.from(await res.arrayBuffer());
 if(bytes.length!==f.bytes||digest(bytes)!==f.sha256)throw Error('Snapshot checksum mismatch: '+f.path);
 await mkdir(path.dirname(target),{recursive:true});await writeFile(target+'.partial',bytes);await rename(target+'.partial',target);downloaded++;
}}
await Promise.all(Array.from({length:4},run));
console.log(JSON.stringify({verified,downloaded,total:manifest.files.length,check_only:checkOnly}));
