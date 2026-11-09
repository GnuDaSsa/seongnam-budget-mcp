// Synchronous per-isolate LRU. Cost is a conservative accounting estimate,
// not a promise about JavaScript heap use or other caches in the Worker.
export class EvidenceCache {
 constructor({maxBytes=1_000_000,maxEntries=64,ttlMs=300_000,now=Date.now}={}){
  if(!Number.isSafeInteger(maxBytes)||maxBytes<0||!Number.isSafeInteger(maxEntries)||maxEntries<1||!Number.isFinite(ttlMs)||ttlMs<=0)throw Error('Invalid cache limits');
  this.maxBytes=maxBytes;this.maxEntries=maxEntries;this.ttlMs=ttlMs;this.now=now;this.entries=new Map();this.bytes=0;
 }
 remove(key){const v=this.entries.get(key);if(v){this.bytes-=v.bytes;this.entries.delete(key);}}
 get(key){const item=this.entries.get(key);if(!item)return null;if(item.expires<=this.now()){this.remove(key);return null;}this.entries.delete(key);this.entries.set(key,item);return JSON.parse(item.body);}
 set(key,value){
  const body=JSON.stringify(value),bytes=2*(key.length+body.length)+256;
  this.remove(key);
  if(bytes>this.maxBytes)return false;
  const now=this.now();for(const [k,v] of this.entries)if(v.expires<=now)this.remove(k);
  while(this.entries.size>=this.maxEntries||this.bytes+bytes>this.maxBytes)this.remove(this.entries.keys().next().value);
  this.entries.set(key,{body,bytes,expires:now+this.ttlMs});this.bytes+=bytes;return true;
 }
 stats(){return {entries:this.entries.size,estimated_bytes:this.bytes};}
}
