import test from 'node:test';
import assert from 'node:assert/strict';
import { multiplayer } from './helpers/multiplayer';
import { emptyInput } from '../src/simulation';

test('moving bosses and friendly shells share fresh time, including batched arrivals and removal',async()=>{
 const f=await multiplayer();try{
  await f.start();const g=f.clients[0],s=f.host().sim;s.enemies=[];s.obstacles=[];
  const e=s.createEnemy('drill',{x:0,z:0});e.state='execute';e.bodyAngle=Math.PI/2;s.enemies=[e];
  s.bullets=[{id:999,x:8,z:0,vx:0,vz:24,life:4,owner:'roma',source:-2,damage:25,power:false}];f.snapshot();
  s.elapsed+=.05;e.x=.9;s.bullets[0].z=1.2;f.host().tick++;f.snapshot();g.render(.016);
  assert.equal(g.view.enemies[0].x,.9);assert.equal(g.view.bullets[0].z,1.2);
  s.enemies=[];s.bullets=[];f.host().tick++;f.snapshot();g.render(.016);assert.equal(g.view.enemies.length,0);assert.equal(g.view.bullets.length,0);
 }finally{f.cleanup();}
});
test('own movement and visual shot start immediately, reconciliation never doubles accepted movement',async()=>{
 const f=await multiplayer({lag:120});try{
  await f.start();const g=f.clients[1],s=f.host().sim,m=s.members.get(g.id)!;m.tank.cooldown=0;f.snapshot();const fired=m.fired;
  g.step({...emptyInput(),x:1,firePressed:true});g.render(0,0);const before=g.view.player.x;g.render(0,.5);const middle=g.view.player.x;g.render(0,1);const after=g.view.player.x;
  assert(after>middle&&middle>before);assert(Math.abs(middle-(before+after)/2)<1e-8);assert(g.view.bullets.some(b=>b.source===g.id&&b.id<0),'visual shot appears before network');assert.equal(m.fired,fired);
  f.run(.6);assert.equal(m.fired,fired+1);assert(!g.view.bullets.some(b=>b.id<0),'confirmed/rejected ghosts are removed');
 }finally{f.cleanup();}
});
test('same-session reconnect starts after the last processed sequence',async()=>{
 const f=await multiplayer();try{
  await f.start();f.run(1);const g=f.clients[1];(g as any).sequence=0;(g as any).ack=-1;(g as any).bootstrap=true;f.host().tick++;f.snapshot();
  assert(g.diagnostics().sequence>=f.host().ack[g.id]);f.run(.3,()=>({...emptyInput(),x:1}));assert(g.diagnostics().ack>0);
 }finally{f.cleanup();}
});

test('cancelled entry ignores a late reservation and another attempt starts without duplicate joins',async()=>{
 const {NetworkGame}=await import('../src/network');const original=globalThis.fetch;const pending:((r:Response)=>void)[]=[];
 globalThis.fetch=((url:any)=>String(url).endsWith('/api/join')?new Promise(resolve=>pending.push(resolve)):Promise.resolve(new Response('[]',{status:200}))) as typeof fetch;
 const g=new NetworkGame(null,'cancel',undefined,{endpoint:'http://127.0.0.1:1',webrtc:false});
 try{
  const request={type:'join' as const,mode:'quick' as const,name:'P',skin:0};const first=g.enter(request);void g.enter(request);assert.equal(pending.length,1);g.stop();const next=g.enter(request);assert.equal(pending.length,2);
  pending[0](new Response(JSON.stringify({token:'old',reservation:{}})));await first;assert.equal(g.room,undefined);assert.equal(g.error,'');
  pending[1](new Response(JSON.stringify({code:'BUSY',message:'Все комнаты заняты'}),{status:503}));await next;assert.equal(g.error,'Все комнаты заняты');
 }finally{g.stop();globalThis.fetch=original;}
});

test('host preparation and backup benchmark share one pending Worker; stop disposes a late Worker',async()=>{
 const {NetworkGame}=await import('../src/network');const original=globalThis.fetch;
 globalThis.fetch=(()=>Promise.resolve(new Response('[]',{status:200}))) as typeof fetch;
 let resolvePort:(port:any)=>void=()=>{},calls=0,terminated=0;
 const g=new NetworkGame(null,'worker-race',undefined,{endpoint:'http://127.0.0.1:1',webrtc:false,hostFactory:()=>{calls++;return new Promise(resolve=>resolvePort=resolve);}});
 try{
  const a=(g as any).getHost(),b=(g as any).getHost();assert.equal(calls,1);g.stop();resolvePort({postMessage(){},terminate(){terminated++;},onmessage:null});
  const results=await Promise.allSettled([a,b]);assert(results.every(r=>r.status==='rejected'));assert.equal(terminated,1);
 }finally{g.stop();globalThis.fetch=original;}
});

test('room metadata cannot clear a recovery pause or restart its deadline without a fresh snapshot',async()=>{
 const f=await multiplayer();try{
  await f.start();const g=f.clients.find(g=>g.id!==f.coordinator.info.host)!;g.recovering=true;const at=f.now()-5000;(g as any).recoveryAt=at;
  (g as any).receiveInfo({...g.room,revision:g.room!.revision+1});assert(g.recovering);assert.equal((g as any).recoveryAt,at);
  f.host().tick++;(g as any).authorityUntil=f.now()+1500;(g as any).packet(f.coordinator.info.host,f.host().snapshot());assert(!g.recovering);assert.equal((g as any).recoveryAt,0);
 }finally{f.cleanup();}
});
