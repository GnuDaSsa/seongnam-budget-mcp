// Public source metadata belongs with corpus assets, not in the source repository.
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';

export async function loadCouncilCatalog(root=process.cwd()){
 const manifest=JSON.parse(await readFile(path.join(root,'snapshot/council/catalog.json'),'utf8'));
 const f=manifest.data_asset;
 if(manifest.schema_version!==2||!f||!/^council\/[a-f0-9]{20}\.json\.gz$/.test(f.path)||!Number.isSafeInteger(f.bytes)||f.bytes<=0||f.bytes>8*1024*1024||!/^[a-f0-9]{64}$/.test(f.sha256))throw Error('Invalid council metadata asset manifest');
 const assets=JSON.parse(await readFile(path.join(root,'snapshot/assets.json'),'utf8'));
 const registered=assets.files.find(a=>a.path===f.path);
 if(!registered||registered.bytes!==f.bytes||registered.sha256!==f.sha256)throw Error('Council metadata asset is not registered');
 const bytes=await readFile(path.join(root,'snapshot',f.path));
 if(bytes.length!==f.bytes||createHash('sha256').update(bytes).digest('hex')!==f.sha256)throw Error('Council metadata checksum mismatch');
 const catalog=JSON.parse(gunzipSync(bytes,{maxOutputLength:8*1024*1024}));
 if(catalog.schema_version!==1||JSON.stringify(catalog.summary)!==JSON.stringify(manifest.summary)||JSON.stringify(catalog.embedding)!==JSON.stringify(manifest.embedding)||JSON.stringify(catalog.documents.map(d=>d.id))!==JSON.stringify(manifest.documents.map(d=>d.id)))throw Error('Council metadata and manifest disagree');
 return catalog;
}
