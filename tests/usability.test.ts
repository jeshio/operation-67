import { PROTOCOL } from '../src/protocol';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation, emptyInput, type GameEvent } from '../src/simulation';
import { CoopSimulation } from '../src/coop';
import { planWave, wavePacing } from '../src/waves';
import { Tutorial } from '../src/tutorial';
import { TouchState } from '../src/touch-state';
import { GUN, muzzles } from '../src/weapons';
import { OwnShots } from '../src/own-shots';
import { AnnouncerGate } from '../src/announcer';
import { RoomService, type Peer } from '../server/rooms';
import type { ServerMessage } from '../src/protocol';

test('first ten waves have progressive totals, caps and pacing for every team size', () => {
  const counts=[2,4,4,6,8,10,12,15,18,22], caps=[2,2,3,4,5,6,7,8,10,12];
  for(let n=1;n<=4;n++)for(let w=1;w<=45;w++){
    const s=new CoopSimulation();for(let id=1;id<=n;id++)s.addMember(-id,`Игрок ${id}`,id-1);s.start(false);s.wave=w-1;s.beginWave();s.obstacles=[];
    assert.equal(s.remainingToSpawn,Math.min(24,Math.ceil((counts[w-1]??24)*(1+.5*(n-1)))));
    assert.equal(s.pacing().maxActive,Math.min(12,(caps[w-1]??12)+(n>=3?1:0)));
    for(let i=0;i<40;i++)s.queueEnemy();
    assert(s.enemies.length+s.portals.length<=s.pacing().maxActive);
    assert.deepEqual(s.portals.slice(0,planWave(w).bosses.length).map(p=>p.kind),planWave(w).bosses);
    const old=s.peak;s.members.get(-n)!.present=false;assert.equal(s.peak,old);
  }
  assert.equal(wavePacing(1).spawnInterval,2.5);assert.equal(wavePacing(10).spawnInterval,1);
  assert.equal(wavePacing(2).captureInterval,3.5);assert.equal(wavePacing(10).captureInterval,1.8);
});

test('second-wave reinforcements are bounded, infinite and can charge 67 before capture',()=>{
  const s=new Simulation();s.start(false);s.beginWave();s.obstacles=[];s.remainingToSpawn=0;s.spawnTimer=0;s.player.x=s.player.z=0;s.lev.x=17;s.lev.z=13;
  for(let i=0;i<800;i++){s.player.hp=100;s.update(1/60,emptyInput());s.drainEvents();assert(s.enemies.length+s.portals.length<=2);}
  assert.equal(s.wave,2);assert.equal(s.capture?.progress,0);
  // Clear each real reinforcement with normal projectiles; no charge or kill shortcut.
  s.enemies=[];s.portals=[];
  for(let i=0;i<8;i++){
    s.queueEnemy();const portal=s.portals.shift()!;const e=s.createEnemy(portal.kind,{x:0,z:-5},portal.id);s.enemies=[e];
    while(e.hp>0){s.player.angle=Math.PI;s.shoot(s.player,'roma',25);s.updateBullets(.3);}
  }
  assert.equal(s.charge,67);assert.equal(s.wave,2);
});

test('stick deflection survives release for one step, cancellation clears it and aim ownership is exclusive',()=>{
  const t=new TouchState();t.begin('move',1);t.begin('aim',2);t.update(2,56,0,56);assert(!t.begin('aim',3));t.update(3,0,56,56);assert.deepEqual(t.lastAim,{x:1,y:0});
  t.end(2);assert(!t.aiming);assert(t.consume().firePressed);assert(!t.consume().firePressed);assert.equal(t.action(1),'move');
  t.begin('aim',4);t.update(4,0,56,56);t.end(4,true);assert(!t.consume().firePressed);t.begin('power',5);t.end(5,true);assert(!t.consume().power);
  const s=new Simulation();s.start(false);s.obstacles=[];s.updateControlled(1/60,{...emptyInput(),firePressed:true});assert.equal(s.fired,1);
  s.updateControlled(1/60,{...emptyInput(),firePressed:true});assert.equal(s.fired,1);s.updateControlled(1,emptyInput());assert.equal(s.fired,1);
});

