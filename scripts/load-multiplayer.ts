import { cli, type Options } from '@colyseus/loadtest';
import { Worker } from 'node:worker_threads';
import { writeFile,mkdir } from 'node:fs/promises';
import { NetworkGame, type HostPort } from '../src/network';
import { emptyInput } from '../src/simulation';
const clients:NetworkGame[]=[],codes:string[]=[],joins:number[]=[],errors:string[]=[];
const seconds=Math.max(10,Number(process.env.LOAD_SECONDS)||60),output=process.env.LOAD_REPORT??'test-artifacts/multiplayer/load.json';
let coordinatorBefore:any;let watchdog:ReturnType<typeof setTimeout>|undefined;
let previous=performance.now(),accumulator=0,started=0,cpu=process.cpuUsage(),finishing=false;
const workerPort=async()=>{
 const worker=new Worker(new URL('./load-host.mjs',import.meta.url),{execArgv:['--import','tsx']});
 const port:HostPort={onmessage:null,postMessage:m=>worker.postMessage(m),terminate:()=>{void worker.terminate();}};
 worker.on('message',data=>port.onmessage?.({data}));worker.on('error',error=>errors.push(error.message));return port;
};
const timer=setInterval(()=>{
 const now=performance.now();accumulator+=Math.min(.1,(now-previous)/1000);previous=now;
 while(accumulator>=1/60){
  for(const g of clients){const own=g.state?.players.find(p=>p.id===g.id)?.tank,enemy=g.state?.enemies[0];
   g.step({...emptyInput(),aim:enemy?{x:enemy.x,z:enemy.z}:own?{x:own.x,z:own.z-1}:{x:0,z:-10},fire:true});
   if(g.state?.phase==='over'&&g.room?.owner===g.id)g.start();
  }accumulator-=1/60;
 }
},8);
async function main(options:Options){
 if(finishing)return;
 if(!started){
  const endpoint=options.endpoint.replace(/^ws/,'http');
  watchdog=setTimeout(()=>{errors.push('Load generator deadline exceeded');void finish(endpoint);},(seconds+120)*1000);
  const deadline=performance.now()+35000;
  do{coordinatorBefore=await fetch(endpoint+'/api/qa').then(r=>r.json()).catch(()=>null);if(!coordinatorBefore?.rooms?.length)break;if(performance.now()>deadline)throw Error('Load test requires an empty coordinator');await new Promise(r=>setTimeout(r,500));}while(true);
  started=performance.now();cpu=process.cpuUsage();
 }
 const endpoint=options.endpoint.replace(/^ws/,'http');const index=options.clientId,group=Math.floor(index/4),at=performance.now();
 const g=new NetworkGame(null,'load',undefined,{endpoint,webrtc:false,hostFactory:workerPort});clients.push(g);
 g.onLeave=reason=>{if(!finishing)errors.push(reason??'Unexpected disconnect');};
 await g.enter({type:'join',mode:index%4===0?'private':'code',code:codes[group],name:`Load ${index}`,skin:index%6});
 const until=performance.now()+20000;while(!g.state){if(g.error||performance.now()>until)throw Error(g.error||'Host startup timeout');await new Promise(r=>setTimeout(r,20));}
 joins.push(performance.now()-at);codes[group]=g.room!.code;if(index%4===3)clients[index-3].start();

}
async function finish(endpoint:string){
 if(finishing)return;finishing=true;clearTimeout(watchdog);clearInterval(timer);const elapsed=(performance.now()-started)/1000,usage=process.cpuUsage(cpu),diagnostics=clients.map(g=>g.diagnostics());
 const coordinator=await fetch(endpoint+'/api/qa').then(r=>r.ok?r.json():null).catch(()=>null);
 if(coordinator?.process&&coordinatorBefore?.process){const a=coordinatorBefore.process,b=coordinator.process;coordinator.cpuPercent=((b.cpu.user-a.cpu.user)+(b.cpu.system-a.cpu.system))/elapsed/10000;coordinator.bytesPerSecond={in:((coordinator.metrics.wireBytesIn??coordinator.metrics.bytesIn)-(coordinatorBefore.metrics.wireBytesIn??coordinatorBefore.metrics.bytesIn))/elapsed,out:((coordinator.metrics.wireBytesOut??coordinator.metrics.bytesOut)-(coordinatorBefore.metrics.wireBytesOut??coordinatorBefore.metrics.bytesOut))/elapsed};}
 const report={rooms:codes.length,players:clients.length,durationSeconds:elapsed,joinMs:joins,errors,coordinator,generator:{cpuPercent:(usage.user+usage.system)/elapsed/10000,memory:process.memoryUsage()},clients:diagnostics};
 clients.forEach(g=>g.leave());await mkdir(new URL('../test-artifacts/multiplayer/',import.meta.url),{recursive:true});await writeFile(output,JSON.stringify(report,null,2));
 setTimeout(()=>process.exit(errors.length||diagnostics.some(d=>!d.connected||d.recovering)?1:0),250);
}
process.on('SIGINT',()=>{finishing=true;clearInterval(timer);clients.forEach(g=>g.stop());process.exit();});
cli(async options=>{try{await main(options);}catch(error){errors.push(String(error));throw error;}finally{if(options.clientId===options.numClients-1&&!finishing)setTimeout(()=>void finish(options.endpoint.replace(/^ws/,'http')),seconds*1000);}});
