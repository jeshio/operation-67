import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation, emptyInput, type Bullet, type Pickup } from '../src/simulation';
import { CoopSimulation } from '../src/coop';
import { MODULES, chooseModules, tankStats, type ModuleId, type BigBoss } from '../src/modules';
import { makePickup, updatePickup } from '../src/pickup-view';
import { addModuleParts } from '../src/module-view';
import * as THREE from 'three';
const arena=()=>{const s=new Simulation();s.start(false);s.obstacles=[];s.player.x=s.player.z=0;s.remainingToSpawn=1;s.spawnTimer=9999;return s;};
const team=(n:number)=>{const s=new CoopSimulation();for(let i=1;i<=n;i++)s.addMember(-i,`Игрок ${i}`,i);s.start(false);s.obstacles=[];s.spawnTimer=9999;s.remainingToSpawn=1;return s;};
function take(s:CoopSimulation,id:number,p:Pickup){const m=s.members.get(id)!;m.tank.x=p.x;m.tank.z=p.z;s.inPlayer(m,()=>s.updatePickups(0));}
const shot=(s:Simulation,mods:ModuleId[],x=0,z=0):Bullet=>{s.player.modules=mods;s.player.x=x;s.player.z=z;s.player.angle=0;s.shoot(s.player,'roma',tankStats(s.player).damage);return s.bullets.at(-1)!;};
test('flight blocks collection, lands once, lifetime starts at landing and pause freezes it',()=>{
  const s=arena();s.player.hp=70;s.launchPickup({x:0,z:0},'heal',{spot:{x:1.5,z:0}});const p=s.pickups[0];s.player.x=p.x;
  s.updatePickups(.64);assert.equal(s.player.hp,70);assert(p.flight);assert.equal(p.life,12);
  s.pause();s.update(5,emptyInput());assert(p.flight);assert.equal(s.player.hp,70);s.resume();
  s.updatePickups(.01);assert.equal(s.player.hp,90);assert.equal(s.pickups.length,0);assert.equal(s.drainEvents().filter(e=>e.type==='landing').length,1);
  s.launchPickup({x:0,z:0},'charge',{spot:{x:8,z:0},delay:.12});s.advanceLoot(.77);assert(!s.pickups[0].flight);assert(Math.abs(s.pickups[0].life-12)<1e-8);s.advanceLoot(12);assert.equal(s.pickups.length,0);
});
test('normal drops preserve cadence and order; safe launch and separated boss landings near covers and boundaries',()=>{
  const s=arena();for(let i=0;i<12;i++){const e=s.createEnemy('light',{x:0,z:0});s.enemies.push(e);s.killEnemy(e);}
  assert.deepEqual(s.pickups.map(p=>p.kind),['heal','charge','rapid']);for(const p of s.pickups)assert(Math.hypot(p.x,p.z)>=1&&Math.hypot(p.x,p.z)<=2.001);
  for(const n of [1,2,3,4]){const s=team(n);s.obstacles=new Simulation().obstacles;
    for(const from of [{x:16,z:12},{x:-16,z:-12},{x:0,z:0},{x:-8,z:7}]){
      if(!s.walkable(from.x,from.z,2))continue;s.dropBossLoot(from,'drill');assert.equal(s.pickups.length,n);
      for(const p of s.pickups){assert(s.walkable(p.x,p.z,.8));assert(s.lineOfSight(from,p,.55));}
      for(const a of s.pickups)for(const b of s.pickups)if(a.id<b.id)assert(Math.hypot(a.x-b.x,a.z-b.z)>=2.6,'choices must not overlap pickup radius');
    }
  }
});
test('big boss rewards count all reserved humans, never Lev; mini bosses have their own repair; full-health repairs survive',()=>{
  for(let n=1;n<=4;n++){const s=team(n);const dead=s.members.get(-n)!;dead.tank.hp=0;dead.connected=false;s.dropBossLoot({x:0,z:0},'drill');
    assert.equal(s.pickups.filter(p=>p.kind==='heal').length,0);assert.equal(s.deliveries[0].count,n+1);assert.equal(s.pickups.filter(p=>p.kind==='module').length,n);assert.equal(new Set(s.pickups.filter(p=>p.module).map(p=>p.module)).size,n);assert(s.lootBatch!.eligible.includes(dead.id));
    s.elapsed=8;s.advanceSupport(0);s.advanceLoot(1);if(n>1){const p=s.pickups.find(p=>p.kind==='heal')!;take(s,-1,p);assert(s.pickups.includes(p));assert(p.life>29);}
  }
  const s=arena();s.dropBossLoot({x:0,z:0},'hail');assert.equal(s.pickups.length,1);assert.equal(s.deliveries[0].count,2);
  s.pickups=[];const e=s.createEnemy('saw',{x:0,z:0});s.enemies=[e];s.killEnemy(e);assert.equal(s.pickups.length,1);assert.equal(s.pickups[0].reward,'mini');
});
test('one module per batch, late joiners excluded, no duplicate; death/rejoin preserves, new battle resets',()=>{
  const s=team(2);s.dropBossLoot({x:0,z:0},'drill');s.advanceLoot(1);const items=s.pickups.filter(p=>p.module),id=items[0].module!;
  const late=s.addMember(-3,'Поздний',0);take(s,late.id,items[0]);assert(!late.tank.modules?.length);assert.equal(s.moduleBlock(items[0],late.tank),'Со следующего босса');
  take(s,-1,items[0]);assert.deepEqual(s.members.get(-1)!.tank.modules,[id]);take(s,-1,items[1]);assert(s.pickups.includes(items[1]));assert.equal(s.moduleBlock(items[1],s.members.get(-1)!.tank),'Модуль с этого босса получен');
  const m=s.members.get(-1)!;m.shield=0;s.damageTank(m.tank,1000);s.finishWave();assert.equal(m.tank.hp,50);assert(m.tank.modules!.includes(id));assert.equal(m.tank.lastDamageAt,s.elapsed);
  m.present=m.connected=false;s.addMember(m.id,'Вернулся',4);assert(m.tank.modules!.includes(id));assert.equal(m.skin,4);
  s.start(false);assert(s.members.get(-1)!.tank.modules!.length===0);assert.equal(m.tank.maxHp,100);assert.equal(s.lootBatch,null);assert.equal(s.pickups.length,0);
});
test('unusable leftover becomes repair; expired batch is removed, ordinary drops cannot evict modules',()=>{
  const s=team(2);s.dropBossLoot({x:0,z:0},'drill');s.advanceLoot(1);const items=s.pickups.filter(p=>p.module);take(s,-1,items[0]);s.members.get(-2)!.present=false;s.refreshLootRights();assert.equal(items[1].kind,'heal');assert.equal(items[1].life,30);
  s.dropBossLoot({x:0,z:0},'hail');const batch=s.lootBatch!.id;for(let i=0;i<40;i++)s.launchPickup({x:0,z:0},'charge');assert.equal(s.pickups.length,16);assert(s.pickups.filter(p=>p.batchId).every(p=>p.batchId===batch));assert.equal(s.pickups.filter(p=>p.module).length,1);
});
test('maximal matching avoids duplicates and reaches saturation for 1–4 humans over repeated bosses',()=>{
  assert.equal(Object.keys(MODULES).length,12);
  const one=chooseModules('drill',[{modules:['armor','cannon','turbo']}],()=>0);assert.deepEqual(one,['ram']);
  assert.equal(chooseModules('drill',[{modules:['armor','cannon','turbo']},{modules:['armor','cannon','turbo']}],()=>0).length,1);
  for(let n=1;n<=4;n++){const s=team(n);
    for(let round=0;round<5;round++)for(const boss of ['drill','hail','factory'] as BigBoss[]){
      s.dropBossLoot({x:0,z:0},boss);s.advanceLoot(1);
      // Any legal first choice must still leave the remaining items collectable or converted.
      for(const m of s.members.values()){const p=s.pickups.find(p=>p.kind==='module'&&!s.moduleBlock(p,m.tank));if(p)take(s,m.id,p);}
      s.refreshLootRights();for(const m of s.members.values())assert.equal(new Set(m.tank.modules).size,m.tank.modules?.length??0);
    }
    // N=1 can install all 12 in four visits; larger teams may redistribute choices.
    if(n===1)assert.equal(s.members.get(-1)!.tank.modules!.length,12);
    for(const m of s.members.values())m.tank.modules=Object.keys(MODULES) as ModuleId[];
    s.dropBossLoot({x:0,z:0},'factory');assert.equal(s.pickups.length,0);assert.equal(s.deliveries[0].count,2*n+1);
    for(let i=0;i<5;i++){s.start(false);assert.equal(s.pickups.length,0);assert([...s.members.values()].every(m=>!m.tank.modules?.length));}
  }
});
test('armor installation heals 30, normal repair and HUD maximum remain 130; regen waits, stops dead, resets on revive',()=>{
  const s=team(1),m=s.members.get(-1)!;s.lootBatch={id:3,eligible:[m.id],claimed:[]};s.pickups=[{id:4,x:0,z:0,life:1e9,kind:'module',module:'armor',batchId:3}];m.tank.hp=95;take(s,m.id,s.pickups[0]);assert.equal(m.tank.hp,125);assert.equal(m.tank.maxHp,130);
  s.pickups=[{id:5,x:0,z:0,kind:'heal',life:12}];take(s,m.id,s.pickups[0]);assert.equal(m.tank.hp,130);assert.equal(s.events.at(-1)!.amount,5);
  m.tank.modules!.push('repair');m.tank.hp=70;m.tank.lastDamageAt=0;s.elapsed=4.99;s.inPlayer(m,()=>s.updateControlled(.01,emptyInput()));assert.equal(m.tank.hp,70);s.elapsed=6;s.inPlayer(m,()=>s.updateControlled(.5,emptyInput()));assert.equal(m.tank.hp,71);
  m.shield=0;s.damageTank(m.tank,10);assert.equal(m.tank.lastDamageAt,6);s.elapsed=10;s.inPlayer(m,()=>s.updateControlled(1,emptyInput()));assert.equal(m.tank.hp,61);
  m.tank.hp=0;s.elapsed=20;s.inPlayer(m,()=>s.updateControlled(1,emptyInput()));assert.equal(m.tank.hp,0);s.spawn(m,50);assert.equal(m.tank.lastDamageAt,20);assert.equal(m.tank.maxHp,130);
});
test('cannon, loader, ballistics, tracks, turbo and temporary boosts share stats without duplicate multipliers',()=>{
  const s=arena();s.player.modules=['cannon','loader','ballistics','tracks','turbo'];const b=shot(s,s.player.modules);assert.equal(b.damage,30);assert.equal(b.vz,30);
  s.player.cooldown=0;s.rapidTime=6;s.powerTime=7;s.updateControlled(.1,{...emptyInput(),x:1,fire:true});assert(Math.abs(s.player.x-.805)<1e-8);assert(Math.abs(s.player.cooldown-.3/1.15/2)<1e-8);
  s.activateDash({...emptyInput(),x:1});assert.equal(s.dashCooldown,3);assert.equal(s.dashTime,.2);
});
test('piercing halves second direct hit; final splash excludes hit targets, awards kills but not hit charge',()=>{
  // Keep the splash-only neighbour outside the full visible tracks, not the old small circle.
  const s=arena();const a=s.createEnemy('shooter',{x:0,z:3}),b=s.createEnemy('shooter',{x:0,z:5}),c=s.createEnemy('light',{x:1.2,z:4.4});c.hp=10;s.enemies=[a,b,c];
  shot(s,['pierce','splash']);s.updateBullets(.25);assert.equal(a.hp,25);assert.equal(b.hp,37.5);assert(!s.enemies.includes(c));assert.equal(s.charge,12);assert.equal(s.bullets.length,0);
});
test('cover and Barrier stop piercing and block fragments; recover vulnerability uses shared damage',()=>{
  const s=arena();const wall={id:99,x:0,z:3,w:8,d:.3,kind:'cover' as const,hp:Infinity};s.obstacles=[wall];const e=s.createEnemy('light',{x:0,z:3.7});s.enemies=[e];shot(s,['pierce','splash']);s.updateBullets(.2);assert.equal(e.hp,25);assert.equal(s.bullets.length,0);assert.equal(s.charge,0);
  s.obstacles=[];const shield=s.createEnemy('barrier',{x:0,z:3});shield.angle=Math.PI;s.enemies=[shield];shot(s,['pierce','splash']);s.updateBullets(.2);assert.equal(shield.hp,shield.maxHp);assert.equal(s.charge,0);assert.equal(s.bullets.length,0);
  const saw=s.createEnemy('saw',{x:0,z:2});saw.state='recover';s.enemies=[saw];s.hurtEnemy(saw,40,s.player,'roma',0,'ram',false);assert.equal(saw.hp,saw.maxHp-60);assert.equal(s.charge,0);
});
test('ram hits each front enemy once, credits damage and capacitor kills; magnet does not collect modules',()=>{
  const s=team(1),m=s.members.get(-1)!;m.tank.x=m.tank.z=0;m.tank.modules=['ram','capacitor'];const e=s.createEnemy('shooter',{x:0,z:1.5});s.enemies=[e];
  s.inPlayer(m,()=>{s.activateDash({...emptyInput(),z:1});for(let i=0;i<4;i++)s.updateControlled(1/60,{...emptyInput(),z:1});});assert.equal(e.hp,10);assert.equal(m.damage,40);assert.equal(m.charge,0);
  m.dashCooldown=0;m.tank.z=0;s.inPlayer(m,()=>{s.activateDash({...emptyInput(),z:1});s.updateControlled(1/60,{...emptyInput(),z:1});});assert.equal(m.kills,1);assert.equal(m.charge,13);
  m.tank.modules.push('magnet');m.tank.x=m.tank.z=0;m.tank.hp=70;s.pickups=[{id:90,x:2,z:0,kind:'heal',life:12},{id:91,x:2,z:0,kind:'module',module:'armor',batchId:4,life:1e9}];s.lootBatch={id:4,eligible:[m.id],claimed:[]};s.inPlayer(m,()=>s.updatePickups(0));assert.equal(m.tank.hp,90);assert.equal(s.pickups.length,1);assert.equal(s.pickups[0].kind,'module');
});
test('rendered arc reaches two units, reduced motion jumps to landing; twelve attachments combine without moving muzzle',()=>{
  const p:Pickup={id:1,x:2,z:0,kind:'heal',life:12,flight:{from:{x:0,z:0},remaining:.325,delay:0}};const root=makePickup(p,()=>new THREE.Sprite(new THREE.SpriteMaterial()));
  updatePickup(root,p,0,.05,true,false);assert.equal(root.position.x,1);assert(root.position.y>=2);updatePickup(root,p,0,.05,true,true);assert.equal(root.position.x,2);assert.equal(root.position.y,0);
  const groups=Array.from({length:4},()=>new THREE.Group());addModuleParts(Object.keys(MODULES) as ModuleId[],groups[0],groups[1],groups[2],groups[3]);assert.equal(groups[0].children.length,12);assert.equal(groups[1].children.length,12);
  groups[2].updateMatrixWorld(true);assert(new THREE.Box3().setFromObject(groups[2]).max.z<=1.765);groups[3].updateMatrixWorld(true);assert(new THREE.Box3().setFromObject(groups[3]).max.z<=1.725);
});

