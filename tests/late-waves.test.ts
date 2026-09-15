import test from 'node:test';
import assert from 'node:assert/strict';
import { planWave, bossCaption, bossScale } from '../src/waves';
import { CONFIG as C, ENEMY_META } from '../src/config';
import { Simulation, emptyInput } from '../src/simulation';
import { CoopSimulation } from '../src/coop';

test('bosses double strictly after wave 30 and retain both rotations through later cycles',()=>{
  const big=['drill','hail','factory'],mini=['saw','squall','barrier'];
  for(let wave=1;wave<=120;wave++){
    const p=planWave(wave),copies=wave>30?2:1;
    assert.deepEqual(p.bosses.filter(k=>ENEMY_META[k].tier==='boss'),wave%5===0?Array(copies).fill(big[(wave/5-1)%3]):[]);
    assert.deepEqual(p.bosses.filter(k=>ENEMY_META[k].tier==='mini'),wave%3===0?Array(copies).fill(mini[(wave/3-1)%3]):[]);
    assert(p.count<=24);assert.equal(p.captureIndex!==null,[2,7,13].includes((wave-1)%15+1));
  }
  assert.deepEqual(planWave(30).bosses,['factory','saw']);assert.deepEqual(planWave(31).bosses,[]);
  assert.deepEqual(planWave(33).bosses,['squall','squall']);assert.deepEqual(planWave(35).bosses,['drill','drill']);
  assert.equal(bossCaption(planWave(45).bosses),'ЗАВОД ×2 + БАРЬЕР ×2');
  assert.equal(bossCaption(planWave(30).bosses),'ЗАВОД + ПИЛА');
});

test('four boss slots stay reserved against summons for 1–4 players; live plus pending never exceeds 12',()=>{
  for(let n=1;n<=4;n++){
    const s=new CoopSimulation();for(let id=1;id<=n;id++)s.addMember(-id,`Игрок ${id}`,id-1);s.start(false);s.wave=44;s.beginWave();s.obstacles=[];
    for(const m of s.members.values())m.tank.hp=10000;
    for(let i=0;i<8;i++)assert(s.queueEnemy('light'));
    assert(!s.queueEnemy('light'),'summons cannot take the four reserved slots');
    for(let i=0;i<4;i++)assert(s.queueEnemy());
    assert.deepEqual(s.portals.slice(-4).map(p=>p.kind),['factory','factory','barrier','barrier']);
    assert.equal(s.portals.length,12);assert.equal(s.remainingToSpawn,20);assert(!s.queueEnemy());
    s.spawnTimer=999;for(let i=0;i<92;i++){s.updateAll(1/60,new Map());assert(s.enemies.length+s.portals.length<=12);}
    assert.equal(s.enemies.filter(e=>ENEMY_META[e.kind].tier==='boss').length,2);assert.equal(s.enemies.filter(e=>ENEMY_META[e.kind].tier==='mini').length,2);
    for(const e of s.enemies.filter(e=>ENEMY_META[e.kind].tier!=='regular'))assert.equal(e.maxHp,C.enemy[e.kind].hp*bossScale(45).hp*s.multiplier(e.kind));
  }
});

test('late combined wave waits for every boss before its single 20-second break and resets on a new game',()=>{
  const s=new Simulation();s.start(false);s.wave=44;s.beginWave();s.obstacles=[];s.player.hp=10000;s.lev.cooldown=999;
  s.remainingToSpawn=0;s.spawnTimer=999;
  s.enemies=s.wavePlan.bosses.map((kind,i)=>{const e=s.createEnemy(kind,{x:-12+i*8,z:-9});e.state='recover';e.stateTime=999;return e;});
  const bosses=[...s.enemies];
  for(const e of bosses.slice(0,-1)){s.killEnemy(e);s.update(1/60,emptyInput());assert.equal(s.breakTime,0);}
  s.killEnemy(bosses.at(-1)!);s.update(1/60,emptyInput());assert.equal(s.breakTime,20);assert.equal(s.score,4250);
  s.start(false);s.wave=29;s.beginWave();assert.equal(s.wavePlan.bosses.length,2,'restart does not retain late-wave duplication');
});
