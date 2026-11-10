import {readFile,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

export const EXCLUDED=['.gitignore','.gitlab-ci.yml'];
export function managed(file){return !EXCLUDED.includes(file)&&!file.startsWith('.github/');}
export function allowed(file){
 if(!file||file.includes('\\')||file.split('/').some(p=>!p||p==='.'||p==='..')||/(?:^|\/)(?:\.env|credentials?|secrets?|id_rsa)(?:[./_-]|$)/i.test(file))return false;
 return /^(?:[A-Z_]+\.md|LICENSE|package(?:-lock)?\.json|requirements(?:-rag)?\.txt|release\.config\.json|\.gitignore|\.gitlab-ci\.yml|\.github\/workflows\/[\w-]+\.ya?ml|\.openai\/hosting\.json|(?:docs|worker|scripts|pipeline|tests|web)\/[\w./-]+\.(?:md|json|mjs|js|py|html|css)|snapshot\/(?:catalog|assets)\.json|snapshot\/semantic\/manifest\.json)$/.test(file);
}
export async function boundedFile(root,file,{missing=false}={}){
 if(!allowed(file))throw Error('Unapproved source path: '+file);
 const base=path.resolve(root),target=path.resolve(base,file);
 if(!target.startsWith(base+path.sep))throw Error('Source path escaped checkout');
 if((await lstat(base)).isSymbolicLink())throw Error('Checkout root must not be a symlink or junction');
 let current=base;
 for(const part of file.split('/')){current=path.join(current,part);try{const st=await lstat(current);if(st.isSymbolicLink())throw Error('Symlink or junction in source path: '+file);}catch(e){if(e.code==='ENOENT'&&missing)break;throw e;}}
 return target;
}
export async function sourceDigest(root,files){
 const hash=createHash('sha256');
 for(const file of [...files].sort()){const p=await boundedFile(root,file);hash.update(file+'\0');hash.update((await readFile(p,'utf8')).replace(/\r\n/g,'\n'));hash.update('\0');}
 return hash.digest('hex');
}
export async function buildIdentity(root){
 let input;
 try{input=JSON.parse(await readFile(path.join(root,'.release-state/build-input.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 if(input){
  if(!/^[a-f0-9]{40}$/.test(input.source_sha)||!Array.isArray(input.files)||input.files.some(f=>!managed(f)||!allowed(f)))throw Error('Invalid release build input');
  if(await sourceDigest(root,input.files)!==input.source_digest)throw Error('Release source changed after synchronization');
  return{source_sha:input.source_sha,source_digest:input.source_digest,verified_source:true};
 }
 try{
  const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true}).trim();
  const files=git('ls-files','-z').split('\0').filter(f=>f&&managed(f)&&allowed(f));
  const clean=!git('status','--porcelain','--untracked-files=normal');
  return{source_sha:clean?git('rev-parse','HEAD'):null,source_digest:await sourceDigest(root,files),verified_source:false};
 }catch{return{source_sha:null,source_digest:null,verified_source:false};}
}
