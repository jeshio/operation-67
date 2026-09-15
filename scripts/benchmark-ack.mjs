import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { WebSocket } from 'ws';
import { emptyInput } from '../src/simulation.ts';
const [source,endpoint,label]=process.argv.slice(2);
const { NetworkGame }=await import(pathToFileURL(resolve(source)).href);
Object.defineProperty(globalThis,'location',{value:new URL(endpoint),configurable:true});
Object.defineProperty(globalThis,'WebSocket',{value:WebSocket,configurable:true});
const clients=[],pending=[],samples=[];let measuring=false,accumulator=0,previous=performance.now();
const wait=async predicate=>{const end=performance.now()+20000;while(!predicate()){if(performance.now()>end)throw Error('Benchmark startup: '+clients.map(g=>g.error).join(';'));await new Promise(r=>setTimeout(r,10));}};
const timer=setInterval(()=>{const now=performance.now();accumulator+=Math.min(.1,(now-previous)/1000);previous=now;while(accumulator>=1/60){for(const [i,g] of clients.entries()){const before=g.sequence;g.step({...emptyInput(),x:.2,fire:true,aim:{x:0,z:-10}});if(measuring&&g.sequence!==before)pending[i].set(g.sequence,performance.now());}accumulator-=1/60;}if(measuring)for(const [i,g] of clients.entries())for(const [seq,at] of pending[i])if(seq<=g.ack){samples[i].push(performance.now()-at);pending[i].delete(seq);}},8);
try{
 for(let i=0;i<4;i++){const g=new NetworkGame(null,'ack',undefined,{endpoint,webrtc:false});clients.push(g);pending.push(new Map());samples.push([]);await g.enter({type:'join',mode:i?'code':'private',code:clients[0].room?.code,name:`Ack ${i}`,skin:i});await wait(()=>!!g.state);}
 clients[0].start();await wait(()=>clients.every(g=>g.state?.phase==='playing'));measuring=true;await new Promise(r=>setTimeout(r,6000));measuring=false;
 const metrics=samples.map(values=>{values.sort((a,b)=>a-b);return{samples:values.length,p50Ms:values[Math.floor(values.length*.5)],p95Ms:values[Math.floor(values.length*.95)]};});
 if(metrics.some(m=>m.samples<100))throw Error('Insufficient acknowledged commands');
 const report={label,source,endpoint,scenario:'four Node clients, relay, 60 Hz input, 6 seconds; creation-to-observed cumulative acknowledgement',metrics};await writeFile(`test-artifacts/multiplayer/ack-${label}.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(metrics));
}finally{clearInterval(timer);clients.forEach(g=>g.leave());}
