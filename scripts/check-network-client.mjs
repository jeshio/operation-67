import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { NetworkGame } from '../src/network.ts';
import { emptyInput } from '../src/simulation.ts';
import { NET } from '../src/net/config.ts';
const base=new URL(process.argv[2]??'https://89.19.211.4/');
Object.defineProperty(globalThis,'location',{value:base,configurable:true});
Object.defineProperty(globalThis,'WebSocket',{value:class extends WebSocket{constructor(url){super(url,{origin:base.origin});}},configurable:true});
const quick=process.argv.includes('--quick');
const count=Math.max(2,Math.min(4,Number(process.argv.find(a=>a.startsWith('--players='))?.split('=')[1])||2));
const clients=[],commands=new Map(),begun=performance.now();let previous=begun,accumulator=0;
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const timer=setInterval(()=>{
 const now=performance.now(),dt=Math.min(.1,(now-previous)/1000);previous=now;accumulator+=dt;
 while(accumulator>=1/60){for(const g of clients)g.step(commands.get(g)??emptyInput());accumulator-=1/60;}
 for(const g of clients)g.render(dt,accumulator*60);
},8);
async function wait(description,check,limit=20000){const until=performance.now()+limit;while(!check()){if(performance.now()>until)throw Error(`${description}: timeout (${clients.map(c=>c.error||c.connectionNotice).join('; ')})`);await delay(50);}}
async function connect(number,code){const g=new NetworkGame(null,'qa-remote',undefined,{endpoint:base.href.replace(/\/$/,'')});clients.push(g);g.onRound=()=>g.releaseInput();g.onConnectionLoss=()=>g.releaseInput();g.enter({type:'join',mode:quick?'quick':code?'code':'private',code,name:`Проверка сети ${number}`,skin:number-1});await wait('Join',()=>!!g.state);return g;}
try{
 const first=await connect(1);for(let i=2;i<=count;i++)await connect(i,first.room.code);
 if(count===4){const response=await fetch(base.href.replace(/\/$/,'')+'/api/join',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({version:NET.version,request:{type:'join',mode:'code',code:first.room.code,name:'Пятый',skin:0}})});assert.equal((await response.json()).code,'FULL');}
 if(!quick)first.start();
 await wait('Battle start',()=>clients.every(g=>g.state?.phase==='playing'));await delay(250);
 const before=clients.map(g=>structuredClone(g.state.players.find(p=>p.id===g.id)));
 for(const g of clients)commands.set(g,{...emptyInput(),x:.65,z:-.3,aim:{x:0,z:-8},fire:true});
 await delay(1000);commands.clear();clients.forEach(g=>g.releaseInput());
 const released=clients.map(g=>g.sequence);await wait('Release acknowledged',()=>clients.every((g,i)=>g.ack>=released[i]));
 await delay(150);
 await wait('Authoritative movement and fire',()=>clients.every((g,i)=>{const p=g.state.players.find(p=>p.id===g.id);return p&&p.fired>before[i].fired&&Math.hypot(p.tank.x-before[i].tank.x,p.tank.z-before[i].tank.z)>.2;}));
 for(const [i,g] of clients.entries()){const p=g.state.players.find(p=>p.id===g.id);assert.equal(g.state.players.length,count);assert.equal(g.room.code,first.room.code);assert.equal(g.error,'');console.log(`Player ${i+1}: server movement ${Math.hypot(p.tank.x-before[i].tank.x,p.tank.z-before[i].tank.z).toFixed(2)}, shots ${p.fired-before[i].fired}, ack ${g.ack}, sent ${g.sequence}`);}
 console.log(`PASS: actual NetworkGame clients over HTTPS/WSS in ${((performance.now()-begun)/1000).toFixed(1)} s`);
}finally{clearInterval(timer);for(const g of clients)g.leave();await delay(300);}
