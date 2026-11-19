import {constants} from 'node:fs';
import {copyFile, lstat, open, readFile, realpath, unlink} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {Release} from './release.mjs';
import {boundedFile, sourceDigest} from './release-identity.mjs';

const exec = promisify(execFile);
const json = async file => JSON.parse(await readFile(file, 'utf8'));
const hash = data => createHash('sha256').update(data).digest('hex');
const assetName = /^(?:(?:corpus|semantic)\/[a-z0-9][a-z0-9_-]*\.(?:json|bin)\.gz|(?:affiliates|council)\/[a-f0-9]{20}\.json\.gz)$/;
const samePath = (a, b) => path.relative(a, b) === '';

async function git(cwd, ...args) {
  return (await exec('git', args, {cwd, windowsHide: true, encoding: 'utf8', maxBuffer: 8*1024*1024})).stdout;
}

export function manifestDiff(before, after) {
  if (!before.origin || !before.token_origin || before.origin !== after.origin || before.token_origin !== after.token_origin)
    throw Error('Asset origins changed; review the hosting change separately');
  function entries(manifest) {
    if (!Array.isArray(manifest.files) || !manifest.files.length) throw Error('Empty asset manifest');
    const map = new Map();
    for (const asset of manifest.files) {
      if (!assetName.test(asset.path) || !Number.isSafeInteger(asset.bytes) || asset.bytes <= 0 ||
          !/^[a-f0-9]{64}$/.test(asset.sha256) || map.has(asset.path)) throw Error('Invalid or duplicate snapshot asset: '+asset.path);
      map.set(asset.path, asset);
    }
    return map;
  }
  const old = entries(before), current = entries(after);
  for (const name of old.keys()) if (!current.has(name)) throw Error('Removed snapshot asset needs review: '+name);
  const changes = [];
  for (const [name, asset] of current) {
    const previous = old.get(name);
    if (previous?.sha256 === asset.sha256 && previous.bytes === asset.bytes) continue;
    if (name.startsWith('semantic/tokens-')) throw Error('External model asset needs its own publication: '+name);
    changes.push({name, previous, asset});
  }
  return changes;
}

async function inspectedAsset(root, name) {
  const dir = path.join(root, 'snapshot', path.dirname(name));
  for (const parent of [path.join(root, 'snapshot'), dir]) {
    const st = await lstat(parent);
    if (!st.isDirectory() || st.isSymbolicLink()) throw Error('Unexpected asset directory: '+parent);
  }
  const file = path.join(dir, path.basename(name));
  let st;
  try { st = await lstat(file); } catch (e) { if (e.code === 'ENOENT') return {file}; throw e; }
  if (!st.isFile() || st.isSymbolicLink()) throw Error('Unexpected asset file: '+file);
  return {file, bytes: st.size, sha256: hash(await readFile(file)), nlink: st.nlink};
}

function matches(actual, expected) {
  return expected ? actual.sha256 === expected.sha256 && actual.bytes === expected.bytes : actual.sha256 === undefined;
}

export async function transferAssets(root, target, changes) {
  async function inspect({name, previous, asset}) {
    const from = await inspectedAsset(root, name), to = await inspectedAsset(target, name);
    if (!matches(from, asset)) throw Error('Source asset checksum mismatch: '+name);
    if (matches(to, asset)) return {from, to, done: true};
    if (!matches(to, previous) || to.nlink > 1) throw Error('Unexpected existing asset; preserve and review: '+name);
    return {from, to, done: false};
  }
  // Preflight all changes before writing, then recheck each target before its copy.
  for (const change of changes) await inspect(change);
  let copied = 0;
  for (const change of changes) {
    const {from, to, done} = await inspect(change);
    if (done) continue;
    await copyFile(from.file, to.file, change.previous ? 0 : constants.COPYFILE_EXCL);
    if (!matches(await inspectedAsset(target, change.name), change.asset)) throw Error('Copied asset checksum mismatch: '+change.name);
    copied++;
  }
  return copied;
}

