// Derive exact statement-header locations; never infer organizational renames.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gunzipSync,gzipSync} from 'node:zlib';
import {statementDepartment,normalizeDepartment} from '../worker/departments.js';
const raw=await readFile('snapshot/catalog.json'),catalog=JSON.parse(raw),docs=new Map(catalog.documents.map((d,i)=>[d.id,i])),groups=new Map();
for(const shard of catalog.shards){
 const pages=JSON.parse(gunzipSync(await readFile('snapshot/corpus/pages-'+shard.id+'.json.gz'))).pages;
 const texts=JSON.parse(gunzipSync(await readFile('snapshot/corpus/text-'+shard.id+'.json.gz')));
 if(pages.length!==texts.length)throw Error('Department source page/text mismatch');
 for(let i=0;i<pages.length;i++){
  const name=statementDepartment(texts[i]);if(!name)continue;
  const key=normalizeDepartment(name);if(!groups.has(key))groups.set(key,{name,key,locations:[]});
  groups.get(key).locations.push([shard.offset+i,docs.get(pages[i][0]),pages[i][1]]);
 }
}
const data={schema_version:1,corpus_catalog_sha256:createHash('sha256').update(raw).digest('hex'),basis:'explicit_department_header_only',departments:[...groups.values()].sort((a,b)=>a.key.localeCompare(b.key))};
const bytes=gzipSync(Buffer.from(JSON.stringify(data))),file={path:'corpus/departments.json.gz',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
await writeFile('snapshot/'+file.path,bytes);
const assets=JSON.parse(await readFile('snapshot/assets.json','utf8'));assets.files=[...assets.files.filter(f=>f.path!==file.path),file];
await writeFile('snapshot/assets.json',JSON.stringify(assets,null,2)+'\n');
console.log(JSON.stringify({departments:data.departments.length,header_locations:data.departments.reduce((n,d)=>n+d.locations.length,0),...file}));
