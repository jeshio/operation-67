import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { AudioRecovery } from '../src/audio-recovery';
import { GameProfile } from '../src/profile';
import { CoopSimulation } from '../src/coop';
import { Simulation, emptyInput } from '../src/simulation';
import { hitFeedback } from '../src/feedback';
import { AimSector } from '../src/aim-sector';
import { makePickup, updatePickup } from '../src/pickup-view';

for(const state of ['running','suspended','interrupted','closed'])test(`audio restores ${state} and avoids duplicate attempts`,async()=>{
  let calls=0,resumes=0;const ctx={state,resume:async()=>{resumes++;ctx.state='running';}};
  const recovery=new AudioRecovery(()=>{calls++;if(ctx.state==='closed')ctx.state='suspended';return ctx;},40);
  const a=recovery.run();if(state!=='running')assert.equal(recovery.run(),a);assert(await a);assert(!recovery.needsAction);assert.equal(calls,1);assert.equal(resumes,state==='running'?0:1);
});
test('hung audio times out, explicit retry replaces it; old callbacks and background cannot finish a new attempt',async()=>{
  let stale!:()=>void,latest!:()=>void,count=0;
  const old={state:'interrupted',resume:()=>new Promise<void>(r=>stale=r)},fresh={state:'suspended',resume:()=>new Promise<void>(r=>latest=r)};
  const recovery=new AudioRecovery(replace=>{count++;return replace?fresh:old;},20);
  assert.equal(await recovery.run(),false);assert(recovery.needsAction);
  const retry=recovery.run(true);assert.equal(recovery.run(true),retry);old.state='running';stale();await Promise.resolve();assert(recovery.needsAction);
  fresh.state='running';latest();assert(await retry);assert(!recovery.needsAction);assert.equal(count,2);
  fresh.state='interrupted';const pending=recovery.run(true);recovery.stop();fresh.state='running';latest();assert.equal(await pending,false);
});
test('all six skins persist immediately, migrate old profile and rejoin without changing combat state',()=>{
  const saved=new Map([['roma-online-profile',JSON.stringify({name:'Лев',skin:2})]]);
  const storage={getItem:(k:string)=>saved.get(k)??null,setItem:(k:string,v:string)=>{saved.set(k,v);}};
  const profile=new GameProfile(storage);assert.equal(profile.name,'Лев');assert.equal(profile.skin,2);
  const s=new CoopSimulation();const p=s.addMember(-1,'Рома',0);s.start(false);p.tank.hp=38;p.charge=24;p.dashCooldown=3;p.kills=8;p.tank.cooldown=.17;
  for(let skin=0;skin<6;skin++){
    profile.select(skin);profile.rename(`Лев ${skin}`);const loaded=new GameProfile(storage);assert.equal(loaded.skin,skin);
    const old=structuredClone(p);s.addMember(-1,loaded.name,loaded.skin);
    assert.equal(p.skin,skin);assert.equal(p.tank.skin,skin);assert.equal(p.name,loaded.name);assert.equal(p.tank.displayName,loaded.name);
    for(const key of ['charge','dashCooldown','kills'] as const)assert.equal(p[key],old[key]);assert.equal(p.tank.hp,38);assert.equal(p.tank.cooldown,.17);
  }
  p.shield=0;s.damageTank(p.tank,100);s.addMember(-1,'Новый цвет',2);assert.equal(p.tank.hp,0);assert.equal(p.skin,2);
  const blocked=new GameProfile({getItem(){throw Error();},setItem(){throw Error();}});blocked.select(4);assert.equal(blocked.skin,4);
});
test('hit feedback grows with low armor, is per-hit and bounded; shield causes no red hit',()=>{
  const values=[90,50,5].map(hp=>hitFeedback({damage:10,hpAfter:hp,maxHp:100}));
  assert(values[0].opacity<values[1].opacity&&values[1].opacity<values[2].opacity);
  assert(values[0].sparks<values[2].sparks);const max=hitFeedback({damage:999,hpAfter:0,maxHp:100});assert(max.opacity<=.75&&max.duration<=.5&&max.shake<=.28);
  const s=new Simulation();s.start(false);s.drainEvents();s.damagePlayer(10);s.damagePlayer(15);assert.deepEqual(s.drainEvents().filter(e=>e.type==='hit').map(e=>e.hpAfter),[90,75]);
  s.powerTime=7;s.damagePlayer(10);assert(s.drainEvents().every(e=>e.type!=='hit'));
});
test('crate drops: both branches, three kinds, one destruction, reachable position and bounded lifetime',()=>{
  const s=new Simulation();s.start(false);s.obstacles=[];
  s.random=()=>.9;s.dropCrateBonus({x:0,z:0});assert.equal(s.pickups.length,0);
  for(let kind=0;kind<3;kind++){const rolls=[.1,(kind+.5)/3];s.random=()=>rolls.shift()??.1;s.dropCrateBonus({x:0,z:0});assert.equal(s.pickups.at(-1)?.kind,['heal','charge','rapid'][kind]);}
  s.obstacles=[{id:1,kind:'cover',x:0,z:0,w:2,d:2,hp:Infinity}];s.random=()=>0;s.dropCrateBonus({x:2,z:0});const p=s.pickups.at(-1)!;assert(s.walkable(p.x,p.z,.7));assert(s.lineOfSight({x:2,z:0},p,.55));
  for(let i=0;i<20;i++)s.dropCrateBonus({x:10,z:10});assert.equal(s.pickups.length,16);const ids=s.pickups.map(p=>p.id);assert.equal(new Set(ids).size,16);
  s.player.x=-15;s.player.z=-12;s.updatePickups(13);assert.equal(s.pickups.length,0);
  s.player.hp=90;s.pickups=[{id:999,x:s.player.x,z:s.player.z,life:.001,kind:'heal'}];s.updatePickups(.02);assert.equal(s.player.hp,90);assert.equal(s.pickups.length,0);
  s.obstacles=[{id:2,kind:'crate',x:0,z:0,w:1,d:1,hp:1}];s.bullets=[1,2].map(id=>({id,x:0,z:-.7,y:.7,vx:0,vz:10,life:3,owner:'lev' as const,damage:25,power:false}));
  s.updateBullets(.1);assert.equal(s.pickups.length,1);assert.equal(s.obstacles.length,0);s.updateBullets(.1);assert.equal(s.pickups.length,1);
});
test('shared pickup goes to the first living player once and reports actual repair',()=>{
  const s=new CoopSimulation();const a=s.addMember(-1,'Рома',0),b=s.addMember(-2,'Лев',1);s.start(false);s.obstacles=[];s.spawnTimer=999;s.remainingToSpawn=1;
  for(const m of [a,b]){m.tank.x=0;m.tank.z=0;m.tank.hp=95;}
  s.pickups=[{id:99,x:0,z:0,life:12,kind:'heal'}];s.drainEvents();s.updateAll(1/60,new Map([[-1,emptyInput()],[-2,emptyInput()]]));
  assert.equal(a.tank.hp,100);assert.equal(b.tank.hp,95);assert.equal(s.pickups.length,0);const events=s.drainEvents().filter(e=>e.type==='pickup');assert.equal(events.length,1);assert.equal(events[0].amount,5);
});
test('laser brightness pulses without stretching; release fades out and reset clears it',()=>{
 const v=new AimSector(),beam=v.root.children[0] as THREE.Mesh<THREE.BufferGeometry,THREE.ShaderMaterial>,geometry=beam.geometry;
 v.update({x:0,z:0,angle:0},[],true,false,.1,false,true);const length=beam.scale.z,strength=beam.material.uniforms.strength.value;assert(v.root.visible);
 v.pulse();v.update({x:0,z:0,angle:0},[],true,false,.04);assert.equal(beam.scale.z,length);assert(beam.material.uniforms.strength.value>strength);
 v.update({x:0,z:0,angle:0},[{id:1,kind:'cover',x:0,z:4,w:20,d:1,hp:Infinity}],true,true,0);assert(beam.position.z+beam.scale.z<3.39);
 v.update({x:0,z:0,angle:0},[],true,false,.2,true,false);assert(v.root.visible);v.update({x:0,z:0,angle:0},[],true,false,.2,true,false);assert(!v.root.visible);
 v.reset();assert(!v.root.visible);assert.equal(beam.geometry,geometry);
});
test('pickup model rotates once per 8 seconds, label stays facing camera, mobile model is at least 28px',()=>{
  const p={id:1,x:0,z:0,kind:'heal' as const,life:12};const v=makePickup(p,()=>new THREE.Sprite(new THREE.SpriteMaterial()));
  updatePickup(v,p,0,24/360,true,false);const body=v.getObjectByName('pickup-body')!,label=v.getObjectByName('pickup-label')!;
  assert(body.scale.x*1.4/(24/360)>=28-1e-8);const angle=body.rotation.y;updatePickup(v,p,8,24/360,true,false);assert(Math.abs(body.rotation.y-angle-2*Math.PI)<1e-8);assert.equal(label.rotation.y,0);
  updatePickup(v,{...p,life:1.2},10,24/360,true,true);assert.equal(body.rotation.y,0);assert((label as THREE.Sprite).material.opacity>0);
});

