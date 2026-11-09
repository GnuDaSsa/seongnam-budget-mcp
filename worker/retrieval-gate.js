// Bounds active expensive retrieval operations per Worker isolate. It is an
// admission limit, not a byte-level memory limit or a cross-isolate guarantee.
export class RetrievalGate {
 constructor({maxActive=1,maxQueued=24}={}){
  if(!Number.isSafeInteger(maxActive)||maxActive<1||!Number.isSafeInteger(maxQueued)||maxQueued<0)throw Error('Invalid retrieval limits');
  this.maxActive=maxActive;this.maxQueued=maxQueued;this.active=0;this.queue=[];
 }
 async run(work){
  if(this.active>=this.maxActive){
   if(this.queue.length>=this.maxQueued)throw Error('동시 검색 요청이 많습니다. 잠시 후 다시 조회해 주세요.');
   await new Promise(resolve=>this.queue.push(resolve));
  }else this.active++;
  try{return await work();}finally{
   const next=this.queue.shift();if(next)next();else this.active--;
  }
 }
 stats(){return {active:this.active,queued:this.queue.length};}
}
