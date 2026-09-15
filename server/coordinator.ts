import { randomBytes } from 'node:crypto';
import { NET } from '../src/net/config';
import { validCheckpoint } from '../src/net/host';
import { matches, type BattleCheckpoint, type Commit, type HealthReport, type HostAssignment, type Participant, type PresenceEvent, type RoomInfo } from '../src/protocol';
export interface CoordinatorHooks {
  send(id:number,type:string,payload:unknown):void;
  broadcast(type:string,payload:unknown):void;
  changed(info:RoomInfo):void;
  closed():void;
}
interface Seat extends Participant {identity:string; disconnectedAt:number|null; health:HealthReport; failedAt:number;}
export class BattleCoordinator {
  readonly seats=new Map<number,Seat>();readonly checkpoints:BattleCheckpoint[]=[];
  readonly info:RoomInfo; private nextId=-1;private presence=0;
  leaseUntil=0;private inactiveAt:number|null=null;private recoveringAt:number|null=null;
  private prepareAt=0;private prepareNonce='';private handoffTarget=0;private nextRound:number|null=null;
  private countdownAt:number|null=null;private bestSince=0;private bestId=0;private lastHostChange=-Infinity;
  private benchmarkAt=-Infinity;
  checkpointAt=0;lastReason='created';
  constructor(matchId:string,code:string,isPublic:boolean,private hooks:CoordinatorHooks,private now=()=>performance.now()){
    this.info={revision:0,reason:'created',matchId,code,public:isPublic,owner:0,round:0,countdown:isPublic?3:null,host:0,backup:0,hostEpoch:0,stage:'waiting',players:[]};
    if(isPublic)this.countdownAt=this.now()+3000;
  }
  private publish(){this.info.reason=this.lastReason;this.info.revision++;this.info.players=[...this.seats.values()].filter(p=>p.present).map(({id,name,skin,connected,foreground,present,sessionId})=>({id,name,skin,connected,foreground,present,sessionId}));this.hooks.changed(structuredClone(this.info));}
  private announce(p:Seat,kind:PresenceEvent['kind']){this.hooks.broadcast('presence',{id:++this.presence,playerId:p.id,name:p.name,kind});}
  join(identity:string,name:string,skin:number,foreground=true,sessionId?:string):number {
    let p=[...this.seats.values()].find(p=>p.identity===identity);
    if(!p?.present&&this.presentCount>=NET.players)throw Error('FULL');
    if(!p&&this.seats.size>=NET.maxIdentities)throw Error('FULL');
    const used=new Set([...this.seats.values()].filter(s=>s.present&&s!==p).map(s=>s.name));let display=name;
    for(let n=2;used.has(display);n++)display=`${name.slice(0,12)} ·${n}`;
    const returning=!!p?.present;
    if(!p){p={id:this.nextId--,identity,name:display,skin,connected:true,foreground,present:true,disconnectedAt:null,health:{foreground,stepP95:null,serverRtt:null,links:[]},failedAt:-Infinity};this.seats.set(p.id,p);}
    Object.assign(p,{name:display,skin,connected:true,foreground,present:true,disconnectedAt:null,sessionId});p.health.foreground=foreground;
    if(!this.seats.get(this.info.owner)?.connected)this.info.owner=p.id;
    this.inactiveAt=null;this.publish();this.announce(p,returning?'returned':'joined');
    return p.id;
  }
  get presentCount(){return [...this.seats.values()].filter(p=>p.present).length;}
  disconnect(id:number,leave=false){const p=this.seats.get(id);if(!p)return;p.connected=false;p.foreground=false;p.disconnectedAt=this.now();if(leave)p.present=false;
    if(this.info.owner===id)this.info.owner=[...this.seats.values()].find(q=>q.connected&&q.present)?.id??id;
    this.announce(p,leave?'left':'lost');this.publish();if(this.info.host===id)this.recover('host-disconnected');}
  health(id:number,report:HealthReport){const p=this.seats.get(id);if(!p||!p.connected)return;
    const changed=p.foreground!==report.foreground;p.health=report;p.foreground=report.foreground;
    if(changed){this.publish();if(!p.foreground&&this.info.host===id)this.handoff(0,'host-background');}
  }
  start(id:number){if(id!==this.info.owner)return;if(this.countdownAt!==null||this.nextRound!==null)return;
    const phase=this.checkpoints.at(-1)?.simulation.core.phase??'menu';if(!['menu','over'].includes(phase))return;
    this.countdownAt=this.now()+3000;this.info.countdown=3;this.publish();}
  private active(){return [...this.seats.values()].filter(p=>p.present&&p.connected&&p.foreground);}
  private score(p:Seat){
    if(p.health.stepP95!==null&&p.health.stepP95>1000/NET.tickRate)return Infinity;
    const values=this.active().filter(q=>q.id!==p.id).map(q=>{
      const link=p.health.links.find(l=>l.peerId===q.id);
      const relay=(p.health.serverRtt??150)+(q.health.serverRtt??150);
      return link&&link.loss<=.05?Math.min(link.directRtt??Infinity,link.relayRtt??relay):relay;
    });return Math.max(0,...values)+(p.health.stepP95??0);
  }
  private best(exclude=0){const all=this.active().filter(p=>p.id!==exclude&&this.now()-p.failedAt>5000);return all.sort((a,b)=>this.score(a)-this.score(b)||b.id-a.id).find(p=>Number.isFinite(this.score(p)));}
  private recover(reason:string){if(this.info.stage==='closed'||this.info.stage==='recovering'&&this.lastReason===reason)return;this.lastReason=reason;this.info.stage='recovering';this.recoveringAt??=this.now();this.publish();}
  private prepare(target=0){
    if(this.now()<this.leaseUntil)return;
    const candidate=this.active().find(p=>p.id===target&&this.now()-p.failedAt>5000&&Number.isFinite(this.score(p)))??this.best();
    if(!candidate){this.recover('no-host');return;}
    this.info.host=candidate.id;this.info.hostEpoch++;if(this.nextRound!==null){this.info.round=this.nextRound;this.nextRound=null;}
    this.info.stage='preparing';this.prepareAt=this.now();this.prepareNonce=randomBytes(12).toString('hex');
    this.info.backup=this.best(candidate.id)?.id??0;this.publish();
    const assignment:HostAssignment={...this.context,host:candidate.id,checkpoint:this.checkpoints.at(-1)??null,players:this.info.players,nonce:this.prepareNonce};
    this.hooks.send(candidate.id,'prepare',assignment);
  }
  ready(id:number,nonce:string){if(id!==this.info.host||nonce!==this.prepareNonce||this.info.stage!=='preparing')return;
    const seat=this.seats.get(id);if(!seat?.connected||!seat.foreground||!seat.present){this.recover('candidate-unavailable');return;}
    this.info.stage='running';this.lastHostChange=this.now();this.recoveringAt=null;this.bestSince=0;this.bestId=0;this.publish();
    this.hooks.send(id,'activate',{...this.context,nonce});
  }
  renew(id:number,request:{hostEpoch:number;round:number;nonce:number}){
    if(id!==this.info.host||request.hostEpoch!==this.info.hostEpoch||request.round!==this.info.round||this.info.stage!=='running'||!this.seats.get(id)?.foreground)return;
    this.leaseUntil=this.now()+NET.leaseMs;
    this.hooks.send(id,'lease',{...this.context,nonce:request.nonce,duration:NET.leaseMs});
    this.hooks.broadcast('authority',{...this.context,remaining:NET.leaseMs});
  }
  get context(){const {matchId,round,hostEpoch}=this.info;return{matchId,round,hostEpoch};}
  authorized(id:number){return id===this.info.host&&this.now()<this.leaseUntil&&['running','handoff'].includes(this.info.stage);}
  checkpoint(id:number,cp:BattleCheckpoint,stopped=false){
    if(id!==this.info.host||!validCheckpoint(cp,this.context)||(!stopped&&!this.authorized(id)))return false;
    const latest=this.checkpoints.at(-1);
    if(latest&&matches(latest,cp)&&cp.tick<latest.tick)return false;
    if(!latest||!matches(latest,cp)||cp.tick>latest.tick){this.checkpoints.push(structuredClone(cp));if(this.checkpoints.length>2)this.checkpoints.shift();this.checkpointAt=this.now();
      const c=cp.simulation.core;const commit:Commit={...this.context,tick:cp.tick,state:{score:c.score,wave:c.wave,elapsed:c.elapsed,phase:c.phase},names:cp.simulation.coop.members.filter(p=>p.present).map(p=>p.name)};
      this.hooks.broadcast('commit',commit);
      const backup=this.best(this.info.host)?.id??0;if(this.info.backup!==backup){this.info.backup=backup;this.publish();}
      if(backup)this.hooks.send(backup,'backup',cp);
      if(this.now()-this.benchmarkAt>=NET.sampleWindowMs){this.benchmarkAt=this.now();for(const candidate of this.active())if(candidate.id!==id&&candidate.id!==backup)this.hooks.send(candidate.id,'candidate-check',cp);}
    }
    if(stopped){this.leaseUntil=0;const target=this.handoffTarget;this.handoffTarget=0;this.prepare(target);}
    return true;
  }
  private handoff(target:number,reason:string){
    if(this.info.stage==='handoff'||this.info.stage==='preparing')return;
    this.lastReason=reason;this.handoffTarget=target;this.recoveringAt??=this.now();
    if(this.info.host&&this.seats.get(this.info.host)?.connected&&this.now()<this.leaseUntil){this.info.stage='handoff';this.publish();this.hooks.send(this.info.host,'stop-host',this.context);}
    else{this.leaseUntil=Math.max(this.leaseUntil,0);this.recover(reason);}
  }
  tick(){
    const now=this.now();if(this.info.stage==='closed')return;
    for(const p of this.seats.values())if(p.present&&!p.connected&&p.disconnectedAt!==null&&now-p.disconnectedAt>=NET.reconnectMs){p.present=false;this.announce(p,'left');this.publish();}
    const active=this.active();
    if(!active.length){this.inactiveAt??=now;if(this.info.stage==='running')this.handoff(0,'no-active-players');if(now-this.inactiveAt>=NET.reconnectMs){this.close('Бой закрыт: все игроки отключились.');return;}}
    else this.inactiveAt=null;
    if(this.countdownAt!==null){const remaining=Math.max(0,Math.ceil((this.countdownAt-now)/1000));if(this.info.countdown!==remaining){this.info.countdown=remaining;this.publish();}
      if(!remaining&&this.info.stage==='running'){this.countdownAt=null;this.info.countdown=null;this.nextRound=this.info.round+1;this.handoff(this.info.host,'new-round');}}
    if(this.info.stage==='waiting')this.prepare();
    else if(this.info.stage==='preparing'&&now-this.prepareAt>=(this.info.hostEpoch===1?NET.initialPrepareMs:NET.prepareMs)){const p=this.seats.get(this.info.host);if(p)p.failedAt=now;this.recover('candidate-timeout');}
    else if(['handoff','recovering'].includes(this.info.stage)&&now>=this.leaseUntil)this.prepare(this.handoffTarget);
    else if(this.info.stage==='running'){
      if(now>=this.leaseUntil&&now-this.lastHostChange>=NET.leaseMs){const failed=this.seats.get(this.info.host);if(failed)failed.failedAt=now;this.recover('lease-expired');this.prepare();}
      else if(active.length>1&&now-this.lastHostChange>=NET.hostCooldownMs){
        const current=this.seats.get(this.info.host),best=this.best();const old=current?this.score(current):Infinity,next=best?this.score(best):Infinity;
        if(best&&best.id!==this.info.host&&old-next>=NET.improvementMs&&next<=old*(1-NET.improvementRatio)){
          if(this.bestId!==best.id){this.bestId=best.id;this.bestSince=now;}
          const core=this.checkpoints.at(-1)?.simulation.core;
          if(now-this.bestSince>=NET.sampleWindowMs&&core&&(core.breakTime>0||['menu','over'].includes(core.phase)))this.handoff(best.id,'better-host');
        }else{this.bestId=0;this.bestSince=0;}
      }
    }
    if(this.recoveringAt!==null&&now-this.recoveringAt>=NET.reconnectMs)this.close('Не удалось восстановить бой. Начни новый матч.');
  }
  close(message:string){this.info.stage='closed';this.leaseUntil=0;this.publish();this.hooks.broadcast('game-error',{code:'RECOVERY_TIMEOUT',message});this.hooks.closed();}
  debug(){return{...this.info,checkpointAgeMs:this.checkpointAt?this.now()-this.checkpointAt:null,checkpointTicks:this.checkpoints.map(c=>c.tick),reason:this.lastReason};}
  hostLatency(){return this.seats.get(this.info.host)?.health.serverRtt??null;}
}
