import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { AimSector } from '../src/aim-sector';
import { ShotTrails, type TrailShot } from '../src/shot-trails';
import { muzzles } from '../src/weapons';
import type { Obstacle } from '../src/config';
test('lasers originate at displayed muzzles with recoil in all directions, including twin guns',()=>{
 const laser=new AimSector();
 for(const power of [false,true])for(let i=0;i<8;i++){
  const pose={x:3,z:-2,angle:i*Math.PI/4,recoil:.7};laser.update(pose,[],true,power,.1);
  const tips=muzzles(pose,power);for(let n=0;n<tips.length;n++){
   const beam=laser.root.children[n] as THREE.Mesh;laser.root.updateMatrixWorld(true);const start=beam.getWorldPosition(new THREE.Vector3());
   assert(start.distanceTo(new THREE.Vector3(tips[n].x,tips[n].y,tips[n].z))<1e-7);assert.equal(beam.rotation.y,pose.angle);assert.equal(beam.scale.z,3.8);
  }
  assert.equal(laser.root.children[1].visible,power);assert(!laser.root.children[2].visible);assert(!laser.root.children[3].visible);
 }
});
test('only nearby cover gets a contact dot; no laser behind cover intersecting the barrel',()=>{
 const v=new AimSector(),p={x:0,z:0,angle:0};
 const wall:Obstacle={id:1,x:0,z:4,w:10,d:1,kind:'cover',hp:Infinity};
 v.update(p,[wall],true,false,.1);assert(v.root.children[0].visible);assert(v.root.children[2].visible);
 assert(v.root.children[2].position.z<3.5);
 v.update(p,[{...wall,z:1}],true,false,.1);assert(!v.root.children[0].visible);assert(!v.root.children[2].visible);
 v.update(p,[],false,false,.1);assert(!v.root.visible);
 v.update(p,[],true,false,.1,false,false);assert(!v.root.visible,'old aim never resumes after death/menu');
});
const shot=(id=1,x=0,z=2):TrailShot=>({id,x,z,y:1.13,vx:0,vz:30,power:false});
test('trails begin empty, grow behind their own shot, stop at cover and fade without following the tank',()=>{
 const t=new ShotTrails();t.update([shot()],[],.016);const mesh=t.root.children[0] as THREE.Mesh<THREE.BufferGeometry,THREE.ShaderMaterial>;assert(!mesh.visible);
 t.update([shot(1,0,3)],[],.016);assert(mesh.visible);assert.equal(mesh.position.z,2);assert.equal(mesh.scale.z,1);assert.equal(mesh.position.y,1.13);
 t.update([shot(1,0,4)],[],.016);assert.equal(mesh.scale.z,1.4);const end=mesh.position.clone();
 t.update([],[],.05);assert(mesh.position.equals(end));assert(mesh.material.uniforms.strength.value<.52);assert(mesh.visible);
 t.update([],[],.08);assert.equal(t.stats().active,0);assert(!mesh.visible);
 const wall:Obstacle={id:1,x:0,z:2.4,w:10,d:.2,kind:'cover',hp:Infinity};
 t.update([shot(2,0,2.8)],[],.016);t.update([shot(2,0,3.5)],[wall],.016);assert(mesh.position.z>2.5);
});
test('trail pool stays bounded through bursts, five resets and reduced motion',()=>{
 const t=new ShotTrails();
 for(let run=0;run<5;run++){
  t.update(Array.from({length:160},(_,id)=>shot(id)),[],.016);assert.equal(t.stats().allocated,32);
  t.update(Array.from({length:160},(_,id)=>shot(id,0,4)),[],.016,true);
  for(const m of t.root.children)assert((m as THREE.Mesh).scale.z<=.65);
  t.update([],[],0,true);assert.equal(t.stats().active,0);
  t.reset();assert.equal(t.stats().allocated,32);assert(t.root.children.every(m=>!m.visible));
 }
});
