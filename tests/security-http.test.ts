import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createGameServer } from '../server/index';
import { NET } from '../src/net/config';
import { Client } from '@colyseus/sdk';
import { WebSocket } from 'ws';
import { RateLimit, clientAddress, configuredOrigins, validSignal } from '../server/security';

const payload=(mode='private',code?:string)=>({version:NET.version,request:{type:'join',mode,name:'Игрок',skin:0,code}});
test('HTTP and WebSocket security boundaries, private matchmaking and graceful drain',async()=>{
  await mkdir('test-artifacts/security',{recursive:true});const root=await mkdtemp(resolve('test-artifacts/security/http-'));
  await writeFile(root+'/index.html','<!doctype html><title>ОПЕРАЦИЯ 67</title>');await writeFile(root+'/.env','FAKE_TEST_ONLY');await symlink(resolve('package.json'),root+'/escape.js');
  await writeFile(root+'/.hidden.js','FAKE_TEST_ONLY');await symlink('.hidden.js',root+'/alias.js');
  const app=createGameServer({root,origins:['https://game.example.com'],maxRooms:4}),channels:any[]=[];
  await app.listen(0);const address=app.http.address() as {port:number},base=`http://127.0.0.1:${address.port}`,sdk=new Client(base);
  const post=(path:string,body:unknown,origin='https://game.example.com')=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify(body)});
  try{
    const page=await fetch(base);assert.equal(page.status,200);assert.match(page.headers.get('content-security-policy')!,/script-src 'self'/);assert.equal(page.headers.get('referrer-policy'),'no-referrer');
    for(const path of ['/.env','/%2eenv','/escape.js','/alias.js','/..%2Fpackage.json','/%00','/api/qa','/__healthcheck'])assert.equal((await fetch(base+path)).status,404,path);
    assert.equal((await fetch(base+'/%zz')).status,400);
    assert.equal((await fetch(base+'/health',{headers:{Origin:'https://evil.example'}})).status,403);
    assert.equal((await post('/api/join',payload(),'https://evil.example')).status,403);
    assert.equal((await post('/api/join',null)).status,400);
    assert.equal((await post('/api/join',{data:'x'.repeat(5000)})).status,413);
    assert.equal((await fetch(base+'/api/join',{method:'POST',body:'{}'})).status,415);
    const first=await (await post('/api/join',payload())).json() as any;
    const room=await sdk.consumeSeatReservation(first.reservation);room.onMessage('*',()=>{});channels.push(room);
    assert.equal(app.rooms.rooms.get(room.roomId)?.metadata.public,false);
    for(const method of ['join','joinOrCreate','create','joinById','reconnect']) {
      const id=method==='joinById'?room.roomId:'battle';
      const r=await post(`/matchmake/${method}/${id}`,{identity:first.token,name:'Чужой',skin:0,foreground:true,version:NET.version});assert.equal(r.status,404,method);
    }
    const directory=await (await fetch(base+'/api/rooms')).json();assert.deepEqual(directory,[]);
    const code=app.rooms.rooms.get(room.roomId)!.coordinator.info.code;
    const second=await(await post('/api/join',payload('code',code))).json() as any;const other=await sdk.consumeSeatReservation(second.reservation);other.onMessage('*',()=>{});channels.push(other);
    assert.equal(app.rooms.rooms.size,1);assert.equal(app.rooms.rooms.get(room.roomId)!.clients.length,2);
    await new Promise<void>((resolve,reject)=>{const socket=new WebSocket(base.replace('http','ws')+'/invalid',{origin:'https://evil.example'});socket.once('unexpected-response',(_req,res)=>{try{assert.equal(res.statusCode,401);socket.terminate();resolve();}catch(e){reject(e);}});socket.on('error',()=>{});socket.once('open',()=>{socket.close();reject(Error('Forbidden origin accepted'));});});
    // malformed plugin data used to reach message.targetId without a guard.
    room.send('webrtc:offer',null);await new Promise(r=>setTimeout(r,100));assert.equal((await fetch(base+'/health')).status,200);assert.equal(app.rooms.rooms.get(room.roomId)!.clients.length,1);
    app.drain();assert.equal((await fetch(base+'/ready')).status,503);assert.equal((await post('/api/join',payload())).status,503);assert.equal((await fetch(base+'/health')).status,200);
    app.drain(false);assert.equal((await fetch(base+'/ready')).status,200);
    for(let i=0;i<24;i++)await post('/api/join',payload('code','FFFFFF'));
    const limited=await post('/api/join',payload('code','FFFFFF'));assert.equal(limited.status,429);assert.equal(limited.headers.get('retry-after'),'10');
  }finally{channels.forEach(c=>c.connection.close());await app.close();await rm(root,{recursive:true,force:true});}
});
test('bounded rate limits, exact trusted proxies and production configuration',()=>{
  let now=0;const limit=new RateLimit(2,1000,2,()=>now);assert(limit.take('a'));assert(limit.take('a'));assert(!limit.take('a'));assert(limit.take('b'));assert(!limit.take('c'));now=2001;assert(limit.take('c'));
  const request=(peer:string,forwarded:string)=>({socket:{remoteAddress:peer},headers:{'x-forwarded-for':forwarded}} as any);
  assert.equal(clientAddress(request('198.51.100.9','1.2.3.4'),[]),'198.51.100.9');
  assert.equal(clientAddress(request('::ffff:127.0.0.1','1.2.3.4, 198.51.100.9'),['127.0.0.1']),'198.51.100.9');
  assert.throws(()=>configuredOrigins([],true));assert.throws(()=>configuredOrigins(['https://example.com/path'],true));assert.throws(()=>createGameServer({production:true,qa:true,origins:['https://example.com']}));
});
test('signal schemas reject malformed descriptions, candidates and excessive strings',()=>{
  for(const v of [undefined,null,1,[],{}, {targetId:'peer',sdp:null},{targetId:'peer',sdp:{type:'answer',sdp:'sdp'}},{targetId:'peer',sdp:{type:'offer',sdp:'x'.repeat(16000)}}])assert.equal(validSignal('webrtc:offer',v),false);
  assert(validSignal('webrtc:offer',{targetId:'peer',sdp:{type:'offer',sdp:'v=0'}}));assert(validSignal('webrtc:join',undefined));
  assert(!validSignal('webrtc:ice-candidate',{targetId:'peer',candidate:{candidate:'test',sdpMLineIndex:-1}}));
});

