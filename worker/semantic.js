import {PrecompiledNormalizer} from '@huggingface/tokenizers';
const DIM=256, decoder=new TextDecoder(), encoder=new TextEncoder();
const normalizer=new PrecompiledNormalizer({type:'Precompiled'});
const TOKEN_ASSET_ORIGIN='https://seongnam-budget-model-assets-20261108.gnudas0923.chatgpt.site';
let loaded=null,loading=null;
async function binary(env,name){
 let r=await env.ASSETS.fetch(new Request('https://assets.local/semantic/'+name+'.bin.gz'));
 // Rare query tokens live on our public, fixed-origin model asset site.
 if(!r.ok&&/^tokens-\d+$/.test(name))r=await fetch(TOKEN_ASSET_ORIGIN+'/semantic/'+name+'.bin.gz',{signal:AbortSignal.timeout(15000)});
 if(!r.ok)throw Error('의미 검색 자산을 읽지 못했습니다: '+name);
 return new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
}
function normalizedText(s){return normalizer.normalize(s).replace(/[!"#$%&'()*+,\-./:;<=>?@\[\\\]^_`{|}~]/g,' $& ').replace(/\s+/gu,' ').trim();}
async function state(env){
 if(loaded)return loaded;if(loading)return loading;
 loading=(async()=>{
  const [vb,cb,centerBytes,pageBytes]=await Promise.all(['vocab','common','centroids','page-docs'].map(n=>binary(env,n)));
  const header=new Uint32Array(vb,0,2),n=header[0];
  const offsets=new Uint32Array(vb,8,n+1),ids=new Uint32Array(vb,12+4*n,n),scores=new Float32Array(vb,12+8*n,n),bytes=new Uint8Array(vb,12+12*n);
  const cn=new Uint32Array(cb,0,1)[0],commonIds=new Uint32Array(cb,4,cn),scales=new Float32Array(cb,4+4*cn,cn),vectors=new Int8Array(cb,4+8*cn);
  const centers=new Float32Array(centerBytes),pageDocs=new Uint16Array(pageBytes);
  return {n,offsets,ids,scores,bytes,maxBytes:header[1],commonIds,scales,vectors,centers,pageDocs};
 })();try{loaded=await loading;return loaded;}finally{loading=null;}
}
function comparePrefix(s,idx,input,from,to){let a=s.offsets[idx],end=s.offsets[idx+1];for(let j=from;j<to;j++,a++){if(a===end)return -1;let diff=s.bytes[a]-input[j];if(diff)return diff;}return 0;}
function bound(s,input,from,to,lo,hi,upper=false){while(lo<hi){let mid=(lo+hi)>>>1,c=comparePrefix(s,mid,input,from,to);if(c<0||(upper&&c===0))lo=mid+1;else hi=mid;}return lo;}
export function tokenize(s,text){
 let str=normalizedText(text);if(!str)return[];
 let input=encoder.encode('▁'+str.replace(/ /g,'▁')),ends=[0];for(let i=1;i<=input.length;i++)if(i===input.length||(input[i]&192)!==128)ends.push(i);
 const count=ends.length-1,best=new Float64Array(count+1).fill(-Infinity),prev=new Int32Array(count+1),tokens=new Int32Array(count+1);best[0]=0;
 for(let i=0;i<count;i++){
  let lo=0,hi=s.n,single=false;
  for(let j=i+1;j<=count&&ends[j]-ends[i]<=s.maxBytes;j++){
   lo=bound(s,input,ends[i],ends[j],lo,hi);hi=bound(s,input,ends[i],ends[j],lo,hi,true);if(lo===hi)break;
   if(s.offsets[lo+1]-s.offsets[lo]===ends[j]-ends[i]){let score=best[i]+s.scores[lo];if(j===i+1)single=true;if(score>best[j]){best[j]=score;prev[j]=i;tokens[j]=s.ids[lo];}}
  }
  if(!single&&best[i]-23.517933250454895>best[i+1]){best[i+1]=best[i]-23.517933250454895;prev[i+1]=i;tokens[i+1]=1;}
 }
 let result=[];for(let at=count;at>0;at=prev[at])if(tokens[at]>1)result.push(tokens[at]);return result.reverse();
}
function find(arr,id){let lo=0,hi=arr.length;while(lo<hi){let m=(lo+hi)>>>1;if(arr[m]<id)lo=m+1;else hi=m;}return arr[lo]===id?lo:-1;}
function unit(v){let norm=Math.sqrt(v.reduce((a,x)=>a+x*x,0));if(norm>0)for(let i=0;i<v.length;i++)v[i]/=norm;return v;}
function dot(a,b){let sum=0;for(let i=0;i<DIM;i++)sum+=a[i]*b[i];return sum;}
export async function createEncoder(env){
 const s=await state(env),extra=new Map();
 function common(id){const i=find(s.commonIds,id);if(i<0)return null;return{row:s.vectors.subarray(i*DIM,(i+1)*DIM),scale:s.scales[i]};}
 async function ensure(ids){let missing=[...new Set(ids.filter(id=>!common(id)&&!extra.has(id)))],groups=new Map();for(let id of missing){let key=Math.floor(id/2048);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(id);}
  for(let [key,list] of groups){let b=await binary(env,'tokens-'+key),h=new Uint32Array(b,0,2),scale=new Float32Array(b,8,h[1]),rows=new Int8Array(b,8+4*h[1]);for(let id of list){let i=id-h[0];extra.set(id,{row:rows.slice(i*DIM,(i+1)*DIM),scale:scale[i]});}}
 }
 function row(id){return common(id)||extra.get(id);}
 function embed(ids){let v=new Float32Array(DIM);for(let id of ids){let w=row(id);if(w)for(let j=0;j<DIM;j++)v[j]+=w.row[j]*w.scale;}return unit(v);}
 function tokenVector(id){const w=row(id);return w?unit(Float32Array.from(w.row)):new Float32Array(DIM);}
 function tokenWeight(id){const w=row(id);return w?Math.sqrt(w.row.reduce((sum,x)=>sum+x*x,0))*w.scale:0;}
 return{s,tokenize:text=>tokenize(s,text),ensure,embed,tokenVector,tokenWeight};
}
export async function vectorSearch(env,manifest,query,allowedDocs,limit=64,allowedGids=null){
 const enc=await createEncoder(env),ids=enc.tokenize(query);await enc.ensure(ids);const q=enc.embed(ids);
 if(!ids.length||!q.some(x=>x))return {enc,ids,q,hits:[],scanned:0};
 const clusters=manifest.clusters.map((_,i)=>({i,score:dot(q,enc.s.centers.subarray(i*DIM,(i+1)*DIM))})).sort((a,b)=>b.score-a.score).slice(0,manifest.nprobe);
 let candidates=[],scanned=0;
 for(let start=0;start<clusters.length;start+=8){const batch=await Promise.all(clusters.slice(start,start+8).map(async c=>({c,b:await binary(env,'cluster-'+c.i)})));
  for(let {b} of batch){let n=new Uint32Array(b,0,1)[0],loc=new Uint32Array(b,4,n*3),norm=new Float32Array(b,4+12*n,n),v=new Int8Array(b,4+16*n);
   for(let i=0;i<n;i++){let gid=loc[i*3];if(!allowedDocs.has(enc.s.pageDocs[gid])||allowedGids&&!allowedGids.has(gid))continue;scanned++;let sum=0,at=i*DIM;for(let k=0;k<DIM;k++)sum+=q[k]*v[at+k];let score=sum/(norm[i]||1);if(score>=0.15)candidates.push({gid,start:loc[i*3+1],end:loc[i*3+2],cosine:score});}
  }candidates.sort((a,b)=>b.cosine-a.cosine);candidates.length=Math.min(candidates.length,limit*3);
 }
 let seen=new Set(),hits=[];for(let c of candidates){if(seen.has(c.gid))continue;seen.add(c.gid);hits.push(c);if(hits.length===limit)break;}
 return {enc,ids,q,hits,scanned};
}
export async function rerank(vector,candidates){
 const {enc,ids,q}=vector,uniqueIds=[...new Set(ids)],qv=uniqueIds.map(id=>enc.tokenVector(id)),qw=uniqueIds.map(id=>enc.tokenWeight(id)),weight=qw.reduce((a,b)=>a+b,0);
 for(let c of candidates)c.tokenIds=enc.tokenize(c.text);await enc.ensure(candidates.flatMap(c=>c.tokenIds));
 for(let c of candidates){
  const docTokens=[...new Set(c.tokenIds)],max=new Float32Array(qv.length).fill(-1);
  for(let id of docTokens){let dv=enc.tokenVector(id);for(let i=0;i<qv.length;i++)max[i]=Math.max(max[i],dot(qv[i],dv));}
  c.maxsim=weight?max.reduce((a,b,i)=>a+b*qw[i],0)/weight:0;c.cosine=dot(q,enc.embed(c.tokenIds));
  c.score=0.55*c.cosine+0.35*c.maxsim+0.10*c.rrf/(2/61);delete c.tokenIds;
 }
 return candidates.sort((a,b)=>b.score-a.score);
}
