import {spawn,execFileSync} from 'node:child_process';
import path from 'node:path';
const wrangler=process.env.WRANGLER_BIN||path.resolve('work/worker-tools/node_modules/.bin/wrangler');
const configs=[['baseline',process.env.BASE_CONFIG||path.resolve('work/baseline-src/dist/server/wrangler.json')],['gated',process.env.GATED_CONFIG||path.resolve('dist/server/wrangler.json')]];
const port=Number(process.env.WORKER_PORT||8787),url=`http://127.0.0.1:${port}`,sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function run(label,config,trial){
 const child=spawn(wrangler,['dev','--config',config,'--local','--ip','127.0.0.1','--port',String(port),'--no-bundle','--show-interactive-dev-session=false'],{env:{...process.env,WRANGLER_WRITE_LOGS:'false',CLOUDFLARE_SEND_METRICS:'false'},stdio:['ignore','pipe','pipe']});let logs='';child.stdout.on('data',x=>logs+=x);child.stderr.on('data',x=>logs+=x);
 try{
  let ready=false;for(let n=0;n<150;n++){if(child.exitCode!==null)break;try{const r=await fetch(url+'/api/status',{signal:AbortSignal.timeout(1000)});if(r.ok){ready=true;break;}}catch{}await sleep(200);}
  if(!ready)throw Error('Worker failed to start: '+logs.slice(-1200));
  const listing=execFileSync('ps',['-Ao','pid,command'],{encoding:'utf8'}).split('\n');
  const pids=listing.filter(l=>l.includes('work/worker-tools/node_modules/@cloudflare/workerd-')&&l.includes('workerd serve')&&!l.includes('ps -Ao')).map(l=>l.trim().split(/\s+/,1)[0]);
  if(pids.length!==2)throw Error(`Expected 2 local workerd processes, found ${pids.length}`);
  const runner=spawn(process.execPath,[process.env.PROBE_SCRIPT||'experiments/workerd-concurrency.mjs'],{env:{...process.env,WORKER_URL:url,WORKER_PIDS:pids.join(',')},stdio:['ignore','pipe','pipe']});let out='',err='';runner.stdout.on('data',x=>out+=x);runner.stderr.on('data',x=>err+=x);
  const code=await new Promise((resolve,reject)=>{runner.once('error',reject);runner.once('close',resolve)});if(code!==0)throw Error('Probe failed: '+err);
  for(const line of out.trim().split('\n')){const data=JSON.parse(line);console.log(JSON.stringify({label,trial,...data}));}
 }finally{if(child.exitCode===null){const closed=new Promise(r=>child.once('close',r));child.kill('SIGINT');await Promise.race([closed,sleep(5000)]);if(child.exitCode===null)child.kill('SIGKILL');await sleep(300);}}
}
for(let trial=1;trial<=Number(process.env.TRIALS||3);trial++)for(const [label,config] of configs)if(!process.env.RUN_LABEL||process.env.RUN_LABEL===label)await run(label,config,trial);
