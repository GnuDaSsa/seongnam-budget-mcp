import {mkdir,readFile,writeFile,cp,rm,access} from 'node:fs/promises';
import path from 'node:path';
import {build} from 'esbuild';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {buildLexical} from './build-lexical.mjs';
import {buildIdentity} from './release-identity.mjs';
await buildLexical();
const root=process.cwd();
const out=path.resolve(root,'dist');
if(path.dirname(out)!==root) throw new Error('Unsafe build destination');
await rm(out,{recursive:true,force:true});
await mkdir(path.join(out,'server'),{recursive:true});
await mkdir(path.join(out,'.openai'),{recursive:true});
await mkdir(path.join(out,'client'),{recursive:true});
const catalog=JSON.parse(await readFile('snapshot/catalog.json','utf8'));
const affiliates=JSON.parse(await readFile('snapshot/affiliates/catalog.json','utf8'));
const assets=JSON.parse(await readFile('snapshot/assets.json','utf8'));
const affiliateFiles=new Map(assets.files.filter(f=>f.path.startsWith('affiliates/')).map(f=>[f.path,f]));
if(affiliates.schema_version!==1||!Array.isArray(affiliates.documents)||!Array.isArray(affiliates.institutions))throw Error('Invalid affiliate catalog');
for(const d of affiliates.documents){
 if(!/^[a-f0-9]{20}$/.test(d.id)||d.shard!==d.id||d.source_scope!=='affiliate'||!affiliates.institutions.some(i=>i.id===d.institution_id))throw Error('Invalid affiliate document');
 const file='affiliates/'+d.shard+'.json.gz',meta=affiliateFiles.get(file),bytes=await readFile('snapshot/'+file),sha=createHash('sha256').update(bytes).digest('hex');
 if(!meta||bytes.length!==meta.bytes||sha!==meta.sha256||d.shard_bytes!==bytes.length||d.shard_sha256!==sha)throw Error('Affiliate snapshot checksum mismatch: '+file);
 const shard=JSON.parse(gunzipSync(bytes,{maxOutputLength:32*1024*1024}));
 if(!Array.isArray(shard.pages)||shard.pages.length!==d.indexed_pages||!Number.isInteger(d.page_count)||d.page_count<1)throw Error('Invalid affiliate page count: '+file);
 const seen=new Set();for(const p of shard.pages){if(!Number.isInteger(p.page)||p.page<1||p.page>d.page_count||seen.has(p.page)||typeof p.text!=='string'||!p.text.trim()||p.text.length>1024*1024||p.unit!=null&&typeof p.unit!=='string')throw Error('Invalid affiliate page locator or text: '+file);seen.add(p.page);}
}
const html=await readFile('web/index.html','utf8');
const semantic=JSON.parse(await readFile('snapshot/semantic/manifest.json','utf8'));
if(createHash('sha256').update(await readFile('snapshot/catalog.json')).digest('hex')!==semantic.corpus_catalog_sha256)throw Error('Corpus changed: rebuild vectors and ANN before publishing');
catalog.summary.search_engine='Hybrid Korean lexical + Potion 256d cosine IVF + token MaxSim reranking; generation by connected GPT';
for(const name of ['vocab','common','centroids','page-docs',...semantic.clusters.map((_,i)=>'cluster-'+i),...Array.from({length:Math.ceil(semantic.tokenizer_vocab/2048)},(_,i)=>'tokens-'+i)])await access(path.join(root,'snapshot/semantic',name+'.bin.gz'));
let code=await readFile('worker/server.js','utf8');
code=code.replace('/*__CATALOG__*/null',JSON.stringify(catalog)).replace('/*__AFFILIATES__*/null',JSON.stringify(affiliates)).replace('/*__HTML__*/null',JSON.stringify(html)).replace('/*__SEMANTIC__*/null',JSON.stringify(semantic)).replace('/*__RELEASE__*/null',JSON.stringify(await buildIdentity(root)));
await build({stdin:{contents:code,resolveDir:path.join(root,'worker'),sourcefile:'server.js'},bundle:true,format:'esm',platform:'browser',target:'es2022',outfile:path.join(out,'server/index.js')});
await cp('.openai/hosting.json',path.join(out,'.openai/hosting.json'));
await cp('snapshot/corpus',path.join(out,'client/corpus'),{recursive:true});
await mkdir(path.join(out,'client/affiliates'),{recursive:true});
for(const d of affiliates.documents)await cp('snapshot/affiliates/'+d.shard+'.json.gz',path.join(out,'client/affiliates',d.shard+'.json.gz'));
await cp('snapshot/semantic',path.join(out,'client/semantic'),{recursive:true,filter:src=>!path.basename(src).startsWith('tokens-')});
// Cloudflare conventional static asset metadata; Sites accepts dist/client assets.
await writeFile(path.join(out,'server/wrangler.json'),JSON.stringify({main:'index.js',compatibility_date:'2026-11-07',assets:{directory:'../client',binding:'ASSETS'}},null,2));
console.log(JSON.stringify({built:true,documents:catalog.summary.documents,pages:catalog.summary.snapshot_pages,shards:catalog.shards.length}));
