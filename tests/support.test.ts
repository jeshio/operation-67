import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Simulation, emptyInput } from '../src/simulation';
import { CoopSimulation } from '../src/coop';
import { MODULES, tankStats, type ModuleId } from '../src/modules';
import { breakDuration, damageStage, deliveryStage } from '../src/support';
import { SupportView } from '../src/support-view';
import { TankCondition } from '../src/tank-condition';
import { RoomService, type Peer } from '../server/rooms';
import { PROTOCOL } from '../src/protocol';
const team=(n=2)=>{const s=new CoopSimulation();for(let i=1;i<=n;i++)s.addMember(-i,`Игрок ${i}`,i%6);s.start(false);s.obstacles=[];s.spawnTimer=99999;s.remainingToSpawn=1;for(const m of s.members.values())m.shield=0;return s;};
const step=(s:CoopSimulation,seconds:number)=>{for(let i=0;i<Math.round(seconds*60);i++)s.updateAll(1/60,new Map());};
const advance=(s:Simulation,time:number)=>{s.elapsed=time;s.advanceSupport(1/60);};
test('all 45 waves choose breaks from completed composition; respawn occurs once at every break, preserving modules',()=>{
 for(let w=1;w<=45;w++){const s=team(),a=s.members.get(-1)!,b=s.members.get(-2)!;s.wave=w;a.tank.modules=['armor','repair'];a.tank.maxHp=130;s.damageTank(a.tank,500);assert.equal(a.tank.hp,0);b.tank.adrenaline=true;
  s.finishWave();assert.equal(s.breakTime,w%5===0?20:w%3===0?10:6);assert.equal(s.breakTime,breakDuration(w));assert.equal(a.tank.hp,50);assert.deepEqual(a.tank.modules,['armor','repair']);assert.equal(a.tank.lastDamageAt,s.elapsed);assert(!b.tank.adrenaline);
  a.tank.hp=62;s.finishWave();assert.equal(a.tank.hp,62);s.beginWave();assert.equal(a.tank.hp,62);
 }
});
test('boss warning is in final five seconds; break allows controls and no portals or hostile bullets',()=>{
 const s=team();s.wave=4;s.finishWave();s.drainEvents();step(s,.5);assert(!s.drainEvents().some(e=>e.text?.includes('босс')));step(s,.6);assert.equal(s.drainEvents().filter(e=>e.text?.includes('босс')).length,1);
 const m=s.members.get(-1)!,x=m.tank.x;s.updateAll(1/60,new Map([[m.id,{...emptyInput(),x:1,fire:true}]]));assert(m.tank.x>x);assert(s.bullets.length>0);assert.equal(s.enemies.length+s.portals.length,0);
});
test('unsafe respawn defers until clear ground, never grants twice at next wave',()=>{
 const s=team(),m=s.members.get(-1)!;s.damageTank(m.tank,200);s.obstacles=[{id:999,x:0,z:0,w:40,d:40,kind:'cover',hp:Infinity}];s.finishWave();assert.equal(m.tank.hp,0);assert.equal(m.pendingSpawnHP,50);s.obstacles=[];step(s,1/60);assert.equal(m.tank.hp,50);m.tank.hp=77;s.beginWave();assert.equal(m.tank.hp,77);
});
test('boss modules are immediate, aircraft starts at +5 and crate at +8 for 1–4 reserved humans; mini repairs independent',()=>{
 for(let n=1;n<=4;n++){const s=team(n),last=s.members.get(-n)!;last.tank.hp=0;last.connected=false;s.elapsed=20;s.dropBossLoot({x:10,z:8},'drill');assert.equal(s.pickups.length,n);assert(s.pickups.every(p=>p.kind==='module'));
  const d=s.deliveries[0];assert.equal(d.count,n+1);assert.equal(d.startAt,25);assert.equal(d.x,0);assert.equal(deliveryStage(d,24.99),'waiting');assert.equal(deliveryStage(d,25),'approach');assert.equal(deliveryStage(d,26),'parachute');
  advance(s,27.99);assert(s.pickups.every(p=>p.kind==='module'));advance(s,28);assert.equal(s.pickups.filter(p=>p.kind==='heal').length,n+1);assert(s.pickups.filter(p=>p.kind==='heal').every(p=>p.flight&&p.life===30));assert.equal(s.drainEvents().filter(e=>e.type==='supplyLand').length,1);s.advanceSupport(0);assert.equal(s.drainEvents().filter(e=>e.type==='supplyLand').length,0);
  const mini=s.createEnemy('saw',{x:-10,z:-8});s.enemies=[mini];s.killEnemy(mini);assert.equal(s.pickups.filter(p=>p.reward==='mini').length,n);
  s.dropBossLoot({x:10,z:8},'hail');assert.equal(s.pickups.filter(p=>p.reward==='mini').length,n);assert.equal(s.deliveries.length,1);
 }
 const solo=new Simulation();solo.start(false);solo.dropBossLoot({x:0,z:0},'drill');assert.equal(solo.pickups.length,1);assert.equal(solo.deliveries[0].count,2);
});
test('missing modules become air repairs; full health leaves every repair, dynamic max and cap16 protect modules',()=>{
 const s=team(4);for(const m of s.members.values())m.tank.modules=Object.keys(MODULES) as ModuleId[];s.dropBossLoot({x:0,z:0},'factory');assert.equal(s.pickups.length,0);assert.equal(s.deliveries[0].count,9);
 advance(s,8);s.advanceLoot(1);assert.equal(s.pickups.length,9);const m=s.members.get(-1)!;Object.assign(m.tank,{x:s.pickups[0].x,z:s.pickups[0].z});m.tank.hp=m.tank.maxHp=130;s.inPlayer(m,()=>s.updatePickups(0));assert.equal(s.pickups.length,9);m.tank.hp=125;s.inPlayer(m,()=>s.updatePickups(0));assert.equal(m.tank.hp,130);assert.equal(s.pickups.length,8);
 s.pickups=[];for(let i=0;i<4;i++)s.pickups.push({id:100+i,x:10,z:10,kind:'module',module:'armor',batchId:888,life:1e9});for(let i=0;i<40;i++)s.launchPickup({x:0,z:0},'heal',{reward:'mini'});assert.equal(s.pickups.length,16);assert.equal(s.pickups.filter(p=>p.kind==='module').length,4);
});
test('emergency is final active-wave <=20%, shared90 sec, counts reserved slots and cannot overlap boss supplies',()=>{
 const s=team(3),m=s.members.get(-1)!;m.tank.maxHp=130;m.tank.hp=26;s.members.get(-3)!.tank.hp=0;s.members.get(-3)!.connected=false;s.checkEmergency();assert.equal(s.deliveries.length,1);assert.equal(s.deliveries[0].count,3);assert.equal(s.emergencyReadyAt,90);
 m.tank.hp=80;advance(s,3);assert.equal(s.pickups.length,3);s.dropBossLoot({x:9,z:8},'drill');assert.equal(s.emergencyReadyAt,90);assert.equal(s.deliveries.length,2);assert.equal(s.deliveries[1].startAt,8);
 advance(s,11);s.advanceLoot(1);m.tank.hp=10;advance(s,100);s.checkEmergency();assert.equal(s.deliveries.filter(d=>d.source==='emergency').length,1,'boss ground repair blocks new emergency');
 s.pickups=s.pickups.filter(p=>!p.batchId);s.advanceSupport(0);s.checkEmergency();assert.equal(s.deliveries.filter(d=>!d.landed).length,1);assert.equal(s.emergencyReadyAt,190);
 for(const phase of ['over','dying','paused'] as const){const q=team();q.members.get(-1)!.tank.hp=10;q.phase=phase;q.checkEmergency();assert.equal(q.deliveries.length,0);}
 const q=team();q.members.get(-1)!.tank.hp=10;q.finishWave();q.checkEmergency();assert.equal(q.deliveries.length,0);q.breakTime=0;q.members.forEach(m=>m.tank.hp=0);q.checkEmergency();assert.equal(q.deliveries.length,0);
});
test('final enemy death prevents emergency during completion and boss support never consumes emergency cooldown',()=>{
 const s=team();s.members.get(-1)!.tank.hp=10;s.remainingToSpawn=0;s.updateAll(1/60,new Map());assert(s.breakTime>0);assert.equal(s.deliveries.length,0);
 s.dropBossLoot({x:0,z:0},'drill');assert.equal(s.emergencyReadyAt,0);s.stopSupport();assert.equal(s.deliveries.length,0);
});
test('repair zone uses personal actual healing, living/new/revived players, 10s duration, pause and at most one popup/sec',()=>{
 const s=team();s.wave=1;s.beginWave();s.spawnTimer=9999;const a=s.members.get(-1)!,b=s.members.get(-2)!;a.tank.hp=60;b.tank.hp=0;b.deadWave=s.wave;Object.assign(a.tank,{x:s.capture!.x,z:s.capture!.z});s.capture!.progress=3;s.capture!.hold=s.capture!.duration-3;s.updateCapture(0);assert(s.repairZone);assert.equal(b.tank.hp,50);const z=s.repairZone!;
 for(const t of [a.tank,b.tank]){t.x=z.x;t.z=z.z;}s.drainEvents();step(s,2);assert(Math.abs(a.tank.hp-64)<1e-6);assert(Math.abs(b.tank.hp-54)<1e-6);assert(s.drainEvents().filter(e=>e.type==='zoneRepair'&&e.actorId===a.id).length<=2);
 a.tank.x=15;s.pause();const elapsed=s.elapsed;step(s,2);assert.equal(s.elapsed,elapsed);s.resume();step(s,2);assert(Math.abs(a.tank.hp-64)<1e-6);
 const late=s.addMember(-3,'Новый',2);late.tank.hp=90;late.tank.x=z.x;late.tank.z=z.z;step(s,2);assert(late.tank.hp>93.9);a.tank.x=z.x;step(s,4);assert(!s.repairZone);assert(a.tank.hp<=80+1e-6);assert(b.tank.hp<=70+1e-6);assert(!s.events.some(e=>e.type==='heal'));
});
test('adrenaline begins only on allied death, combines with modules, no dash bonus, resets at second ally/break/death',()=>{
 for(let n=2;n<=4;n++){const s=team(n),a=s.members.get(-1)!;a.tank.modules=['tracks','cannon'];for(const m of [...s.members.values()].slice(1))s.damageTank(m.tank,500);step(s,1/60);assert(a.tank.adrenaline);assert.equal(s.events.filter(e=>e.type==='lastStand').length,1);
  const stats=tankStats(a.tank);assert.equal(stats.damage,39);assert(Math.abs(stats.speed-7*1.15*1.25)<1e-9);assert.equal(stats.dashCooldown,4);s.finishWave();assert(!a.tank.adrenaline);assert.equal(s.targetPlayers().length,n);
 }
 const s=team(),a=s.members.get(-1)!,b=s.members.get(-2)!;b.present=false;step(s,1/60);assert(!a.tank.adrenaline);b.present=true;s.damageTank(b.tank,500);step(s,1/60);assert(a.tank.adrenaline);s.addMember(-3,'Новенький',1);step(s,1/60);assert(!a.tank.adrenaline);
 const q=team();q.members.forEach(m=>q.damageTank(m.tank,500));step(q,1/60);assert.equal(q.phase,'dying');assert(!q.events.some(e=>e.type==='lastStand'));
});
test('launched adrenaline bullets retain splash strength after buff ends and fragments are multiplied only once',()=>{
 const s=new Simulation();s.start(false);s.obstacles=[];s.player.x=s.player.z=0;s.player.modules=['splash','cannon'];s.player.adrenaline=true;s.player.angle=0;s.shoot(s.player,'roma',tankStats(s.player).damage);const bullet=s.bullets[0];assert.equal(bullet.damage,39);assert(Math.abs(bullet.splashDamage!-15.6)<1e-8);s.player.adrenaline=false;
 const enemy=s.createEnemy('shooter',{x:bullet.x+1,z:bullet.z});s.enemies=[enemy];s.burstBullet(bullet);assert(Math.abs(enemy.hp-(50-15.6))<1e-8);
});
test('stale commands from former life are rejected and respawn clears already buffered input',()=>{
 const service=new RoomService();const make=():Peer=>({send(){},close(){},seq:-1,ack:-1,input:emptyInput(),inputAt:0,messages:0,windowAt:0});const p=make(),q=make();for(const x of [p,q])service.receive(x,{type:'hello',version:PROTOCOL},1000);service.receive(p,{type:'join',mode:'private',name:'Рома',skin:0},1000);const r=p.room!;service.receive(q,{type:'join',mode:'code',code:r.code,name:'Лев',skin:1},1000);r.sim.start(false);r.sim.spawnTimer=9999;
 const m=r.sim.members.get(p.id!)!;service.receive(p,{type:'input',seq:1,controlEpoch:0,input:{...emptyInput(),x:1,fire:true}},1000);m.shield=0;r.sim.damageTank(m.tank,500);r.sim.finishWave();const x=m.tank.x,epoch=m.tank.controlEpoch!;service.receive(p,{type:'input',seq:2,controlEpoch:0,input:{...emptyInput(),x:1,fire:true}},1001);assert.equal(p.seq,1);
 // Room notices an epoch change when it occurs during its own step; external fixtures release explicitly.
 r.step(1/60,1002);assert.equal(m.tank.x,x);service.receive(p,{type:'input',seq:3,controlEpoch:epoch,input:{...emptyInput(),x:1}},1003);r.step(1/60,1004);assert(m.tank.x>x);
});
test('support models restore correct stage, use shared geometry and clear through five restarts; damage materials isolated',()=>{
 const sim=new Simulation();sim.start(false);sim.scheduleDelivery('boss',3,5);const view=new SupportView();view.update(sim,false);const flight=view.root.children[1];assert(!(flight.children[0] as THREE.Group).visible);sim.elapsed=6.5;view.update(sim,false);assert(flight.children[0].visible&&flight.children[1].visible);view.update(sim,true);assert(!flight.children[0].visible&&!flight.children[1].visible&&flight.children[2].visible);
 for(let i=0;i<5;i++){view.reset();assert.equal(view.root.children.length,1);sim.start(false);assert.equal(sim.deliveries.length,0);assert(!sim.repairZone);assert.equal(sim.emergencyReadyAt,0);}
 const material=new THREE.MeshStandardMaterial({color:0x4085bc}),root=new THREE.Group(),body=new THREE.Group(),turret=new THREE.Group(),mesh=new THREE.Mesh(new THREE.BoxGeometry(),material);body.add(mesh);root.add(body,turret);const c=new TankCondition(root,body,turret);c.update({...sim.player,adrenaline:true,hp:20},1,false);assert.notEqual((mesh.material as THREE.MeshStandardMaterial).color.getHex(),material.color.getHex());assert.equal(material.color.getHex(),0x4085bc);c.update(sim.player,2,true);assert.equal((mesh.material as THREE.MeshStandardMaterial).color.getHex(),0x4085bc);
 assert.deepEqual([100,50,35,20,0].map(hp=>damageStage(hp,100)),[0,1,2,3,0]);assert.equal(damageStage(26,130),3);
});
