import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {mkdtemp, mkdir, readFile, writeFile, rm} from 'node:fs/promises';
import {run} from '../scripts/release.mjs';
import {sourceDigest} from '../scripts/release-identity.mjs';
import {manifestDiff, syncSnapshotAssets} from '../scripts/sync-snapshot-assets.mjs';

const oldPath = 'corpus/pages-2026-0.json.gz', newPath = 'corpus/pages-2026-1.json.gz';
const origin = 'https://budget.example.test', tokenOrigin = 'https://tokens.example.test';
const asset = (name, content) => ({path:name, bytes:Buffer.byteLength(content), sha256:createHash('sha256').update(content).digest('hex')});
const manifest = files => ({origin,token_origin:tokenOrigin,files});
const previous = manifest([asset(oldPath,'old')]), updated = manifest([asset(oldPath,'updated'),asset(newPath,'added')]);
const save = (dir, file, data) => writeFile(path.join(dir,file), typeof data === 'string' ? data : JSON.stringify(data));
const git = (dir,...args) => run('git',args, dir);

test('real registries accept only hosted, relative asset changes without duplicate entries or removals', () => {
  assert.deepEqual(manifestDiff(previous,updated).map(c=>c.name), [oldPath,newPath]);
  for (const invalid of [manifest([asset(newPath,'adding')]), manifest([updated.files[0],updated.files[0]]),
    manifest([previous.files[0],asset('corpus/../unsafe.json.gz','bad')]), {...updated,token_origin:origin},
    manifest([previous.files[0],asset('semantic/tokens-0.bin.gz','changed')])]) {
    assert.throws(()=>manifestDiff(previous,invalid));
  }
});

async function fixture(t) {
  const base = await mkdtemp(path.join(os.tmpdir(),'budget-assets-'));
  t.after(async()=>{
    if (path.dirname(base)!==path.resolve(os.tmpdir()) || !path.basename(base).startsWith('budget-assets-')) throw Error('Unsafe fixture cleanup');
    await rm(base,{recursive:true,force:true});
  });
  const root = path.join(base,'canonical'), target = path.join(base,'site');
  const config = {branch:'main',remotes:[],site:{project_id:'fixture',url:origin}};
  const files = ['.openai/hosting.json','release.config.json','snapshot/assets.json'];
  for (const dir of [root,target]) {
    await mkdir(path.join(dir,'snapshot/corpus'),{recursive:true});
    await mkdir(path.join(dir,'.release-state'));
    await mkdir(path.join(dir,'.openai'));
    await git(dir,'init','-b','main');
    await save(dir,'.gitignore','.release-state/\n'+(dir===root?'snapshot/corpus/\n':''));
    await save(dir,'.openai/hosting.json',{project_id:'fixture'});
    await save(dir,'release.config.json',config);
    await save(dir,'snapshot/assets.json',dir===root?updated:previous);
    await save(dir,'snapshot/'+oldPath,dir===root?'updated':'old');
    await git(dir,'add','.');
    await git(dir,'-c','user.name=Fixture','-c','user.email=test@example.test','-c','commit.gpgsign=false','commit','-m','test fixture');
  }
  const state = {files,source_sha:await git(root,'rev-parse','HEAD'),source_digest:await sourceDigest(root,files)};
  await save(root,'snapshot/'+newPath,'added');
  await save(target,'snapshot/assets.json',updated);
  await save(root,'.release-state/state.json',{...state,stage:'sites_source_ready'});
  await save(root,'.release-state/sites-sync.json',{...state,target,head:await git(target,'rev-parse','HEAD')});
  await save(target,'.release-state/build-input.json',state);
  return {root,target};
}

test('target preflight rejects staged, unrelated or ambiguous changes; verified partial copies resume', async t=>{
  const {root,target} = await fixture(t);
  await save(target,'unexpected.txt','user work');
  await assert.rejects(syncSnapshotAssets(root,target),/Unrelated Sites change/);
  await git(target,'add','unexpected.txt');
  await assert.rejects(syncSnapshotAssets(root,target),/Staged Sites changes/);
  await git(target,'reset','--','unexpected.txt');
  await rm(path.join(target,'unexpected.txt'));
  await save(target,'snapshot/'+newPath,'unknown');
  await assert.rejects(syncSnapshotAssets(root,target),/Unexpected existing asset/);
  assert.equal(await readFile(path.join(target,'snapshot/'+oldPath),'utf8'),'old');
  await save(target,'snapshot/'+newPath,'added');
  await save(root,'snapshot/'+oldPath,'mismatch');
  await assert.rejects(syncSnapshotAssets(root,target),/Source asset checksum mismatch/);
  await save(root,'snapshot/'+oldPath,'updated');
  const result = await syncSnapshotAssets(root,target);
  assert.equal(result.copied,1);
  assert.deepEqual(result.assets,[oldPath,newPath]);
  assert.equal(await readFile(path.join(target,'snapshot/'+oldPath),'utf8'),'updated');
  assert.equal((await syncSnapshotAssets(root,target)).copied,0);
});
