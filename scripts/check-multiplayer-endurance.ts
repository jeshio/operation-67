import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { HostSimulation } from '../src/net/host';
import { pack,unpack } from '../src/net/codec';
import { validCheckpoint } from '../src/net/validation';
import { autopilot } from '../src/autopilot';
import { p95 } from '../src/net/mesh';
import type { BattleCheckpoint, Participant } from '../src/protocol';
const players:Participant[]=Array.from({length:4},(_,i)=>({id:-i-1,name:`Endurance ${i}`,skin:i,connected:true,foreground:true,present:true}));
let host=new HostSimulation(),epoch=1,seq=0,steps=0,previousWave=0,maxBytes=0,copies=0,stepTimes:number[]=[],copyTimes:number[]=[];
host.load({matchId:'endurance',round:1,hostEpoch:epoch,host:-1,players,checkpoint:null,nonce:'start'});
const waves:unknown[]=[];const start=performance.now();let retained:BattleCheckpoint[]=[];
while(host.sim.wave<46&&steps++<60*6000){
 const now=steps*1000/60;seq++;
 for(const m of host.sim.members.values()){
  // Invulnerability permits deterministic progression; movement, AI, weapons, loot and waves stay real.
  m.tank.hp=10000;const input=host.sim.inPlayer(m,()=>autopilot(host.sim));
  host.accept({...host.context,kind:'input',frames:[{...host.context,playerId:m.id,seq,controlEpoch:m.tank.controlEpoch??0,input}]},m.id,now);
 }
 const before=performance.now();host.step(now);stepTimes.push(performance.now()-before);if(host.tick%3===0)host.snapshot();
 if(steps%15===0){const t=performance.now(),bytes=pack(host.checkpoint()),cp=unpack<BattleCheckpoint>(bytes);assert(validCheckpoint(cp,host.context));retained.push(cp);if(retained.length>2)retained.shift();copies++;maxBytes=Math.max(maxBytes,bytes.length);copyTimes.push(performance.now()-t);}
 if(host.sim.wave!==previousWave){
  global.gc?.();waves.push({wave:host.sim.wave,elapsed:host.sim.elapsed,stepP95Ms:p95(stepTimes),copyP95Ms:p95(copyTimes),heapBytes:process.memoryUsage().heapUsed,rssBytes:process.memoryUsage().rss});stepTimes=[];copyTimes=[];
  const cp=unpack<BattleCheckpoint>(pack(host.checkpoint())),replacement=new HostSimulation();replacement.load({...host.context,hostEpoch:++epoch,host:-2,checkpoint:cp,nonce:String(epoch),players});
  assert.deepEqual(pack(replacement.sim.exportCheckpoint()),pack(host.sim.exportCheckpoint()));host=replacement;seq=0;previousWave=host.sim.wave;
 }
 assert(host.sim.enemies.length+host.sim.portals.length<=12);assert(host.sim.bullets.length<=160);assert(host.sim.hazards.length<=36);assert(host.sim.pickups.length<=16);
}
assert.equal(host.sim.wave,46);assert(maxBytes<1048576);
const report={scenario:'4 invulnerable autopilot players; real host inputs, 250 ms binary checkpoints; restore on every wave',wavesCompleted:45,simulatedSeconds:host.sim.elapsed,wallSeconds:(performance.now()-start)/1000,steps,copies,maxCheckpointBytes:maxBytes,hostGenerations:epoch,waves};
await writeFile('test-artifacts/multiplayer/endurance-45.json',JSON.stringify(report,null,2));console.log(JSON.stringify({...report,waves:undefined}));
