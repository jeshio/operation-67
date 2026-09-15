import { CoopSimulation, type BattleState, type Member } from '../coop';
import type { Bullet, GameEvent } from '../simulation';
import type { InputFrame } from '../protocol';
import { NET } from './config';
/** Prediction uses the exact controlled-player step used by the authoritative host. */
export class ClientPrediction {
  private sim=new CoopSimulation();private pending:{frame:InputFrame;at:number}[]=[];
  private ghosts=new Map<string,{bullet:Bullet;at:number;seq:number}>();
  private heard=new Set<string>();private id=0;
  member?:Member;events:GameEvent[]=[];
  reset(){this.sim=new CoopSimulation();this.pending=[];this.ghosts.clear();this.heard.clear();this.events=[];this.member=undefined;}
  reconcile(state:BattleState,id:number,ack:number,now:number){
    this.id=id;const data=structuredClone(state);
    Object.assign(this.sim,{phase:data.phase,wave:data.wave,elapsed:data.elapsed,obstacles:data.obstacles,enemies:data.enemies,bullets:[],hazards:data.hazards});
    this.sim.members=new Map(data.players.map(p=>[p.id,p]));this.member=this.sim.members.get(id);
    for(const b of state.bullets)if(b.predictionId)this.ghosts.delete(b.predictionId);
    for(const [key,g] of this.ghosts)if(g.seq<=ack||now-g.at>NET.predictionMs)this.ghosts.delete(key);
    this.pending=this.pending.filter(p=>p.frame.seq>ack&&now-p.at<=NET.predictionMs);
    for(const p of this.pending)this.advance(p.frame,p.at,true);
  }
  step(frame:InputFrame,now:number){
    this.pending.push({frame,at:now});this.pending=this.pending.filter(p=>now-p.at<=NET.predictionMs).slice(-NET.queueFrames);
    this.advance(frame,now,false);
  }
  private advance(frame:InputFrame,now:number,replay:boolean){
    const m=this.member;if(!m||m.tank.hp<=0||this.sim.phase!=='playing')return;
    this.sim.bullets=[];this.sim.events=[];
    this.sim.inPlayer(m,()=>this.sim.updateControlled(1/NET.tickRate,frame.input));
    if(!replay){
      for(const b of this.sim.bullets)if(b.predictionId)this.ghosts.set(b.predictionId,{bullet:{...b,id:-100_000_000-frame.seq*4-(b.barrel??0)},at:now,seq:frame.seq});
      for(const e of this.sim.drainEvents())if(e.type==='shot'&&e.shotId&&!this.heard.has(e.shotId)){this.heard.add(e.shotId);this.events.push({...e,actorId:this.id});}
    }
    while(this.heard.size>512)this.heard.delete(this.heard.values().next().value!);
  }
  suppress(event:GameEvent){return event.type==='shot'&&!!event.shotId&&this.heard.has(event.shotId);}
  bullets(now:number){
    const out:Bullet[]=[];
    for(const [key,g] of this.ghosts){const dt=(now-g.at)/1000;if(dt>NET.predictionMs/1000){this.ghosts.delete(key);continue;}
      const b=g.bullet,x=b.x+b.vx*dt,z=b.z+b.vz*dt;
      if(this.sim.lineOfSight(b,{x,z},.08))out.push({...b,x,z});
    }return out;
  }
}
