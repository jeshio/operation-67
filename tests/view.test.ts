import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { calculateLayout, inside, edgePoint, groupThreats } from '../src/view.ts';
import { ArenaCamera, projectPoint, groundPoint } from '../src/camera.ts';

function rig(width=390,height=844) {const layout=calculateLayout(width,height,true),camera=new THREE.OrthographicCamera(-1,1,1,-1,.1,180),follow=new ArenaCamera(camera);follow.configure(layout);return {layout,camera,follow};}
test('portrait free view excludes safe areas, bars and thumb controls even with Safari chrome',()=>{
  for(const [w,h] of [[360,640],[390,844],[430,932],[360,500],[390,600]]){
    const l=calculateLayout(w,h,true,{top:47,right:16,bottom:34,left:16});
    assert.ok(l.portrait);assert.ok(l.free.top>=135);assert.ok(l.free.bottom<=h-34-220);assert.ok(l.free.bottom-l.free.top>=48);assert.ok(inside(l.anchor,l.free));
  }
  assert.equal(calculateLayout(844,390,true).portrait,false);assert.equal(calculateLayout(390,844,false).portrait,false);
});
test('camera projects and unprojects consistently, follows with a fixed scale and preserves all aim directions',()=>{
  const {layout,camera,follow}=rig();follow.update({x:0,z:0},'playing',1/60);
  const initial=projectPoint(camera,layout,{x:0,z:0});assert.ok(Math.abs(initial.x-195)<1e-8);assert.ok(Math.abs(initial.y-844*.45)<1e-8);
  for(let i=0;i<60;i++)follow.update({x:7,z:4},'playing',1/60);
  assert.equal(camera.right-camera.left,24);
  for(const p of [{x:7,z:4},{x:-18,z:14},{x:18,z:-14}]){const q=groundPoint(camera,layout,projectPoint(camera,layout,p));assert.ok(Math.hypot(q.x-p.x,q.z-p.z)<1e-8);}
  const player={x:7,z:4},origin=projectPoint(camera,layout,player);
  for(const [x,y] of [[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1],[0,-1],[1,-1]]){
    const target=groundPoint(camera,layout,{x:origin.x+x*70,y:origin.y+y*70}),q=projectPoint(camera,layout,target);
    assert.ok(Math.abs((q.x-origin.x)*y-(q.y-origin.y)*x)<1e-8);
  }
});
test('all arena edges and a fast dash remain clear of HUD and abilities',()=>{
  for(const [w,h] of [[360,500],[360,640],[390,844],[430,932]]){
    const {layout,camera,follow}=rig(w,h);
    const positions=[{x:0,z:0},...[-18.36,18.36].flatMap(x=>[-14.36,0,14.36].map(z=>({x,z}))),...[-14.36,14.36].map(z=>({x:0,z}))];
    for(const p of positions){follow.update(p,'playing',1/60);const screen=projectPoint(camera,layout,p);assert.ok(inside(screen,layout.free),JSON.stringify({w,h,p,screen,free:layout.free}));}
    follow.reset();follow.update({x:0,z:0},'playing',1/60);
    for(let frame=0;frame<12;frame++){const p={x:frame*.4,z:-frame*.4};follow.update(p,'playing',1/60);assert.ok(inside(projectPoint(camera,layout,p),layout.free));}
  }
});
test('pause and results freeze camera; resize and restart restore a valid view; reduced motion has no lag',()=>{
  const {layout,camera,follow}=rig();follow.update({x:0,z:0},'playing',1/60);follow.update({x:5,z:5},'playing',1/60);
  const before=[...camera.matrixWorld.elements,...camera.projectionMatrix.elements];
  follow.update({x:10,z:10},'paused',100,false,'playing');assert.deepEqual([...camera.matrixWorld.elements,...camera.projectionMatrix.elements],before);
  follow.update({x:10,z:10},'over',100);assert.deepEqual([...camera.matrixWorld.elements,...camera.projectionMatrix.elements],before);
  follow.configure(calculateLayout(844,390,true));follow.update({x:5,z:5},'paused',0,false,'playing');assert.equal(camera.position.x,29);
  follow.configure(layout);follow.reset();follow.update({x:0,z:7},'playing',0);assert.ok(inside(projectPoint(camera,layout,{x:0,z:7}),layout.free));
  follow.update({x:5,z:5},'playing',1/60,true);const p=projectPoint(camera,layout,{x:5,z:5});assert.ok(Math.abs(p.x-layout.anchor.x)<1e-8);assert.ok(Math.abs(p.y-layout.anchor.y)<1e-8);
});
test('edge markers intersect the rectangle, group eight directions and prioritize attacks and bosses',()=>{
  const rect={left:30,right:330,top:100,bottom:450},origin={x:180,y:280};
  const targets=[[180,-100],[1000,280],[180,900],[-1000,280]];
  for(const [x,y] of targets){const p=edgePoint({x,y},origin,rect);assert.ok(inside(p,rect));assert.ok(p.x===30||p.x===330||p.y===100||p.y===450);}
  const groups=groupThreats([{id:1,x:1000,y:280,boss:false,attacking:false,portal:false},{id:2,x:900,y:300,boss:true,attacking:true,portal:false},{id:3,x:180,y:200,boss:false,attacking:false,portal:false}],origin,rect);
  assert.equal(groups.length,1);assert.equal(groups[0].count,2);assert.ok(groups[0].boss&&groups[0].attacking);assert.equal(groups[0].x,330);
  const all=groupThreats(Array.from({length:120},(_,id)=>({id,x:origin.x+1000*Math.cos(id),y:origin.y+1000*Math.sin(id),boss:false,attacking:false,portal:true})),origin,rect);
  assert.ok(all.length<=8);assert.equal(all.reduce((n,m)=>n+m.count,0),120);
});