test('real audio manager recreates closed graph, keeps decoded clips and disconnects stopped sources without waiting for callbacks',async()=>{
  const {GameAudio}=await import('../src/audio');
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'AudioContext'),originalFetch=globalThis.fetch;
  const contexts:MockContext[]=[];
  const param=()=>({value:0,setValueAtTime(){},setTargetAtTime(){},exponentialRampToValueAtTime(){}});
  class Node { gain=param();pan=param();frequency=param();playbackRate=param();onended?:()=>void;connected=false;connect(){this.connected=true;}disconnect(){this.connected=false;}start(){}stop(){} }
  class MockContext {
    state='suspended';sampleRate=32;currentTime=0;destination={};nodes:Node[]=[];
    constructor(){contexts.push(this);}
    createGain(){return this.node();}createStereoPanner(){return this.node();}createOscillator(){return this.node();}createBufferSource(){return this.node();}
    node(){const n=new Node();this.nodes.push(n);return n;}
    createBuffer(){return {duration:1,getChannelData:()=>new Float32Array(32)};}
    decodeAudioData(){return Promise.resolve(this.createBuffer());}resume(){this.state='running';return Promise.resolve();}suspend(){this.state='suspended';return Promise.resolve();}close(){this.state='closed';return Promise.resolve();}
  }
  Object.defineProperty(globalThis,'AudioContext',{configurable:true,value:MockContext});globalThis.fetch=(async()=>({ok:true,arrayBuffer:async()=>new ArrayBuffer(16)})) as typeof fetch;
  try{
    const audio=new GameAudio({muted:false,musicMuted:false,narratorMuted:false}),sim=new Simulation();sim.start(false);
    assert(await audio.unlock());await new Promise(r=>setTimeout(r,0));assert.equal(audio.stats().clips,9);
    audio.handle([{type:'shot',owner:'roma',x:0,z:0}],sim);audio.update(sim);assert(audio.stats().sources>0);
    const old=contexts[0];audio.pause();assert.equal(audio.stats().sources,0);assert(!audio.stats().engine);assert.equal(old.nodes.filter(n=>n.connected).length,3,'only output buses remain connected');
    old.state='interrupted';assert(await audio.resume());old.state='closed';assert(await audio.unlock());assert.equal(contexts.length,2);assert.equal(audio.stats().clips,9);
    audio.handle([{type:'shot',owner:'roma',x:0,z:0}],sim);const sources=audio.stats().sources;for(const node of old.nodes)node.onended?.();assert.equal(audio.stats().sources,sources,'late old callbacks cannot remove fresh sources');
    for(let i=0;i<5;i++){audio.reset();audio.update(sim);audio.pause();assert.equal(audio.stats().sources,0);assert(contexts.at(-1)!.nodes.filter(n=>n.connected).length<=3);await audio.unlock();}
    assert(await audio.retry());assert.equal(contexts.length,3);assert.equal(audio.stats().clips,9);audio.pause();
  }finally{globalThis.fetch=originalFetch;if(descriptor)Object.defineProperty(globalThis,'AudioContext',descriptor);else Reflect.deleteProperty(globalThis,'AudioContext');}
});

