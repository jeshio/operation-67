import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { TouchState } from '../src/touch-state';
import { ArenaCamera, projectPoint, stickDirection } from '../src/camera';
import { calculateLayout } from '../src/view';
import { AIM_SECTOR, AimSector, sectorReach } from '../src/aim-sector';
import { Tutorial } from '../src/tutorial';
import type { Obstacle } from '../src/config';

test('right stick centre never fires; deflection, recentring, release and cancel are independent', () => {
  const t = new TouchState(); t.begin('move',1); t.update(1,56,0,56); t.begin('aim',2);
  for (const x of [0,5,56*.18]) { t.update(2,x,0,56); assert(!t.aiming); assert(!t.consume().firePressed); }
  t.update(2,30,0,56); assert(t.aiming); assert(t.consume().firePressed); assert(!t.consume().firePressed);
  t.update(2,0,0,56); assert(!t.aiming); assert(!t.consume().firePressed); assert.equal(t.move.x,1);
  t.update(2,-300,0,56); assert.equal(t.lastAim.x,-1); t.end(2,true); assert(!t.aiming); assert(!t.consume().firePressed);
  assert.equal(t.move.x,1); t.update(2,30,0,56); assert(!t.aiming);
});

test('eight stick aim directions keep their screen direction during camera follow, at every viewport and arena edge', () => {
  for (const [width,height] of [[360,640],[390,844],[430,932],[390,600],[844,390],[1280,720]]) {
    const layout=calculateLayout(width,height,true),camera=new THREE.OrthographicCamera(),rig=new ArenaCamera(camera);rig.configure(layout);
    for (const p of [{x:0,z:7},{x:-18,z:-14},{x:18,z:14},{x:3,z:5}]) {
      rig.update(p,'playing',1/60);
      const origin=projectPoint(camera,layout,p);
      for (let i=0;i<8;i++) {
        const x=Math.cos(i*Math.PI/4),y=Math.sin(i*Math.PI/4),direction=stickDirection(camera,layout,{x,y});
        const target=projectPoint(camera,layout,{x:p.x+direction.x,z:p.z+direction.z});
        assert(Math.abs((target.x-origin.x)*y-(target.y-origin.y)*x)<1e-8);
        assert((target.x-origin.x)*x+(target.y-origin.y)*y>0);
        assert(Math.abs(Math.hypot(direction.x,direction.z)-20)<1e-8);
      }
    }
  }
});

test('personal sector clips before cover, follows turret and reuses geometry across repeated battles', () => {
  const wall:Obstacle={id:99,x:0,z:3,w:10,d:1,kind:'cover',hp:Infinity};
  assert.equal(sectorReach({x:0,z:0},Math.PI, [wall]),AIM_SECTOR.length);
  assert(Math.abs(sectorReach({x:0,z:0},0,[wall])-2.35)<1e-8);
  assert.equal(sectorReach({x:0,z:3},0,[wall]),0);
  const view=new AimSector(),geometries=view.root.children.map(c=>(c as THREE.Mesh).geometry);
  for(let round=0;round<5;round++)for(let i=0;i<8;i++) {
    const p={x:round,z:0,angle:i*Math.PI/4};view.update(p,[wall],true,i%2===0,.1);
    assert.equal(view.root.position.x,round);assert.equal(view.root.children.length,4);
    assert.deepEqual(view.root.children.map(c=>(c as THREE.Mesh).geometry),geometries);
    for(const child of view.root.children) assert(Array.from((child as THREE.Mesh).geometry.attributes.position.array).every(Number.isFinite));
    view.update(p,[wall],false,false);assert(!view.root.visible);
  }
});

test('returning players relearn the right stick while keeping completed dash and boost lessons', () => {
  const t=new Tutorial({getItem:()=>JSON.stringify({'touch:fire':true,'touch:dash':true,'touch:power':true}),setItem(){}});
  assert(!t.knows('fire'));assert(t.knows('dash'));assert(t.knows('power'));assert.equal(t.update(.5,true,true,false),'fire');
  t.confirm([{type:'shot',x:0,z:0,owner:'roma'}],0,false);assert(t.knows('fire'));
});