test('lessons use active game time, power priority, confirmations and separate persistent input modes',()=>{
  let stored='{}';const storage={getItem:()=>stored,setItem:(_k:string,v:string)=>{stored=v;}};
  const t=new Tutorial(storage);assert.equal(t.update(.4,true,true,false),undefined);assert.equal(t.update(.1,true,true,false),'fire');
  assert.equal(t.update(100,false,true,true),undefined);assert.equal(t.update(.1,true,true,false),'fire');
  assert.equal(t.update(.1,true,true,true),'power');
  const event=(type:GameEvent['type'],actorId=-1):GameEvent=>({type,actorId,x:0,z:0,owner:'roma'});
  t.confirm([event('power',-2)],-1,true);assert(!t.knows('power'));t.confirm([event('power')],-1,true);assert(t.knows('power'));
  t.confirm([event('shot'),event('dash')],-1,true);assert(t.knows('fire')&&t.knows('dash'));
  const restored=new Tutorial(storage);assert(restored.knows('power'));restored.touch=false;assert(!restored.knows('power'));restored.touch=true;restored.repeat();assert(!restored.knows('power'));
  const failing=new Tutorial({getItem(){throw Error();},setItem(){throw Error();}});assert.doesNotThrow(()=>failing.confirm([event('shot')],-1,true));assert(failing.knows('fire'));
  const repeat=new Tutorial(null);assert.equal(repeat.update(.5,true,false,false),'fire');assert.equal(repeat.update(3,true,false,false),undefined);assert.equal(repeat.update(8.9,true,false,false),undefined);assert.equal(repeat.update(.1,true,false,false),'fire');
});

test('friendly projectiles and flash origins use rendered muzzle height, dual offsets, recoil and companion scale',()=>{
  const s=new Simulation();s.start(false);s.obstacles=[];s.player.x=s.player.z=0;
  for(const power of [false,true])for(const owner of ['roma','lev'] as const)for(let i=0;i<8;i++){
    s.bullets=[];s.drainEvents();s.player.angle=i*Math.PI/4;s.shoot(s.player,owner,25,power);
    const tips=muzzles(s.player,power,owner==='lev'?GUN.levScale:1),event=s.drainEvents().find(e=>e.type==='shot')!;
    assert.equal(s.bullets.length,power?2:1);
    s.bullets.forEach((b,i)=>{assert(Math.hypot(b.x-tips[i].x,b.z-tips[i].z)<1e-10);assert.equal(b.y,tips[i].y);assert.equal(event.muzzles![i].bulletId,b.id);});
  }
  s.bullets=[];s.drainEvents();s.player.angle=0;s.obstacles=[{id:99,x:0,z:1,w:4,d:.2,kind:'cover',hp:Infinity}];s.shoot(s.player,'roma',25,true);
  assert.equal(s.bullets.length,0);assert(!s.drainEvents().some(e=>e.type==='shot'));
});

test('own shell birth agrees with visible muzzle then joins authority in 80ms without following tank or duplicating',()=>{
  const s=new Simulation();s.start(false);s.obstacles=[];s.player.x=s.player.z=0;s.shoot(s.player,'roma',25,true);const events=s.drainEvents();s.updateBullets(.05);
  const view=new OwnShots();view.confirm(events,0);const tank={...s.player,x:2,z:1};const rendered=view.present(s.bullets,tank,1000),tip=muzzles(tank,true);
  assert.equal(rendered.length,2);assert.equal(rendered[0].x,tip[0].x);assert(Math.abs(rendered[0].z-tip[0].z)<1e-10);
  view.confirm(events,0);const unchanged=view.present(s.bullets,{...tank,x:10,z:10},1000);assert.deepEqual(unchanged,rendered);
  assert.deepEqual(view.present(s.bullets,tank,1080),s.bullets);
  assert.deepEqual(view.present([],tank,1090),[]);view.reset();assert.deepEqual(view.present(s.bullets,tank,1100),s.bullets);
});

