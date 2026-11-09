// Bounds active expensive retrieval operations per Worker isolate. It is an
// admission limit, not a byte-level memory limit or a cross-isolate guarantee.
export class RetrievalGate {
 constructor({maxActive=1,maxQueued=24,waitTimeoutMs=15000,activeTimeoutMs=30000,setTimer=setTimeout,clearTimer=clearTimeout,setWatchdog=setTimeout,clearWatchdog=clearTimeout}={}){
  if(!Number.isSafeInteger(maxActive)||maxActive<1||!Number.isSafeInteger(maxQueued)||maxQueued<0||![waitTimeoutMs,activeTimeoutMs].every(x=>Number.isSafeInteger(x)&&x>=1&&x<=2147483647)||![setTimer,clearTimer,setWatchdog,clearWatchdog].every(x=>typeof x==='function'))throw Error('Invalid retrieval limits');
  this.maxActive=maxActive;this.maxQueued=maxQueued;this.waitTimeoutMs=waitTimeoutMs;this.activeTimeoutMs=activeTimeoutMs;this.setTimer=setTimer;this.clearTimer=clearTimer;this.setWatchdog=setWatchdog;this.clearWatchdog=clearWatchdog;this.active=0;this.queue=[];this.stalled=new Set();
 }
 isStalled(){return this.stalled.size>0;}
 assertHealthy(){if(this.isStalled())throw Error('검색 처리가 지연되어 새 요청을 받을 수 없습니다. 잠시 후 다시 조회해 주세요.');}
 async run(work){
  this.assertHealthy();
  if(this.active>=this.maxActive){
   if(this.queue.length>=this.maxQueued)throw Error('동시 검색 요청이 많습니다. 잠시 후 다시 조회해 주세요.');
   await new Promise((resolve,reject)=>{
    const entry={resume:resolve,reject,timer:null};this.queue.push(entry);
    entry.timer=this.setTimer(()=>{const i=this.queue.indexOf(entry);if(i>=0){this.queue.splice(i,1);reject(Error('검색 대기 시간이 초과되었습니다. 잠시 후 다시 조회해 주세요.'));}},this.waitTimeoutMs);
   });
  }else this.active++;
  const token={};const watchdog=this.setWatchdog(()=>{
   this.stalled.add(token);
   for(const entry of this.queue.splice(0)){this.clearTimer(entry.timer);entry.reject(Error('검색 처리가 지연되어 새 요청을 받을 수 없습니다. 잠시 후 다시 조회해 주세요.'));}
  },this.activeTimeoutMs);
  try{return await work();}finally{
   this.clearWatchdog(watchdog);this.stalled.delete(token);
   const next=this.queue.shift();if(next){this.clearTimer(next.timer);next.resume();}else this.active--;
  }
 }
 stats(){return {active:this.active,queued:this.queue.length};}
}
