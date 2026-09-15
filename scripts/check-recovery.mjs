import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { NetworkGame } from '../src/network.ts';
import { emptyInput } from '../src/simulation.ts';
const base=new URL(process.argv[2]??'http://127.0.0.1:5179/');
Object.defineProperty(globalThis,'location',{value:base,configurable:true});
Object.defineProperty(globalThis,'WebSocket',{value:class extends WebSocket{constructor(url){super(url,{origin:base.origin});}},configurable:true});
const values=new Map(),storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};
const clients=new Set(),commands=new Map(),delay=ms=>new Promise(r=>setTimeout(r,ms));let previous=performance.now(),accumulator=0;
const timer=setInterval(()=>{const now=performance.now(),dt=Math.min(.1,(now-previous)/1000);previous=now;accumulator+=dt;while(accumulator>=1/60){for(const g of clients)g.step(commands.get(g)??emptyInput());accumulator-=1/60;}for(const g of clients)g.render(dt,accumulator*60);},8);
async function wait(check,label){const until=performance.now()+12000;while(!check()){if(performance.now()>until)throw Error(label+': '+[...clients].map(c=>c.error||c.status).join('; '));await delay(25);}}
async function connect(key,skin,code){const g=new NetworkGame(storage,key);clients.add(g);g.enter({type:'join',mode:code?'code':'private',code,skin,name:key==='friend'?'Напарник':`Проверка ${skin}`});await wait(()=>!!g.state,'join');return g;}
try{
 let own=await connect('own',0),id=own.id,code=own.room.code;const friend=await connect('friend',5,code);
 for(let skin=0;skin<6;skin++){
   own.leave();clients.delete(own);await delay(100);own=await connect('own',skin,code);
   await wait(()=>friend.state.players.find(p=>p.id===id)?.skin===skin,'skin broadcast');
   const a=own.state.players.find(p=>p.id===id),b=friend.state.players.find(p=>p.id===id);
   assert.equal(own.id,id);assert.equal(a.skin,skin);assert.equal(a.tank.skin,skin);assert.equal(a.name,`Проверка ${skin}`);assert.equal(b.name,a.name);
 }
 console.log('PASS: all six skins/names on rejoin, stable player id, both clients agree');
 friend.start();await wait(()=>own.state.phase==='playing','start');
 let restores=0;own.onRestore=()=>{assert.equal(own.events.length,0);restores++;};
 for(let cycle=0;cycle<5;cycle++){
   own.events=[];own.sleep();await delay(300);assert.equal(own.events.length,0);own.wake();
   await wait(()=>!own.recovering,'fresh state');assert(own.needsResume);const player=own.state.players.find(p=>p.id===id),before=player.fired;
   commands.set(own,{...emptyInput(),fire:true,aim:{x:0,z:-8}});await delay(100);assert.equal(own.state.players.find(p=>p.id===id).fired,before);
   own.continue();await wait(()=>own.state.players.find(p=>p.id===id).fired>before,'confirmed shooting');commands.clear();own.releaseInput();
 }
 assert.equal(restores,5);console.log('PASS: five background/fresh-state/manual-resume cycles, no historical events, shooting confirmed after each return');
}finally{clearInterval(timer);for(const g of clients)g.leave();await delay(300);}
