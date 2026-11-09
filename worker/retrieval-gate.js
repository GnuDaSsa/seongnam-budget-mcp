// Bounds active expensive retrieval operations per Worker isolate. It is an
// admission limit, not a byte-level memory limit or a cross-isolate guarantee.
export class RetrievalGate {
 constructor({maxActive=1,maxQueued=24,waitTimeoutMs=15000,setTimer=setTimeout,clearTimer=clearTimeout}={}){
  if(!Number.isSafeInteger(maxActive)||maxActive<1||!Number.isSafeInteger(maxQueued)||maxQueued<0||!Number.isSafeInteger(waitTimeoutMs)||waitTimeoutMs<1||waitTimeoutMs>2147483647||typeof setTimer!=='function'||typeof clearTimer!=='function')throw Error('Invalid retrieval limits');
  this.maxActive=maxActive;this.maxQueued=maxQueued;this.waitTimeoutMs=waitTimeoutMs;this.setTimer=setTimer;this.clearTimer=clearTimer;this.active=0;this.queue=[];
 }
 async run(work){
  if(this.active>=this.maxActive){
   if(this.queue.length>=this.maxQueued)throw Error('동시 검색 요청이 많습니다. 잠시 후 다시 조회해 주세요.');
   await new Promise((resolve,reject)=>{
    const entry={resume:resolve,timer:null};this.queue.push(entry);
    entry.timer=this.setTimer(()=>{const i=this.queue.indexOf(entry);if(i>=0){this.queue.splice(i,1);reject(Error('검색 대기 시간이 초과되었습니다. 잠시 후 다시 조회해 주세요.'));}},this.waitTimeoutMs);
   });
  }else this.active++;
  try{return await work();}finally{
   const next=this.queue.shift();if(next){this.clearTimer(next.timer);next.resume();}else this.active--;
  }
 }
 stats(){return {active:this.active,queued:this.queue.length};}
}
