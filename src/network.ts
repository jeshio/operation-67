import { presentEnemies, presentFriendlyBullet } from './combat-view';
import { advanceKnockback } from './knockback';
import { tankStats } from './modules';
import { OwnShots } from './own-shots';
import { muzzles } from './weapons';
import { Simulation, emptyInput, type Input, type GameEvent } from './simulation';
import { CONFIG as C, BALANCE as B } from './config';
import type { BattleState, Member } from './coop';
import { PROTOCOL, type ServerMessage, type RoomInfo, type JoinRequest, type ClientMessage, type PresenceEvent } from './protocol';

const SEND_INTERVAL=1000/30, LINK_WARNING=750, LINK_TIMEOUT=2500, PREDICTION_WINDOW=350;
type PendingInput={seq:number;input:Input;at:number};
export class NetworkGame {
  readonly view=new Simulation(); room?:RoomInfo; id=0; state?:BattleState; status='Подключение…'; error=''; connected=false;
  presence:PresenceEvent[]=[]; private lastPresence=0; private ownShots=new OwnShots(); private leaving=false;
  events:GameEvent[]=[]; watched?:number; onRound=()=>{}; onLeave=()=>{}; onConnectionLoss=()=>{};
  private socket?:WebSocket; private stopped=false; private token=''; private join?:JoinRequest; private lastEvent=0; private sequence=0;
  private pending:PendingInput[]=[]; private predicted?:Member; private previousPosition?:{x:number;z:number}; private offset={x:0,z:0};
  private frames:{at:number;state:BattleState}[]=[]; private retry?:ReturnType<typeof setTimeout>;
  private joined=false; private joining=false; private openedAt=0; private snapshotAt=0; private ackAt=0; private ack=-1; private sentSeq=-1; private bufferedAt?:number;
  private resyncSequence=0;private awaitingResync?:number;
  private appliedBattle=''; private bootstrap=true; private background=false;
  recovering=false; needsResume=false; awayMessage=''; private awayPhase?:string;
  onRestore=()=>{}; onControlReset=()=>{};
  onSnapshot=(_state:BattleState,_room:RoomInfo)=>{};
  sleep(){
    if(this.background)return;
    this.awayPhase=this.state?.phase;this.background=true;this.needsResume=!!this.room;
    this.releaseInput();this.resetPrediction();this.frames=[];
  }
  wake(){
    if(!this.background)return;
    this.background=false;this.recovering=!!this.room;this.bootstrap=true;this.resetPrediction();
    this.status='Восстанавливаем связь…';
    if(this.joined){this.snapshotAt=this.ackAt=this.now();this.awaitingResync=++this.resyncSequence;this.send({type:'resync',request:this.awaitingResync});}else this.checkConnection();
  }
  continue(){this.needsResume=false;this.awayMessage='';this.releaseInput();}
  private sentAt=-Infinity; private lastSent?:Input; private queuedInput=emptyInput();
  constructor(private storage:Storage|null,private key:string,private now=()=>performance.now()){
    this.view.network=true;try{this.token=storage?.getItem(key)??'';}catch{}this.connect();
  }
  private connect(){
    const url=new URL('/ws',location.href);url.protocol=location.protocol==='https:'?'wss:':'ws:';
    if(['5177','5178'].includes(location.port))url.port='5179';
    const ws=new WebSocket(import.meta.env?.VITE_SERVER_URL||url.href);this.socket=ws;this.openedAt=this.now();
    // A superseded socket may still dispatch its final messages or close event.
    ws.onopen=()=>{if(this.socket===ws)this.send({type:'hello',version:PROTOCOL,token:this.token||undefined});};
    ws.onmessage=event=>{if(this.socket!==ws)return;try{this.receive(JSON.parse(event.data));}catch(error){console.error('Battle snapshot failed',error);this.error='Не удалось прочитать состояние боя. Обнови страницу.';}};
    ws.onclose=event=>{
      if(this.socket!==ws||this.stopped)return;
      if(event.code===1000){this.connected=this.joined=false;this.stopped=true;this.error=event.reason||'Соединение закрыто.';this.onConnectionLoss();return;}
      this.reconnect();
    };
    ws.onerror=()=>{if(this.socket===ws)this.status='Нет связи с игровым сервером. Повторяем подключение…';};
  }
  private reconnect(){
    if(this.stopped||this.retry)return;
    const ws=this.socket;this.socket=undefined;this.connected=this.joined=false;
    this.bootstrap=true;this.recovering=!!this.room;this.needsResume=!!this.room;this.status='Восстанавливаем связь…';this.resetPrediction();this.onConnectionLoss();ws?.close();
    this.retry=setTimeout(()=>{this.retry=undefined;if(!this.stopped)this.connect();},500);
  }
  get connectionNotice(){
    if(!this.connected)return this.status;
    return this.joined&&((this.sentSeq>this.ack&&this.now()-this.ackAt>LINK_WARNING)||(this.bufferedAt!==undefined&&this.now()-this.bufferedAt>LINK_WARNING))?'Команды задерживаются. Восстанавливаем связь…':'';
  }
  private checkConnection(){
    if(this.background)return;
    const now=this.now();
    if(this.joined&&(now-this.snapshotAt>LINK_TIMEOUT||(this.sentSeq>this.ack&&now-this.ackAt>LINK_TIMEOUT)||(this.bufferedAt!==undefined&&now-this.bufferedAt>LINK_TIMEOUT)))this.reconnect();
    else if(!this.joined&&(!this.connected||this.joining)&&this.socket&&now-this.openedAt>8000)this.reconnect();
  }
  send(message:ClientMessage){if(this.socket?.readyState!==WebSocket.OPEN)return false;this.socket.send(JSON.stringify(message));return true;}
  enter(request:JoinRequest){if(this.leaving||this.room||this.joining)return;if(!this.room){this.needsResume=false;this.awayMessage='';}this.error='';this.join=request;this.joining=true;this.openedAt=this.now();if(this.stopped){this.stopped=false;this.connect();}else if(this.connected)this.send(request);}
  leave(){if(this.leaving)return;this.leaving=true;this.releaseInput();this.send({type:'leave'});this.stop();this.onLeave();}
  stop(){this.stopped=true;clearTimeout(this.retry);this.retry=undefined;const socket=this.socket;this.socket=undefined;this.connected=this.joined=this.joining=false;socket?.close();}
  start(){this.send({type:'start'});}
  nextWatch(){const alive=this.state?.players.filter(p=>p.tank.hp>0)??[];this.watched=alive[(alive.findIndex(p=>p.id===this.watched)+1)%Math.max(1,alive.length)]?.id;}
  private resetPrediction(){
    this.ownShots.reset();this.events=[];this.pending=[];this.predicted=undefined;this.previousPosition=undefined;this.offset={x:0,z:0};
    this.queuedInput=emptyInput();this.lastSent=undefined;this.sentAt=-Infinity;this.bufferedAt=undefined;
  }
  /** Send release immediately on blur, pause or orientation change, even between simulation ticks. */
  releaseInput(){
    this.queuedInput=emptyInput();
    if(this.joined){this.sequence++;this.flushInput(true);}
  }
  private receive(message:ServerMessage){
    if(this.stopped||this.leaving)return;
    if(message.type==='welcome'){
      this.token=message.token;try{this.storage?.setItem(this.key,this.token);}catch{}this.connected=true;this.status='Сервер на связи';
      this.openedAt=this.now();this.joining=!!this.join;
      if(this.room&&this.join)this.send({...this.join,mode:'code',code:this.room.code});else if(this.join)this.send(this.join);return;
    }
    if(message.type==='error'){this.error=message.message;this.recovering=false;this.joining=false;if(this.room&&message.message.includes('Комната не найдена')){this.room=undefined;this.state=undefined;this.view.phase='menu';this.frames=[];this.join=undefined;this.joined=false;}return;}
    if(message.type==='left'){if(!this.leaving){this.leaving=true;this.stop();this.onLeave();}return;}
    if(message.type==='presence'){if(message.event.id>this.lastPresence){this.lastPresence=message.event.id;if(!this.background)this.presence.push(message.event);}return;}
    if(message.type==='joined'){
      if(this.room?.code!==message.room.code){this.lastPresence=0;this.presence=[];}
      this.awaitingResync=undefined;this.bootstrap=true;this.id=message.id;this.view.localId=this.id;this.room=message.room;this.sequence=0;this.frames=[];this.resetPrediction();
      this.joined=true;this.joining=false;this.ack=this.sentSeq=-1;this.ackAt=this.snapshotAt=this.now();this.error='';return;
    }
    if(message.type!=='snapshot'||!this.joined||this.background||message.room.round<(this.room?.round??0))return;
    if(this.room&&message.room.code!==this.room.code)return;
    if(this.awaitingResync!==undefined&&message.resync!==this.awaitingResync)return;this.awaitingResync=undefined;
    const battle=`${message.room.code}:${message.room.round}`,newRound=this.appliedBattle!==battle,restoring=this.bootstrap;
    if(!newRound&&this.state&&(message.state.elapsed<this.state.elapsed||message.state.wave<this.state.wave||message.state.score<this.state.score||(this.state.phase==='over'&&message.state.phase!=='over')))return;
    if(this.appliedBattle.split(':')[0]!==message.room.code)this.lastEvent=0;
    this.appliedBattle=battle;
    if(restoring){this.lastEvent=Math.max(this.lastEvent,message.eventCursor??Math.max(0,...message.events.map(e=>e.eventId??0)));this.frames=[];this.resetPrediction();this.bootstrap=false;this.recovering=false;
      if(this.awayPhase&&this.awayPhase!=='over'&&message.state.phase==='over')this.awayMessage='Бой закончился, пока тебя не было';this.awayPhase=undefined;}
    if(newRound){this.frames=[];this.resetPrediction();}
    // Commit the authoritative state before notifying presentation code of a new round.
    const priorEpoch=this.state?.players.find(p=>p.id===this.id)?.tank.controlEpoch??0;
    this.room=message.room;this.state=message.state;const now=this.now();this.snapshotAt=now;
    if(message.ack>this.ack){this.ack=message.ack;this.ackAt=now;}
    this.frames.push({at:now,state:message.state});if(this.frames.length>6)this.frames.shift();
    const own=message.state.players.find(p=>p.id===this.id);
    if(own){
      if((own.tank.controlEpoch??0)!==priorEpoch){this.resetPrediction();this.onControlReset();this.releaseInput();}
      const old=this.predicted?.tank;this.predicted=structuredClone(own);
      this.pending=this.pending.filter(p=>p.seq>message.ack&&now-p.at<=PREDICTION_WINDOW);
      this.view.obstacles=message.state.obstacles.map(o=>({...o,hp:o.hp??Infinity}));this.view.enemies=message.state.enemies;
      for(const p of this.pending)this.predict(this.predicted,p.input);
      const t=this.predicted.tank;
      if(this.previousPosition&&old){this.previousPosition.x+=t.x-old.x;this.previousPosition.z+=t.z-old.z;}
      if(old&&old.hp>0&&t.hp>0&&Math.hypot(old.x-t.x,old.z-t.z)<2){
        this.offset.x+=old.x-t.x;this.offset.z+=old.z-t.z;
        const length=Math.hypot(this.offset.x,this.offset.z);if(length>.75){this.offset.x*=.75/length;this.offset.z*=.75/length;}
      }else this.offset={x:0,z:0};
    }
    const fresh=message.events.filter(e=>(e.eventId??0)>this.lastEvent);this.ownShots.confirm(fresh,this.id);
    for(const event of fresh)if((event.eventId??0)>this.lastEvent){this.lastEvent=event.eventId!;const actor=message.state.players.find(p=>p.id===event.actorId);this.events.push({...event,target:event.target===this.id?0:event.target,callout:event.type==='lastStand'&&event.actorId!==this.id?undefined:event.callout,text:event.type==='lastStand'?(event.actorId===this.id?'ВСЯ НАДЕЖДА НА ТЕБЯ!':`Вся надежда на ${actor?.name??'напарника'}!`):event.type==='achievement'&&actor?`${actor.name} — ${event.text}`:event.text});}
    this.onSnapshot(message.state,message.room);
    if(newRound)this.onRound();else if(restoring)this.onRestore();
  }
  private predict(m:Member,input:Input){
    if(m.tank.hp<=0||this.state?.phase!=='playing')return;const dt=1/60,t=m.tank,n=Math.hypot(input.x,input.z);
    m.dashTime=Math.max(0,m.dashTime-dt);m.dashCooldown=Math.max(0,m.dashCooldown-dt);
    if(input.dash&&m.dashCooldown<=0){m.dashDirection=n?{x:input.x/n,z:input.z/n}:{x:Math.sin(t.bodyAngle),z:Math.cos(t.bodyAngle)};m.dashTime=B.dash.duration;m.dashCooldown=tankStats(t).dashCooldown;}
    const dx=m.dashTime>0?m.dashDirection.x*B.dash.speed:input.x/Math.max(1,n)*tankStats(t).speed,dz=m.dashTime>0?m.dashDirection.z*B.dash.speed:input.z/Math.max(1,n)*tankStats(t).speed;
    if(!advanceKnockback(t,dt,C.player.radius,(x,z,r)=>this.view.walkable(x,z,r)))this.view.move(t,dx*dt,dz*dt,C.player.radius);t.angle=Math.atan2(input.aim.x-t.x,input.aim.z-t.z);
  }
  private flushInput(force=false){
    if(!this.joined||!this.room||!this.socket)return;
    if(this.socket.bufferedAmount>0){this.bufferedAt??=this.now();return;}this.bufferedAt=undefined;
    const now=this.now(),input=this.queuedInput;
    const changed=this.lastSent&&(input.fire!==this.lastSent.fire||(Math.hypot(input.x,input.z)===0)!==(Math.hypot(this.lastSent.x,this.lastSent.z)===0));
    if(!force&&!changed&&!input.firePressed&&!input.power&&!input.dash&&now-this.sentAt<SEND_INTERVAL-.01)return;
    if(!this.send({type:'input',seq:this.sequence,round:this.room.round,controlEpoch:this.state?.players.find(p=>p.id===this.id)?.tank.controlEpoch??0,input}))return;
    if(this.sentSeq<=this.ack)this.ackAt=now;
    this.sentSeq=this.sequence;this.sentAt=now;this.lastSent={...input};this.queuedInput={...input,power:false,dash:false,firePressed:false};
  }
  step(input:Input){
    this.checkConnection();if(this.background||!this.connected||!this.joined||!this.room)return;
    if(this.recovering||this.needsResume)input={...emptyInput(),aim:input.aim};
    const at=this.now(),seq=++this.sequence;
    // A transient invalid projection must not invalidate movement and fire for the server.
    const finite=(n:number)=>Number.isFinite(n)&&Math.abs(n)<=100;
    const t=this.predicted?.tank??this.view.player;
    const safe={...input,x:finite(input.x)?input.x:0,z:finite(input.z)?input.z:0,aim:finite(input.aim.x)&&finite(input.aim.z)?{...input.aim}:{x:t.x,z:t.z-1}};
    this.queuedInput={...safe,firePressed:this.queuedInput.firePressed||safe.firePressed,power:this.queuedInput.power||safe.power,dash:this.queuedInput.dash||safe.dash};this.flushInput();
    if(this.predicted){
      this.previousPosition={x:this.predicted.tank.x,z:this.predicted.tank.z};
      this.pending.push({seq,input:safe,at});this.pending=this.pending.filter(p=>at-p.at<=PREDICTION_WINDOW).slice(-30);
      this.predict(this.predicted,safe);
    }
  }
  render(dt:number,fraction=1){
    this.checkConnection();const state=this.state;if(!state||!this.frames.length)return;
    const target=this.now()-100;let a=this.frames[0],b=this.frames.at(-1)!;
    for(let i=1;i<this.frames.length;i++)if(this.frames[i].at>=target){a=this.frames[i-1];b=this.frames[i];break;}
    const alpha=b.at<=a.at?1:Math.max(0,Math.min(1,(target-a.at)/(b.at-a.at)));
    const blend=<T extends {id:number;x:number;z:number;angle?:number;bodyAngle?:number}>(current:T[],before:T[])=>current.map(t=>{const old=before.find(p=>p.id===t.id);if(!old||Math.hypot(t.x-old.x,t.z-old.z)>4)return{...t};return{...t,x:old.x+(t.x-old.x)*alpha,z:old.z+(t.z-old.z)*alpha,angle:t.angle===undefined?undefined:(old.angle??t.angle)+Math.atan2(Math.sin(t.angle-(old.angle??t.angle)),Math.cos(t.angle-(old.angle??t.angle)))*alpha,bodyAngle:t.bodyAngle===undefined?undefined:(old.bodyAngle??t.bodyAngle)+Math.atan2(Math.sin(t.bodyAngle-(old.bodyAngle??t.bodyAngle)),Math.cos(t.bodyAngle-(old.bodyAngle??t.bodyAngle)))*alpha};});
    const v=this.view;v.phase=state.phase;v.wave=state.wave;v.score=state.score;v.elapsed=state.elapsed;v.breakTime=state.breakTime;v.remainingToSpawn=state.remaining;
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
    v.bullets=[...v.bullets,...friendly.filter(b=>b.source!==this.id),...this.ownShots.present(friendly.filter(b=>b.source===this.id),v.player,this.now())];
    for(const e of this.events)if(e.type==='shot'&&e.source===this.id&&e.muzzles){
      const tips=muzzles(v.player,e.powered??e.muzzles.length===2);
      e.muzzles=e.muzzles.map(m=>({...m,...tips[m.barrel]}));
    }
    if(v.player.hp<=0){const watched=v.allies.find(t=>t.id===this.watched&&t.hp>0)??v.allies.find(t=>t.hp>0);v.focus=watched;this.watched=watched?.id;}else v.focus=undefined;
  }
}
