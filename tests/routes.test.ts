import test from 'node:test';
import assert from 'node:assert/strict';
import { RouteMesh } from '../src/net/mesh';
import { Assembler,unpack } from '../src/net/codec';
import type { GamePacket } from '../src/protocol';
test('direct route requires stable improvement and handshake; one-way pings cannot extend it',()=>{
 const original=globalThis.RTCPeerConnection;let now=10000;
 class Peer {connectionState='connected';close(){this.connectionState='closed';}}
 globalThis.RTCPeerConnection=Peer as any;
 const direct:GamePacket[]=[],relay:GamePacket[]=[],assembler=new Assembler();
 const mesh=new RouteMesh(-2,()=>{},(_id,bytes)=>{relay.push(unpack(bytes));return true;},()=>{},()=>now);
 try{
  mesh.setPeers([{id:-1,connected:true,present:true,foreground:true,name:'P',skin:0}]);const link=(mesh as any).links.get(-1);
  const channel=(label:string)=>({label,readyState:'open',bufferedAmount:0,send(bytes:Uint8Array){const assembled=assembler.receive(bytes,now);if(assembled)direct.push(unpack(assembled));},close(){}});
  (mesh as any).bind(-1,link,channel('frames'));(mesh as any).bind(-1,link,channel('control'));
  let request:any;
  for(let i=0;i<100;i++){
   mesh.tick();assert(!mesh.isDirect(-1),'only measurement cannot switch the route');
   for(const p of direct.splice(0)){if(p.kind==='route-request')request=p;else if(p.kind==='ping'){now+=30;(mesh as any).packet(-1,{...p,kind:'pong'},'direct');}}
   for(const p of relay.splice(0))if(p.kind==='ping'){now+=100;(mesh as any).packet(-1,{...p,kind:'pong'},'relay');}
   now+=100;if(request)break;
  }
  assert(request);assert(now>=17000,'three relay samples plus five seconds of stable gain');
  (mesh as any).packet(-1,{kind:'route-ready',id:request.id+1},'direct');assert(!mesh.isDirect(-1));
  (mesh as any).packet(-1,{kind:'route-ready',id:request.id},'direct');assert(mesh.isDirect(-1));
  const ack=link.lastAck;now=ack+501;(mesh as any).packet(-1,{kind:'ping',id:888,at:now},'direct');mesh.tick();assert(!mesh.isDirect(-1));assert.equal(link.lastAck,ack);
  const before=mesh.stats()[0].relayRtt;(mesh as any).packet(-1,{kind:'pong',id:999999,at:now-9999},'relay');assert.equal(mesh.stats()[0].relayRtt,before,'unsolicited pong does not forge latency');
  link.fast.onmessage({data:new ArrayBuffer(13000)});assert.equal(link.pc.connectionState,'closed','oversized direct frames are bounded');
 }finally{mesh.close();globalThis.RTCPeerConnection=original;}
});
