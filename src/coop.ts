import { Simulation, emptyInput, type SimulationCheckpoint, type Tank, type Point, type Input, type Enemy, type Bullet, type GameEvent } from './simulation';
import { CONFIG as C, BALANCE as B, ENEMY_META, type EnemyKind } from './config';
import { planWave, wavePacing } from './waves';
import type { Callout } from './announcer';

export const SKINS = [
  {name:'Синий',color:0x278bc4}, {name:'Жёлтый',color:0xf2c343}, {name:'Мятный',color:0x58cda7},
  {name:'Фиолетовый',color:0x9575da}, {name:'Полярный',color:0xe0eeee}, {name:'Графитовый',color:0x586879},
] as const;
const personalKeys=['charge','powerTime','dashTime','dashCooldown','rapidTime','streak','powerKills','moved','fired'] as const;
type Personal=Record<typeof personalKeys[number],number>;
export interface Member extends Personal {
  id:number; name:string; skin:number; tank:Tank; connected:boolean; present:boolean; shield:number;
  kills:number; damage:number; bestStreak:number; deadWave:number; pendingSpawnHP?:number; dashDirection:Point;
}
export interface BattleState {
  phase:Simulation['phase']; wave:number; score:number; elapsed:number; breakTime:number; remaining:number; peak:number;
  players:Member[]; enemies:Enemy[]; bullets:Bullet[]; portals:Simulation['portals']; hazards:Simulation['hazards'];
  deliveries?:Simulation['deliveries']; repairZone?:Simulation['repairZone']; emergencyReadyAt?:number; lootBatch?:Simulation['lootBatch']; pickups:Simulation['pickups']; obstacles:Simulation['obstacles']; capture:Simulation['capture'];
}
export class CoopSimulation extends Simulation {
  members=new Map<number,Member>(); peak=1; private roster=new Set<number>(); private lastStandWave = -1; private deaths = new Set<number>(); tick=0; private eventSequence=0;
  get eventCursor(){return this.eventSequence;}
  constructor(seed=6702){super(seed);this.network=true;}
  override exportCheckpoint() {
    return { ...super.exportCheckpoint(), coop: structuredClone({ members: [...this.members.values()], peak: this.peak, roster: [...this.roster], lastStandWave: this.lastStandWave, deaths: [...this.deaths], tick: this.tick, eventSequence: this.eventSequence }) };
  }
  override importCheckpoint(checkpoint: SimulationCheckpoint & { coop?: CoopCheckpointData }) {
    if (!checkpoint.coop) throw new Error('Missing cooperative checkpoint');
    super.importCheckpoint(checkpoint);
    const data = structuredClone(checkpoint.coop);
    this.members = new Map(data.members.map(member => [member.id, member]));
    this.peak = data.peak; this.roster = new Set(data.roster); this.lastStandWave = data.lastStandWave;
    this.deaths = new Set(data.deaths); this.tick = data.tick; this.eventSequence = data.eventSequence;
    this.network = true; this.allies = null; this.focus = undefined;
  }
  override lootParticipants(){return [...this.members.values()].filter(m=>m.present).map(m=>m.tank);}
  override creditDamage(source:number|undefined,damage:number){const m=this.members.get(source??0);if(m)m.damage+=damage;}
  override targetPlayers(){return [...this.members.values()].filter(m=>m.present&&m.tank.hp>0).map(m=>m.tank);}
  inPlayer<T>(m:Member,fn:()=>T):T {
    if(this.player===m.tank)return fn();
    const oldPlayer=this.player, oldDirection=this.dashDirection, old=Object.fromEntries(personalKeys.map(k=>[k,this[k]])) as Personal;
    this.player=m.tank;this.dashDirection=m.dashDirection;for(const k of personalKeys)this[k]=m[k];
    try{return fn();}finally{for(const k of personalKeys){m[k]=this[k];this[k]=old[k];}m.dashDirection=this.dashDirection;this.dashDirection=oldDirection;this.player=oldPlayer;}
  }
  override emit(type:GameEvent['type'],at:Point=this.player,text?:string,owner?:string,data:Partial<GameEvent>={}) {
    const actor=data.actorId ?? (owner==='roma'||(at===this.player&&this.members.has(this.player.id))?this.player.id:undefined);
    super.emit(type,at,text,owner,{...data,actorId:actor,eventId:++this.eventSequence,tick:this.tick});
  }
  override announce(callout:Callout){super.announce(callout);if(callout==='point')this.events.at(-1)!.actorId=undefined;}
  addMember(id:number,name:string,skin:number):Member {
    const existing=this.members.get(id);
    if(existing){existing.name=name;existing.skin=skin;existing.tank.displayName=name;existing.tank.skin=skin;existing.present=existing.connected=true;if(existing.deadWave===this.wave&&this.breakTime===0)existing.tank.hp=0;else if(existing.tank.hp<=0&&this.phase==='playing')this.spawn(existing,50);this.raiseDifficulty(id);return existing;}
    const m:Member={id,name,skin,tank:{id,x:0,z:7,hp:100,maxHp:100,angle:Math.PI,bodyAngle:Math.PI,cooldown:0,recoil:0,displayName:name,skin},connected:true,present:true,shield:2,kills:0,damage:0,bestStreak:0,deadWave:-1,dashDirection:{x:0,z:-1},charge:0,powerTime:0,dashTime:0,dashCooldown:0,rapidTime:0,streak:0,powerKills:0,moved:0,fired:0};
    this.members.set(id,m);this.spawn(m,100);m.tank.controlEpoch=0;this.raiseDifficulty(id);return m;
  }
  spawn(m:Member,hp:number){
    const living=this.targetPlayers().filter(t=>t.id!==m.id), center=living[0]??{x:0,z:7};
    const safe:Point[]=[];
    for(let z=-13;z<=13;z+=1.5)for(let x=-17;x<=17;x+=1.5){
      const p={x,z};if(!this.walkable(x,z,C.player.radius)||living.some(t=>Math.hypot(t.x-x,t.z-z)<1.7)||this.enemies.some(e=>Math.hypot(e.x-x,e.z-z)<C.enemy[e.kind].radius+3))continue;
      if(this.hazards.some(h=>{const dx=x-h.x,dz=z-h.z;return h.kind==='circle'?Math.hypot(dx,dz)<h.radius+1:Math.abs(dx*Math.cos(h.angle)-dz*Math.sin(h.angle))<h.radius+1&&dx*Math.sin(h.angle)+dz*Math.cos(h.angle)>-1&&dx*Math.sin(h.angle)+dz*Math.cos(h.angle)<h.length+1;}))continue;
      safe.push(p);
    }
    safe.sort((a,b)=>Math.hypot(a.x-center.x,a.z-center.z)-Math.hypot(b.x-center.x,b.z-center.z));
    // Defer an unsafe spawn until a valid patch of ground is available.
    if(!safe.length){m.tank.hp=0;m.deadWave=-1;m.pendingSpawnHP=hp;return false;}
    Object.assign(m.tank,safe[0],{hp,recoil:0,knockback:undefined,lastDamageAt:this.elapsed,ramHits:[],adrenaline:false,controlEpoch:(m.tank.controlEpoch??0)+1});m.shield=2;m.deadWave=-1;m.pendingSpawnHP=undefined;return true;
  }
  override start(_intro=false){
    this.phase='menu';this.lastStandWave=-1;this.deaths.clear();this.roster.clear();this.peak=1;for(const m of this.members.values()){m.tank.modules=[];m.tank.maxHp=100;m.tank.lastDamageAt=0;m.tank.ramHits=[];m.tank.adrenaline=false;delete m.tank.knockback;}super.start(false);
    for(const m of this.members.values())if(m.present){for(const k of personalKeys)m[k]=0;m.kills=m.damage=m.bestStreak=0;m.deadWave=-1;this.spawn(m,100);m.tank.controlEpoch=0;}
    this.events=this.events.filter(e=>e.type!=='line');
  }
  override beginWave(){
    this.deaths.clear();this.roster=new Set([...this.members.values()].filter(m=>m.present).map(m=>m.id));this.peak=Math.max(1,this.roster.size);
    super.beginWave();this.remainingToSpawn=this.countFor(this.peak);this.wavePlan.count=this.remainingToSpawn;
    this.events=this.events.filter(e=>e.type!=='line');
  }
  override finishWave(){
    if(this.breakTime>0)return;super.finishWave();
    for(const m of this.members.values())if(m.present&&m.tank.hp<=0){m.charge=m.powerTime=m.rapidTime=m.streak=m.powerKills=0;this.spawn(m,50);}
  }
  override pacing(){return wavePacing(this.wave || 1,this.peak);}
  countFor(n:number){return Math.min(24,Math.ceil(planWave(this.wave||1).count*(1+.5*(n-1))));}
  multiplier(kind:EnemyKind,n=this.peak){return 1+(ENEMY_META[kind].tier==='regular'?.35:.65)*(n-1);}
  private raiseDifficulty(id:number){
    if(this.phase!=='playing'||this.breakTime>0)return;
    this.roster.add(id);const next=Math.min(4,Math.max(this.peak,this.roster.size));if(next===this.peak)return;
    if(!this.capture)this.remainingToSpawn+=this.countFor(next)-this.countFor(this.peak);
    for(const e of this.enemies){const ratio=this.multiplier(e.kind,next)/this.multiplier(e.kind);e.hp*=ratio;e.maxHp*=ratio;}
    this.peak=next;
  }
  override createEnemy(kind:EnemyKind,p:Point,id?:number){const e=super.createEnemy(kind,p,id);e.hp*=this.multiplier(kind);e.maxHp=e.hp;return e;}
  override addCharge(amount:number){if(this.player.hp>0)super.addCharge(amount);}
  override damagePlayer(amount:number,source?:number,weapon?:string){this.damageTank(this.player,amount,source,weapon);}
  override damageTank(t:Tank,amount:number,source?:number,weapon?:string){
    const m=this.members.get(t.id);if(!m||!m.present||t.hp<=0||amount<=0||this.phase!=='playing')return;
    if(m.shield>0||m.powerTime>0||m.dashTime>0){this.emit('shield',t,undefined,'roma',{actorId:t.id,source,target:t.id,damage:0,weapon});return;}
    const damage=Math.min(t.hp,amount);t.hp-=damage;t.lastDamageAt=this.elapsed;m.streak=0;
    this.emit('hit',t,undefined,'roma',{actorId:t.id,source,target:t.id,damage,weapon,hpAfter:t.hp,maxHp:t.maxHp});
    if(t.hp===0){t.adrenaline=false;t.controlEpoch=(t.controlEpoch??0)+1;this.deaths.add(t.id);m.deadWave=this.wave;m.powerTime=m.charge=m.rapidTime=m.dashTime=m.powerKills=0;this.emit('explode',t,undefined,'roma',{actorId:t.id,target:t.id,tier:'mini'});}
  }
  override creditHit(b:Bullet,damage:number){const m=this.members.get(b.source??0);if(m){m.damage+=damage;this.inPlayer(m,()=>this.addCharge(1));}}
  override killEnemy(e:Enemy,owner:'roma'|'lev'='roma',source?:number){
    if(!this.enemies.includes(e))return;const m=this.members.get(source??this.player.id);
    if(m)this.inPlayer(m,()=>{super.killEnemy(e,owner,source);m.kills++;if(m.tank.hp<=0)this.streak=0;m.bestStreak=Math.max(m.bestStreak,this.streak);});
    else super.killEnemy(e,owner,source);
  }
  override updateCapture(dt:number){
    const point=this.capture;if(!point)return;
    const m=[...this.members.values()].find(m=>m.present&&m.tank.hp>0&&Math.hypot(m.tank.x-point.x,m.tank.z-point.z)<B.capture.radius);
    if(m)this.inPlayer(m,()=>super.updateCapture(dt));
    else{point.status=this.enemies.some(e=>Math.hypot(e.x-point.x,e.z-point.z)<B.capture.radius+C.enemy[e.kind].radius)?'contested':'away';}
  }
  updateAll(dt:number,inputs:Map<number,Input>){
    if(this.phase==='dying'){super.update(dt,emptyInput());return;}if(this.phase!=='playing')return;
    this.tick++;this.elapsed+=dt;this.advanceSupport(dt);this.advanceLoot(dt);
    if(this.targetPlayers().length!==1)for(const t of this.lootParticipants())t.adrenaline=false;
    for(const m of this.members.values())if(m.present){
      m.shield=Math.max(0,m.shield-dt);
      if(m.tank.hp>0)this.inPlayer(m,()=>{this.updateControlled(dt,inputs.get(m.id)??{...emptyInput(),aim:{x:m.tank.x+Math.sin(m.tank.angle),z:m.tank.z+Math.cos(m.tank.angle)}});this.updatePickups(0);});
      else{m.dashCooldown=Math.max(0,m.dashCooldown-dt);if(m.deadWave<0)this.spawn(m,m.pendingSpawnHP??50);}
    }
    this.refreshLootRights();
    if(this.targetPlayers().length!==1)for(const t of this.lootParticipants())t.adrenaline=false;
    if(this.breakTime>0){this.updateBullets(dt);this.advanceBreak(dt);return;}
    for(const e of this.enemies)this.updateEnemy(e,dt);
    for(const e of this.enemies)for(const q of this.enemies)if(q.id<e.id){const d=Math.hypot(e.x-q.x,e.z-q.z);if(d<C.enemy[e.kind].radius+C.enemy[q.kind].radius)this.move(e,(e.x-q.x||.1)/Math.max(d,.1)*dt*2,(e.z-q.z)/Math.max(d,.1)*dt*2,C.enemy[e.kind].radius);}
    this.updateBullets(dt);this.updateHazards(dt);
    if(!this.targetPlayers().length){this.deaths.clear();this.phase='dying';this.stopSupport();this.deathTime=.8;return;}
    const alive=this.targetPlayers();
    if(alive.length===1&&this.lastStandWave!==this.wave&&[...this.deaths].some(id=>this.members.get(id)?.present)){
      this.lastStandWave=this.wave;alive[0].adrenaline=true;this.emit('lastStand',alive[0],undefined,undefined,{actorId:alive[0].id,callout:'lastStand'});
    }
    this.deaths.clear();
    this.updateCapture(dt);if(this.breakTime>0)return;
    for(const p of this.portals){p.remaining-=dt;if(p.remaining<=0)this.enemies.push(this.createEnemy(p.kind,p,p.id));}this.portals=this.portals.filter(p=>p.remaining>0);
    this.spawnTimer-=dt;if((this.capture||this.remainingToSpawn>0)&&this.spawnTimer<=0)this.spawnTimer=this.queueEnemy()?(this.capture?this.pacing().captureInterval:this.pacing().spawnInterval):.3;
    if(!this.capture&&this.remainingToSpawn===0&&!this.enemies.length&&!this.portals.length)this.finishWave();
    this.checkEmergency();
  }
  state():BattleState{return {phase:this.phase,wave:this.wave,score:this.score,elapsed:this.elapsed,breakTime:this.breakTime,remaining:this.remainingToSpawn,peak:this.peak,players:[...this.members.values()].filter(m=>m.present),enemies:this.enemies,bullets:this.bullets,portals:this.portals,hazards:this.hazards,deliveries:this.deliveries,repairZone:this.repairZone,emergencyReadyAt:this.emergencyReadyAt,lootBatch:this.lootBatch,pickups:this.pickups,obstacles:this.obstacles,capture:this.capture};}
}

interface CoopCheckpointData {
  members: Member[]; peak: number; roster: number[]; lastStandWave: number;
  deaths: number[]; tick: number; eventSequence: number;
}
export type CoopCheckpoint = ReturnType<CoopSimulation['exportCheckpoint']>;
