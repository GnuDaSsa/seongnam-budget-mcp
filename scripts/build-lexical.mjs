import {readFile,writeFile} from 'node:fs/promises';
import {gzipSync,gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';

// Ranking needs lengths, document indices, unit flags and exact dedup IDs only.
// Preserve full page metadata in existing shards and load it for selected hits.
export async function buildLexical(){
 const raw=await readFile('snapshot/catalog.json'),catalog=JSON.parse(raw),n=catalog.summary.snapshot_units;
 const bytes=Buffer.alloc(40+n*16);bytes.write('SBL1');bytes.writeUInt32LE(n,4);
 createHash('sha256').update(raw).digest().copy(bytes,8);
 const docs=new Map(catalog.documents.map((d,i)=>[d.id,i])),hashes=new Map();let count=0;
 for(const sh of catalog.shards){const rows=JSON.parse(gunzipSync(await readFile('snapshot/corpus/pages-'+sh.id+'.json.gz'))).pages;
  for(let i=0;i<rows.length;i++){const p=rows[i],at=40+(sh.offset+i)*16;if(!hashes.has(p[4]))hashes.set(p[4],hashes.size);
   bytes.writeUInt32LE(docs.get(p[0]),at);bytes.writeUInt32LE(p[5],at+4);bytes.writeUInt32LE(['원','천원','백만원','억원'].includes(p[2])?1:0,at+8);bytes.writeUInt32LE(hashes.get(p[4]),at+12);count++;
  }
 }
 if(count!==n)throw Error('Lexical metadata coverage mismatch');
 await writeFile('snapshot/corpus/rank.bin.gz',gzipSync(bytes,{level:6}));
 return{locations:n,bytes:bytes.length};
}