test('admission queue stays bounded and draining cancels queued reservations',async()=>{
 const {RoomRegistry}=await import('../server/rooms');const registry=new RoomRegistry();
 let resume!:()=>void;(registry as any).serial=new Promise<void>(r=>{resume=r;});
 const queued=Array.from({length:64},()=>registry.join(payload() as any).then(()=>false,e=>e.message==='BUSY'));
 await assert.rejects(registry.join(payload() as any),/BUSY/);registry.draining=true;resume();
 assert((await Promise.all(queued)).every(Boolean));assert.equal((registry as any).pending,0);assert.equal(registry.rooms.size,0);
});

test('invalid and oversized signalling cannot reach another room or stop the process',async()=>{
 const app=createGameServer({maxRooms:4});await app.listen(0);
 const base=`http://127.0.0.1:${(app.http.address() as any).port}`,sdk=new Client(base),channels:any[]=[];
 const enter=async(mode='private',code?:string,token?:string)=>{
  const response=await fetch(base+'/api/join',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...payload(mode,code),token})});assert.equal(response.status,200);
  const result=await response.json() as any,room=await sdk.consumeSeatReservation(result.reservation);room.onMessage('*',()=>{});channels.push(room);return {room,token:result.token as string};
 };
 try{
  const resident=(await enter()).room,foreign=(await enter()).room,code=app.rooms.rooms.get(resident.roomId)!.coordinator.info.code;
  let foreignOffers=0;foreign.onMessage('webrtc:offer',()=>{foreignOffers++;});
  resident.send('webrtc:offer',{targetId:foreign.sessionId,sdp:{type:'offer',sdp:'v=0'}});
  resident.send('route',{route:'relay',peerId:{unexpected:'x'.repeat(4096)}});
  await new Promise(r=>setTimeout(r,50));assert.equal(foreignOffers,0);assert.equal(app.rooms.debug().events.length,0);
  let guest:string|undefined;
  for(const message of [null,[],{targetId:resident.sessionId,sdp:{type:'offer',sdp:42}},{targetId:resident.sessionId,sdp:{type:'offer',sdp:'x'.repeat(NET.maxSignalBytes+1)}}]){
   const entered=await enter('code',code,guest);guest=entered.token;const attacker=entered.room;const left=new Promise<void>(r=>attacker.onLeave(()=>r()));attacker.send('webrtc:offer',message);await left;
   assert.equal((await fetch(base+'/health')).status,200);assert.equal(app.rooms.rooms.get(foreign.roomId)!.clients.length,1);
  }
 }finally{channels.forEach(c=>c.connection.close());await app.close();}
});

test('slow JSON body times out without blocking health checks',async()=>{
 const {request}=await import('node:http');const app=createGameServer();await app.listen(0);
 const base=`http://127.0.0.1:${(app.http.address() as any).port}`;
 let req:ReturnType<typeof request>|undefined;
 try{
  const response=new Promise<number>((resolve,reject)=>{req=request(base+'/api/join',{method:'POST',headers:{'Content-Type':'application/json'}},r=>{r.resume();resolve(r.statusCode!);});req.on('error',reject);req.write('{');});
  assert.equal((await fetch(base+'/health')).status,200);assert.equal(await response,408);
 }finally{req?.destroy();await app.close();}
});

test('queued admission has a finite deadline and never executes after timeout',async()=>{
 const {RoomRegistry}=await import('../server/rooms');const registry=new RoomRegistry();
 let resume!:()=>void;(registry as any).serial=new Promise<void>(r=>{resume=r;});
 const started=Date.now();await assert.rejects(registry.join(payload() as any),/BUSY/);assert(Date.now()-started<7000);
 resume();await (registry as any).serial;assert.equal(registry.rooms.size,0);assert.equal((registry as any).pending,0);
});
