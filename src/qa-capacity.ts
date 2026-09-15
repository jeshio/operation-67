import { NetworkGame } from './network';
import { emptyInput } from './simulation';
import { autopilot } from './autopilot';
import { observe, type Histogram } from './qa-capacity-metrics';
import type { CapacityWorkload } from './qa-capacity-workload';

/** Transport-only page shared by the two benchmark builds. No gameplay UI or records. */
export function mountCapacityQA(){
  const params=new URLSearchParams(location.search),baseline=params.get('version')==='baseline';
  let game:NetworkGame|undefined,workload:CapacityWorkload|undefined;
  let acknowledgements:Histogram={},gaps:Histogram={},scheduler:Histogram={},stepTimes:Histogram={};
  let lastSnapshot=0,previous=performance.now(),accumulator=0,totalInputs=0;
  const pending=new Map<number,number>();
  let traffic:Record<string,{packets:number;bytes:number}>={};
  let sentBytes=0,receivedBytes=0,periodStart=performance.now(),snapshots=0;
  let routePolicy:Record<string,'relay'|'direct'|'auto'>={};
  const tickHistory:{at:number;tick:number;epoch:string}[]=[];
  let error='';
  let restoreProof:unknown;
  function install(){
    if(game)return;
    game=new NetworkGame(localStorage,'capacity-session',undefined,{endpoint:params.get('endpoint')??undefined});
    const g=game as any;
    game.onRound=()=>game?.releaseInput();game.onConnectionLoss=()=>game?.releaseInput();
    game.onAcknowledgement=ms=>observe(acknowledgements,ms);
    game.onGamePacket=(peer,route,direction,kind,bytes)=>{
      const key=`${peer}:${route}:${direction}:${kind}`,counter=traffic[key]??={packets:0,bytes:0};counter.packets++;counter.bytes+=bytes;
    };
    if(baseline){
      const measured=new WeakSet<WebSocket>(),encoder=new TextEncoder();
      const measureSocket=()=>{const socket=g.socket as WebSocket|undefined;if(!socket||measured.has(socket))return;measured.add(socket);
        const send=socket.send.bind(socket);socket.send=(data:any)=>{send(data);sentBytes+=typeof data==='string'?encoder.encode(data).length:data.byteLength??data.size??0;};
        socket.addEventListener('message',event=>{receivedBytes+=typeof event.data==='string'?encoder.encode(event.data).length:event.data.byteLength??event.data.size??0;});
      };
      const connect=g.connect.bind(g);g.connect=()=>{connect();measureSocket();};measureSocket();
    }else{
      const workerMessage=g.workerMessage.bind(g);
      g.workerMessage=(message:any)=>{
        if(message.type==='capacity-restore-proof'){restoreProof=message.proof;return;}
        if(message.capacitySteps)for(const ms of message.capacitySteps)observe(stepTimes,ms*100);
        // Install the fixture in a replacement Worker without resetting its restored world.
        if(message.type==='ready'&&workload)g.host?.postMessage({type:'qa',action:'capacity-workload',workload,reset:false});
        workerMessage(message);
      };
    }
    game.onSnapshot=()=>{
      const now=performance.now();if(lastSnapshot)observe(gaps,now-lastSnapshot);lastSnapshot=now;snapshots++;
      if(baseline)for(const [seq,at] of pending)if(seq<=g.ack){observe(acknowledgements,now-at);pending.delete(seq);}
    };
  }
  const timer=setInterval(()=>{
    const now=performance.now(),dt=now-previous;previous=now;observe(scheduler,Math.max(0,dt-8));
    accumulator+=Math.min(.1,dt/1000);
    try{
      while(accumulator>=1/60){
        if(game){
          game.render(1/60);
          const before=(game as any).sequence;
          game.step(game.state?.phase==='playing'?autopilot(game.view):emptyInput());
          if((game as any).sequence>before){totalInputs++;if(baseline)pending.set((game as any).sequence,now);}
          while(pending.size>180)pending.delete(pending.keys().next().value!);
          // Rendering/audio normally drain these. A headless generator must drain them too.
          game.events.length=0;game.presence.length=0;
        }
        accumulator-=1/60;
      }
      if(game&&!baseline){const mesh=(game as any).mesh;for(const [id,route] of Object.entries(routePolicy))mesh?.qaPreference(Number(id),route);}
    }catch(e){error=String(e);}
  },8);
  const api={
    async join(code?:string){install();await game!.enter({type:'join',mode:code?'code':'private',code,name:`Load ${params.get('guest')??'1'}`,skin:Number(params.get('guest')??0)%6});},
    start:()=>game?.start(),
    configure(next:{workload?:CapacityWorkload;routes?:typeof routePolicy;reset?:boolean}){
      if(next.routes)routePolicy=next.routes;
      if(next.workload){workload=next.workload;if(!baseline)(game as any)?.host?.postMessage({type:'qa',action:'capacity-workload',workload,reset:next.reset??false});}
    },
    status(){
      const g=game as any,r=game?.room,d=baseline?null:game?.diagnostics();
      return{id:game?.id,code:r?.code,room:r,connected:game?.connected??false,recovering:game?.recovering??false,error:error||game?.error,
        phase:game?.state?.phase,wave:game?.state?.wave,score:game?.state?.score,
        snapshotAgeMs:lastSnapshot?performance.now()-lastSnapshot:null,
        players:game?.state?.players.map(p=>({id:p.id,present:p.present,connected:p.connected,hp:p.tank.hp,kills:p.kills,fired:p.fired})),
        tick:baseline?Math.round((game?.state?.elapsed??0)*60):d?.tick,
        sequence:g?.sequence??0,ack:g?.ack??-1,host:baseline?0:r?.host,epoch:baseline?`${r?.round}`:`${r?.round}:${r?.hostEpoch}`,
        links:d?.links??[],stepP95:d?.stepP95??null,serverRtt:d?.serverRtt??null,
        checkpointTick:d?.checkpointTick??null,checkpointAgeMs:d?.checkpointAgeMs??null,
        preparedCheckpointTick:!baseline&&game?.id===r?.host?g?.assignment?.checkpoint?.tick??null:null,
        restoreProof,
        transitions:d?.transitions??[],pauseMs:d?.pauseMs??[],
        bufferedBytes:baseline?g?.socket?.bufferedAmount??0:g?.channel?.connection?.transport?.ws?.bufferedAmount??0,
        sentBytes:baseline?sentBytes:d?.sentBytes??0,receivedBytes:baseline?receivedBytes:d?.receivedBytes??0};
    },
    sample(){
      const s=api.status(),now=performance.now();tickHistory.push({at:now,tick:s.tick??0,epoch:s.epoch});
      while(tickHistory.length>15)tickHistory.shift();
      const since=[...tickHistory].reverse().find(p=>now-p.at>=9900&&p.epoch===s.epoch);
      const result={...s,at:now,periodMs:now-periodStart,acknowledgements,gaps,scheduler,stepTimes,traffic,snapshots,totalInputs,
        tickRate10s:since?1000*((s.tick??0)-since.tick)/(now-since.at):null};
      acknowledgements={};gaps={};scheduler={};stepTimes={};traffic={};snapshots=0;periodStart=now;
      return result;
    },
    async ice(){const links=(game as any)?.mesh?.links;return links?Promise.all([...links].map(async([peer,l]:any)=>({peer,state:l.pc.connectionState,stats:[...(await l.pc.getStats()).values()].filter((s:any)=>s.type==='candidate-pair').map((s:any)=>({state:s.state,nominated:s.nominated,bytesSent:s.bytesSent,bytesReceived:s.bytesReceived,currentRoundTripTime:s.currentRoundTripTime}))}))):[];},
    sleep:()=>game?.sleep(),wake:()=>{game?.wake();game?.continue();},
    disconnect:()=>{const g=game as any;if(baseline)g?.socket?.close();else g?.channel?.connection?.close();},resume:()=>game?.continue(),
    cutDirect(){const links=(game as any)?.mesh?.links;if(links)for(const l of links.values())l.pc.close();},
    leave:()=>game?.leave(),crash:()=>game?.stop(),
    dispose(){clearInterval(timer);game?.leave();},
  };
  Object.assign(window,{__capacityQA:api});
}
