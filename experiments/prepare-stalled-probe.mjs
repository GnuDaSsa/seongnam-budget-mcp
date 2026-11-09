import {writeFile} from 'node:fs/promises';import path from 'node:path';import {build} from 'esbuild';
// Test-only wrapper injects one delayed local asset read; never deploy it.
const source=`import worker from './index.js';\nlet once=true;\nexport default {async fetch(req,env,ctx){const slow=req.headers.get('x-probe-delay')==='1';const wrapped={...env,ASSETS:{async fetch(input){if(slow&&once){once=false;await new Promise(r=>setTimeout(r,35000));}return env.ASSETS.fetch(input);}}};return worker.fetch(req,wrapped,ctx);}};\n`;
for(const [label,root] of [['baseline','work/stalled-baseline-src'],['gated','.']]){
 const server=path.resolve(root,'dist/server'),client=path.resolve(root,'dist/client');await writeFile(path.join(server,'stalled-probe-wrapper.js'),source);
 await build({entryPoints:[path.join(server,'stalled-probe-wrapper.js')],outfile:path.join(server,'stalled-probe-bundle.js'),bundle:true,format:'esm',platform:'browser',target:'es2022'});
 await writeFile(`work/stalled-probe-${label}.json`,JSON.stringify({main:path.join(server,'stalled-probe-bundle.js'),compatibility_date:'2026-11-07',assets:{directory:client,binding:'ASSETS'}},null,2));
}
