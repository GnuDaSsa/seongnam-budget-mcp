import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,copyFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Release,run} from '../scripts/release.mjs';
import {allowed,sourceDigest,buildIdentity} from '../scripts/release-identity.mjs';
const sha='1'.repeat(40),old='2'.repeat(40);
const config={branch:'main',remotes:[{name:'origin',url:'https://gitlab.example.test/user/repo.git'},{name:'github',url:'https://github.example.test/user/repo.git'}],site:{project_id:'test-site',url:'https://budget.example.test'},connections:['first','second']};
async function fixture(t){
 const root=await mkdtemp(path.join(os.tmpdir(),'budget-release-'));
 t.after(async()=>{if(path.dirname(root)!==path.resolve(os.tmpdir())||!path.basename(root).startsWith('budget-release-'))throw Error('Unsafe cleanup');await rm(root,{recursive:true,force:true});});
 await writeFile(path.join(root,'README.md'),'checked source\n');await mkdir(path.join(root,'tests'));return root;
}
function runner({heads={origin:old,github:old},failPush=null,failValidation=false,dirty='',deleted=''}={}){
 const calls=[];const state={heads,dirty,failPush};
 const execute=async(command,raw,cwd)=>{const args=command==='git'&&raw[0]==='-c'?raw.slice(2):raw;calls.push({command,args,cwd});
  if(command!=='git'){if(failValidation)throw Error('validation failed');return'';}
  const [op,...rest]=args;
  if(op==='branch')return'main';if(op==='diff')return rest.includes('--diff-filter=D')?deleted:rest.includes('-z')?'README.md\0':'';
  if(op==='remote')return config.remotes.find(r=>r.name===rest[1]).url;
  if(op==='rev-parse')return rest[0]==='HEAD'?sha:'.git/info/exclude';
  if(op==='status')return state.dirty;
  if(op==='ls-files')return rest.includes('--others')?'':'README.md\0';
  if(op==='ls-remote')return state.heads[rest[0]]+'\trefs/heads/main';
  if(op==='push'){if(state.failPush===rest[0])throw Error('security scan rejected');state.heads[rest[0]]=sha;}
  return'';
 };return{execute,calls,state};
}
async function saved(release,root){const s={source_sha:sha,source_digest:await sourceDigest(root,['README.md']),files:['README.md'],remotes:{origin:sha,github:sha},stage:'validated'};await release.save(s);return s;}
test('command output preserves UTF-8 characters split across stdout and stderr chunks',async()=>{
 const message='성남시 예산 검증';
 for(const stream of ['stdout','stderr']){
  const script=`const bytes=Buffer.from(${JSON.stringify(message)});for(const byte of bytes){await new Promise(resolve=>process.${stream}.write(Buffer.from([byte]),resolve));await new Promise(resolve=>setTimeout(resolve,10));}process.exitCode=${stream==='stderr'?1:0};`;
  const result=run(process.execPath,['--input-type=module','-e',script],process.cwd());
  if(stream==='stdout')assert.equal(await result,message);
  else await assert.rejects(result,error=>{assert.equal(error.message,process.execPath+' failed (1): '+message);return true;});
 }
});
test('failed validation never commits or pushes',async t=>{
 const root=await fixture(t),fake=runner({failValidation:true}),r=new Release(root,config,{execute:fake.execute});
 await assert.rejects(r.prepare('validated change'),/validation failed/);
 assert(!fake.calls.some(c=>['commit','push','add'].includes(c.args[0])));assert.equal(await r.load(),null);
});
test('tracked deletions are rejected before source hashing, validation or staging',async t=>{
 const root=await fixture(t),fake=runner({deleted:'docs/removed.md\0'}),r=new Release(root,config,{execute:fake.execute});
 await assert.rejects(r.prepare('remove source'),/Source deletions need explicit review.*docs\/removed.md/);
 assert(fake.calls.every(c=>c.command==='git'));assert(!fake.calls.some(c=>['commit','push','add'].includes(c.args[0])));
 assert.equal(await r.load(),null);
});
test('partial push is journaled and resumes without force; source drift blocks progress',async t=>{
 const root=await fixture(t),fake=runner({failPush:'github'}),r=new Release(root,config,{execute:fake.execute});await saved(r,root);
 await assert.rejects(r.push(),/security scan rejected/);assert.equal((await r.load()).stage,'partially_pushed');assert.equal((await r.load()).remotes.origin,sha);
 fake.state.failPush=null;await r.push();assert.equal((await r.load()).stage,'repositories_verified');
 assert.equal(fake.calls.filter(c=>c.args[0]==='push'&&c.args[1]==='origin').length,1);assert(!fake.calls.some(c=>c.args.some(a=>a.includes('--force'))));
 await writeFile(path.join(root,'README.md'),'changed');await assert.rejects(r.push(),/Source changed/);
});
test('Sites synchronization preserves assets and rejects source identity drift',async t=>{
 const root=await fixture(t),target=path.join(root,'..',path.basename(root)+'-site');
 await mkdir(target);t.after(async()=>{if(path.dirname(target)===path.dirname(root)&&target===root+'-site')await rm(target,{recursive:true,force:true});});
 await mkdir(path.join(target,'.openai'));await writeFile(path.join(target,'.openai/hosting.json'),JSON.stringify({project_id:'test-site'}));
 await mkdir(path.join(target,'.git/info'),{recursive:true});await writeFile(path.join(target,'.git/info/exclude'),'');
 await mkdir(path.join(target,'snapshot'));await writeFile(path.join(target,'snapshot/keep.bin'),'asset');await writeFile(path.join(target,'.gitignore'),'site rules');
 const fake=runner({heads:{origin:sha,github:sha}}),r=new Release(root,config,{execute:fake.execute});const s=await saved(r,root);await r.syncSites(target);
 assert.equal(await readFile(path.join(target,'snapshot/keep.bin'),'utf8'),'asset');assert.equal(await readFile(path.join(target,'.gitignore'),'utf8'),'site rules');
 assert.match(await readFile(path.join(target,'.git/info/exclude'),'utf8'),/\.release-state/);
 assert.deepEqual(await buildIdentity(target),{source_sha:sha,source_digest:s.source_digest,verified_source:true});
 await writeFile(path.join(target,'README.md'),'unexpected');await assert.rejects(buildIdentity(target),/source changed/);
});
test('Sites synchronization resumes only journaled before/after bytes after an interrupted copy',async t=>{
 const root=await fixture(t),target=root+'-site';
 await mkdir(target);t.after(async()=>{if(path.dirname(target)===path.dirname(root)&&target===root+'-site')await rm(target,{recursive:true,force:true});});
 await mkdir(path.join(target,'.openai'));await writeFile(path.join(target,'.openai/hosting.json'),JSON.stringify({project_id:'test-site'}));
 await mkdir(path.join(target,'.git/info'),{recursive:true});await writeFile(path.join(target,'.git/info/exclude'),'');
 await writeFile(path.join(root,'LICENSE'),'new license');await writeFile(path.join(target,'README.md'),'old readme');await writeFile(path.join(target,'LICENSE'),'old license');
 const fake=runner({heads:{origin:sha,github:sha}});let interrupted=false,unrelated=false,staged=false,copies=0;
 const execute=async(command,args,cwd)=>{
  if(cwd===target&&args[0]==='status')return interrupted?' M README.md':'';
  if(cwd===target&&args[0]==='diff')return args.includes('--cached')?(staged?'README.md\0':''):unrelated?'README.md\0web/unrelated.js\0':'README.md\0';
  if(cwd===target&&args[0]==='ls-files')return'';
  return fake.execute(command,args,cwd);
 };
 const r=new Release(root,config,{execute,copy:async(from,to)=>{await copyFile(from,to);copies++;if(!interrupted){interrupted=true;throw Error('injected interruption');}}});
 const s=await saved(r,root);s.files.push('LICENSE');s.source_digest=await sourceDigest(root,s.files);await r.save(s);
 await assert.rejects(r.syncSites(target),/injected interruption/);
 assert.equal(await readFile(path.join(target,'README.md'),'utf8'),'checked source\n');assert.equal(await readFile(path.join(target,'LICENSE'),'utf8'),'old license');
 assert.equal(JSON.parse(await readFile(path.join(root,'.release-state/sites-sync.json'),'utf8')).entries.length,2);
 await writeFile(path.join(target,'README.md'),'unknown partial or user content');
 await assert.rejects(r.syncSites(target),/Unrecognized Sites file changes/);assert.equal(copies,1);
 await writeFile(path.join(target,'README.md'),'checked source\n');unrelated=true;
 await assert.rejects(r.syncSites(target),/Unrelated Sites checkout changes/);assert.equal(copies,1);
 unrelated=false;staged=true;await assert.rejects(r.syncSites(target),/Staged Sites checkout changes/);assert.equal(copies,1);
 staged=false;await r.syncSites(target);assert.equal(copies,2);assert.equal(await readFile(path.join(target,'LICENSE'),'utf8'),'new license');
 assert.equal((await buildIdentity(target)).verified_source,true);
 await r.syncSites(target);assert.equal(copies,2);
});
test('completion requires both remotes, official success, live identity and connected MCP identity',async t=>{
 const root=await fixture(t),fake=runner({heads:{origin:sha,github:sha}});let live;
 const fetcher=async url=>({ok:true,json:async()=>url.endsWith('/api/status')?{release:live}:{result:{structuredContent:{evidence:[{classification:{matched_paths:[{combined_code:'301-01'},{combined_code:'401-01'}]}}]}}}});
 const r=new Release(root,config,{execute:fake.execute,fetcher}),s=await saved(r,root),receipt={status:'succeeded',project_id:'test-site',url:config.site.url,id:'deployment',version_id:'version'};
 live={source_sha:old,source_digest:s.source_digest,verified_source:true};await assert.rejects(r.verify(receipt,[]),/identity mismatch/);assert.notEqual((await r.load()).stage,'complete');
 live.source_sha=sha;await assert.rejects(r.verify({...receipt,status:'pending'},[]),/official Sites/);await assert.rejects(r.verify(receipt,[]),/Missing connected/);
 await r.verify(receipt,config.connections.map(name=>({name,release:live})));assert.equal((await r.load()).stage,'complete');
 fake.state.heads.github=old;await assert.rejects(r.verify(receipt,[]),/Both repositories/);
});
test('source paths exclude secrets, assets, traversal and arbitrary files',()=>{
 for(const file of ['.env','docs/secrets.json','snapshot/semantic/cluster-0.bin.gz','../README.md','C:/outside.md','notes.txt'])assert.equal(allowed(file),false,file);
 for(const file of ['scripts/release.mjs','docs/RELEASE.md','.github/workflows/ci.yml'])assert.equal(allowed(file),true,file);
});
