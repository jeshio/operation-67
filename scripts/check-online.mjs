import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
const base=new URL(process.argv[2]??'https://89.19.211.4/');
const endpoint=new URL('/ws',base);endpoint.protocol=base.protocol==='https:'?'wss:':'ws:';
const clients=[];const begun=Date.now();const stamp=()=>((Date.now()-begun)/1000).toFixed(1);
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function connect(name){
 const ws=new WebSocket(endpoint,{origin:base.origin});const c={ws,name,messages:[],state:null,id:null};clients.push(c);
 ws.on('message',data=>{const m=JSON.parse(String(data));if(m.type==='snapshot')c.state=m;else {c.messages.push(m);if(m.type==='error')console.log('SERVER ERROR',name,m.message);}});
 await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});
 ws.on('close',(code,reason)=>console.log(stamp(),'CLOSE',name,code,String(reason)));
 c.send=m=>ws.send(JSON.stringify(m));
 c.wait=async type=>{for(let i=0;i<200;i++){const n=c.messages.findIndex(m=>m.type===type);if(n>=0)return c.messages.splice(n,1)[0];await delay(50);}throw Error('Не получено '+type);};
 c.send({type:'hello',version:4});await c.wait('welcome');console.log(stamp(),'CONNECTED',name);return c;
}
try{
 const owner=await connect('Проверка 1');owner.send({type:'join',mode:'private',name:owner.name,skin:0});const joined=await owner.wait('joined');owner.id=joined.id;
 for(let i=2;i<=4;i++){const c=await connect('Проверка '+i);c.send({type:'join',mode:'code',code:joined.room.code,name:c.name,skin:i-1});c.id=(await c.wait('joined')).id;}
 const fifth=await connect('Проверка 5');fifth.send({type:'join',mode:'code',code:joined.room.code,name:fifth.name,skin:4});assert.match((await fifth.wait('error')).message,/четыре/);
 console.log(stamp(),'Starting',JSON.stringify({id:owner.id,room:owner.state?.room,phase:owner.state?.state.phase}));
 owner.send({type:'start'});
 for(let i=0;i<200&&owner.state?.state.phase!=='playing';i++)await delay(50);
 console.log(stamp(),'Start result',JSON.stringify({room:owner.state?.room,phase:owner.state?.state.phase}));
 assert.equal(owner.state?.state.phase,'playing');await delay(150);
 for(const c of clients.slice(0,4))assert.equal(c.state.state.players.length,4);
 const before=owner.state.state.players.find(p=>p.id===owner.id).tank;console.log(stamp(),'Before',JSON.stringify({tank:before,elapsed:owner.state.state.elapsed,ack:owner.state.ack}));
 for(let i=0;i<20;i++){owner.send({type:'input',seq:i,input:{x:1,z:0,aim:{x:0,z:0},fire:true,power:false,dash:false}});await delay(50);}
 owner.send({type:'input',seq:20,input:{x:0,z:0,aim:{x:0,z:0},fire:false,power:false,dash:false}});for(let i=0;i<100&&owner.state.ack<20;i++)await delay(50);
 const after=owner.state.state.players.find(p=>p.id===owner.id).tank;
 console.log(stamp(),'After',JSON.stringify({tank:after,elapsed:owner.state.state.elapsed,ack:owner.state.ack}));
 assert(Math.hypot(after.x-before.x,after.z-before.z)>.2);
 console.log('Ack',owner.state.ack,'phase',owner.state.state.phase);
 assert(owner.state.ack>=20);
 console.log('PASS: trusted HTTPS/WSS, 4 players, fifth rejected, shared battle, movement/fire commands acknowledged.');
}finally{for(const c of clients){if(c.ws.readyState===WebSocket.OPEN)c.ws.send(JSON.stringify({type:'leave'}));c.ws.close();}await delay(300);for(const c of clients)c.ws.terminate();}
