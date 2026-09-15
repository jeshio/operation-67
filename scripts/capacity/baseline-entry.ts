// Build-time aliases resolve these imports to the untouched baseline revision.
import { createGameServer } from 'capacity-baseline-server';
import { Room } from 'capacity-baseline-rooms';
import { createServer } from 'node:http';
import { WebSocket } from 'ws';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { maintainCapacityWorkload,resetCapacityWorkload,type CapacityWorkload } from '../../src/qa-capacity-workload';

if(process.env.GAME_QA!=='1')throw Error('Capacity baseline is a QA-only build');
const sockets=new Set<WebSocket>(),wire={wireBytesIn:0,wireBytesOut:0},lag=monitorEventLoopDelay({resolution:10});lag.enable();
const size=(data:any)=>typeof data==='string'?Buffer.byteLength(data):data?.byteLength??0;
const send=WebSocket.prototype.send,emit=WebSocket.prototype.emit;
(WebSocket.prototype as any).send=function(...args:any[]){wire.wireBytesOut+=size(args[0]);sockets.add(this);return(send as any).apply(this,args);};
(WebSocket.prototype as any).emit=function(type:string,...args:any[]){if(type==='message')wire.wireBytesIn+=size(args[0]);if(type==='close')sockets.delete(this);return emit.apply(this,[type,...args]);};
const profiles=new Map<string,CapacityWorkload>(),steps=new Map<string,{count:number;durations:number[];histogram:Record<string,number>}>();
const originalStep=Room.prototype.step;
Room.prototype.step=function(...args:any[]){
  const profile=profiles.get(this.code);if(profile&&this.sim.phase==='playing'&&maintainCapacityWorkload(this.sim,profile))this.round++;
  const stats=steps.get(this.code)??{count:0,durations:[],histogram:{}};steps.set(this.code,stats);
  const t=performance.now();originalStep.apply(this,args);
  if(this.peers.size&&this.sim.phase==='playing'){const ms=performance.now()-t;stats.count++;stats.durations.push(ms);const key=Math.ceil(ms*100);stats.histogram[key]=(stats.histogram[key]??0)+1;if(stats.durations.length>600)stats.durations.shift();}
};
const app=createGameServer({root:process.cwd()+'/dist',maxRooms:128,origins:process.env.ALLOWED_ORIGINS?.split(',')??[]});
const metrics=createServer(async(req,res)=>{
  res.setHeader('Content-Type','application/json');
  if(req.method==='POST'&&req.url==='/workload'){
    const chunks:Buffer[]=[];let size=0;
    for await(const part of req){size+=part.length;if(size>4096){res.writeHead(413);res.end('{}');return;}chunks.push(part);}
    try{
      const command=JSON.parse(Buffer.concat(chunks).toString());
      if(!['normal','heavy'].includes(command.profile)||!Number.isSafeInteger(command.seed))throw Error('Invalid workload');
      let index=0;for(const room of app.rooms.rooms.values()){
        const workload={profile:command.profile,seed:command.seed+index++};profiles.set(room.code,workload);
        if(command.reset){resetCapacityWorkload(room.sim,workload);room.round++;}
      }
      res.end(JSON.stringify({ok:true,rooms:profiles.size}));
    }catch{res.writeHead(400);res.end('{}');}return;
  }
  res.end(JSON.stringify({process:{uptime:process.uptime(),cpu:process.cpuUsage(),memory:process.memoryUsage()},metrics:wire,
    runtime:{eventLoopP95Ms:lag.percentile(95)/1e6,eventLoopP99Ms:lag.percentile(99)/1e6,connections:sockets.size,bufferedBytes:[...sockets].reduce((n,s)=>n+s.bufferedAmount,0)},
    rooms:[...app.rooms.rooms.values()].map((room:any)=>{const s=steps.get(room.code),d=s?.durations.toSorted((a,b)=>a-b)??[],stepTimes=s?.histogram??{};if(s)s.histogram={};return{code:room.code,players:room.peers.size,wave:room.sim.wave,tick:s?.count??0,stage:room.sim.phase,stepP95Ms:d[Math.floor(d.length*.95)]??0,stepTimes};})}));lag.reset();
});
app.http.listen(5209,'127.0.0.1');metrics.listen(5210,'127.0.0.1');
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{lag.disable();void app.close().then(()=>metrics.close(()=>process.exit()));});
