import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation, emptyInput } from '../src/simulation';
import { CoopSimulation } from '../src/coop';
import { advanceKnockback, RAM_PUSH } from '../src/knockback';
import { CONFIG as C } from '../src/config';
function arena(){const s=new Simulation();s.start(false);s.obstacles=[];s.remainingToSpawn=1;s.spawnTimer=9999;s.healTimer=999;Object.assign(s.player,{x:0,z:0});Object.assign(s.lev,{x:.6,z:0});return s;}
for(const kind of ['drill','saw'] as const)test(`${kind}: throws both teams and helper; only opposing humans take damage once per rush`,()=>{
 const s=arena(),boss=s.createEnemy(kind,{x:0,z:-1.6}),ally=s.createEnemy('shooter',{x:-.5,z:0});boss.angle=0;boss.state='execute';boss.stateTime=.65;s.enemies=[boss,ally];
 const old=s.player.hp,allyHp=ally.hp,levHp=s.lev.hp;s.updateEnemy(boss,1/60);assert(s.player.knockback);assert(s.lev.knockback);assert(ally.knockback);assert.equal(old-s.player.hp,C.enemy[kind].damage);assert.equal(ally.hp,allyHp);assert.equal(s.lev.hp,levHp);
 const before=s.player.z;for(let i=0;i<10;i++){s.updateControlled(1/60,emptyInput());s.updateEnemy(ally,1/60);s.updateLev(1/60);s.updateEnemy(boss,1/60);}assert(s.player.z>before+1);assert(ally.z>0);assert(s.lev.z>0);assert.equal(s.player.hp,old-C.enemy[kind].damage);assert.equal(ally.hp,allyHp);
});
test('shield preserves armor but does not prevent pushing; each coop human damaged only once',()=>{
 const s=new CoopSimulation();const a=s.addMember(-1,'Рома',0),b=s.addMember(-2,'Лев',1);s.start(false);s.obstacles=[];a.shield=0;b.shield=7;for(const [i,m] of [a,b].entries())Object.assign(m.tank,{x:i*.7,z:0});
 const boss=s.createEnemy('drill',{x:0,z:-1.6});boss.angle=0;boss.state='execute';boss.stateTime=.65;s.enemies=[boss];for(let i=0;i<3;i++)s.updateEnemy(boss,1/60);
 assert(a.tank.knockback&&b.tank.knockback);assert.equal(a.tank.hp,78);assert.equal(b.tank.hp,100);assert.equal(s.events.filter(e=>e.type==='hit'&&e.target===a.id).length,1);
});
test('push is bounded, sweeps thin cover and arena edges, preserves turret and hull angles',()=>{
 for(const obstacle of [true,false]){const s=arena();s.obstacles=obstacle?[{id:9,x:0,z:2,w:20,d:.1,kind:'cover',hp:Infinity}]:[];Object.assign(s.player,{z:obstacle?0:14,knockback:{x:0,z:32,remaining:.3,source:9}});const angle=s.player.angle,body=s.player.bodyAngle;
  advanceKnockback(s.player,1,.64,(x,z,r)=>s.walkable(x,z,r));assert(s.player.z<= (obstacle?1.31:14.36)+1e-8);assert(!s.player.knockback);assert.equal(s.player.angle,angle);assert.equal(s.player.bodyAngle,body);
 }
 const s=arena();s.player.knockback={x:0,z:32,remaining:.3,source:1};advanceKnockback(s.player,1,.64,()=>true);assert(s.player.z>4&&s.player.z<5);
});
test('cover prevents contact through walls and each second rush can damage again',()=>{
 const s=arena(),boss=s.createEnemy('drill',{x:0,z:-1.4});boss.angle=0;boss.state='execute';boss.stateTime=.65;s.enemies=[boss];s.obstacles=[{id:99,x:0,z:-.7,w:20,d:.15,kind:'cover',hp:Infinity}];s.updateEnemy(boss,1/60);assert.equal(s.player.hp,100);assert(!s.player.knockback);
 s.obstacles=[];boss.state='execute';boss.stateTime=.65;s.updateEnemy(boss,1/60);assert.equal(s.player.hp,78);boss.state='windup';boss.stateTime=0;s.updateEnemy(boss,1/60);s.updateEnemy(boss,1/60);assert.equal(s.player.hp,56);
});
test('pause freezes impulse; new battle and respawn remove it; integration is frame independent',()=>{
 const s=arena();s.player.knockback={x:32,z:0,remaining:RAM_PUSH.duration,source:8};s.pause();s.update(1,emptyInput());assert.equal(s.player.knockback.remaining,RAM_PUSH.duration);assert.equal(s.player.x,0);s.start(false);assert(!s.player.knockback);
 const co=new CoopSimulation(),m=co.addMember(-1,'Рома',0);m.tank.knockback={x:32,z:0,remaining:.3,source:8};co.spawn(m,50);assert(!m.tank.knockback);
 const a={x:0,z:0,hp:100,knockback:{x:20,z:10,remaining:.3,source:8}},b=structuredClone(a);advanceKnockback(a,.3,.64,()=>true);for(let i=0;i<18;i++)advanceKnockback(b,1/60,.64,()=>true);assert(Math.hypot(a.x-b.x,a.z-b.z)<1e-8);
});

