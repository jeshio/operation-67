import { chromium } from '@playwright/test';
import { mkdirSync,readFileSync,writeFileSync,createWriteStream,existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { assertProductionEmpty } from './safety.mjs';

if(process.platform!=='darwin')throw Error('Run this physical-computer check on the Mac, outside Docker');
const {values}=parseArgs({options:{endpoint:{type:'string',default:'https://67.jeshio.ru/qa-colyseus'},output:{type:'string',default:'test-artifacts/capacity/physical'},minutes:{type:'string',default:'30'}}});
const endpoint=values.endpoint.replace(/\/$/,''),out=resolve(values.output);mkdirSync(out,{recursive:true});
if(!new URL(endpoint).pathname.startsWith('/qa-colyseus'))throw Error('A separate QA endpoint is required');
const clean=value=>JSON.parse(JSON.stringify(value,(key,value)=>/token|sessionId/i.test(key)?undefined:value));
async function guard(){const r=await fetch(new URL('/health',endpoint),{signal:AbortSignal.timeout(5000)});assertProductionEmpty(await r.json());}
await guard();
const browser=await chromium.launch({headless:false,args:['--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows']});
const stream=createWriteStream(resolve(out,'samples.jsonl')),pages=[],events=[],started=Date.now();let stop=false,lastCommand=0,startedBattle=false;
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{stop=true;});
const state=c=>c.page.evaluate(capacity=>capacity?window.__capacityQA.status():window.__multiplayerQA.state(),c.capacity);
const act=(c,action)=>c.page.evaluate(({capacity,action})=>{
 const q=capacity?window.__capacityQA:window.__multiplayerQA;
 if(action==='sleep')q.sleep();if(action==='wake'){q.wake();q.resume();}
 if(action==='relay'||action==='direct'){
  if(capacity)q.configure({routes:Object.fromEntries((q.status().players??[]).map(p=>[p.id,action]))});else q.route(action);
 }
 if(action==='leave')capacity?q.dispose():q.leave();
},{capacity:c.capacity,action});
try{
 let code;
 for(let i=0;i<3;i++){
  const context=await browser.newContext({viewport:{width:1024,height:768}}),page=await context.newPage(),capacity=i>0;
  const c={page,context,capacity};pages.push(c);page.on('pageerror',error=>events.push({at:Date.now(),kind:'browser-error',slot:i,message:error.message}));
  const url=new URL(endpoint+(capacity?'/qa-network.html':'/'));url.searchParams.set('guest',String(100+i));
  if(capacity){url.searchParams.set('capacity','1');url.searchParams.set('version','current');url.searchParams.set('endpoint',endpoint);}else url.searchParams.set('qa','');
  await page.goto(url.href);await page.waitForFunction(capacity=>capacity?!!window.__capacityQA:!!window.__multiplayerQA,capacity);
  await page.evaluate(({capacity,code})=>capacity?window.__capacityQA.join(code):window.__multiplayerQA.join('private'),{capacity,code});
  await page.waitForFunction(capacity=>capacity?!!window.__capacityQA.status().players?.length:!!window.__multiplayerQA.state().state,capacity);
  const s=await state(c);code=s.code??s.room.code;c.id=s.id;
 }
 await pages[0].page.bringToFront();await pages[0].page.evaluate(()=>window.__multiplayerQA.bot(true));
 const invitation=new URL(endpoint+'/');invitation.searchParams.set('qa','');invitation.searchParams.set('guest','200');invitation.searchParams.set('room',code);
 const ready={code,url:invitation.href,nativeIds:pages.map(c=>c.id),browser:browser.version(),platform:process.platform,controls:resolve(out,'control.json'),startedAt:new Date().toISOString()};
 writeFileSync(resolve(out,'ready.json'),JSON.stringify(ready,null,2));console.log(JSON.stringify(ready));
 while(!stop&&Date.now()-started<Number(values.minutes)*60000){
  await guard();
  const states=await Promise.all(pages.map(state)),room=states[0].room;
  if(!startedBattle&&room?.players?.filter(p=>p.present).length===4){await pages[0].page.evaluate(()=>window.__multiplayerQA.start());startedBattle=true;events.push({at:Date.now(),kind:'four-players-started'});console.log('Four players joined; starting battle');}
  const sample={at:Date.now(),states:clean(states.map(s=>({...s,state:s.state?{phase:s.state.phase,wave:s.state.wave,score:s.state.score,players:s.state.players.map(p=>({id:p.id,present:p.present,hp:p.tank.hp,x:p.tank.x,z:p.tank.z,fired:p.fired}))}:undefined,view:undefined})))};
  stream.write(JSON.stringify(sample)+'\n');writeFileSync(resolve(out,'latest.json'),JSON.stringify(sample,null,2));
  const path=resolve(out,'control.json');if(existsSync(path)){
   const command=JSON.parse(readFileSync(path,'utf8'));
   if(Number.isSafeInteger(command.id)&&command.id>lastCommand){
    lastCommand=command.id;
    if(!['sleep','wake','relay','direct','stop'].includes(command.action))throw Error('Unknown physical test action');
    events.push({at:Date.now(),kind:command.action});
    if(command.action==='stop')stop=true;else await Promise.all(pages.map(c=>act(c,command.action)));
   }
  }
  await new Promise(r=>setTimeout(r,1000));
 }
}catch(error){events.push({at:Date.now(),kind:'error',message:error.message});console.error(error.message);process.exitCode=1;}
finally{
 await Promise.allSettled(pages.map(c=>act(c,'leave')));await browser.close();stream.end();
 writeFileSync(resolve(out,'events.json'),JSON.stringify({finishedAt:new Date().toISOString(),events,note:'Physical phone actions and network type require the user’s confirmation; this is not a capacity measurement.'},null,2));
}
