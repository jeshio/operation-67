import test from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { Simulation, emptyInput } from '../src/simulation.ts';
import { CONFIG as C, BALANCE as B, ENEMY_META, POINTS } from '../src/config.ts';
import { planWave, bossScale, captureDuration } from '../src/waves.ts';
import { AnnouncerGate } from '../src/announcer.ts';
import { GameStorage } from '../src/storage.ts';
const tick = (s: Simulation, n = 1) => { for (let i = 0; i < n; i++) s.update(1 / 60, emptyInput()); };
function arena(wave = 1) { const s = new Simulation(); s.start(false); s.wave = wave - 1; s.beginWave(); s.obstacles = []; s.player.x = 0; s.player.z = 0; s.lev.x = 17; s.lev.z = 13; s.remainingToSpawn = 1; s.spawnTimer = 9999; s.drainEvents(); return s; }

test('45 wave schedule: capture rotation, bosses together, independent mini rotation and roster', () => {
  for (let wave = 1; wave <= 45; wave++) {
    const p = planWave(wave), copies=wave>30?2:1; assert.equal(p.bosses.filter(k => ENEMY_META[k].tier === 'boss').length, +(wave % 5 === 0)*copies); assert.equal(p.bosses.filter(k => ENEMY_META[k].tier === 'mini').length, +(wave % 3 === 0)*copies);
    assert.equal(p.captureIndex !== null, [2, 7, 13].includes((wave - 1) % 15 + 1)); assert.ok(p.count <= 24);
  }
  assert.deepEqual(planWave(15).bosses, ['factory', 'squall']); assert.deepEqual(planWave(30).bosses, ['factory', 'saw']); assert.deepEqual(planWave(45).bosses, ['factory', 'factory', 'barrier', 'barrier']);
  assert.equal(planWave(11).roster.length, 6); assert.deepEqual(bossScale(16), {hp:1.35, damage:1.15, interval:0.9299999999999999});
  const s = arena(20), boss = s.createEnemy('drill', {x:0,z:-8}); assert.equal(boss.hp, 2400 * 1.35); assert.equal(s.createEnemy('light', {x:5,z:5}).hp, C.enemy.light.hp * s.scale());
});
test('capture sites fit in clear reachable space; reinforcements continue after initial count', () => {
  const s = new Simulation(); for (const p of POINTS) { assert.ok(s.walkable(p.x,p.z,B.capture.radius), p.name); assert.ok(Math.hypot(s.player.x-p.x,s.player.z-p.z)<1 || s.findPath(s.player,p).length); }
  const c = arena(2); c.remainingToSpawn = 0; c.spawnTimer = 0; tick(c); assert.equal(c.portals.length, 1); assert.equal(c.breakTime, 0); assert.equal(c.score, 0);
});
test('capture accumulates five seconds total, freezes on contest/exit/pause, then completes', () => {
  const s = arena(2), c = s.capture!; s.player.x = c.x; s.player.z = c.z;
  assert.equal(c.duration,5); tick(s,60); const before=c.progress; s.player.x=0;tick(s,120);assert.equal(c.progress,before);
  s.player.x=c.x;const e=s.createEnemy('light',c);e.cooldown=999;s.enemies.push(e);tick(s,60);assert.equal(c.progress,before);assert.equal(c.status,'contested');
  s.enemies=[];tick(s,121);assert.equal(c.progress,3);const h=c.hold;s.pause();tick(s,600);assert.equal(c.hold,h);s.resume();tick(s,122);
  assert.equal(c.status,'complete');assert.equal(c.progress+c.hold,5);assert.equal(s.score,750);assert.equal(s.enemies.length,0);assert.equal(s.hazards.length,0);assert.ok(s.breakTime>0);assert.ok(s.events.some(e=>e.callout==='point'));
});
test('capture duration grows per visit across cycles and never exceeds 25 seconds total', () => {
  const waves=[2,7,13,17,22,28,32,37,43,152];
  assert.deepEqual(waves.map(captureDuration),[5,9,13,17,21,25,25,25,25,25]);
  const s=arena(28),c=s.capture!;s.player.x=c.x;s.player.z=c.z;
  tick(s,24*60);assert.notEqual(c.status,'complete');tick(s,63);assert.equal(c.progress+c.hold,25);assert.equal(c.status,'complete');
  s.start(false);s.beginWave();assert.equal(s.capture!.duration,5);
});
test('dash is protected, has cooldown, cannot tunnel through cover and freezes on pause', () => {
  const s=arena(); s.obstacles=[{id:99,x:1.5,z:0,w:0.3,d:6,kind:'cover',hp:Infinity}]; assert.ok(s.activateDash({...emptyInput(),x:1})); s.damagePlayer(20); assert.equal(s.player.hp,100); assert.equal(s.activateDash(emptyInput()),false);
  s.pause(); tick(s,60); assert.equal(s.dashTime,0.2); s.resume(); tick(s,20); assert.ok(s.player.x<1); assert.equal(s.dashTime,0); s.damagePlayer(10); assert.equal(s.player.hp,90); tick(s,240); assert.ok(s.activateDash(emptyInput()));
});
test('pickups rotate, expire, heal/cap charge and rapid fire never multiplies SIX SEVEN', () => {
  const s=arena(); for(let i=0;i<12;i++){const e=s.createEnemy('light',{x:8,z:8});s.enemies.push(e);s.killEnemy(e,'lev');} assert.deepEqual(s.pickups.map(p=>p.kind),['heal','charge','rapid']);
  s.player.hp=60;s.charge=60;s.advanceLoot(.65);for(const p of [...s.pickups]){s.player.x=p.x;s.player.z=p.z;s.updatePickups(0);}assert.equal(s.player.hp,80);assert.equal(s.charge,67);assert.equal(s.rapidTime,6);assert.equal(s.pickups.length,0);
  s.activatePower();s.player.cooldown=0;s.update(1/60,{...emptyInput(),fire:true});assert.equal(s.player.cooldown,0.15);
  s.pickups.push({id:900,x:-8,z:-8,kind:'heal',life:0.01});tick(s);assert.equal(s.pickups.length,0);
});
test('streak thresholds include Lev; only actual damage resets; six per power fires once', () => {
  const s=arena();
  for(let i=0;i<67;i++){const e=s.createEnemy('light',{x:10,z:10});s.enemies.push(e);s.killEnemy(e,i%2?'lev':'roma');}
  assert.deepEqual(s.events.filter(e=>e.callout).map(e=>e.callout),['steel','unstoppable','master','legend']);assert.equal(s.streak,67);
  s.activatePower();s.damagePlayer(20);assert.equal(s.streak,67);
  for(let i=0;i<9;i++){const e=s.createEnemy('light',{x:10,z:10});s.enemies.push(e);s.killEnemy(e);}
  assert.equal(s.events.filter(e=>e.callout==='six').length,1);s.powerTime=0;s.damagePlayer(1);assert.equal(s.streak,0);assert.equal(s.events.at(-1)?.damage,1);
  s.start(false);assert.equal(s.streak,0);assert.equal(s.pickups.length,0);
});
test('announcer selects highest, enforces 12/60 seconds and discards stale events', () => {
  const g=new AnnouncerGate();assert.equal(g.choose(['steel','boss','power'],0),'power');assert.equal(g.choose(['legend'],2),undefined);assert.equal(g.choose([],13),undefined);assert.equal(g.choose(['legend'],13),'legend');assert.equal(g.choose(['legend'],26),undefined);assert.equal(g.choose(['boss'],26),'boss');assert.equal(g.choose(['legend'],73),'legend');g.reset();assert.equal(g.choose(['steel'],0),'steel');
});
test('sniper locks aim and respects cover; mortar does one hit; charge cannot hit repeatedly', () => {
  const s=arena(6); const sniper=s.createEnemy('sniper',{x:0,z:-8});s.enemies.push(sniper);sniper.cooldown=0;tick(s);assert.equal(sniper.state,'windup');const h=s.hazards[0];const angle=h.angle; s.player.x=5;tick(s,10);assert.equal(h.angle,angle);
  s.enemies=[];s.hazards=[];s.player.x=0;s.obstacles=[{id:4,x:0,z:-3,w:4,d:1,hp:Infinity,kind:'cover'}];s.addHazard(sniper,sniper,.3,.01,20,'line',0,20,true);tick(s,20);assert.equal(s.player.hp,100);
  s.obstacles=[];s.addHazard(sniper,s.player,2,.01,16);tick(s,10);assert.equal(s.player.hp,84);tick(s,20);assert.equal(s.player.hp,84);
  const saw=s.createEnemy('saw',{x:0,z:-1});s.enemies=[saw];saw.state='execute';saw.angle=0;saw.stateTime=.5;tick(s,15);assert.equal(s.player.hp,68);
});
test('barrier blocks frontal shots, side shots work; medic cannot heal bosses', () => {
  const s=arena(9), e=s.createEnemy('barrier',{x:0,z:-3});e.angle=0;e.cooldown=999;s.enemies=[e];s.player.angle=Math.PI;s.shoot(s.player,'roma',25);s.updateBullets(.15);assert.equal(e.hp,e.maxHp);
  s.player.x=3;s.player.z=-3;s.player.angle=-Math.PI/2;s.shoot(s.player,'roma',25);s.updateBullets(.15);assert.equal(e.hp,e.maxHp-25);
  const boss=s.createEnemy('drill',{x:2,z:2});boss.hp=100;const medic=s.createEnemy('medic',{x:2,z:3});medic.cooldown=0;s.enemies=[boss,medic];s.updateEnemy(medic,1/60);assert.equal(boss.hp,100);
});
test('boss phases, summon cap, reserved boss portals and rewards', () => {
  const s=arena(15);s.spawnTimer=0;s.remainingToSpawn=s.wavePlan.count;tick(s,62);assert.deepEqual(s.portals.map(p=>p.kind),['factory','squall']);
  const f=s.createEnemy('factory',{x:0,z:-5});f.hp=f.maxHp/2;f.cooldown=0;s.enemies=[f];s.portals=[];s.updateEnemy(f,1/60);assert.ok(f.enraged);assert.equal(f.state,'windup');s.updateEnemy(f,1);assert.ok(s.bullets.length>=16);assert.equal(s.portals.length,3);
  while(s.enemies.length+s.portals.length<12)s.enemies.push(s.createEnemy('light',{x:12,z:12}));assert.equal(s.queueEnemy('light'),false);
  s.enemies=[f];s.killEnemy(f);assert.equal(s.score,1500);assert.ok(s.events.some(e=>e.callout==='boss'));const mini=s.createEnemy('saw',{x:0,z:0});s.enemies=[mini];s.killEnemy(mini);assert.equal(s.score,2000);
});
test('death stops all gameplay immediately; animation lasts .8 game seconds including pause', () => {
  const s=arena();s.score=123;s.damagePlayer(200);assert.equal(s.phase,'dying');const elapsed=s.elapsed;tick(s,20);s.pause();const death=s.deathTime;tick(s,120);assert.equal(s.deathTime,death);s.resume();tick(s,29);assert.equal(s.phase,'over');assert.equal(s.elapsed,elapsed);assert.equal(s.score,123);
});
test('old mute migrates to independent switches without losing record', () => {
  let data=JSON.stringify({record:{score:1234,wave:8,time:900},muted:true});const b={getItem:()=>data,setItem:(_k:string,v:string)=>data=v};let s=new GameStorage(b);assert.ok(s.muted&&s.musicMuted&&s.narratorMuted);s.musicMuted=false;s.save();s=new GameStorage(b);assert.equal(s.record.score,1234);assert.equal(s.musicMuted,false);assert.equal(s.narratorMuted,true);
});


