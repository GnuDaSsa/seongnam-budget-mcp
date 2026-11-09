// Coalesce only while identical work is running on the same asset binding.
export class Inflight {
 constructor(maxEntries=64){this.maxEntries=maxEntries;this.bindings=new WeakMap();}
 async run(binding,kind,key,load){
  if(!binding||typeof binding!=='object')return load();
  let pendingMap=this.bindings.get(binding);if(!pendingMap){pendingMap=new Map();this.bindings.set(binding,pendingMap);}
  const scoped=kind+':'+key,existing=pendingMap.get(scoped);
  if(existing)return JSON.parse(JSON.stringify(await existing));
  if(pendingMap.size>=this.maxEntries)return load();
  const pending=load();pendingMap.set(scoped,pending);
  try{return await pending;}finally{if(pendingMap.get(scoped)===pending)pendingMap.delete(scoped);}
 }
}