test('a tank pushed into another hull can drive out, but cannot drive deeper or enter a fresh overlap',()=>{
 const s=arena(),enemy=s.createEnemy('light',{x:0,z:0});s.enemies=[enemy];s.player.x=.5;s.player.z=0;s.move(s.player,.1,0,.64);assert.equal(s.player.x,.6);s.move(s.player,-.1,0,.64);assert.equal(s.player.x,.6);s.player.x=1.3;s.move(s.player,-.1,0,.64);assert.equal(s.player.x,1.3);
});

test('pathfinding escapes cover safety margin after a shove without crossing the physical cover',()=>{
 const s=new Simulation();s.start(false);const from={x:2.1019348233330386,z:-5.931081685004775},goal={x:14,z:0};assert(s.walkable(from.x,from.z,.64));assert(!s.walkable(from.x,from.z,.7));const path=s.findPath(from,goal,.7);assert(path.length>0);assert(s.lineOfSight(from,path[0],.6));Object.assign(s.player,from);s.enemies=[];for(let i=0;i<120;i++)s.follow(s.player,path,7,.64,1/60);assert(Math.hypot(s.player.x-from.x,s.player.z-from.z)>2);assert(s.walkable(s.player.x,s.player.z,.64));
});

test('player ram throws enemies and solo helper, damaging each enemy once per dash',()=>{
 const s=arena();s.player.modules=['ram'];s.dashDirection={x:0,z:1};s.dashTime=.2;Object.assign(s.lev,{x:.4,z:1});
 const enemy=s.createEnemy('shooter',{x:-.4,z:1});s.enemies=[enemy];const hp=enemy.hp;
 s.updateControlled(1/60,emptyInput());assert(enemy.knockback&&s.lev.knockback);assert.equal(enemy.hp,hp-40);assert.equal(s.lev.hp,100);
 s.updateControlled(1/60,emptyInput());assert.equal(enemy.hp,hp-40);s.updateEnemy(enemy,1/60);assert(enemy.z>1);
});
test('coop ram throws teammates without damage and preserves adrenaline ram damage',()=>{
 const s=new CoopSimulation(),a=s.addMember(-1,'Рома',0),b=s.addMember(-2,'Лев',1);s.start(false);s.obstacles=[];
 Object.assign(a.tank,{x:0,z:0,modules:['ram'],adrenaline:true});Object.assign(b.tank,{x:.4,z:1});a.dashTime=.2;a.dashDirection={x:0,z:1};
 const enemy=s.createEnemy('barrier',{x:-.4,z:1});enemy.angle=0;enemy.state='recover';s.enemies=[enemy];const hp=enemy.hp;
 s.inPlayer(a,()=>s.updateControlled(1/60,emptyInput()));assert(b.tank.knockback&&enemy.knockback);assert.equal(b.tank.hp,100);assert.equal(enemy.hp,hp-52);
 s.inPlayer(b,()=>s.updateControlled(1/60,{...emptyInput(),fire:true,aim:{x:0,z:10}}));assert(b.tank.z>1);assert(s.events.some(e=>e.type==='shot'&&e.source===b.id));
});
test('player shove requires ram module, active dash, frontal contact and unobstructed path',()=>{
 for(const variant of ['no-module','no-dash','behind','wall'] as const){
 const s=arena();s.player.modules=variant==='no-module'?[]:['ram'];s.dashTime=variant==='no-dash'?0:.2;s.dashDirection={x:0,z:1};
 const enemy=s.createEnemy('shooter',{x:0,z:variant==='behind'?-1:1});s.enemies=[enemy];const hp=enemy.hp;
 if(variant==='wall')s.obstacles=[{id:99,x:0,z:.5,w:5,d:.1,kind:'cover',hp:Infinity}];
 s.updateControlled(1/60,emptyInput());assert(!enemy.knockback,variant);assert.equal(enemy.hp,hp,variant);
 }
});