test('every bundled announcer clip contains audible PCM speech, not an empty synthesis result', () => {
  for(const key of ['steel','unstoppable','master','legend','six','boss','point','power','lastStand']){
    const b=readFileSync(new URL(`../public/audio/${key}.wav`,import.meta.url));let pos=12,data:Buffer|undefined;
    while(pos+8<=b.length){const size=b.readUInt32LE(pos+4);if(b.toString('ascii',pos,pos+4)==='data'){data=b.subarray(pos+8,pos+8+size);break;}pos+=8+size+(size%2);}
    assert.ok(data&&data.length>19000,key);let energy=0;for(let i=0;i<data.length-1;i+=2)energy+=data.readInt16LE(i)**2;assert.ok(Math.sqrt(energy/(data.length/2))/32768>.005,key);
  }
});

test('pickup feedback reports actual armor and charge gains, full meters and rapid duration', () => {
  const s=arena();s.player.hp=95;s.charge=60;s.pickups=[{id:901,x:0,z:0,kind:'heal',life:12},{id:902,x:0,z:0,kind:'charge',life:12},{id:903,x:0,z:0,kind:'rapid',life:12}];tick(s);
  assert.deepEqual(s.drainEvents().filter(e=>e.type==='pickup').map(e=>[e.pickupKind,e.amount,e.text]),[['heal',5,'+5 К БРОНЕ'],['charge',7,'+7 К ЗАРЯДУ'],['rapid',6,'ОГОНЬ ×2 · 6 СЕК']]);
  s.pickups=[{id:904,x:0,z:0,kind:'heal',life:12},{id:905,x:0,z:0,kind:'charge',life:12}];tick(s);
  assert.deepEqual(s.drainEvents().filter(e=>e.type==='pickup').map(e=>e.text),['ЗАРЯД ПОЛОН']); assert.equal(s.pickups[0]?.kind,'heal');
});