test('containers use shared opaque matte surfaces, cover every viewing direction and never pulse on expiry',()=>{
  const make=(kind:'heal'|'charge'|'rapid',id=1)=>makePickup({id,x:0,z:0,kind,life:12},()=>new THREE.Sprite(new THREE.SpriteMaterial()));
  const models=(['heal','charge','rapid'] as const).map(k=>make(k));
  for(const [i,v] of models.entries()){
    const body=v.getObjectByName('pickup-body')!;
    body.traverse(o=>{if(o instanceof THREE.Mesh){const m=o.material as THREE.MeshStandardMaterial;assert(!m.transparent);assert(m.depthTest&&m.depthWrite);assert(m.roughness>=.8);assert.equal(m.emissive.getHex(),0);}});
    const p={id:i,x:0,z:0,kind:'heal' as const,life:12},upp=24/360;
    for(let step=0;step<=64;step++){
      updatePickup(v,p,step/8,upp,true,false);v.updateMatrixWorld(true);
      // Camera's horizontal axis is arbitrary: square footprint guarantees this lower bound.
      const rotation=body.rotation.y;const projectedWidth=1.4*body.scale.x*(Math.abs(Math.sin(rotation))+Math.abs(Math.cos(rotation)))/upp;
      assert(projectedWidth>=28-1e-8);
    }
    let last=1;
    for(let step=0;step<=60;step++){
      updatePickup(v,{...p,life:3-step/20},10,upp,true,false);
      const opacity=(v.getObjectByName('pickup-label') as THREE.Sprite).material.opacity;assert(opacity<=last+1e-9);last=opacity;
    }
    assert(body.position.y<-.5*body.scale.x,'expired case sinks below snow');
    updatePickup(v,{...p,life:.1},20,upp,true,true);const y=body.position.y;
    updatePickup(v,{...p,life:.05},21,upp,true,true);assert.equal(body.position.y,y);assert.equal(body.rotation.y,0);
  }
  const another=make('heal',4),a=models[0].getObjectByName('pickup-body')!.children[0] as THREE.Mesh,b=another.getObjectByName('pickup-body')!.children[0] as THREE.Mesh;
  assert.equal(a.geometry,b.geometry);assert.equal(a.material,b.material);assert.notEqual(models[0].userData.ownedMaterials[0],another.userData.ownedMaterials[0]);
});
