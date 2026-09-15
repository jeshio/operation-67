import test from 'node:test';import assert from 'node:assert/strict';import * as THREE from 'three';
import { MODULES,type ModuleId } from '../src/modules';import { makeModulePickup } from '../src/module-pickup';import { makePickup,updatePickup } from '../src/pickup-view';import { UpgradeNotice,MODULE_DETAILS,moduleIcon } from '../src/upgrade-notice';import { calculateLayout,fitHud,placeNames } from '../src/view';import { ArenaCamera,projectPoint,groundPoint } from '../src/camera';
const ids=Object.keys(MODULES) as ModuleId[];
test('all 12 ground upgrades have distinct opaque hardware and no label or case',()=>{
  const signatures=new Set<string>();const geometries=new Set<THREE.BufferGeometry>();
  for(const module of ids){
    let labels=0;const p={id:1,x:0,z:0,kind:'module' as const,module,life:999};const root=makePickup(p,()=>{labels++;return new THREE.Sprite();});
    assert.equal(labels,0);assert(!root.getObjectByName('pickup-label'));assert(!root.getObjectByName('pickup-leader'));
    const hardware=root.getObjectByName(`hardware-${module}`)!;assert(hardware);assert(hardware.children.length>=6);
    signatures.add(JSON.stringify(hardware.children.map(o=>({geometry:(o as THREE.Mesh).geometry.type,position:o.position.toArray(),scale:o.scale.toArray(),rotation:o.rotation.toArray()}))));
    hardware.traverse(o=>{if(o instanceof THREE.Mesh){geometries.add(o.geometry);const m=o.material as THREE.Material;assert(!m.transparent);assert(m.depthTest&&m.depthWrite);}});
    for(let step=0;step<=16;step++){
      updatePickup(root,p,step/2,24/360,true,false);root.updateMatrixWorld(true);const box=new THREE.Box3().setFromObject(hardware);assert(box.max.x-box.min.x>=36*24/360-.01);
    }
    updatePickup(root,p,3,24/360,true,true);const pose=root.getObjectByName('pickup-body')!.rotation.y;updatePickup(root,p,7,24/360,true,true);assert.equal(root.getObjectByName('pickup-body')!.rotation.y,pose);
    assert(MODULE_DETAILS[module]);assert(moduleIcon(module).includes('<svg'));
  }
  assert.equal(signatures.size,12);assert(geometries.size<=4);
  const a=makeModulePickup('magnet'),b=makeModulePickup('magnet');assert.deepEqual(a.children.map(o=>(o as THREE.Mesh).geometry),b.children.map(o=>(o as THREE.Mesh).geometry));
});
test('installation notice accepts own confirmed events only, queues once and freezes while covered',()=>{
  const n=new UpgradeNotice(),event={type:'upgrade' as const,module:'turbo' as const,actorId:-2,x:0,z:0};
  n.accept([event],-1,true);assert(!n.waiting);n.accept([{...event,actorId:-1}],-1,true);assert(n.waiting);
  n.update(0,true);assert.equal(n.current,'turbo');n.update(100,false);assert.equal(n.age,0);
  n.accept([{...event,actorId:-1},{...event,module:'armor',actorId:-1}],-1,true);n.update(4.5,true);assert(!n.current);n.update(0,true);assert.equal(n.current,'armor');n.update(4.5,true);assert(!n.waiting);
  n.accept([{...event,actorId:-1}],-1,true);assert(!n.waiting);n.reset();n.accept([{...event,actorId:undefined}],0,false);n.update(0,true);assert.equal(n.current,'turbo');
});
test('measured HUD keeps tank, aiming projection and markers between panels and controls',()=>{
  for(const [w,h,top,bottom] of [[360,500,235,292],[360,640,240,426],[390,844,290,630],[430,932,290,718]]){
    const layout=fitHud(calculateLayout(w,h,true),top,bottom),camera=new THREE.OrthographicCamera(),rig=new ArenaCamera(camera);rig.configure(layout);
    assert(layout.free.top>=top);assert(layout.free.bottom<=bottom);
    for(const [x,z] of [[0,0],[-18,-13],[18,13],[-18,13],[18,-13]]){
      rig.update({x,z},'playing',1/60);const p=projectPoint(camera,layout,{x,z});assert(p.y>=layout.free.top+23.9&&p.y<=layout.free.bottom-23.9);
      const ground=groundPoint(camera,layout,p);assert(Math.hypot(x-ground.x,z-ground.z)<1e-7);
    }
  }
});
test('nearby names avoid one another, tanks and top panels, and stay on screen',()=>{
  const tags=[{id:1,x:130,y:250,width:110,height:18},{id:2,x:150,y:245,width:120,height:18},{id:3,x:180,y:260,width:100,height:18},{id:4,x:200,y:240,width:80,height:18}];
  const free={left:30,right:330,top:115,bottom:350},placed=placeNames(tags,free);assert(placed.length>=2);
  for(const [i,p] of placed.entries()){
    assert(p.y>=free.top&&p.x>=free.left&&p.x+p.width<=free.right);
    for(const q of placed.slice(i+1))assert(p.x+p.width<=q.x||q.x+q.width<=p.x||p.y+p.height<=q.y||q.y+q.height<=p.y);
  }
});
