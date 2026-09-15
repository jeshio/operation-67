import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation, type Bullet, type Enemy, type Point } from '../src/simulation';
import { CONFIG as C, type EnemyKind } from '../src/config';
import { HULL, PROJECTILE, enemyHitTime, enemyModelScale } from '../src/tank-shape';
import { presentEnemies, presentFriendlyBullet } from '../src/combat-view';

function arena(){const s=new Simulation();s.start(false);s.obstacles=[];s.enemies=[];s.bullets=[];s.drainEvents();return s;}
function world(e:Enemy,x:number,z:number):Point{return{x:e.x+Math.cos(e.bodyAngle)*x+Math.sin(e.bodyAngle)*z,z:e.z-Math.sin(e.bodyAngle)*x+Math.cos(e.bodyAngle)*z};}
function shell(s:Simulation,from:Point,to:Point,extra:Partial<Bullet>={}){
  const b:Bullet={id:99001,...from,vx:(to.x-from.x)*10,vz:(to.z-from.z)*10,owner:'roma',damage:25,power:false,life:4,source:0,...extra};s.bullets.push(b);return b;
}

test('all enemy hulls register grazing track hits in eight body directions; real outside shots miss',()=>{
  for(const kind of Object.keys(C.enemy) as EnemyKind[])for(let i=0;i<8;i++){
    const s=arena(),e=s.createEnemy(kind,{x:0,z:0}),scale=enemyModelScale(kind);e.bodyAngle=e.angle=i*Math.PI/4;e.state='recover';s.enemies=[e];
    const x=.9*scale,from=world(e,x,-6),to=world(e,x,6);const before=e.hp;
    assert.notEqual(enemyHitTime(from,to,e),undefined,`${kind}: visible track at ${i}`);
    shell(s,from,to);s.updateBullets(.1);assert(e.hp<before,`${kind}: graze must cause real damage`);assert.equal(s.bullets.length,0);
    if(['drill','hail','factory'].includes(kind))assert(x>C.enemy[kind].radius+PROJECTILE.radius,'reproduces a miss with the old undersized circle');
    s.enemies=[e];e.hp=e.maxHp;s.bullets=[];e.kind=kind;
    // The Barrier's front plate is wider than the tracks.
    const edge=(kind==='barrier'?HULL.shieldWidth/2:HULL.trackX+HULL.trackHitWidth/2)*scale+PROJECTILE.radius+.03;
    const missFrom=world(e,edge,-6),missTo=world(e,edge,6);
    assert.equal(enemyHitTime(missFrom,missTo,e),undefined,`${kind}: clear of armour`);
    shell(s,missFrom,missTo);s.updateBullets(.1);assert.equal(e.hp,e.maxHp);assert.equal(s.bullets.length,1);
  }
});

test('continuous contact picks the nearest target independent of array order and cannot tunnel',()=>{
  const s=arena(),near=s.createEnemy('shooter',{x:0,z:2}),far=s.createEnemy('shooter',{x:0,z:5});s.enemies=[far,near];
  shell(s,{x:0,z:-5},{x:0,z:8});s.updateBullets(.1);
  assert.equal(near.hp,25);assert.equal(far.hp,50);assert.equal(s.bullets.length,0);
  near.hp=far.hp=50;const b=shell(s,{x:0,z:-5},{x:0,z:8},{pierce:true});s.updateBullets(.1);
  assert.equal(near.hp,25);assert.equal(far.hp,37.5);assert.deepEqual(b.hitIds,[near.id,far.id]);assert.equal(s.bullets.length,0);
});

test('cover stops a shell before the boss, while exposed armour before a wall remains hittable',()=>{
  const s=arena(),e=s.createEnemy('factory',{x:0,z:5});e.bodyAngle=0;s.enemies=[e];
  s.obstacles=[{id:99,x:0,z:1,w:6,d:.1,kind:'cover',hp:Infinity}];
  shell(s,{x:1.6,z:-5},{x:1.6,z:10},{pierce:true,splash:true});s.updateBullets(.1);assert.equal(e.hp,e.maxHp);assert.equal(s.bullets.length,0);
  s.obstacles[0].z=8;shell(s,{x:1.6,z:-5},{x:1.6,z:10});s.updateBullets(.1);assert.equal(e.hp,e.maxHp-25);
});

test('wide Barrier plate blocks piercing shots from the front and shells starting inside a boss hit once',()=>{
  const s=arena(),e=s.createEnemy('barrier',{x:0,z:0});e.angle=Math.PI;e.bodyAngle=0;s.enemies=[e];
  shell(s,{x:1.5,z:-5},{x:1.5,z:5},{pierce:true});s.updateBullets(.1);assert.equal(e.hp,e.maxHp);assert.equal(s.bullets.length,0);assert(s.drainEvents().some(e=>e.type==='shield'));
  const boss=s.createEnemy('factory',{x:0,z:0});s.enemies=[boss];shell(s,{x:0,z:0},{x:0,z:5});s.updateBullets(.1);
  assert.equal(boss.hp,boss.maxHp-25);assert.equal(s.drainEvents().filter(e=>e.type==='hit').length,1);
});

test('fresh enemy presentation is bounded, freezes at cover and never extrapolates an attack transition',()=>{
  const s=arena(),old=s.createEnemy('drill',{x:0,z:0});old.state='execute';const now={...old,x:.9};
  const show=(elapsed:number,free=true)=>presentEnemies([now],[old],.05,elapsed,()=>free,()=>free)[0];
  assert.equal(show(.025).x,1.35);assert.equal(show(5).x,1.8);assert.equal(show(.05,false).x,.9);
  const transition={...now,state:'recover' as const};assert.equal(presentEnemies([transition],[old],.05,.05,()=>true,()=>true)[0].x,.9);
  assert.equal(presentEnemies([now],[old],0,.05,()=>true,()=>true)[0].x,.9);
  assert.equal(presentEnemies([{...now,x:10}],[old],.05,.05,()=>true,()=>true)[0].x,10);
  assert.equal(now.x,.9,'presentation never mutates authority');
});

test('friendly extrapolation stops at the same visible hull surface and does not fake damage',()=>{
  const s=arena(),e=s.createEnemy('factory',{x:0,z:0});e.bodyAngle=0;s.enemies=[e];
  const b=shell(s,{x:1.6,z:-3},{x:1.6,z:9}),expected=enemyHitTime(b,{x:b.x,z:b.z+b.vz*.05},e)!;
  const shown=presentFriendlyBullet(b,.05,[e],[]);assert(Math.abs(shown.z-(b.z+b.vz*.05*expected))<1e-8);assert(shown.z<0);assert.equal(e.hp,e.maxHp);assert.equal(s.events.length,0);
  const inside={...b,x:e.x,z:e.z,hitIds:[e.id]};assert(presentFriendlyBullet(inside,.05,[e],[]).z>inside.z,'confirmed piercing may leave its first target');
  const covered=presentFriendlyBullet(b,.05,[],[{id:99,x:0,z:-2.5,w:5,d:.1,kind:'cover',hp:Infinity}]);assert(covered.z<-2.5);
});
