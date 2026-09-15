import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation, emptyInput } from '../src/simulation.ts';
import type { Enemy } from '../src/simulation.ts';
import { CONFIG as C } from '../src/config.ts';
import { GameStorage } from '../src/storage.ts';

function arena() { const sim = new Simulation(); sim.start(false); sim.remainingToSpawn = 1; sim.spawnTimer = 99999; sim.player.x = 0; sim.player.z = 0; sim.lev.x = 15; sim.lev.z = 12; sim.obstacles = []; return sim; }
const tick = (sim: Simulation, n = 1) => { for (let i = 0; i < n; i++) sim.update(1 / 60, emptyInput()); };
const enemy = (id: number, x: number, z: number, hp = 25): Enemy => ({ id, x, z, hp, maxHp: hp, angle: 0, bodyAngle: 0, cooldown: 9999, recoil: 0, kind: 'light', state: 'move', stateTime: 0, target: {x,z}, attack: 0, attackHit: false, enraged: false, burst: 0, shotDelay: 0, path: [], pathTimer: 9999 });

test('charge caps at 67; seven-second power protects the player and cannot stack', () => {
  const sim = arena(); sim.addCharge(66); assert.equal(sim.activatePower(), false); sim.addCharge(10); assert.equal(sim.charge, 67);
  assert.equal(sim.activatePower(), true); assert.equal(sim.charge, 0); sim.addCharge(60); assert.equal(sim.charge, 0); assert.equal(sim.activatePower(), false);
  sim.damagePlayer(100); assert.equal(sim.player.hp, 100); tick(sim, 419); assert.ok(sim.powerTime > 0 && sim.powerTime < 0.02); tick(sim, 2); assert.equal(sim.powerTime, 0);
  sim.damagePlayer(10); assert.equal(sim.player.hp, 90);
});

test('pause freezes simulation, healing, wave portals and power; resume preserves them', () => {
  const sim = arena(); sim.charge = 67; sim.activatePower(); sim.healTimer = 12; sim.queueEnemy(); sim.pause();
  const before = JSON.stringify({ elapsed: sim.elapsed, power: sim.powerTime, heal: sim.healTimer, portals: sim.portals, player: sim.player });
  tick(sim, 600); assert.equal(JSON.stringify({ elapsed: sim.elapsed, power: sim.powerTime, heal: sim.healTimer, portals: sim.portals, player: sim.player }), before);
  assert.equal(sim.activatePower(), false); sim.resume(); tick(sim); assert.ok(sim.powerTime < 7); assert.ok(sim.healTimer < 12);
});

test('player hit and kill award 11 charge and 100 score; Lev kills count too', () => {
  const sim = arena(); sim.enemies = [enemy(10, 0, -3)]; sim.player.angle = Math.PI; sim.shoot(sim.player, 'roma', 25);
  tick(sim, 8); assert.equal(sim.enemies.length, 0); assert.equal(sim.score, 100); assert.equal(sim.charge, 11);
  sim.enemies = [enemy(11, 0, -3, 10)]; sim.shoot(sim.player, 'lev', 10); tick(sim, 8); assert.equal(sim.score, 200); assert.equal(sim.charge, 21);
});

test('cover stops shells; two hits destroy a crate; friendly fire is ignored', () => {
  const sim = arena(); sim.obstacles = [{ id: 1, x: 0, z: -2, w: 1, d: 0.4, kind: 'crate', hp: 50 }]; sim.enemies = [enemy(10, 0, -4)]; sim.player.angle = Math.PI;
  sim.shoot(sim.player, 'roma', 25); tick(sim, 5); assert.equal(sim.obstacles[0].hp, 25); assert.equal(sim.enemies[0].hp, 25);
  sim.shoot(sim.player, 'roma', 25); tick(sim, 5); assert.equal(sim.obstacles.length, 0); assert.equal(sim.enemies[0].hp, 25);
  sim.player.angle = 0; sim.lev.x = 0; sim.lev.z = 2; sim.shoot(sim.player, 'roma', 25); tick(sim, 12); assert.equal(sim.lev.hp, 100); assert.equal(sim.player.hp, 100);
});

test('Lev repairs at the threshold, then waits twenty seconds', () => {
  const sim = arena(); sim.lev.x = 2; sim.lev.z = 0; sim.player.hp = 60; tick(sim); assert.equal(sim.player.hp, 80); assert.equal(sim.healTimer, 20);
  sim.player.hp = 40; tick(sim, 1199); assert.equal(sim.player.hp, 40); tick(sim, 2); assert.equal(sim.player.hp, 60);
});

test('spawn warning lasts 1.5 seconds and begins away from player', () => {
  const sim = arena(); sim.remainingToSpawn = 4; sim.queueEnemy(); const portal = sim.portals[0]; assert.ok(Math.hypot(portal.x, portal.z) > 11);
  tick(sim, 89); assert.equal(sim.enemies.length, 0); tick(sim, 2); assert.equal(sim.enemies.length, 1);
});

