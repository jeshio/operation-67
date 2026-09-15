import test from 'node:test';
import assert from 'node:assert/strict';
import { CoopSimulation } from '../src/coop.ts';
import { emptyInput } from '../src/simulation.ts';
import { autopilot } from '../src/autopilot.ts';
const battle=(n=2)=>{const s=new CoopSimulation();for(let i=1;i<=n;i++)s.addMember(-i,`Игрок ${i}`,i%6);s.start(false);s.spawnTimer=999;s.portals=[];s.enemies=[];s.obstacles=[];return s;};
test('coop: death waits for wave completion, returns at 50 with no power; total defeat ends the round',()=>{
  const s=battle(),m=s.members.get(-1)!;m.shield=0;m.charge=60;m.streak=15;m.rapidTime=6;s.damageTank(m.tank,100);
  assert.equal(m.tank.hp,0);assert.equal(s.phase,'playing');assert.equal(m.charge,0);assert.equal(m.streak,0);
  s.addMember(-1,'Changed',0);assert.equal(m.tank.hp,0);s.finishWave();assert.equal(m.tank.hp,50);assert.equal(m.rapidTime,0);assert.equal(m.shield,2);
  s.beginWave();for(const p of s.members.values()){p.shield=0;s.damageTank(p.tank,1000);}s.updateAll(1/60,new Map());assert.equal(s.phase,'dying');s.updateAll(1,new Map());assert.equal(s.phase,'over');
});
test('coop: last hit owns kill, charge and named achievement; team score only once',()=>{
  const s=battle(),a=s.members.get(-1)!,b=s.members.get(-2)!;a.streak=6;
  const e=s.createEnemy('light',{x:0,z:0});s.enemies.push(e);
  s.creditHit({source:b.id,owner:'roma'} as any,10);s.killEnemy(e,'roma',a.id);s.killEnemy(e,'roma',a.id);
  assert.equal(s.score,100);assert.equal(a.kills,1);assert.equal(b.kills,0);assert.equal(a.charge,10);assert.equal(b.charge,1);assert.equal(b.damage,10);assert.equal(a.bestStreak,7);
  assert.ok(s.events.some(e=>e.callout==='steel'&&e.actorId===a.id));
});
test('coop: a hazard hits each player once, protected player does not consume others damage',()=>{
  const s=battle(3),players=[...s.members.values()];players.forEach(m=>{Object.assign(m.tank,{x:0,z:0});m.shield=0;});players[0].shield=2;
  const e=s.createEnemy('mortar',{x:0,z:-4});s.addHazard(e,{x:0,z:0},2,0,20);
  for(let i=0;i<10;i++)s.updateHazards(1/60);
  assert.deepEqual(players.map(p=>p.tank.hp),[100,80,80]);assert.equal(s.events.filter(e=>e.type==='hit').length,2);
});
test('coop: late join scales remaining health fraction and count; leaving does not lower difficulty',()=>{
  const s=battle(1),e=s.createEnemy('drill',{x:10,z:10});s.enemies.push(e);e.hp=e.maxHp*.25;const old=e.maxHp;
  s.addMember(-2,'Лев',1);assert.equal(s.peak,2);assert.equal(e.maxHp,old*1.65);assert.ok(Math.abs(e.hp/e.maxHp-.25)<1e-8);assert.equal(s.remainingToSpawn,3);
  s.members.get(-2)!.present=false;assert.equal(s.peak,2);s.beginWave();assert.equal(s.peak,1);
});
test('coop: anyone can capture, additional players do not accelerate it; pickup only once',()=>{
  const s=battle();s.wave=1;s.beginWave();s.enemies=[];const p=s.members.get(-2)!;Object.assign(p.tank,s.capture);s.updateCapture(1);assert.equal(s.capture!.progress,1);
  Object.assign(s.members.get(-1)!.tank,{x:p.tank.x,z:p.tank.z});s.updateCapture(1);assert.equal(s.capture!.progress,2);
  p.tank.hp=50;s.pickups=[{id:999,x:p.tank.x,z:p.tank.z,kind:'heal',life:12}];s.inPlayer(p,()=>s.updatePickups(0));assert.equal(p.tank.hp,70);assert.equal(s.pickups.length,0);
});
for(const count of [2,4])test(`coop endurance: ${count} players through 45 waves, bounded objects and five clean restarts`,()=>{
  const s=new CoopSimulation();for(let i=1;i<=count;i++)s.addMember(-i,`Игрок${i}`,i);s.start(false);let steps=0;
  while(s.wave<46&&steps++<60*5000){const inputs=new Map();for(const p of s.members.values()){p.tank.hp=10000;inputs.set(p.id,s.inPlayer(p,()=>autopilot(s)));}s.updateAll(1/60,inputs);s.drainEvents();assert.ok(s.enemies.length+s.portals.length<=12);assert.ok(s.bullets.length<=160);assert.ok(s.hazards.length<=36);assert.ok(s.pickups.length<=16);}
  assert.equal(s.wave,46);console.log(`${count} players: 45 waves in ${Math.round(s.elapsed)} game seconds`);
  for(let i=0;i<5;i++){s.start(false);assert.equal(s.wave,1);assert.equal(s.score,0);assert.equal(s.enemies.length,0);for(const p of s.members.values()){assert.equal(p.tank.hp,100);assert.equal(p.charge,0);assert.equal(p.kills,0);}}
});
