import test from 'node:test';
import assert from 'node:assert/strict';
import { CoopSimulation } from '../src/coop';
import { emptyInput } from '../src/simulation';
import { autopilot } from '../src/autopilot';
import { pack,unpack,Assembler,fragments } from '../src/net/codec';
import { HostSimulation } from '../src/net/host';
import type { HostAssignment, InputBatch } from '../src/protocol';
const equal=(a:unknown,b:unknown)=>assert.deepEqual(unpack(pack(a)),unpack(pack(b)));
function battle(){const s=new CoopSimulation(127);for(let i=1;i<=4;i++)s.addMember(-i,`P${i}`,i);s.start(false);return s;}
for(const scenario of ['playing','boss-death','pickup','module-pickup','wave-end','player-death'] as const)test(`complete checkpoint: ${scenario}, binary roundtrip and identical continuation`,()=>{
  const s=battle();for(let i=0;i<120;i++)s.updateAll(1/60,new Map([...s.members].map(([id,m])=>[id,s.inPlayer(m,()=>autopilot(s))])));
  const m=s.members.get(-1)!;
  if(scenario==='boss-death'){const e=s.createEnemy('drill',{x:0,z:-4});s.enemies.push(e);s.killEnemy(e);}
  if(scenario==='pickup'){m.tank.hp=50;s.pickups=[{id:900,x:m.tank.x,z:m.tank.z,kind:'heal',life:12}];s.inPlayer(m,()=>s.updatePickups(0));}
  if(scenario==='module-pickup'){s.lootBatch={id:901,eligible:[m.id],claimed:[]};s.pickups=[{id:902,x:m.tank.x,z:m.tank.z,kind:'module',module:'armor',batchId:901,life:100}];s.inPlayer(m,()=>s.updatePickups(0));assert(m.tank.modules?.includes('armor'));}
  if(scenario==='wave-end')s.finishWave();
  if(scenario==='player-death'){m.shield=0;s.damageTank(m.tank,1000);}
  s.drainEvents();const cp=s.exportCheckpoint(),restored=new CoopSimulation();restored.importCheckpoint(unpack(pack(cp)));equal(restored.exportCheckpoint(),cp);
  for(let tick=0;tick<360;tick++){
    const inputs=new Map([...s.members].map(([id,m])=>[id,s.inPlayer(m,()=>autopilot(s))]));const copy=structuredClone(inputs);s.updateAll(1/60,inputs);restored.updateAll(1/60,copy);equal(s.drainEvents(),restored.drainEvents());
    if(tick%30===0)equal(s.exportCheckpoint(),restored.exportCheckpoint());
  }
  assert(s.obstacles.some(o=>o.hp===Infinity),'indestructible cover remains infinite');
  const before=cp.core.score;s.score+=100;assert.equal(cp.core.score,before,'checkpoint does not alias live state');
});
test('fragment assembly accepts reordering, rejects incomplete, expired and oversized data',()=>{
  const bytes=pack({values:Array.from({length:20000},(_,i)=>i)}),parts=fragments(bytes,42),a=new Assembler();let value:Uint8Array|undefined;
  for(const p of [...parts].reverse())value=a.receive(p,10)??value;assert.deepEqual(value,bytes);
  const b=new Assembler();b.receive(parts[0],0);assert.equal(b.receive(parts.at(-1)!,1000),undefined);
  assert.throws(()=>pack(new Uint8Array(2_000_000)));
});
const assignment:HostAssignment={matchId:'m',round:1,hostEpoch:1,host:-1,nonce:'n',checkpoint:null,players:[{id:-1,name:'A',skin:0,connected:true,foreground:true,present:true}]};
test('host acknowledges applied commands, deduplicates actions across routes and rejects old authority',()=>{
  const h=new HostSimulation();h.load(assignment);h.sim.obstacles=[];h.sim.enemies=[];h.sim.spawnTimer=999;
  const frame={matchId:'m',round:1,hostEpoch:1,playerId:-1,seq:1,controlEpoch:0,input:{...emptyInput(),x:1,dash:true}};
  const batch:InputBatch={...frame,kind:'input',frames:[frame]};
  assert(h.accept(batch,-1,0));assert.equal(h.ack[-1],undefined);assert(h.accept(batch,-1,0));h.step(10);assert.equal(h.ack[-1],1);
  assert.equal(h.snapshot().events.filter(e=>e.type==='dash').length,1);
  assert.equal(h.accept({...batch,hostEpoch:0},-1,20),false);assert.equal(h.accept(batch,-2,20),false);
  const restored=new HostSimulation();restored.load({...assignment,checkpoint:unpack(pack(h.checkpoint()))});restored.accept(batch,-1,25);restored.step(30);assert.equal(restored.snapshot().events.filter(e=>e.type==='dash').length,0);
});

test('command replay cannot mutate an earlier neutral command or reuse evicted action identifiers',()=>{
 const h=new HostSimulation();h.load(assignment);h.sim.obstacles=[];h.sim.enemies=[];h.sim.spawnTimer=9999;
 const packet=(seq:number,power=false)=>({...h.context,kind:'input' as const,frames:[{...h.context,playerId:-1,seq,controlEpoch:0,input:{...emptyInput(),power}}]});
 h.sim.members.get(-1)!.charge=67;h.accept(packet(1),-1,0);h.accept(packet(1,true),-1,0);h.step(1);assert.equal(h.sim.members.get(-1)!.powerTime,0);
 for(let i=2;i<200;i++){h.accept(packet(i),-1,i);h.step(i);}h.accept(packet(1,true),-1,201);h.step(202);assert.equal(h.sim.members.get(-1)!.powerTime,0);
});

test('late reliable actions expire against newer input instead of firing long after a route switch',()=>{
 const h=new HostSimulation();h.load(assignment);h.sim.obstacles=[];h.sim.enemies=[];h.sim.spawnTimer=9999;const m=h.sim.members.get(-1)!;m.charge=67;
 const packet=(seq:number,power=false)=>({...h.context,kind:'input' as const,frames:[{...h.context,playerId:-1,seq,controlEpoch:0,input:{...emptyInput(),power}}]});
 h.accept(packet(30),-1,1000);h.step(1000);h.accept(packet(1,true),-1,1010);h.step(1020);assert.equal(m.powerTime,0,'expired action is discarded');
 h.accept(packet(29,true),-1,1030);h.step(1040);assert(m.powerTime>0,'recent reordered one-shot still applies once');
});