test('late-wave spawning respects the 24-total and 12-active limits; difficulty caps at double', () => {
  const sim=new Simulation();sim.start(false);sim.wave=100;sim.beginWave();assert.equal(sim.remainingToSpawn,24);assert.equal(sim.scale(),2);
  let peak=0;for(let i=0;i<1800;i++){sim.player.hp=100;sim.update(1/60,emptyInput());sim.drainEvents();peak=Math.max(peak,sim.enemies.length+sim.portals.length);assert.ok(sim.enemies.length+sim.portals.length<=12);}
  assert.equal(peak,12);assert.ok(sim.remainingToSpawn>=0);assert.ok(sim.enemies.every(e=>e.maxHp===C.enemy[e.kind].hp*2));
});

test('wave completion awards its bonus exactly once and respects the six-second break', () => {
  const sim = arena(); sim.remainingToSpawn = 0; tick(sim); assert.equal(sim.score, 250); assert.equal(sim.breakTime, 6);
  tick(sim, 359); assert.equal(sim.wave, 1); assert.equal(sim.score, 250); tick(sim, 2); assert.equal(sim.wave, 2); assert.equal(sim.score, 250);
});

test('pathfinding routes around cover and hull cannot cross arena walls', () => {
  const sim = arena(); sim.obstacles = [{ id: 1, x: 0, z: 0, w: 5, d: 3, kind: 'cover', hp: Infinity }];
  const path = sim.findPath({x:0,z:6}, {x:0,z:-6}); assert.ok(path.length > 3); assert.ok(path.some(p => Math.abs(p.x) > 3));
  for (const p of path) assert.ok(sim.walkable(p.x,p.z,0.7));
  sim.player.x = 18; sim.player.z = 5; for (let i=0;i<120;i++) sim.update(1/60,{...emptyInput(),x:1}); assert.ok(sim.player.x <= C.arena.halfWidth - C.player.radius);
});

test('a shot grazing a cover corner is not considered a clear firing lane', () => {
  const sim = new Simulation();
  assert.equal(sim.lineOfSight({x:8.1239304887,z:-4.4981359864},{x:13.99070369,z:-7.905598}),false);
  const path=sim.findPath({x:5.0,z:2.0},{x:12,z:2.0}); assert.ok(path.length>0);
});

test('frequent path replanning continues forward instead of returning to the starting cell', () => {
  const sim=arena(); sim.player.x=-16.056; sim.player.z=-8.556;
  for(let i=0;i<180;i++){const path=sim.findPath(sim.player,{x:0,z:7}); if(path[0])sim.follow(sim.player,path,3,0.7,1/60);}
  assert.ok(sim.player.x>-12 && sim.player.z>-5);
});

test('intro finishes within eight seconds; pause and skip work', () => {
  const sim = new Simulation(); sim.start(true); tick(sim, 180); sim.pause(); const old = sim.introTime; tick(sim, 180); assert.equal(sim.introTime, old); sim.resume(); sim.skipIntro(); assert.equal(sim.phase, 'playing'); assert.equal(sim.wave, 1);
  sim.start(true); tick(sim, 400); assert.equal(sim.phase, 'playing'); assert.ok(sim.events.some(e => e.text === C.lines.hello));
});

test('game over freezes the score; restart clears gameplay objects and restores crates', () => {
  const sim = arena(); sim.queueEnemy(); sim.charge = 50; sim.score = 900; sim.damagePlayer(100); assert.equal(sim.phase, 'dying'); tick(sim, 120); assert.equal(sim.phase, 'over'); assert.equal(sim.score, 900);
  sim.start(false); assert.equal(sim.player.hp, 100); assert.equal(sim.score, 0); assert.equal(sim.charge, 0); assert.equal(sim.wave, 1); assert.equal(sim.portals.length, 0); assert.equal(sim.bullets.length, 0); assert.equal(sim.enemies.length, 0); assert.ok(sim.obstacles.length > 5);
});

test('local record survives reload; corrupt or unavailable storage does not prevent play', () => {
  let data: string | null = null; const backend = { getItem: () => data, setItem: (_: string, v: string) => { data = v; } };
  const store = new GameStorage(backend); assert.ok(store.submit({score:650,wave:2,time:56})); store.muted = true; store.save(); const restored = new GameStorage(backend); assert.equal(restored.record.score,650); assert.ok(restored.muted); assert.equal(restored.submit({score:100,wave:1,time:10}),false);
  data = '{bad json'; assert.equal(new GameStorage(backend).record.score,0);
  const blocked = new GameStorage({getItem:()=>{throw Error('blocked')},setItem:()=>{throw Error('blocked')}}); assert.doesNotThrow(()=>blocked.submit({score:100,wave:1,time:2}));
});