test('last survivor fires once after damage resolution, never on a wipe or departure, re-arms next wave',()=>{
  const make=(count:number)=>{const s=new CoopSimulation();for(let i=1;i<=count;i++)s.addMember(-i,`Танк ${i}`,0);s.start(false);s.spawnTimer=99999;s.remainingToSpawn=1;s.drainEvents();for(const m of s.members.values())m.shield=0;return s;};
  for(const count of [2,3,4]){
    const s=make(count);for(let i=2;i<=count;i++)s.damageTank(s.members.get(-i)!.tank,1000);s.updateAll(1/60,new Map());
    const events=s.drainEvents().filter(e=>e.type==='lastStand');assert.equal(events.length,1);assert.equal(events[0].actorId,-1);
    s.updateAll(1/60,new Map());assert(!s.drainEvents().some(e=>e.type==='lastStand'));
    s.finishWave();s.beginWave();for(let i=2;i<=count;i++){s.members.get(-i)!.shield=0;s.damageTank(s.members.get(-i)!.tank,1000);}s.updateAll(1/60,new Map());assert.equal(s.drainEvents().filter(e=>e.type==='lastStand').length,1);
  }
  const wipe=make(2);for(const m of wipe.members.values())wipe.damageTank(m.tank,1000);wipe.updateAll(1/60,new Map());assert(!wipe.drainEvents().some(e=>e.type==='lastStand'));
  const left=make(2);left.members.get(-2)!.present=false;left.updateAll(1/60,new Map());assert(!left.drainEvents().some(e=>e.type==='lastStand'));
  const gate=new AnnouncerGate();assert.equal(gate.choose(['lastStand','legend'],0),'lastStand');gate.reset();assert.equal(gate.choose(['lastStand','power'],0),'power');assert.equal(gate.choose(['lastStand'],1),undefined);
});

test('presence notifications distinguish joins, brief drops, loss, restoration and final exit without initial roster replay',()=>{
  const service=new RoomService();let now=10000;
  const peer=()=>{const messages:ServerMessage[]=[];const p:Peer={send:m=>messages.push(m),close(){},seq:-1,ack:-1,input:emptyInput(),inputAt:0,messages:0,windowAt:0};service.receive(p,{type:'hello',version:PROTOCOL},now);return{p,messages};};
  const a=peer();service.receive(a.p,{type:'join',mode:'private',name:'Рома',skin:0},now);const room=a.p.room!;const b=peer();service.receive(b.p,{type:'join',mode:'code',code:room.code,name:'Лев',skin:1},now);
  const presence=()=>a.messages.filter((m):m is Extract<ServerMessage,{type:'presence'}>=>m.type==='presence').map(m=>m.event.kind);
  assert.deepEqual(presence(),['joined']);assert(!b.messages.some(m=>m.type==='presence'));
  room.disconnect(b.p,now);now+=2000;service.step(1/60,now);room.join(b.p,'Лев',1,now);assert.deepEqual(presence(),['joined']);
  room.disconnect(b.p,now);now+=3100;service.step(1/60,now);service.step(1/60,now);assert.deepEqual(presence(),['joined','lost']);
  room.join(b.p,'Лев',1,now);assert.deepEqual(presence(),['joined','lost','returned']);service.receive(b.p,{type:'leave'},now);assert.deepEqual(presence(),['joined','lost','returned','left']);
  room.join(b.p,'Лев',1,now);room.disconnect(b.p,now);now+=31000;service.step(1/60,now);assert.equal(presence().at(-1),'left');
  const c=peer();room.join(c.p,'Друг',2,now);room.disconnect(a.p,now,true);assert.equal(room.owner,c.p.id);
});
