import test from 'node:test';
import assert from 'node:assert/strict';
import { NetworkGame } from '../src/network';
import { CoopSimulation } from '../src/coop';
import { emptyInput } from '../src/simulation';
class Socket {
 static OPEN=1;static last:Socket;readyState=1;onopen?:()=>void;onmessage?:(e:{data:string})=>void;onclose?:(e:{code:number;reason:string})=>void;onerror?:()=>void;sent:unknown[]=[];
 constructor(_url:string){Socket.last=this;}
 send(s:string){this.sent.push(JSON.parse(s));}close(){}message(m:unknown){this.onmessage?.({data:JSON.stringify(m)});}
}
test('moving bosses and friendly shells use fresh snapshots together, including batched arrivals and removal',()=>{
 const originalWS=globalThis.WebSocket,originalLocation=Object.getOwnPropertyDescriptor(globalThis,'location');
 Object.defineProperty(globalThis,'WebSocket',{value:Socket,configurable:true,writable:true});Object.defineProperty(globalThis,'location',{value:new URL('http://localhost:5179'),configurable:true});
 let game:NetworkGame|undefined;
 try{
  let now=1000;game=new NetworkGame(null,'qa-contacts',()=>now);const ws=Socket.last;ws.message({type:'welcome',token:'test'});
  const sim=new CoopSimulation();sim.addMember(-1,'Рома',0);sim.start(false);sim.obstacles=[];
  const e=sim.createEnemy('drill',{x:0,z:0});e.state='execute';e.bodyAngle=Math.PI/2;sim.enemies=[e];
  sim.bullets=[{id:999,x:8,z:0,vx:0,vz:24,life:4,owner:'roma',source:-1,damage:25,power:false}];
  const room={code:'FRESH1',public:false,owner:-1,round:1,countdown:null};ws.message({type:'joined',id:-1,room});
  const snapshot=()=>ws.message({type:'snapshot',room,state:sim.state(),events:[],ack:-1});snapshot();
  now+=50;sim.elapsed+=.05;e.x=.9;sim.bullets[0].z=1.2;snapshot();game.render(.016);
  assert.equal(game.view.enemies[0].x,.9,'target is not 100 ms behind its projectile');assert.equal(game.view.bullets[0].z,1.2);
  now+=25;game.render(.025);assert.equal(game.view.enemies[0].x,1.35);assert(Math.abs(game.view.bullets[0].z-1.8)<1e-8);
  sim.elapsed+=.05;e.x=1.8;snapshot();sim.elapsed+=.05;e.x=2.7;snapshot();game.render(.016);
  assert.equal(game.view.enemies[0].x,2.7);assert(Number.isFinite(game.view.enemies[0].bodyAngle));
  sim.enemies=[];sim.bullets=[];sim.elapsed+=.05;snapshot();game.render(.016);assert.equal(game.view.enemies.length,0);assert.equal(game.view.bullets.length,0);
 }finally{game?.stop();Object.defineProperty(globalThis,'WebSocket',{value:originalWS,configurable:true,writable:true});if(originalLocation)Object.defineProperty(globalThis,'location',originalLocation);else Reflect.deleteProperty(globalThis,'location');}
});
test('network client: smooth predicted subframes, acknowledgement reconciliation and closed-room recovery',()=>{
 const savedWS=globalThis.WebSocket;const savedLocation=Object.getOwnPropertyDescriptor(globalThis,'location');
 Object.defineProperty(globalThis,'WebSocket',{value:Socket,configurable:true,writable:true});Object.defineProperty(globalThis,'location',{value:new URL('http://localhost:5179'),configurable:true});
 let game:NetworkGame|undefined;
 try{
 let now=1000;game=new NetworkGame(null,'qa-network',()=>now);const ws=Socket.last;ws.message({type:'welcome',token:'test'});
 const sim=new CoopSimulation();sim.addMember(-1,'Рома',0);sim.start(false);sim.obstacles=[];sim.members.get(-1)!.tank.x=0;sim.members.get(-1)!.tank.z=0;
 const room={code:'ABCDEF',public:false,owner:-1,round:1,countdown:null};ws.message({type:'joined',id:-1,room});ws.message({type:'snapshot',room,state:sim.state(),events:[],ack:-1});
 game.step({...emptyInput(),x:1});game.render(0,0);const before=game.view.player.x;game.render(0,.5);const middle=game.view.player.x;game.render(0,1);const after=game.view.player.x;
 assert(after>middle&&middle>before);assert(Math.abs(middle-(before+after)/2)<1e-8);
 sim.members.get(-1)!.tank.x=after;ws.message({type:'snapshot',room,state:sim.state(),events:[],ack:1});game.render(.016,1);assert(Math.abs(game.view.player.x-after)<.01,'acknowledged movement is not replayed twice');
 now+=100;game.render(.016,1);assert(game.view.allies!.every(t=>Number.isFinite(t.x)&&Number.isFinite(t.z)),'snapshots delivered in the same clock millisecond cannot create NaN positions');
 ws.message({type:'error',message:'Комната не найдена или уже закрыта.'});assert.equal(game.room,undefined);assert.equal(game.view.phase,'menu');
 ws.onclose?.({code:1000,reason:'Открыта другая вкладка'});assert.equal(game.connected,false);assert.match(game.error,/другая вкладка/);
 }finally{game?.stop();Object.defineProperty(globalThis,'WebSocket',{value:savedWS,configurable:true,writable:true});if(savedLocation)Object.defineProperty(globalThis,'location',savedLocation);else Reflect.deleteProperty(globalThis,'location');}
});

test('cancelled entry ignores delayed messages and retry creates a fresh connection without duplicate joins',()=>{
 const originalWS=globalThis.WebSocket,originalLocation=Object.getOwnPropertyDescriptor(globalThis,'location');
 Object.defineProperty(globalThis,'WebSocket',{value:Socket,configurable:true,writable:true});Object.defineProperty(globalThis,'location',{value:new URL('http://localhost:5179'),configurable:true});
 let game:NetworkGame|undefined;
 try{
  game=new NetworkGame(null,'qa-cancel');let leaves=0;game.onLeave=()=>leaves++;
  const old=Socket.last,request={type:'join' as const,mode:'quick' as const,name:'Лев',skin:2};
  old.message({type:'welcome',token:'qa'});game.enter(request);game.enter(request);assert.equal(old.sent.filter((m:any)=>m.type==='join').length,1);
  game.stop();old.message({type:'joined',id:-1,room:{code:'OLD',round:0}});assert.equal(game.room,undefined);
  game.enter(request);const fresh=Socket.last;assert.notEqual(fresh,old);fresh.message({type:'welcome',token:'qa'});assert.equal(fresh.sent.filter((m:any)=>m.type==='join').length,1);
  game.leave();game.leave();assert.equal(leaves,1);fresh.message({type:'joined',id:-1,room:{code:'LATE',round:0}});assert.equal(game.room,undefined);
 }finally{game?.stop();Object.defineProperty(globalThis,'WebSocket',{value:originalWS,configurable:true,writable:true});if(originalLocation)Object.defineProperty(globalThis,'location',originalLocation);else Reflect.deleteProperty(globalThis,'location');}
});
