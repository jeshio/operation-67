import { CoopSimulation } from '../coop';
import { emptyInput, type Input } from '../simulation';
import { matches, validBatch, type BattleCheckpoint, type Envelope, type HostAssignment, type InputBatch, type InputFrame, type Participant, type WorldSnapshot } from '../protocol';
import { NET } from './config';

interface Driver {
  last:Input; at:number; received:number; controlEpoch:number; floor:number; commands:Set<number>; queue:{frame:InputFrame;at:number}[];
  actions:Map<number,{input:Input;at:number}>; seen:Set<number>;
}
export class HostSimulation {
  readonly sim=new CoopSimulation();
  context:Envelope={matchId:'',round:0,hostEpoch:0};
  tick=0; ack:Record<string,number>={}; private drivers=new Map<number,Driver>();
  private events:WorldSnapshot['events']=[];
  load(assignment:HostAssignment) {
    this.context={matchId:assignment.matchId,round:assignment.round,hostEpoch:assignment.hostEpoch};
    const cp=assignment.checkpoint;
    if(cp)this.sim.importCheckpoint(cp.simulation);
    this.tick=cp?.tick??0;this.ack=cp&&matches(cp,this.context)?{...cp.ack}:{};this.drivers.clear();this.events=[];
    this.syncMembers(assignment.players);
    if(assignment.round>0&&cp?.round!==assignment.round){this.sim.start(false);this.tick=0;this.ack={};}
    this.sim.drainEvents();
    if(cp&&matches(cp,this.context))for(const [id,seen] of Object.entries(cp.actions??{}))this.driver(Number(id)).seen=new Set(seen);
  }
  syncMembers(players:Participant[]) {
    const present=new Map(players.filter(p=>p.present).map(p=>[p.id,p]));
    for(const m of this.sim.members.values())if(!present.has(m.id)){m.present=false;m.connected=false;this.drivers.delete(m.id);}
    for(const p of present.values()){
      let m=this.sim.members.get(p.id);
      if(!m?.present)m=this.sim.addMember(p.id,p.name,p.skin);
      m.name=p.name;m.skin=p.skin;m.tank.displayName=p.name;m.tank.skin=p.skin;m.connected=p.connected;
      if(!p.connected||!p.foreground)this.drivers.delete(p.id);
    }
  }
  private driver(id:number):Driver {
    let d=this.drivers.get(id);if(!d){d={last:emptyInput(),at:-Infinity,received:this.ack[id]??-1,controlEpoch:this.sim.members.get(id)?.tank.controlEpoch??0,floor:this.ack[id]??-1,commands:new Set(),queue:[],actions:new Map(),seen:new Set()};this.drivers.set(id,d);}return d;
  }
  accept(batch:InputBatch,sender:number,now:number) {
    if(!validBatch(batch,sender,this.context))return false;
    const member=this.sim.members.get(sender);if(!member?.present||!member.connected)return false;
    let d=this.driver(sender);if(d.controlEpoch!==(member.tank.controlEpoch??0)){this.drivers.delete(sender);d=this.driver(sender);}
    for(const f of batch.frames){
      if(f.controlEpoch!==(member.tank.controlEpoch??0)||f.seq>d.received+600||f.seq<=d.floor||f.seq<d.received-128||d.commands.has(f.seq))continue;
      d.commands.add(f.seq);while(d.commands.size>128)d.commands.delete(d.commands.values().next().value!);
      // A reliable action can arrive after newer fast frames; reject it once the input timeline has moved on.
      const recent=f.seq>=d.received-Math.ceil(NET.inputExpiryMs*NET.tickRate/1000);
      if(recent&&(f.input.firePressed||f.input.power||f.input.dash)&&!d.seen.has(f.seq)&&!d.actions.has(f.seq)){
        if(d.actions.size<30)d.actions.set(f.seq,{input:{...f.input},at:now});
      }
      if(f.seq<=d.received)continue;d.received=f.seq;
      if(!f.input.x&&!f.input.z&&!f.input.fire&&!f.input.firePressed&&!f.input.dash&&!f.input.power)d.queue=[];
      d.queue.push({frame:{...f,input:{...f.input,firePressed:false,power:false,dash:false}},at:now});
      if(d.queue.length>NET.queueFrames)d.queue.splice(0,d.queue.length-NET.queueFrames);
    }
    return true;
  }
  step(now:number) {
    const inputs=new Map<number,Input>(),epochs=new Map<number,number>();
    for(const m of this.sim.members.values()){
      epochs.set(m.id,m.tank.controlEpoch??0);let d=this.drivers.get(m.id);if(d&&d.controlEpoch!==(m.tank.controlEpoch??0)){this.drivers.delete(m.id);d=undefined;}if(!d||!m.connected||!m.present)continue;
      while(d.queue.length&&now-d.queue[0].at>NET.inputExpiryMs)d.queue.shift();
      // Bound catch-up: a late burst never grants extra simulation steps.
      if(d.queue.length>6)d.queue.splice(0,d.queue.length-6);
      const next=d.queue.shift();
      if(next){d.last=next.frame.input;d.at=now;this.ack[m.id]=next.frame.seq;}
      const input=now-d.at<NET.inputExpiryMs?{...d.last}:{...emptyInput(),aim:{x:m.tank.x+Math.sin(m.tank.angle),z:m.tank.z+Math.cos(m.tank.angle)}};
      for(const [seq,action] of d.actions){
        if(now-action.at<=NET.inputExpiryMs&&seq>(this.ack[m.id]??-1))continue;
        d.actions.delete(seq);d.seen.add(seq);
        if(now-action.at<=NET.inputExpiryMs){if(action.input.firePressed)input.shotId=action.input.shotId;input.firePressed ||= action.input.firePressed;input.power ||= action.input.power;input.dash ||= action.input.dash;}
      }
      while(d.seen.size>128)d.seen.delete(d.seen.values().next().value!);
      inputs.set(m.id,input);
    }
    this.sim.updateAll(1/NET.tickRate,inputs);this.tick++;
    for(const m of this.sim.members.values())if(epochs.get(m.id)!==(m.tank.controlEpoch??0))this.drivers.delete(m.id);
    this.events.push(...this.sim.drainEvents());if(this.events.length>NET.maxEvents)this.events.splice(0,this.events.length-NET.maxEvents);
  }
  snapshot():WorldSnapshot {
    return structuredClone({...this.context,kind:'snapshot',tick:this.tick,state:this.sim.state(),ack:this.ack,events:this.events.splice(0),eventCursor:this.sim.eventCursor});
  }
  checkpoint():BattleCheckpoint {
    return {...this.context,version:1,tick:this.tick,simulation:this.sim.exportCheckpoint(),ack:{...this.ack},eventCursor:this.sim.eventCursor,actions:Object.fromEntries([...this.drivers].map(([id,d])=>[id,[...d.seen]]))};
  }
}
export { validCheckpoint } from './validation';