test('boss spread remains separated across the arena, including tight cover lanes',()=>{
  const s=team(4);s.obstacles=new Simulation().obstacles;let positions=0;
  for(let z=-12;z<=12;z+=2)for(let x=-16;x<=16;x+=2){if(!s.walkable(x,z,2))continue;positions++;s.dropBossLoot({x,z},'hail');
    assert.equal(s.pickups.length,4);for(const p of s.pickups){assert(s.walkable(p.x,p.z,.8));assert(s.lineOfSight({x,z},p,.55));}
    for(const a of s.pickups)for(const b of s.pickups)if(a.id<b.id)assert(Math.hypot(a.x-b.x,a.z-b.z)>=2.7-1e-8);
  }assert(positions>100);
});

test('splash beside cover damages its near side and still blocks the far side; helper credits capacitor',()=>{
  const s=arena();s.obstacles=[{id:99,x:0,z:3,w:8,d:.3,kind:'cover',hp:Infinity}];
  const near=s.createEnemy('shooter',{x:1.25,z:2.3}),far=s.createEnemy('shooter',{x:1.25,z:3.6});s.enemies=[near,far];shot(s,['splash']);s.updateBullets(.2);assert.equal(near.hp,38);assert.equal(far.hp,50);assert.equal(s.charge,0);
  s.player.modules=['capacitor'];s.killEnemy(near,'lev');assert.equal(s.charge,13);
});
test('loot labels fit short phones and modules are never covered by other labels',async()=>{
  const {placeLootLabels}=await import('../src/loot-labels');
  for(const [w,h] of [[360,500],[390,844],[430,932],[844,390],[1280,720]]){
    const labels=Array.from({length:9},(_,i)=>({id:i,x:w*.8,y:h*.4+i*5,width:i<4?176:96,height:i<4?44:24,module:i<4}));
    const packed=placeLootLabels(labels,w,70,h-(h>w?180:70));for(let i=0;i<4;i++)assert(packed.has(i));
    for(const a of packed.values()){assert(a.left>=0&&a.left+a.width<=w);for(const b of packed.values())if(a!==b)assert(a.left+a.width<=b.left||b.left+b.width<=a.left||a.top+a.height<=b.top||b.top+b.height<=a.top);}
  }
});

