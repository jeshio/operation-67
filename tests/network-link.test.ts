import test from 'node:test';
import assert from 'node:assert/strict';
import { multiplayer } from './helpers/multiplayer';
import { emptyInput } from '../src/simulation';
import { BattleRecords } from '../src/records';
import { GameStorage } from '../src/storage';
const driving=()=>({...emptyInput(),x:.8,fire:true,aim:{x:0,z:-10}});
for(const fps of [30,60,120])test(`${fps} fps, 120 ms each way: two drivers, five rounds and acknowledged input`,async()=>{
 const f=await multiplayer({lag:120,fps});try{
  for(let round=0;round<5;round++){
   await f.start();assert.equal(f.host().sim.phase,'playing');const before=[...f.host().sim.members.values()].map(m=>({x:m.tank.x,fired:m.fired}));
   f.run(.8,driving);for(const [i,m] of [...f.host().sim.members.values()].entries()){assert(m.tank.x>before[i].x+1);assert(m.fired>before[i].fired);}
   assert(f.clients.every(g=>!g.error));assert(Math.abs(f.clients[0].view.player.x-f.host().sim.members.get(-1)!.tank.x)<2);
   f.host().sim.members.forEach(m=>{m.shield=0;f.host().sim.damageTank(m.tank,1000);});f.run(1.4);assert.equal(f.host().sim.phase,'over');
  }
 }finally{f.cleanup();}
});
test('crashed host: bounded pause, latest checkpoint, epoch reset and no duplicate tanks',async()=>{
 const f=await multiplayer({lag:75,count:4});try{
  await f.start();f.run(1,driving);const old=f.coordinator.info.host,epoch=f.coordinator.info.hostEpoch,cp=f.coordinator.checkpoints.at(-1)!;
  assert(f.host().tick-cp.tick<=30,'confirmed rollback is at most half a second at 150 ms RTT');
  const at=f.now(),oldRunner=f.runners[f.clients.findIndex(g=>g.id===old)];oldRunner.stop();f.links.find(l=>l.id===old)!.close();
  await f.settle(2.8);assert.notEqual(f.coordinator.info.host,old);assert(f.coordinator.info.hostEpoch>epoch);assert.equal(f.coordinator.info.stage,'running');assert(f.now()-at<=3000);
  assert.equal(f.host().sim.members.size,4);assert(f.host().tick>=cp.tick);assert(f.coordinator.checkpointAt>at);
  f.run(.7,driving);for(const g of f.clients.filter(g=>g.connected)){assert((g.diagnostics().ack??-1)>0,'new generation accepts new command sequence');}
  assert(!f.coordinator.checkpoint(old,cp));
 }finally{f.cleanup();}
});
test('background transfers host, returning host resumes as player with manual controls',async()=>{
 const f=await multiplayer();try{
  await f.start();const old=f.clients.find(g=>g.id===f.coordinator.info.host)!;old.sleep();await f.settle(.7);
  assert.notEqual(f.coordinator.info.host,old.id);assert.equal(f.coordinator.info.stage,'running');old.wake();await f.settle(.5);assert(old.needsResume);assert(!old.recovering);
  const m=f.host().sim.members.get(old.id)!,x=m.tank.x;f.run(.5,driving);assert.equal(m.tank.x,x);old.continue();f.run(.5,driving);assert(m.tank.x>x+1);
 }finally{f.cleanup();}
});
test('invalid aim is sanitized, held controls paced at 30 Hz and release cancels transient actions',async()=>{
 const f=await multiplayer();try{
  await f.start();const link=f.links[1],before=link.sent.length,m=f.host().sim.members.get(-2)!,x=m.tank.x;
  f.run(1,()=>({...driving(),aim:{x:NaN,z:Infinity}}));assert(m.tank.x>x+3);assert(m.fired>0);
  const input=link.sent.slice(before).filter(m=>m.type==='relay'&&m.data.bytes);assert(input.length>=28&&input.length<=32);
  f.clients[1].releaseInput();const release=m.tank.x;f.run(.4);assert(Math.abs(m.tank.x-release)<.15);
 }finally{f.cleanup();}
});
test('former-life commands, stale host frames and historical effects cannot cross recovery',async()=>{
 const f=await multiplayer();try{
  await f.start();const h=f.host(),m=h.sim.members.get(-1)!,stale=h.snapshot();f.run(.4,driving);
  m.shield=0;h.sim.damageTank(m.tank,1000);h.sim.finishWave();f.run(.4);const x=m.tank.x;f.run(.5);assert.equal(m.tank.x,x);
  const g=f.clients[0];g.events=[];(g as any).applySnapshot({...stale,tick:1e9,hostEpoch:stale.hostEpoch-1,events:[{type:'explode',x:0,z:0,eventId:1e9}]});assert(!g.events.length);
  g.sleep();f.run(.2);g.wake();await f.settle(.6);assert(g.events.length===0);assert(g.needsResume);
 }finally{f.cleanup();}
});
test('records are committed from coordinator checkpoints, never unconfirmed snapshots',async()=>{
 const f=await multiplayer();const records=new BattleRecords(new GameStorage(null));try{
  const g=f.clients[1];g.onCommit=c=>records.observe({score:c.state.score,wave:c.state.wave,time:c.state.elapsed,battleId:`${c.matchId}:${c.round}`,team:c.names},c.state.phase);
  await f.start();const h=f.host();h.sim.score=650;f.snapshot();assert.equal(records.storage.record.score,0);f.run(.4);assert.equal(records.storage.record.score,650);
  const committed=f.coordinator.checkpoints.at(-1)!;h.sim.score=99999;f.snapshot();assert.equal(records.storage.record.score,650);
  h.sim.score=committed.simulation.core.score;f.run(.4);assert.equal(records.storage.record.score,650);
 }finally{f.cleanup();}
});
test('modules, adrenaline and knockback use the shared predicted movement calculation',async()=>{
 const f=await multiplayer({lag:120});try{
  await f.start();const s=f.host().sim,m=s.members.get(-1)!,ally=s.members.get(-2)!;
  m.tank.modules=['tracks','turbo','armor'];m.tank.maxHp=130;m.tank.hp=125;ally.shield=0;s.damageTank(ally.tank,1000);f.run(.4);assert(m.tank.adrenaline);
  const x=m.tank.x;f.run(.6,driving);assert(m.tank.x>x+3);assert(Math.abs(f.clients[0].view.player.x-m.tank.x)<2);
  m.tank.knockback={x:-30,z:6,remaining:.3,source:999};f.run(.6);assert(!m.tank.knockback);assert(Math.abs(f.clients[0].view.player.x-m.tank.x)<2);
 }finally{f.cleanup();}
});
test('one-way uplink loss and blocked send queue close a stalled connection',async()=>{
 for(const kind of ['one-way','backpressure']){const f=await multiplayer();try{
  await f.start();if(kind==='one-way')f.links[1].up=false;else f.links[1].connection.transport.ws.bufferedAmount=300000;
  f.run(3.8,driving);assert(!f.links[1].open);assert(f.clients[1].recovering);assert(f.clients[0].connected);
 }finally{f.cleanup();}}
});

test('coordinator loss stops the host at lease expiry and rejects remaining direct frames',async()=>{
 const f=await multiplayer();try{
  await f.start();const reasons:string[]=[];f.clients.forEach(g=>g.onLeave=reason=>reasons.push(reason??''));
  const host=f.host(),snapshot=host.snapshot(),at=host.tick;f.links.forEach(l=>{l.up=false;l.down=false;});f.run(2);
  assert(host.tick-at<=90,'simulation cannot continue beyond the 1.5 second lease');
  const g=f.clients.find(g=>g.id!==f.coordinator.info.host)!,tick=g.diagnostics().tick;
  (g as any).packet(snapshot.state.players[0].id,{...snapshot,tick:tick+999});assert.equal(g.diagnostics().tick,tick);assert(g.recovering);
  f.run(31);assert(reasons.some(r=>r.includes('Не удалось восстановить бой')));
 }finally{f.cleanup();}
});
