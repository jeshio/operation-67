import { PROTOCOL } from '../src/protocol';
import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createGameServer } from '../server/index';
import { emptyInput } from '../src/simulation';
import type { ServerMessage } from '../src/protocol';
const delay=(ms:number)=>new Promise(r=>setTimeout(r,ms));
test('real sockets: four players, capacity, delayed input, stale controls and reconnect without resurrection',async()=>{
 const app=createGameServer();await new Promise<void>(r=>app.http.listen(0,'127.0.0.1',r));
 const address=app.http.address();assert(address&&typeof address==='object');const url=`ws://127.0.0.1:${address.port}/ws`;
 const sockets:WebSocket[]=[];
 async function client(token?:string){const ws=new WebSocket(url);sockets.push(ws);const messages:ServerMessage[]=[];ws.on('message',m=>messages.push(JSON.parse(String(m))));await new Promise<void>(r=>ws.once('open',r));
 const send=(m:unknown)=>ws.send(JSON.stringify(m));
 async function wait(type:ServerMessage['type']){for(let i=0;i<200;i++){const at=messages.findIndex(m=>m.type===type);if(at>=0)return messages.splice(at,1)[0];await delay(10);}throw Error(`No ${type}`);}
 send({type:'hello',version:PROTOCOL,token});const welcome=await wait('welcome');assert.equal(welcome.type,'welcome');return{ws,send,wait,messages,token:welcome.type==='welcome'?welcome.token:''};}
 try{
 const first=await client();first.send({type:'join',mode:'private',name:'Рома',skin:0});const joined=await first.wait('joined');assert.equal(joined.type,'joined');if(joined.type!=='joined')return;
 const code=joined.room.code,clients=[first];for(let i=1;i<4;i++){const p=await client();p.send({type:'join',mode:'code',code,name:`Игрок ${i}`,skin:i});assert.equal((await p.wait('joined')).type,'joined');clients.push(p);}
 const fifth=await client();fifth.send({type:'join',mode:'code',code,name:'Пятый',skin:4});const error=await fifth.wait('error');assert.equal(error.type,'error');
 const room=app.rooms.rooms.get(code)!;room.sim.start(false);room.round++;const player=room.sim.members.get(joined.id)!;
 room.sim.enemies=[];room.sim.portals=[];room.sim.spawnTimer=99;player.tank.x=0;player.tank.z=0;room.sim.obstacles=[];
 const x=player.tank.x;
 // Real network delivery with 50–200 ms artificial one-way delay; bounded bursts, no resending abilities.
 await Promise.all(Array.from({length:18},(_,i)=>(async()=>{await delay(50+i*18+(i%4)*20);first.send({type:'input',seq:i,input:{...emptyInput(),x:1}});})()));
 await delay(400);assert(player.tank.x>x+1);const stopped=player.tank.x;await delay(120);assert.equal(player.tank.x,stopped,'stale input stops within 300 ms');
 first.send({type:'input',seq:999,input:{...emptyInput(),x:null}});await delay(30);assert.equal(player.tank.x,stopped,'invalid input rejected');
 player.shield=0;room.sim.damageTank(player.tank,1000);assert.equal(player.tank.hp,0);
 first.ws.close();await delay(40);const rejoined=await client(first.token);rejoined.send({type:'join',mode:'code',code,name:'Новое имя',skin:5});const again=await rejoined.wait('joined');assert(again.type==='joined');assert.equal(again.id,joined.id);assert.equal(player.tank.hp,0);
 rejoined.send({type:'leave'});await rejoined.wait('left');rejoined.send({type:'join',mode:'code',code,name:'Снова',skin:2});await rejoined.wait('joined');assert.equal(player.tank.hp,0,'leave/rejoin does not resurrect');
 for(const p of clients.slice(1)){p.messages.length=0;const snap=await p.wait('snapshot');assert(snap.type==='snapshot');assert.equal(snap.state.players.length,4);assert.equal(snap.state.players.find(p=>p.id===joined.id)?.tank.hp,0);}
 room.sim.finishWave();assert.equal(player.tank.hp,50);assert.equal(player.charge,0);
 }finally{for(const ws of sockets)ws.terminate();await app.close();}
});