test('two simultaneous drivers can collect a module only once',()=>{
  const s=team(2);s.lootBatch={id:44,eligible:[-1,-2],claimed:[]};s.pickups=[{id:45,kind:'module',module:'armor',batchId:44,x:0,z:0,life:1e9}];
  for(const m of s.members.values()){m.tank.x=m.tank.z=0;}s.drainEvents();s.updateAll(1/60,new Map());
  assert.equal([...s.members.values()].filter(m=>m.tank.modules?.includes('armor')).length,1);assert.equal(s.pickups.length,0);assert.equal(s.drainEvents().filter(e=>e.type==='upgrade').length,1);
});

test('old protocol is rejected before granting a room identity',async()=>{
 const {RoomRegistry}=await import('../server/rooms');const {PROTOCOL}=await import('../src/protocol');const rooms=new RoomRegistry();
 await assert.rejects(rooms.join({version:PROTOCOL-1,request:{type:'join',mode:'quick',name:'Рома',skin:0}}),/VERSION/);assert.equal(rooms.rooms.size,0);
});

test('every module has a unique dark label color with readable light text',()=>{
  const colors=Object.values(MODULES).map(m=>m.labelBg);assert.equal(new Set(colors).size,12);
  const light=(hex:string)=>{const rgb=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;};
  for(const bg of colors)assert((light('#f1dfb7')+.05)/(light(bg)+.05)>=4.5);
});
