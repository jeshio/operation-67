import { BattleCoordinator } from '../../server/coordinator';
import { NetworkGame, type HostPort } from '../../src/network';
import { HostRunner } from '../../src/net/host-worker';
import { pack, unpack } from '../../src/net/codec';
import { emptyInput, type Input } from '../../src/simulation';
import type { BattleCheckpoint } from '../../src/protocol';

/** Real coordinator, binary packets, host engine and client prediction on a controllable network clock. */
export async function multiplayer({lag=0,fps=60,count=2}={}) {
  let now=10000,serial=0,tick=0,accumulator=0;
  const jobs:{at:number;serial:number;run:()=>void}[]=[],clients:NetworkGame[]=[],links:Link[]=[],runners:HostRunner[]=[];
  const queue=(run:()=>void,delay=0)=>jobs.push({at:now+delay,serial:serial++,run});
  const coordinator=new BattleCoordinator('test-match','TEST67',false,{
    send:(id,type,data)=>links.find(l=>l.id===id)?.receive(type,['backup','candidate-check'].includes(type)?pack(data):data),
    broadcast:(type,data)=>links.forEach(l=>l.receive(type,data)),
    changed:info=>links.forEach(l=>l.receive('info',info)),closed:()=>{},
  },()=>now);
  class Link {
    id=0;up=true;down=true;open=true;delayUp=lag;delayDown=lag;reconnection={enabled:false,maxEnqueuedMessages:0};
    handlers=new Map<string,(data:any)=>void>();sent:{type:string;data:any}[]=[];
    connection={transport:{ws:{bufferedAmount:0}},close:()=>this.close()};
    leaveHandler=()=>{};dropHandler=()=>{};
    onMessage(type:string,fn:(data:any)=>void){this.handlers.set(type,fn);}
    onStateChange(_fn:unknown){}onError(_fn:unknown){}onLeave(fn:()=>void){this.leaveHandler=fn;}onDrop(fn:()=>void){this.dropHandler=fn;}
    receive(type:string,data:any){if(!this.open||!this.down)return;const clone=structuredClone(data);queue(()=>{if(this.open&&this.down)this.handlers.get(type)?.(clone);},this.delayDown);}
    send(type:string,data:any){this.sent.push({type,data:structuredClone(data)});if(!this.up||!this.open)return;queue(()=>{
      if(!this.open||!this.up)return;
      if(type==='hello'){this.receive('joined',{id:this.id,info:coordinator.info});return;}
      if(type==='ready')coordinator.ready(this.id,data.nonce);
      if(type==='lease-request')coordinator.renew(this.id,data);
      if(type==='checkpoint'||type==='host-stopped')coordinator.checkpoint(this.id,unpack<BattleCheckpoint>(data),type==='host-stopped');
      if(type==='health')coordinator.health(this.id,data);
      if(type==='start')coordinator.start(this.id);
      if(type==='ping')this.receive('pong',data);
      if(type==='relay')for(const target of data.targets)links.find(l=>l.id===target)?.receive('relay',{sender:this.id,bytes:data.bytes});
      if(type==='leave')coordinator.disconnect(this.id,true);
    },this.delayUp);}
    close(){if(!this.open)return;this.open=false;coordinator.disconnect(this.id);this.leaveHandler();}
    async leave(){this.close();}
  }
  const pump=()=>{for(;;){jobs.sort((a,b)=>a.at-b.at||a.serial-b.serial);if(!jobs.length||jobs[0].at>now)break;jobs.shift()!.run();}};
  const run=(seconds:number,input:(game:NetworkGame,index:number)=>Input=()=>emptyInput())=>{
    for(let n=0;n<Math.round(seconds*240);n++){
      now+=1000/240;tick++;pump();
      if(tick%12===0){coordinator.tick();for(const g of clients)(g as any).maintenance();pump();}
      for(const r of runners)if((r as any).lease>0)(r as any).advance();pump();
      if(tick%(240/fps)===0){accumulator+=1/fps;while(accumulator>=1/60-1e-9){clients.forEach((g,i)=>g.step(input(g,i)));accumulator-=1/60;}clients.forEach(g=>g.render(1/fps,Math.max(0,accumulator*60)));pump();}
    }
  };
  for(let i=0;i<count;i++){
    const link=new Link();links.push(link);
    let port:HostPort;
    const runner=new HostRunner(data=>queue(()=>port.onmessage?.({data})),()=>now);runners.push(runner);
    port={onmessage:null,postMessage:command=>{runner.receive(command);clearInterval((runner as any).timer);},terminate:()=>runner.stop()};
    const game=new NetworkGame(null,'test',()=>now,{endpoint:'http://127.0.0.1:1',webrtc:false,hostFactory:async()=>port});
    clearInterval((game as any).timer);(game as any).host=port;port.onmessage=e=>(game as any).workerMessage(e.data);
    (game as any).bind(link);game.connected=true;clients.push(game);
    link.id=coordinator.join(`identity-${i}`,`Игрок ${i+1}`,i,true,`session-${i}`);
    link.receive('joined',{id:link.id,info:coordinator.info});run(.5);await Promise.resolve();run(.1);
  }
  await Promise.resolve();run(.3);
  const host=()=>runners[clients.findIndex(g=>g.id===coordinator.info.host)].engine;
  const clearArena=()=>{const s=host().sim;s.obstacles=[];s.enemies=[];s.portals=[];s.spawnTimer=9999;s.remainingToSpawn=1;s.bullets=[];for(const [i,m] of [...s.members.values()].entries()){m.tank.x=i?8:-8;m.tank.z=0;}};
  const settle=async(seconds:number)=>{for(let i=0;i<Math.ceil(seconds/.1);i++){run(.1);await Promise.resolve();}};
  const start=async()=>{clients.find(g=>g.id===coordinator.info.owner)!.start();await settle(3.8+lag/100);clearArena();run(.5+lag/1000);};
  return {coordinator,clients,links,runners,host,run,settle,start,clearArena,now:()=>now,
    snapshot:()=>{const h=host(),snapshot=h.snapshot();for(const g of clients)(g as any).applySnapshot(snapshot);},
    cleanup:()=>{for(const g of clients)g.stop();for(const r of runners)r.stop();},
  };
}
