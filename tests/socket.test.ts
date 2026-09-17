import test from 'node:test';
import assert from 'node:assert/strict';
import { boot } from '@colyseus/testing';
import { createGameServer } from '../server/index';
import { NetworkGame } from '../src/network';
import { emptyInput } from '../src/simulation';
import { NET } from '../src/net/config';
const delay=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const storage=()=>{const data=new Map<string,string>();return{getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>data.set(key,value)} as Storage;};
test('Colyseus testing: real four-player room, reserved seats, session replacement, recovery and quick matching',async()=>{
 const app=createGameServer({maxRooms:4}),testServer=await boot(app.game),endpoint='http://127.0.0.1:2568';const clients:NetworkGame[]=[];
 let accumulator=0,previous=performance.now();const timer=setInterval(()=>{const now=performance.now();accumulator+=Math.min(.1,(now-previous)/1000);previous=now;while(accumulator>=1/60){clients.forEach(g=>g.step({...emptyInput(),x:.3,fire:true}));accumulator-=1/60;}clients.forEach(g=>g.render(.016));},8);
 async function wait(check:()=>boolean,description:string,ms=12000){const end=performance.now()+ms;while(!check()){if(performance.now()>end)throw Error(description+' '+clients.map(g=>g.error||g.connectionNotice).join(';'));await delay(20);}}
 async function join(code?:string,backend=storage(),mode:'quick'|'private'|'public'|'code'=code?'code':'private'){
  const g=new NetworkGame(backend,'token',undefined,{endpoint,webrtc:false});clients.push(g);await g.enter({type:'join',mode,code,name:`Игрок ${clients.length}`,skin:clients.length%6});await wait(()=>!!g.state,'join');return g;
 }
 try{
  assert.equal((await (await fetch(endpoint+'/health')).json() as any).maxRooms,4);
  const oldStorage=storage(),first=await join(undefined,oldStorage),code=first.room!.code;await join(code);await join(code);await join(code);
  const room=testServer.getRoomById(first.room!.matchId);assert.equal(room.clients.length,4);assert.equal(app.rooms.rooms.size,1);
  const full=await fetch(endpoint+'/api/join',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({version:NET.version,request:{type:'join',mode:'code',code,name:'Пятый',skin:0}})});assert.equal((await full.json() as any).code,'FULL');
  first.start();await wait(()=>clients.every(g=>g.state?.phase==='playing'),'start');await delay(500);assert(clients.every(g=>g.diagnostics().ack>5));
  const id=first.id,replacement=await join(code,oldStorage);await wait(()=>first.error.includes('другой вкладке'),'replaced');assert.equal(replacement.id,id);assert.equal(replacement.state!.players.length,4);
  await wait(()=>replacement.room!.stage==='running','recovered');const epoch=replacement.room!.hostEpoch;const host=clients.find(g=>g.connected&&g.id===replacement.room!.host)!;host.stop();const begun=performance.now();
  await wait(()=>clients.filter(g=>g.connected).every(g=>g.room!.hostEpoch>epoch&&g.room!.stage==='running'&&!g.recovering),'crash',3000);assert(performance.now()-begun<=3000);
  const quick=await join(undefined,storage(),'quick');assert.notEqual(quick.room!.code,code,'private rooms excluded');const q2=await join(undefined,storage(),'quick');assert.equal(q2.room!.code,quick.room!.code);assert.equal(app.rooms.rooms.size,2);
  const fast=await join(undefined,storage(),'public');
  app.rooms.rooms.get(quick.room!.matchId)!.coordinator.hostLatency=()=>150;
  app.rooms.rooms.get(fast.room!.matchId)!.coordinator.hostLatency=()=>20;
  const best=await join(undefined,storage(),'quick');assert.equal(best.room!.code,fast.room!.code,'best measured room wins immediately');
  const raced=await Promise.all(Array.from({length:3},()=>join(undefined,storage(),'quick')));
  assert(raced.every(g=>g.connected),'races retry another room');assert([...app.rooms.rooms.values()].every(r=>r.clients.length<=4));
  const invalid=await fetch(endpoint+'/api/join',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({version:NET.version-1})});assert.equal((await invalid.json() as any).code,'VERSION');
  const debug=JSON.stringify(app.rooms.debug());assert(!debug.includes(oldStorage.getItem('token')!),'diagnostics omit session secrets');
 }finally{clearInterval(timer);clients.forEach(g=>g.stop());await delay(100);await testServer.shutdown();}
});
