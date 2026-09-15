import { HostSimulation } from './host';
import { NET } from './config';
import type { HostAssignment, InputBatch, Participant } from '../protocol';
import { resetCapacityWorkload, maintainCapacityWorkload, type CapacityWorkload } from '../qa-capacity-workload';
export type HostCommand =
  | {type:'qa';action:'end-round'}
  | {type:'qa';action:'capacity-workload';workload:CapacityWorkload;reset:boolean}
  | {type:'load'; assignment:HostAssignment}
  | {type:'lease'; until:number}
  | {type:'members'; players:Participant[]}
  | {type:'input'; batch:InputBatch; sender:number}
  | {type:'stop'; checkpoint:boolean}
  | {type:'benchmark'; assignment:HostAssignment};
export class HostRunner {
  engine=new HostSimulation(); private timer?:ReturnType<typeof setInterval>;private lease=0;private previous=0;private accumulator=0;
  private checkpointAt=0;private steps:number[]=[];private phase='';
  private capacityWorkload?:CapacityWorkload;
  private capacitySteps:number[]=[];
  constructor(private send:(message:any)=>void,private now=()=>performance.timeOrigin+performance.now()){}
  receive(m:HostCommand) {
    if(import.meta.env?.DEV&&m.type==='qa'){
      if(m.action==='end-round'){for(const p of this.engine.sim.members.values()){p.shield=0;this.engine.sim.damageTank(p.tank,10000);}}
      else if(m.action==='capacity-workload'){this.capacityWorkload=m.workload;if(m.reset)resetCapacityWorkload(this.engine.sim,m.workload);}
    }
    else if(m.type==='load'){
      this.stop();this.engine=new HostSimulation();this.engine.load(m.assignment);
      if(import.meta.env?.DEV&&m.assignment.checkpoint?.round===m.assignment.round){
        const cp=m.assignment.checkpoint,sim=this.engine.sim;
        const players=[...sim.members.values()].filter(p=>p.present);
        this.send({type:'capacity-restore-proof',proof:{hostEpoch:m.assignment.hostEpoch,checkpointTick:cp.tick,
          scoreMatches:sim.score===cp.simulation.core.score,eventCursorMatches:sim.eventCursor===cp.eventCursor,
          rosterMatches:players.length===m.assignment.players.filter(p=>p.present).length&&new Set(players.map(p=>p.id)).size===players.length,
          rewardsMatch:players.every(p=>p.kills===(cp.simulation.coop.members.find(member=>member.id===p.id)?.kills??0))}});
      }
      this.send({type:'ready',nonce:m.assignment.nonce,context:this.engine.context});
    }
    else if(m.type==='lease'){this.lease=m.until;if(!this.timer){this.previous=this.now();this.accumulator=0;this.checkpointAt=this.previous;this.timer=setInterval(()=>this.advance(),8);}}
    else if(m.type==='members')this.engine.syncMembers(m.players);
    else if(m.type==='input')this.engine.accept(m.batch,m.sender,this.now());
    else if(m.type==='stop'){this.stop();if(m.checkpoint)this.send({type:'stopped',checkpoint:this.engine.checkpoint(),snapshot:this.engine.snapshot()});}
    else if(m.type==='benchmark'){
      if(this.timer)return;const test=new HostSimulation();test.load(m.assignment);const times=[];
      for(let i=0;i<12;i++){const t=this.now();test.step(t);times.push(this.now()-t);}
      times.sort((a,b)=>a-b);this.send({type:'benchmark',stepP95:times.at(-1)});
    }
  }
  private advance(){
    const now=this.now();if(now>=this.lease){this.stop();this.send({type:'expired'});return;}
    this.accumulator+=Math.min(.1,(now-this.previous)/1000);this.previous=now;
    while(this.accumulator>=1/NET.tickRate){const t=this.now();if(import.meta.env?.DEV&&this.capacityWorkload)maintainCapacityWorkload(this.engine.sim,this.capacityWorkload);this.engine.step(t);const stepMs=this.now()-t;this.steps.push(stepMs);if(import.meta.env?.DEV)this.capacitySteps.push(stepMs);if(this.steps.length>300)this.steps.shift();this.accumulator-=1/NET.tickRate;
      if(this.engine.tick%3===0)this.send({type:'snapshot',snapshot:this.engine.snapshot()});
    }
    if(now-this.checkpointAt>=NET.checkpointMs||this.phase!==this.engine.sim.phase){this.checkpointAt=now;this.phase=this.engine.sim.phase;this.send({type:'checkpoint',checkpoint:this.engine.checkpoint(),stepP95:[...this.steps].sort((a,b)=>a-b)[Math.floor(this.steps.length*.95)]??0,...(import.meta.env?.DEV?{capacitySteps:this.capacitySteps.splice(0)}:{})});}
  }
  stop(){clearInterval(this.timer);this.timer=undefined;this.lease=0;}
}
// The same runner is injectable in Node tests; real browsers always use an isolated Worker.
if(typeof self!=='undefined'&&typeof document==='undefined'){
  const runner=new HostRunner(message=>self.postMessage(message));self.onmessage=e=>runner.receive(e.data);
}
