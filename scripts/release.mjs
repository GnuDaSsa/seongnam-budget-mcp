import {readFile,writeFile,mkdir,copyFile,open,unlink,readdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {allowed,managed,boundedFile,sourceDigest} from './release-identity.mjs';

export async function run(command,args,cwd){
 return new Promise((resolve,reject)=>{
  const child=spawn(command,args,{cwd,windowsHide:true,shell:false,env:{...process.env,GIT_TERMINAL_PROMPT:'0'}});let out='',err='';
  child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);
  child.on('error',reject);child.on('close',code=>code===0?resolve(out.trim()):reject(Error(command+' failed ('+code+'): '+err.slice(-3000))));
 });
}
export class Release {
 constructor(root,config,{execute=run,fetcher=fetch,copy=copyFile}={}){this.root=path.resolve(root);this.config=config;this.execute=execute;this.fetcher=fetcher;this.copy=copy;this.statePath=path.join(this.root,'.release-state/state.json');}
 async git(...args){return this.execute('git',['-c','credential.interactive=false',...args],this.root);}
 async load(){try{return JSON.parse(await readFile(this.statePath,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
 async save(s){await mkdir(path.dirname(this.statePath),{recursive:true});await writeFile(this.statePath,JSON.stringify(s,null,2)+'\n');}
 async preflight(){
  if(await this.git('branch','--show-current')!==this.config.branch)throw Error('Release requires configured branch');
  if(await this.git('diff','--name-only','--diff-filter=U'))throw Error('Resolve merge conflicts before release');
  for(const remote of this.config.remotes){const u=new URL(remote.url);if(u.protocol!=='https:'||u.username||u.password)throw Error('Remote must be HTTPS without credentials');if(await this.git('remote','get-url',remote.name)!==remote.url)throw Error('Remote URL mismatch: '+remote.name);}
 }
 async assertSource(s){
  await this.preflight();
  if(!s||await this.git('rev-parse','HEAD')!==s.source_sha||await this.git('status','--porcelain','--untracked-files=normal')||await sourceDigest(this.root,s.files)!==s.source_digest)throw Error('Source changed; prepare a new release');
 }
 async prepare(message){
  await this.preflight();
  if(!message?.trim()||message.startsWith('-'))throw Error('An explicit commit message is required');
  const deleted=(await this.git('diff','HEAD','--name-only','--diff-filter=D','--no-renames','-z')).split('\0').filter(Boolean);
  if(deleted.length)throw Error('Source deletions need explicit review before release: '+deleted.join(', '));
  const changed=new Set([...((await this.git('diff','--name-only','HEAD','-z')).split('\0')),...((await this.git('ls-files','--others','--exclude-standard','-z')).split('\0'))].filter(Boolean));
  if([...changed].some(f=>!allowed(f)))throw Error('Unapproved changed source paths; stage only project code and docs');
  const before=await this.git('diff','HEAD','--');
  const changedDigest=await sourceDigest(this.root,[...changed]);
  // Existing assets are checked only. Missing data never triggers an automatic download.
  await this.execute(process.execPath,['scripts/download-snapshot.mjs','--check'],this.root);
  await this.execute(process.execPath,['scripts/build.mjs'],this.root);
  const tests=(await readdir(path.join(this.root,'tests'))).filter(f=>f.endsWith('.test.mjs')).sort().map(f=>'tests/'+f);
  await this.execute(process.execPath,['--use-system-ca','--test',...tests],this.root);
  if(before!==await this.git('diff','HEAD','--')||changedDigest!==await sourceDigest(this.root,[...changed]))throw Error('Source changed during validation');
  if(changed.size){await this.git('add','--',...changed);await this.git('commit','-m',message);}
  if(await this.git('status','--porcelain','--untracked-files=normal'))throw Error('Working tree is not clean after commit');
  const files=(await this.git('ls-files','-z')).split('\0').filter(Boolean);
  if(files.some(f=>!allowed(f)))throw Error('Tracked repository includes unapproved release files');
  const selected=files.filter(managed),s={source_sha:await this.git('rev-parse','HEAD'),source_digest:await sourceDigest(this.root,selected),files:selected,validated_at:new Date().toISOString(),remotes:{},stage:'validated'};
  await this.save(s);return s;
 }
 async remoteHead(remote){const line=await this.git('ls-remote',remote.name,'refs/heads/'+this.config.branch);return line.split(/\s/)[0];}
 async push(){
  const s=await this.load();await this.assertSource(s);
  for(const remote of this.config.remotes){
   // Fetch before checking ancestry. No force push or automatic conflict resolution.
   await this.git('fetch',remote.name,this.config.branch);
   const remoteSha=await this.remoteHead(remote);
   if(remoteSha!==s.source_sha){await this.git('merge-base','--is-ancestor',remoteSha,s.source_sha);await this.git('push',remote.name,s.source_sha+':refs/heads/'+this.config.branch);}
   if(await this.remoteHead(remote)!==s.source_sha)throw Error('Remote did not retain release: '+remote.name);
   s.remotes[remote.name]=s.source_sha;s.stage='partially_pushed';await this.save(s);
  }
  s.stage='repositories_verified';await this.save(s);return s;
 }
 async assertRemotes(s){await this.assertSource(s);for(const r of this.config.remotes)if(s.remotes[r.name]!==s.source_sha||await this.remoteHead(r)!==s.source_sha)throw Error('Both repositories must match before Sites deployment');}
 async syncSites(checkout){
  const s=await this.load();await this.assertRemotes(s);const target=path.resolve(checkout);
  if(target===this.root||target.startsWith(this.root+path.sep)||this.root.startsWith(target+path.sep))throw Error('Use a separate Sites checkout');
  const hosting=JSON.parse(await readFile(await boundedFile(target,'.openai/hosting.json'),'utf8'));
  if(hosting.project_id!==this.config.site.project_id)throw Error('Wrong Sites project');
  const dirty=await this.execute('git',['status','--porcelain','--untracked-files=normal'],target);
  const head=await this.execute('git',['rev-parse','HEAD'],target),journalPath=path.join(this.root,'.release-state/sites-sync.json');
  let journal;try{journal=JSON.parse(await readFile(journalPath,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
  const matches=journal?.target===target&&journal.source_sha===s.source_sha&&journal.source_digest===s.source_digest&&journal.head===head;
  if(dirty&&!matches)throw Error('Sites checkout must be clean before synchronization or match its saved synchronization journal');
  const digest=async(base,file)=>{const p=await boundedFile(base,file,{missing:true});try{return createHash('sha256').update(await readFile(p)).digest('hex');}catch(e){if(e.code==='ENOENT')return null;throw e;}};
  if(matches){
   if(!Array.isArray(journal.entries)||journal.entries.length!==s.files.length||journal.entries.some((e,i)=>e.file!==s.files[i]))throw Error('Invalid Sites synchronization journal');
   if(await this.execute('git',['diff','--cached','--name-only','-z'],target))throw Error('Staged Sites checkout changes block synchronization recovery');
   const changed=new Set([...(await this.execute('git',['diff','HEAD','--name-only','--no-renames','-z'],target)).split('\0'),...(await this.execute('git',['ls-files','--others','--exclude-standard','-z'],target)).split('\0')].filter(Boolean));
   if([...changed].some(f=>!s.files.includes(f)))throw Error('Unrelated Sites checkout changes block synchronization recovery');
   for(const entry of journal.entries){const current=await digest(target,entry.file);if(await digest(this.root,entry.file)!==entry.after||(current!==entry.before&&current!==entry.after))throw Error('Unrecognized Sites file changes; preserve and review: '+entry.file);}
  }else{
   const entries=[];for(const file of s.files)entries.push({file,before:await digest(target,file),after:await digest(this.root,file)});
   journal={target,source_sha:s.source_sha,source_digest:s.source_digest,head,entries};
   await mkdir(path.dirname(journalPath),{recursive:true});await writeFile(journalPath,JSON.stringify(journal,null,2)+'\n');
  }
  let previous=[];try{previous=JSON.parse(await readFile(path.join(target,'.release-state/build-input.json'),'utf8')).files;}catch(e){if(e.code!=='ENOENT')throw e;}
  const removed=previous.filter(f=>!s.files.includes(f));if(removed.length)throw Error('Managed source deletions need explicit review: '+removed.join(', '));
  // The source-only ignore/CI files differ intentionally; full corpus assets are untouched.
  const excludes=await this.execute('git',['rev-parse','--git-path','info/exclude'],target),excludePath=path.resolve(target,excludes);
  if(!excludePath.startsWith(target+path.sep))throw Error('Unsupported external Git directory');
  const excludesText=await readFile(excludePath,'utf8');if(!excludesText.includes('/.release-state/'))await writeFile(excludePath,excludesText+'\n/.release-state/\n');
  for(const entry of journal.entries){
   const current=await digest(target,entry.file);if(current===entry.after)continue;
   if(current!==entry.before)throw Error('Unrecognized Sites file changes; preserve and review: '+entry.file);
   const destination=await boundedFile(target,entry.file,{missing:true});await mkdir(path.dirname(destination),{recursive:true});await this.copy(await boundedFile(this.root,entry.file),destination);
  }
  if(await sourceDigest(target,s.files)!==s.source_digest)throw Error('Sites copy verification failed');
  await mkdir(path.join(target,'.release-state'),{recursive:true});await writeFile(path.join(target,'.release-state/build-input.json'),JSON.stringify({source_sha:s.source_sha,source_digest:s.source_digest,files:s.files},null,2)+'\n');
  s.stage='sites_source_ready';await this.save(s);
  return{source_sha:s.source_sha,project_id:hosting.project_id,next:'Run official Sites source helper, save_site_version, deploy_site_version, then verify. Never persist its credential.'};
 }
 async verify(receipt,connections){
  const s=await this.load();await this.assertRemotes(s);
  if(receipt.status!=='succeeded'||receipt.project_id!==this.config.site.project_id||receipt.url!==this.config.site.url||!receipt.id||!receipt.version_id)throw Error('A successful official Sites deployment receipt is required');
  const request=async(route,body)=>{const res=await this.fetcher(this.config.site.url+route,{...(body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});if(!res.ok)throw Error('Live verification HTTP '+res.status);return res.json();};
  const check=r=>{if(r?.source_sha!==s.source_sha||r?.source_digest!==s.source_digest||r?.verified_source!==true)throw Error('Live release identity mismatch');};
  check((await request('/api/status')).release);
  for(const [query,code] of [['청년월세지원사업 통계목','301-01'],['판교 연구센터 예산','401-01']]){
   const rpc=await request('/public-mcp',{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'budget_research',arguments:{query,year:2026,limit:1}}});
   const data=rpc.result?.structuredContent;if(rpc.error||rpc.result?.isError||!data?.evidence?.[0]?.classification?.matched_paths?.some(p=>p.combined_code===code))throw Error('Public MCP regression: '+query);
  }
  for(const name of this.config.connections){const c=connections.find(c=>c.name===name);if(!c)throw Error('Missing connected MCP verification: '+name);check(c.release);}
  s.stage='complete';s.site={deployment_id:receipt.id,version_id:receipt.version_id,url:receipt.url};s.verified_at=new Date().toISOString();s.connections=this.config.connections;await this.save(s);return s;
 }
}

async function main(){
 const root=process.cwd(),config=JSON.parse(await readFile('release.config.json','utf8')),release=new Release(root,config),[command,...args]=process.argv.slice(2),options={};
 for(let i=0;i<args.length;i+=2){if(!args[i].startsWith('--')||args[i+1]===undefined)throw Error('Options require a value');options[args[i].slice(2)]=args[i+1];}
 await mkdir('.release-state',{recursive:true});let lock;try{lock=await open('.release-state/lock','wx');}catch(e){if(e.code==='EEXIST')throw Error('A release lock exists. Check the earlier process before removing it.');throw e;}
 try{
  let result;if(command==='prepare')result=await release.prepare(options.message);else if(command==='push')result=await release.push();else if(command==='sync-sites'&&options.checkout)result=await release.syncSites(options.checkout);else if(command==='verify'&&options.receipt&&options.connections)result=await release.verify(JSON.parse(await readFile(options.receipt,'utf8')),JSON.parse(await readFile(options.connections,'utf8')));else if(command==='status')result=await release.load();else throw Error('Use prepare --message TEXT, push, sync-sites --checkout PATH, verify --receipt PATH --connections PATH, or status');
  console.log(JSON.stringify(result,null,2));
 }finally{await lock.close();await unlink('.release-state/lock');}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(e=>{console.error(e.message);process.exitCode=1;});
