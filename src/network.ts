import { Client, type Room as ClientRoom } from '@colyseus/sdk';
import { presentEnemies, presentFriendlyBullet } from './combat-view';
import { OwnShots } from './own-shots';
import { muzzles } from './weapons';
import { Simulation, emptyInput, type Input, type GameEvent } from './simulation';
import type { BattleState, Member } from './coop';
import { matches, validBatch, type GamePacket, type RoomInfo, type JoinRequest, type PresenceEvent, type InputFrame, type InputBatch, type HostAssignment, type BattleCheckpoint, type WorldSnapshot, type Commit, type GameError } from './protocol';
import { NET } from './net/config';
import { pack, unpack } from './net/codec';
import { RouteMesh } from './net/mesh';
import { validSnapshot } from './net/validation';
import { ClientPrediction } from './net/prediction';
import type { HostCommand } from './net/host-worker';
export interface HostPort {postMessage(command:HostCommand):void;terminate():void;onmessage:((event:{data:any})=>void)|null;}
export interface NetworkOptions {endpoint?:string;hostFactory?:()=>Promise<HostPort>;webrtc?:boolean;}
export function networkEndpoint(){
  const configured=import.meta.env?.VITE_SERVER_URL;if(configured)return configured.replace(/^ws/,'http').replace(/\/ws\/?$/,'');
  const url=new URL('/',location.href);if(['5177','5178','5197'].includes(url.port))url.port='5179';return url.origin;
}
let warmRtt:number|null=null;let warmDirectory:unknown[]=[];
export function primeNetwork(endpoint=networkEndpoint()){
  void fetch(`${endpoint}/api/rooms`,{cache:'no-store'}).then(r=>r.json()).then(rooms=>{if(Array.isArray(rooms))warmDirectory=rooms.slice(0,32);}).catch(()=>{});
  const t=performance.now();void fetch(`${endpoint}/api/ping`,{cache:'no-store'}).then(r=>{if(r.ok)warmRtt=performance.now()-t;}).catch(()=>{});
}
async function hostPort():Promise<HostPort>{
  if(typeof Worker!=='undefined')return new Worker(new URL('./net/host-worker.ts',import.meta.url),{type:'module'}) as HostPort;
  const {HostRunner}=await import('./net/host-worker');let port:HostPort;
  const runner=new HostRunner(data=>queueMicrotask(()=>port.onmessage?.({data})));
  port={onmessage:null,postMessage:command=>runner.receive(command),terminate:()=>runner.stop()};return port;
}
export class NetworkGame {
  readonly view=new Simulation();room?:RoomInfo;id=0;state?:BattleState;status='Подключение…';error='';connected=false;
  presence:PresenceEvent[]=[];events:GameEvent[]=[];watched?:number;
  onRound=()=>{};onLeave=(_reason?:string)=>{};onConnectionLoss=()=>{};onRestore=()=>{};onControlReset=()=>{};
  onSnapshot=(_state:BattleState,_room:RoomInfo)=>{};onCommit=(_commit:Commit)=>{};
  onAcknowledgement?: (milliseconds:number)=>void;
  onGamePacket?: (peer:number,route:'relay'|'direct',direction:'sent'|'received',kind:'input'|'snapshot',bytes:number)=>void;
  recovering=false;needsResume=false;awayMessage='';private awayPhase?:string;
  private channel?:ClientRoom<any,any>;private client:Client;private endpoint:string;private token='';private join?:JoinRequest;
  private stopped=false;private leaving=false;private joining=false;private background=false;private retry?:ReturnType<typeof setTimeout>;private timer:ReturnType<typeof setInterval>;
  private commandTimes=new Map<number,number>();private acknowledgementMs:number[]=[];private pauseMs:number[]=[];private commitReceivedAt=0;private benchmarkAt=-Infinity;
  private blockedAt=0;private pongAt=0;private lastCommit=-1;
  private webrtcSessions=new Set<string>();
  private signalInbox:{sessionId:string;data:any}[]=[];
  private mesh?:RouteMesh;private host?:HostPort;private hostPending?:Promise<HostPort>;private portGeneration=0;private hostSerial=0;private assignment?:HostAssignment;private leaseUntil=0;private authorityUntil=0;
  private leaseRequests=new Map<number,number>();private leaseSerial=0;private heartbeatAt=0;private reportAt=0;private serverRtt:number|null=warmRtt;private stepP95:number|null=null;
  private outgoing:InputFrame[]=[];private sentAt=0;private sequence=0;private ack=-1;private ackAt=0;private snapshotAt=0;private pendingAt=0;
  private prediction=new ClientPrediction();private predicted?:Member;private previousPosition?:{x:number;z:number};private offset={x:0,z:0};
  private frames:{at:number;state:BattleState}[]=[];private ownShots=new OwnShots();private bootstrap=true;private appliedBattle='';private lastEvent=0;private lastPresence=0;private lastTick=-1;
  private checkpoint?:BattleCheckpoint;private connectGeneration=0;private recoveryAt=0;private receivedBytes=0;private sentBytes=0;private transitions:{at:number;reason:string}[]=[];
  constructor(private storage:Storage|null,private key:string,private now=()=>performance.timeOrigin+performance.now(),private options:NetworkOptions={}){
    this.endpoint=options.endpoint??networkEndpoint();this.client=new Client(this.endpoint);this.view.network=true;
    try{this.token=storage?.getItem(key)??'';}catch{}
    primeNetwork(this.endpoint);this.timer=setInterval(()=>this.maintenance(),50);this.timer.unref?.();
  }
  async enter(request:JoinRequest){if(this.joining||this.room||this.leaving)return;this.join=request;if(this.stopped){this.timer=setInterval(()=>this.maintenance(),50);this.timer.unref?.();}this.stopped=false;this.joining=false;this.error='';this.needsResume=false;await this.connect();}
  private async connect(){
    if(!this.join||this.joining||this.stopped)return;const generation=++this.connectGeneration;this.joining=true;
    try{
      const request=this.room?{...this.join,mode:'code' as const,code:this.room.code}:this.join;
      const response=await fetch(`${this.endpoint}/api/join`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({version:NET.version,token:this.token,request,foreground:!this.background,rtt:this.serverRtt??warmRtt})});
      const result=await response.json();if(!response.ok)throw Object.assign(Error(result.message),{code:result.code});
      if(generation!==this.connectGeneration||this.stopped)return;
      this.token=result.token;try{this.storage?.setItem(this.key,this.token);}catch{}
      const channel=await this.client.consumeSeatReservation(result.reservation);
      if(generation!==this.connectGeneration||this.stopped){void channel.leave();return;}
      this.bind(channel);this.connected=true;this.joining=false;this.pongAt=this.now();this.blockedAt=0;this.status='Сервер на связи';this.serverRtt??=warmRtt;
      channel.send('hello');
    }catch(error){
      if(generation!==this.connectGeneration||this.stopped)return;this.joining=false;const e=error as Error&{code?:string};
      if(this.room&&['NOT_FOUND','CLOSED'].includes(e.code??'')){this.finish('Бой завершён или сервер перезапущен. Начни новый матч.');return;}
      if(this.room)this.scheduleReconnect();else this.error=e.message||'Не удалось подключиться к игре.';
    }
  }
  private bind(channel:ClientRoom<any,any>){
    this.channel=channel;
    // Count complete WebSocket messages, including schema and coordinator traffic.
    const ws=(channel.connection?.transport as any)?.ws;
    if(ws?.send&&ws?.addEventListener){
      const size=(data:any)=>typeof data==='string'?new TextEncoder().encode(data).byteLength:data?.byteLength??data?.size??0;
      const send=ws.send;ws.send=(...args:any[])=>{const result=send.apply(ws,args);this.sentBytes+=size(args[0]);return result;};
      ws.addEventListener('message',(event:MessageEvent)=>{this.receivedBytes+=size(event.data);});
    }
    channel.reconnection.enabled=false;channel.reconnection.maxEnqueuedMessages=0;
    const on=<T>(type:string,fn:(data:T)=>void)=>channel.onMessage(type,(data:T)=>{if(this.channel===channel&&!this.stopped)fn(data);});
    on<{id:number;info:RoomInfo}>('joined',data=>{this.id=data.id;this.view.localId=this.id;this.receiveInfo(data.info);this.setupMesh();});
    on<RoomInfo>('info',info=>this.receiveInfo(info));
    on<PresenceEvent>('presence',event=>{if(event.id>this.lastPresence){this.lastPresence=event.id;if(!this.background)this.presence.push(event);}});
    on<HostAssignment>('prepare',assignment=>void this.prepare(assignment));
    on<{hostEpoch:number}>('activate',m=>{if(m.hostEpoch===this.room?.hostEpoch)this.renew();});
    on<any>('lease',m=>{if(!this.room||!matches(m,this.room)||this.room.host!==this.id)return;const sent=this.leaseRequests.get(m.nonce);if(sent===undefined)return;this.leaseRequests.delete(m.nonce);this.leaseUntil=sent+NET.leaseMs;if(this.leaseUntil>this.now())this.host?.postMessage({type:'lease',until:this.leaseUntil});});
    on<any>('authority',m=>{if(this.room&&matches(m,this.room))this.authorityUntil=this.now()+Math.max(0,m.remaining-(this.serverRtt??0));});
    on<any>('stop-host',m=>{if(this.room&&matches(m,this.room))this.host?.postMessage({type:'stop',checkpoint:true});});
    on<Uint8Array>('backup',bytes=>{try{const cp=unpack<BattleCheckpoint>(bytes);this.checkpoint=cp;void this.benchmark(cp);}catch{}});
    on<Uint8Array>('candidate-check',bytes=>{try{void this.benchmark(unpack<BattleCheckpoint>(bytes));}catch{}});
    on<Commit>('commit',commit=>{if(this.room&&matches(commit,this.room)&&commit.tick>this.lastCommit){this.lastCommit=commit.tick;this.commitReceivedAt=this.now();this.onCommit(commit);}});
    on<{sender:number;bytes:Uint8Array}>('relay',m=>{if(this.mesh)this.mesh.receiveRelay(m.sender,m.bytes);else{try{this.packet(m.sender,unpack<GamePacket>(m.bytes));}catch{}}});
    for(const type of ['webrtc:offer','webrtc:answer','webrtc:ice-candidate'])on<any>(type,m=>{this.signalInbox.push({sessionId:m.peerId,data:m.sdp?{description:m.sdp}:{candidate:m.candidate}});if(this.signalInbox.length>96)this.signalInbox.shift();this.flushSignals();});
    on<string[]>('webrtc:peers',sessions=>{this.webrtcSessions=new Set(sessions);this.updateMeshPeers();});
    on<string>('webrtc:peer-joined',session=>{this.webrtcSessions.add(session);this.updateMeshPeers();});
    on<string>('webrtc:peer-left',session=>{this.webrtcSessions.delete(session);this.updateMeshPeers();});
    channel.onStateChange((state:any)=>{if(this.channel===channel&&state.matchId){const info=state.toJSON();this.receiveInfo({...info,countdown:info.countdown<0?null:info.countdown,players:Object.values(info.players)} as RoomInfo);}});
    on<{nonce:number;at:number}>('pong',m=>{const rtt=this.now()-m.at;if(rtt>=0&&rtt<10000){this.serverRtt=rtt;this.pongAt=this.now();}});
    on<GameError>('game-error',e=>{if(e.code==='SESSION_REPLACED'||e.code==='RECOVERY_TIMEOUT'||e.code==='CLOSED')this.finish(e.message);else this.error=e.message;});
    channel.onError((_code,message)=>{if(this.channel===channel)this.status=message??'Проблема соединения';});
    const dropped=()=>{if(this.channel!==channel||this.stopped)return;this.channel=undefined;this.connected=false;this.bootstrap=true;this.recovering=true;this.needsResume=true;this.mesh?.close();this.mesh=undefined;this.webrtcSessions.clear();this.recoveryAt ||= this.now();this.resetPrediction();this.onConnectionLoss();this.scheduleReconnect();};
    channel.onLeave(dropped);channel.onDrop(dropped);
  }
  private setupMesh(){
    if(this.mesh){this.updateMeshPeers();return;}this.mesh=new RouteMesh(this.id,(peer,data)=>this.signal(peer,data),(peer,bytes)=>this.send('relay',{targets:[peer],bytes}), (peer,packet)=>this.packet(peer,packet),this.now);
    this.mesh.onBytes=(direction,size)=>{if(direction==='sent')this.sentBytes+=size;else this.receivedBytes+=size;};
    this.mesh.onGamePacket=(...sample)=>this.onGamePacket?.(...sample);
    this.mesh.onRoute=(id,route)=>{this.transition({at:this.now(),reason:`route:${id}:${route}`});this.send('route',{peerId:id,route});};
    if(this.options.webrtc!==false){this.send('webrtc:join');this.updateMeshPeers();}
  }
  private updateMeshPeers(){if(this.options.webrtc!==false){this.mesh?.setPeers((this.room?.players??[]).filter(p=>p.sessionId&&this.webrtcSessions.has(p.sessionId)));this.flushSignals();}}
  private signal(peer:number,data:any){
    const targetId=this.room?.players.find(p=>p.id===peer)?.sessionId;if(!targetId)return;
    if(data.description)this.send(data.description.type==='offer'?'webrtc:offer':'webrtc:answer',{targetId,sdp:data.description});
    else if(data.candidate)this.send('webrtc:ice-candidate',{targetId,candidate:data.candidate});
  }
  private flushSignals(){if(!this.mesh||!this.id)return;const pending=this.signalInbox.splice(0);for(const m of pending){const id=this.room?.players.find(p=>p.sessionId===m.sessionId)?.id;if(id!==undefined)void this.mesh.acceptSignal(id,m.data);}}
  private receiveInfo(info:RoomInfo){
    if(this.room&&info.matchId!==this.room.matchId)return;
    if(this.room&&(info.hostEpoch<this.room.hostEpoch||info.revision<this.room.revision))return;
    // A first assignment can arrive before the reply to our application-level hello.
    // Colyseus has already authenticated this connection; bind its stable player id now.
    if(!this.id&&this.channel){const own=info.players.find(p=>p.sessionId===this.channel!.sessionId);if(own){this.id=own.id;this.view.localId=own.id;}}
    const changed=!this.room||!matches(info,this.room);const oldHost=this.room?.host;
    this.room=info;
    if(changed){this.bootstrap=true;this.lastTick=-1;this.leaseUntil=0;this.authorityUntil=0;this.resetPrediction();this.sequence=0;this.ack=-1;this.lastCommit=-1;this.commitReceivedAt=0;this.ackAt=this.now();this.pendingAt=0;this.transition({at:this.now(),reason:`host:${info.host}:${info.hostEpoch}`});}
    if(info.host!==this.id&&oldHost===this.id)this.host?.postMessage({type:'stop',checkpoint:false});
    // Room metadata cannot prove that fresh authorized battle frames are arriving.
    this.recovering ||= info.stage!=='running'||this.bootstrap;
    if(this.recovering)this.recoveryAt ||= this.now();
    this.updateMeshPeers();
    if(info.host===this.id)this.host?.postMessage({type:'members',players:info.players});
  }
  private async getHost(){
    if(this.host)return this.host;
    if(this.hostPending)return this.hostPending;
    const generation=this.portGeneration;
    const pending=(async()=>{const port=await(this.options.hostFactory?.()??hostPort());
      if(this.stopped||generation!==this.portGeneration){port.terminate();throw Error('Stopped');}
      this.host=port;port.onmessage=e=>this.workerMessage(e.data);return port;
    })();
    this.hostPending=pending;
    try{return await pending;}finally{if(this.hostPending===pending)this.hostPending=undefined;}
  }
  private async prepare(assignment:HostAssignment){
    if(assignment.host!==this.id||this.background)return;const serial=++this.hostSerial;this.assignment=assignment;
    try{const port=await this.getHost();if(serial!==this.hostSerial||this.stopped)return;port.postMessage({type:'load',assignment});}catch{this.status='Не удалось подготовить расчёт боя';}
  }
  private async benchmark(cp:BattleCheckpoint){
    if(this.background||this.room?.host===this.id||this.now()-this.benchmarkAt<NET.sampleWindowMs)return;this.benchmarkAt=this.now();
    try{const port=await this.getHost();if(this.room?.host===this.id)return;port.postMessage({type:'benchmark',assignment:{...cp,host:this.id,checkpoint:cp,players:this.room?.players??[],nonce:'benchmark'}});}catch{}
  }
  private workerMessage(m:any){
    if(this.stopped)return;
    if(m.type==='benchmark'){this.stepP95=m.stepP95;return;}
    if(m.type==='ready'){this.send('ready',{nonce:m.nonce});return;}
    if(m.type==='expired'){this.recovering=true;this.recoveryAt ||= this.now();return;}
    if(!this.room)return;
    if(m.type==='snapshot'){
      const snapshot=m.snapshot as WorldSnapshot;if(!matches(snapshot,this.room)||this.room.host!==this.id)return;
      this.applySnapshot(snapshot);const relay:number[]=[];
      for(const p of this.room.players)if(p.id!==this.id&&p.connected){if(this.mesh?.isDirect(p.id))this.mesh.send(p.id,snapshot);else relay.push(p.id);}
      if(relay.length){const bytes=pack(snapshot);if(this.send('relay',{targets:relay,bytes}))for(const id of relay)this.onGamePacket?.(id,'relay','sent','snapshot',bytes.length);}
    }else if(m.type==='checkpoint'||m.type==='stopped'){
      const cp=m.checkpoint as BattleCheckpoint;if(!matches(cp,this.room)||this.room.host!==this.id)return;this.checkpoint=cp;
      if(m.stepP95!==undefined)this.stepP95=m.stepP95;
      const bytes=pack(cp);this.send(m.type==='stopped'?'host-stopped':'checkpoint',bytes);
    }
  }
  private renew(){if(!this.room||this.room.host!==this.id||this.background||this.room.stage!=='running')return;
    const nonce=++this.leaseSerial;this.leaseRequests.set(nonce,this.now());for(const [n,t] of this.leaseRequests)if(this.now()-t>NET.leaseMs)this.leaseRequests.delete(n);
    this.heartbeatAt=this.now();this.send('lease-request',{hostEpoch:this.room.hostEpoch,round:this.room.round,nonce});
  }
  private packet(sender:number,packet:GamePacket){
    if(!this.room||this.stopped)return;
    if(packet.kind==='input'&&this.room.host===this.id&&this.now()<this.leaseUntil&&validBatch(packet,sender,this.room))this.host?.postMessage({type:'input',batch:packet,sender});
    else if(packet.kind==='snapshot'&&sender===this.room.host&&this.now()<this.authorityUntil)this.applySnapshot(packet);
    else if(packet.kind==='ping')this.send('relay',{targets:[sender],bytes:pack({kind:'pong',id:packet.id,at:packet.at})});
  }
  private applySnapshot(snapshot:WorldSnapshot){
    if(!this.room||this.background||snapshot.tick<=this.lastTick||!validSnapshot(snapshot,this.room))return;
    const previous=this.state,old=this.predicted?.tank,battle=`${this.room.matchId}:${this.room.round}`,newRound=battle!==this.appliedBattle,restoring=this.bootstrap;
    const own=snapshot.state.players.find(p=>p.id===this.id);if(!own)return;
    if(previous&&(previous.players.find(p=>p.id===this.id)?.tank.controlEpoch??0)!==(own.tank.controlEpoch??0)){this.resetPrediction();this.onControlReset();}
    if(this.recoveryAt&&this.room.stage==='running'){this.pauseMs.push(this.now()-this.recoveryAt);this.pauseMs=this.pauseMs.slice(-100);this.recoveryAt=0;}
    this.lastTick=snapshot.tick;this.state=snapshot.state;this.snapshotAt=this.now();this.recovering=this.room.stage!=='running';
    if(snapshot.ack[this.id]!==undefined&&snapshot.ack[this.id]>this.ack){this.ack=snapshot.ack[this.id];for(const [seq,at] of this.commandTimes)if(seq<=this.ack){const ms=this.now()-at;this.acknowledgementMs.push(ms);this.onAcknowledgement?.(ms);this.commandTimes.delete(seq);}this.acknowledgementMs=this.acknowledgementMs.slice(-500);this.ackAt=this.now();this.sequence=Math.max(this.sequence,this.ack);}
    this.prediction.reconcile(snapshot.state,this.id,this.ack,this.now());this.predicted=this.prediction.member;
    if(old&&this.predicted&&old.hp>0&&this.predicted.tank.hp>0&&!restoring){const dx=old.x-this.predicted.tank.x,dz=old.z-this.predicted.tank.z;if(Math.hypot(dx,dz)<2){this.offset.x+=dx;this.offset.z+=dz;const n=Math.hypot(this.offset.x,this.offset.z);if(n>.75){this.offset.x*=.75/n;this.offset.z*=.75/n;}}else this.offset={x:0,z:0};}
    this.frames.push({at:this.now(),state:snapshot.state});if(this.frames.length>8)this.frames.shift();
    if(restoring&&this.awayPhase){if(this.awayPhase!=='over'&&snapshot.state.phase==='over')this.awayMessage='Бой закончился, пока тебя не было';this.awayPhase=undefined;}
    if(restoring||newRound){this.events=[];this.lastEvent=snapshot.eventCursor;this.bootstrap=false;this.appliedBattle=battle;}
    else for(const e of snapshot.events)if((e.eventId??0)>this.lastEvent){this.lastEvent=e.eventId!;if(!this.prediction.suppress(e)){const actor=snapshot.state.players.find(p=>p.id===e.actorId);this.events.push({...e,target:e.target===this.id?0:e.target,callout:e.type==='lastStand'&&e.actorId!==this.id?undefined:e.callout,text:e.type==='lastStand'?(e.actorId===this.id?'ВСЯ НАДЕЖДА НА ТЕБЯ!':`Вся надежда на ${actor?.name??'напарника'}!`):e.type==='achievement'&&actor?`${actor.name} — ${e.text}`:e.text});}}
    this.ownShots.confirm(snapshot.events,this.id);this.onSnapshot(snapshot.state,this.room);
    if(newRound)this.onRound();else if(restoring)this.onRestore();
  }
  private send(type:string,payload?:unknown){
    if(!this.channel||!this.connected||this.stopped)return false;
    const buffered=(this.channel.connection?.transport as {ws?:{bufferedAmount:number}})?.ws?.bufferedAmount??0;
    if(buffered>NET.maxBufferedBytes){this.blockedAt ||= this.now();return false;}
    this.blockedAt=0;try{this.channel.send(type,payload);return true;}catch{return false;}
  }
  private flush(force=false){
    if(!this.room||!this.outgoing.length||(!force&&this.now()-this.sentAt+.1<1000/NET.inputRate))return;
    const frames=this.outgoing.splice(0),batch:InputBatch={...this.envelope,kind:'input',frames};
    const actions=frames.filter(f=>f.input.power||f.input.dash||f.input.firePressed);
    if(this.room.host===this.id)this.host?.postMessage({type:'input',batch,sender:this.id});
    else if(this.mesh){this.mesh.send(this.room.host,batch);if(actions.length)this.mesh.send(this.room.host,{...batch,frames:actions},true);}
    else this.send('relay',{targets:[this.room.host],bytes:pack(batch)});
    this.sentAt=this.now();this.pendingAt ||= this.now();
  }
  private get envelope(){const r=this.room!;return{matchId:r.matchId,round:r.round,hostEpoch:r.hostEpoch};}
  step(input:Input){
    this.checkConnection();if(!this.room||!this.connected||this.background||this.recovering||this.room.stage!=='running')return;
    if(this.needsResume)input={...emptyInput(),aim:input.aim};
    const finite=(n:number)=>Number.isFinite(n)&&Math.abs(n)<=100;
    const safe:Input={...input,x:finite(input.x)?input.x:0,z:finite(input.z)?input.z:0,aim:finite(input.aim.x)&&finite(input.aim.z)?{...input.aim}:{x:this.view.player.x,z:this.view.player.z-1}};
    const seq=++this.sequence;this.commandTimes.set(seq,this.now());while(this.commandTimes.size>180)this.commandTimes.delete(this.commandTimes.keys().next().value!);safe.shotId=`${this.room.round}:${this.room.hostEpoch}:${this.id}:${seq}`;
    const frame:InputFrame={...this.envelope,playerId:this.id,seq,controlEpoch:this.state?.players.find(p=>p.id===this.id)?.tank.controlEpoch??0,input:safe};
    this.outgoing.push(frame);if(this.outgoing.length>NET.queueFrames)this.outgoing.splice(0,this.outgoing.length-NET.queueFrames);
    if(this.predicted)this.previousPosition={x:this.predicted.tank.x,z:this.predicted.tank.z};
    this.prediction.step(frame,this.now());this.predicted=this.prediction.member;this.events.push(...this.prediction.events.splice(0));this.flush();
  }
  releaseInput(){this.outgoing=[];if(this.room&&this.connected&&!this.background&&!this.recovering){this.step({...emptyInput(),aim:{x:this.view.player.x,z:this.view.player.z-1}});this.flush(true);}}
  sleep(){if(this.background)return;this.awayPhase=this.state?.phase;this.releaseInput();this.background=true;this.needsResume=!!this.room;this.resetPrediction();this.report();if(this.room?.host===this.id)this.host?.postMessage({type:'stop',checkpoint:true});}
  wake(){if(!this.background)return;this.background=false;this.bootstrap=true;this.recovering=!!this.room;this.pongAt=this.now();this.report();if(this.connected)this.send('hello');else this.scheduleReconnect();}
  continue(){this.needsResume=false;this.awayMessage='';this.releaseInput();}
  start(){this.send('start');}
  nextWatch(){const alive=this.state?.players.filter(p=>p.tank.hp>0)??[];this.watched=alive[(alive.findIndex(p=>p.id===this.watched)+1)%Math.max(1,alive.length)]?.id;}
  private resetPrediction(){this.commandTimes.clear();this.prediction.reset();this.predicted=undefined;this.previousPosition=undefined;this.offset={x:0,z:0};this.frames=[];this.outgoing=[];this.ownShots.reset();this.events=[];}
  private report(){this.reportAt=this.now();this.send('health',{foreground:!this.background,stepP95:this.stepP95,serverRtt:this.serverRtt,links:this.mesh?.stats()??[]});}
  private maintenance(){if(this.stopped)return;this.mesh?.tick();if(this.now()-this.heartbeatAt>=NET.heartbeatMs)this.renew();if(this.now()-this.reportAt>=NET.probeMs){this.report();this.send('ping',{at:this.now()});}this.checkConnection();}
  private checkConnection(){
    if(this.stopped||!this.room||this.background)return;
    if(this.room.host!==this.id&&this.authorityUntil>0&&this.now()>=this.authorityUntil){this.recovering=true;this.recoveryAt ||= this.now();}
    if(this.connected&&((this.blockedAt&&this.now()-this.blockedAt>2000)||(this.pongAt&&this.now()-this.pongAt>3000))){this.channel?.connection.close(1000,'Connection stalled');return;}
    if(this.recoveryAt&&this.now()-this.recoveryAt>=NET.reconnectMs)this.finish('Не удалось восстановить бой. Начни новый матч.');
  }
  get connectionNotice(){if(this.recovering)return 'Восстанавливаем бой…';if(!this.connected)return this.status;return this.snapshotAt&&this.now()-this.snapshotAt>750?'Команды задерживаются…':'';}
  private scheduleReconnect(){if(this.retry||this.stopped)return;this.status='Восстанавливаем связь…';this.retry=setTimeout(()=>{this.retry=undefined;void this.connect();},500);}
  stop(){this.stopped=true;this.joining=false;this.connectGeneration++;this.hostSerial++;this.portGeneration++;this.hostPending=undefined;clearInterval(this.timer);clearTimeout(this.retry);this.retry=undefined;this.mesh?.close();this.host?.terminate();this.host=undefined;const c=this.channel;this.channel=undefined;this.connected=false;if(c)void c.leave().catch(()=>{});}
  leave(){if(this.leaving)return;this.leaving=true;this.send('leave');this.stop();this.onLeave();}
  private finish(reason:string){this.error=reason;this.stop();this.onLeave(reason);}
  private transition(event:{at:number;reason:string}){this.transitions.push(event);if(this.transitions.length>200)this.transitions.shift();}
  diagnostics(){return{room:this.room,id:this.id,connected:this.connected,recovering:this.recovering,sequence:this.sequence,ack:this.ack,tick:this.lastTick,serverRtt:this.serverRtt,stepP95:this.stepP95,links:this.mesh?.stats()??[],sentBytes:this.sentBytes,receivedBytes:this.receivedBytes,cachedPublicRooms:warmDirectory.length,checkpointTick:this.lastCommit<0?null:this.lastCommit,checkpointAgeMs:this.commitReceivedAt?this.now()-this.commitReceivedAt:null,acknowledgementP95Ms:[...this.acknowledgementMs].sort((a,b)=>a-b)[Math.floor(this.acknowledgementMs.length*.95)]??null,pauseMs:this.pauseMs,transitions:this.transitions.slice(-30)};}
  render(dt:number,fraction=1){
    this.checkConnection();const state=this.state;if(!state||!this.frames.length)return;
    const target=this.now()-100;let a=this.frames[0],b=this.frames.at(-1)!;
    for(let i=1;i<this.frames.length;i++)if(this.frames[i].at>=target){a=this.frames[i-1];b=this.frames[i];break;}
    const alpha=b.at<=a.at?1:Math.max(0,Math.min(1,(target-a.at)/(b.at-a.at)));
    const blend=<T extends {id:number;x:number;z:number;angle?:number;bodyAngle?:number}>(current:T[],before:T[])=>current.map(t=>{const old=before.find(p=>p.id===t.id);if(!old||Math.hypot(t.x-old.x,t.z-old.z)>4)return{...t};return{...t,x:old.x+(t.x-old.x)*alpha,z:old.z+(t.z-old.z)*alpha,angle:t.angle===undefined?undefined:(old.angle??t.angle)+Math.atan2(Math.sin(t.angle-(old.angle??t.angle)),Math.cos(t.angle-(old.angle??t.angle)))*alpha,bodyAngle:t.bodyAngle===undefined?undefined:(old.bodyAngle??t.bodyAngle)+Math.atan2(Math.sin(t.bodyAngle-(old.bodyAngle??t.bodyAngle)),Math.cos(t.bodyAngle-(old.bodyAngle??t.bodyAngle)))*alpha};});
    const v=this.view;v.obstacles=state.obstacles;v.phase=state.phase;v.wave=state.wave;v.score=state.score;v.elapsed=state.elapsed;v.breakTime=state.breakTime;v.remainingToSpawn=state.remaining;
    const elapsed=state.phase==='playing'?Math.min(.05,Math.max(0,(this.now()-this.snapshotAt)/1000)):0;
    const previous=this.frames.at(-2)?.state;
    v.enemies=presentEnemies(state.enemies,previous?.enemies??[],previous?state.elapsed-previous.elapsed:0,elapsed,(x,z,r)=>v.walkable(x,z,r),(a,b,r)=>v.lineOfSight(a,b,r));
    v.bullets=blend(b.state.bullets,a.state.bullets).filter(b=>b.owner==='enemy');v.portals=state.portals;v.hazards=state.hazards;v.pickups=state.pickups;v.lootBatch=state.lootBatch??null;v.capture=state.capture;v.deliveries=state.deliveries??[];v.repairZone=state.repairZone??null;v.emergencyReadyAt=state.emergencyReadyAt??0;
    const tanks=blend(b.state.players.map(p=>p.tank),a.state.players.map(p=>p.tank));
    v.allies=state.players.map(m=>({...m.tank,...tanks.find(t=>t.id===m.id),netPower:m.powerTime,netShield:m.shield+m.dashTime}));
    const own=state.players.find(p=>p.id===this.id);if(own){
      const predicted=this.predicted??own;this.offset.x*=Math.exp(-dt/.1);this.offset.z*=Math.exp(-dt/.1);
      const previous=this.previousPosition??predicted.tank;const blendOwn=own.tank.hp>0&&Math.hypot(previous.x-predicted.tank.x,previous.z-predicted.tank.z)<2?Math.max(0,Math.min(1,fraction)):1;
      v.player={...own.tank,...predicted.tank,x:previous.x+(predicted.tank.x-previous.x)*blendOwn+this.offset.x,z:previous.z+(predicted.tank.z-previous.z)*blendOwn+this.offset.z,netPower:own.powerTime,netShield:own.shield+predicted.dashTime};
      v.allies=v.allies.map(t=>t.id===this.id?v.player:t);for(const k of ['charge','powerTime','dashTime','dashCooldown','rapidTime','streak','moved','fired'] as const)v[k]=own[k];
      v.kills=own.kills;
    }
    const friendly=state.bullets.filter(b=>b.owner!=='enemy').map(b=>presentFriendlyBullet(b,elapsed,v.enemies,v.obstacles));
    v.bullets=[...v.bullets,...friendly.filter(b=>b.source!==this.id),...this.ownShots.present(friendly.filter(b=>b.source===this.id),v.player,this.now()),...this.prediction.bullets(this.now())];
    for(const e of this.events)if(e.type==='shot'&&e.source===this.id&&e.muzzles){
      const tips=muzzles(v.player,e.powered??e.muzzles.length===2);
      e.muzzles=e.muzzles.map(m=>({...m,...tips[m.barrel]}));
    }
    if(v.player.hp<=0){const watched=v.allies.find(t=>t.id===this.watched&&t.hp>0)??v.allies.find(t=>t.hp>0);v.focus=watched;this.watched=watched?.id;}else v.focus=undefined;
  }
}