export async function syncSnapshotAssets(root, checkout) {
  root = path.resolve(root);
  const target = path.resolve(checkout);
  for (const dir of [root, target]) {
    if (!samePath(await realpath(dir), dir) || !samePath((await git(dir,'rev-parse','--show-toplevel')).trim(), dir))
      throw Error('Expected an exact Git checkout without linked directories');
  }
  for (const [a, b] of [[root,target],[target,root]]) {
    const relative = path.relative(a, b);
    if (!relative || (!relative.startsWith('..'+path.sep) && !path.isAbsolute(relative))) throw Error('Use separate release and Sites checkouts');
  }
  const config = await json(path.join(root,'release.config.json'));
  const release = new Release(root, config);
  for (const dir of [root,target]) {
    const work = await lstat(path.join(dir,'.release-state'));
    if (!work.isDirectory() || work.isSymbolicLink()) throw Error('Unexpected release state directory');
  }
  const lockPath = path.join(root,'.release-state','lock');
  const lock = await open(lockPath, 'wx');
  try {
    const state = await release.load();
    await release.assertSource(state);
    const journal = await json(path.join(root,'.release-state','sites-sync.json'));
    const build = await json(path.join(target,'.release-state','build-input.json'));
    if (state.stage !== 'sites_source_ready' || !samePath(target,journal.target) ||
        (await git(target,'rev-parse','HEAD')).trim() !== journal.head ||
        [journal,build].some(x=>x.source_sha !== state.source_sha || x.source_digest !== state.source_digest) ||
        JSON.stringify(build.files) !== JSON.stringify(state.files) || !state.files.includes('snapshot/assets.json') ||
        (await json(await boundedFile(target,'.openai/hosting.json'))).project_id !== config.site.project_id ||
        await sourceDigest(target,state.files) !== state.source_digest) throw Error('Sites checkout does not match the completed source synchronization');
    const previous = JSON.parse(await git(target,'show','HEAD:snapshot/assets.json'));
    const manifest = await json(await boundedFile(root,'snapshot/assets.json'));
    if (manifest.origin !== config.site.url) throw Error('Unexpected public snapshot origin');
    const changes = manifestDiff(previous, manifest);
    if ((await git(target,'diff','--cached','--name-only','-z')).length) throw Error('Staged Sites changes block asset synchronization');
    const permitted = new Set([...state.files, ...changes.map(c=>'snapshot/'+c.name)]);
    const dirty = (await git(target,'diff','HEAD','--name-only','--no-renames','-z')) +
                  (await git(target,'ls-files','--others','--exclude-standard','-z'));
    for (const file of dirty.split('\0').filter(Boolean)) if (!permitted.has(file)) throw Error('Unrelated Sites change: '+file);
    // New bytes must be eligible for the Sites source helper's ordinary git add.
    const tracked = new Set((await git(target,'ls-files','--cached','-z','--','snapshot')).split('\0'));
    const newPaths = changes.map(c=>'snapshot/'+c.name).filter(file=>!tracked.has(file));
    if (newPaths.length) {
      try {
        const ignored = await git(target,'check-ignore','--',...newPaths);
        if (ignored) throw Error('Sites ignores new asset: '+ignored.trim());
      } catch (e) { if (e.code !== 1) throw e; }
    }
    const copied = await transferAssets(root, target, changes);
    return {project_id:config.site.project_id, source_sha:state.source_sha, copied, assets:changes.map(c=>c.name)};
  } finally {
    await lock.close();
    await unlink(lockPath);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [option, target, ...rest] = process.argv.slice(2);
  if (option !== '--checkout' || !target || rest.length) throw Error('Usage: node scripts/sync-snapshot-assets.mjs --checkout PATH');
  syncSnapshotAssets(process.cwd(),target).then(result=>console.log(JSON.stringify(result,null,2))).catch(error=>{
    console.error(error.message);
    process.exitCode = 1;
  });
}
