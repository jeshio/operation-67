import { chromium,firefox,webkit } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir,writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const base=process.env.QA_URL??'http://127.0.0.1:5197/';
const names=process.argv.slice(2).length?process.argv.slice(2):['chromium','firefox','webkit'];
const reportJSON=value=>JSON.stringify(value,(key,value)=>/token|sessionId/i.test(key)?undefined:value,2);
await mkdir('test-artifacts/multiplayer',{recursive:true});
for(const name of names){
 const reportName=name+(process.env.QA_REPORT_SUFFIX??'');
 const browser=await({chromium,firefox,webkit}[name]).launch({headless:true,...(process.env.QA_PROXY_SERVER?{proxy:{server:process.env.QA_PROXY_SERVER}}:{}),...(name==='chromium'?{channel:'chromium',args:process.env.QA_LOCAL_ICE==='1'?['--disable-features=WebRtcHideLocalIpsWithMdns']:[]}:{})}),pages=[],errors=[],results={browser:name,version:browser.version(),localIceTest:process.env.QA_LOCAL_ICE==='1',samples:[],transportWarnings:[]};let faultAt=0;
 const state=p=>p.evaluate(()=>window.__multiplayerQA.state());
 try{
  for(let i=0;i<4;i++){
   const ctx=await browser.newContext({viewport:{width:960,height:720}}),page=await ctx.newPage();pages.push(page);page.on('pageerror',e=>{if(name==='webkit'&&faultAt&&Date.now()-faultAt<4000&&e.message==='Error sending binary data through RTCDataChannel.')results.transportWarnings.push({message:e.message,afterFaultMs:Date.now()-faultAt});else errors.push(e.message);});
   await page.goto(`${base}?qa&guest=${i+1}`);await page.waitForFunction(()=>!!window.__multiplayerQA);
   const started=Date.now();if(i===0)await page.evaluate(()=>window.__multiplayerQA.join('public'));else{const code=(await state(pages[0])).room.code;await page.evaluate(code=>window.__multiplayerQA.join('code',code),code);}
   await page.waitForFunction(()=>!!window.__multiplayerQA.state().state);results.samples.push({joinMs:Date.now()-started});
  }
  await Promise.all(pages.map(p=>p.waitForFunction(()=>window.__multiplayerQA.state().state?.phase==='playing',null,{timeout:20000})));
  const before=await Promise.all(pages.map(state));await Promise.all(pages.map(p=>p.evaluate(()=>{window.__multiplayerQA.input({x:.65,z:-.3,aim:{x:0,z:-8},fire:true});window.__frames=[];let previous=performance.now();function frame(t){window.__frames.push(t-previous);previous=t;if(window.__frames.length<600)requestAnimationFrame(frame)}requestAnimationFrame(frame)})));
  await pages[0].waitForTimeout(1000);await Promise.all(pages.map(p=>p.evaluate(()=>window.__multiplayerQA.input(null))));
  // The one-second input window is independent of delivery time. Wait for authoritative convergence.
  await Promise.all(pages.map((p,i)=>p.waitForFunction(before=>{const s=window.__multiplayerQA.state(),a=before.state.players.find(p=>p.id===before.id),b=s.state.players.find(p=>p.id===s.id);return b.fired>a.fired&&Math.hypot(b.tank.x-a.tank.x,b.tank.z-a.tank.z)>.5;},before[i],{timeout:5000})));
  const after=await Promise.all(pages.map(state));for(let i=0;i<4;i++){const a=before[i].state.players.find(p=>p.id===before[i].id),b=after[i].state.players.find(p=>p.id===after[i].id);assert(b.fired>a.fired,'player shoots');assert(Math.hypot(b.tank.x-a.tank.x,b.tank.z-a.tank.z)>.5,'player moves');}
  if(process.env.QA_RELAY_ONLY!=='1'){
  await Promise.all(pages.map(p=>p.waitForFunction(()=>window.__multiplayerQA.state().links?.length===3&&window.__multiplayerQA.state().links.every(l=>l.directRtt!==null),null,{timeout:15000})));
  await Promise.all(pages.map(p=>p.evaluate(()=>window.__multiplayerQA.route('direct'))));await pages[0].waitForTimeout(500);
  results.direct=await Promise.all(pages.map(state));assert(results.direct.every(s=>s.links.every(l=>l.route==='direct')),'all peers use tested direct links');
  if(process.env.QA_NETWORK_FAULTS==='1'){faultAt=Date.now();execFileSync('sh',['scripts/qa-netem.sh']);results.netem='eth0: 40±10 ms, loss 1%, reorder 2%; lo: 15±5 ms, loss 2%, reorder 5%; enabled after ICE';await pages[0].waitForTimeout(1000);}
  await pages[1].evaluate(()=>window.__multiplayerQA.route('relay'));await pages[0].waitForTimeout(300);results.mixed=(await state(pages[1])).links;assert(results.mixed.every(l=>l.route==='relay'));
  const previousTick=(await state(pages[2])).tick;faultAt=Date.now();await pages[2].evaluate(()=>window.__multiplayerQA.cutDirect());await pages[0].waitForTimeout(700);const fallback=await state(pages[2]);assert(fallback.tick>previousTick);assert(fallback.links.every(l=>l.route==='relay'));
  }else{await Promise.all(pages.map(p=>p.evaluate(()=>window.__multiplayerQA.route('relay'))));results.relayOnly=true;}
  let active=await Promise.all(pages.map(state)),hostIndex=active.findIndex(s=>s.id===s.room.host),epoch=active[0].room.hostEpoch;
  const backgroundAt=Date.now();await pages[hostIndex].evaluate(()=>window.__multiplayerQA.sleep());
  await Promise.all(pages.filter((_,i)=>i!==hostIndex).map(p=>p.waitForFunction(epoch=>{const s=window.__multiplayerQA.state();return s.room.hostEpoch>epoch&&!s.recovering;},epoch,{timeout:3000})));
  results.backgroundRecoveryMs=Date.now()-backgroundAt;
  await pages[hostIndex].evaluate(()=>{window.__multiplayerQA.wake();window.__multiplayerQA.resume();});
  await pages[hostIndex].waitForFunction(()=>!window.__multiplayerQA.state().recovering);
  results.repeatRounds=[];
  for(let repeat=0;repeat<2;repeat++){
   active=await Promise.all(pages.map(state));hostIndex=active.findIndex(s=>s.id===s.room.host);const round=active[0].room.round;
   await pages[hostIndex].evaluate(()=>window.__multiplayerQA.endRound());
   await Promise.all(pages.map(p=>p.waitForFunction(()=>window.__multiplayerQA.state().state.phase==='over',null,{timeout:5000})));
   await pages[0].waitForTimeout(300);const owner=active.findIndex(s=>s.id===s.room.owner);await pages[owner].evaluate(()=>window.__multiplayerQA.start());
   await Promise.all(pages.map(p=>p.waitForFunction(round=>{const s=window.__multiplayerQA.state();return s.room.round>round&&s.state.phase==='playing'&&!s.recovering;},round,{timeout:7000})));
   const fresh=await Promise.all(pages.map(state));assert(fresh.every(s=>s.state.players.filter(p=>p.present).length===4&&s.state.score===0));results.repeatRounds.push(fresh[0].room.round);
  }
  active=await Promise.all(pages.map(state));hostIndex=active.findIndex(s=>s.id===s.room.host);epoch=active[0].room.hostEpoch;
  const oldHost=active[hostIndex].id,code=active[0].room.code,returnContext=pages[hostIndex].context();faultAt=Date.now();
  const began=Date.now();await pages[hostIndex].close();const survivors=pages.filter((_,i)=>i!==hostIndex);
  await Promise.all(survivors.map(p=>p.waitForFunction(epoch=>{const s=window.__multiplayerQA.state();return s.room.hostEpoch>epoch&&s.room.stage==='running'&&!s.recovering;},epoch,{timeout:3000})));results.recoveryMs=Date.now()-began;
  await survivors[0].waitForTimeout(1000);results.final=await Promise.all(survivors.map(state));
  for(const [i,p] of survivors.entries())results.samples[i].frames=await p.evaluate(()=>{const f=window.__frames.slice(5).sort((a,b)=>a-b);return{fps:1000/(f.reduce((a,b)=>a+b,0)/f.length),frameP95:f[Math.floor(f.length*.95)]};});
  const returned=await returnContext.newPage();await returned.goto(`${base}?qa&guest=${hostIndex+1}`);await returned.waitForFunction(()=>!!window.__multiplayerQA);await returned.evaluate(code=>window.__multiplayerQA.join('code',code),code);
  await returned.waitForFunction(()=>!!window.__multiplayerQA.state().state&&!window.__multiplayerQA.state().recovering);
  const back=await state(returned);assert.equal(back.id,oldHost);assert.notEqual(back.room.host,oldHost);assert.equal(back.state.players.filter(p=>p.present).length,4);assert.equal(new Set(back.state.players.map(p=>p.id)).size,4);results.formerHostRejoined=true;
  assert.equal(errors.length,0,errors.join('\n'));results.errors=errors;console.log(`${name}: four players, ${results.relayOnly?'relay':'relay/direct/mixed + fallback'}, background, repeat rounds, rejoin, host recovery ${results.recoveryMs} ms PASS`);
  await survivors[0].screenshot({path:`test-artifacts/multiplayer/${reportName}.png`});
 }catch(error){results.ice=await Promise.all(pages.filter(p=>!p.isClosed()).map(p=>p.evaluate(()=>window.__multiplayerQA.ice()).catch(()=>null)));results.failure=String(error);results.errors=errors;console.error(name,error);for(const p of pages)if(!p.isClosed())console.error(reportJSON(await state(p).then(({state,view,...d})=>d).catch(()=>({}))));process.exitCode=1;}
 finally{if(process.env.QA_NETWORK_FAULTS==='1')execFileSync('sh',['scripts/qa-netem.sh','off']);await writeFile(`test-artifacts/multiplayer/${reportName}.json`,reportJSON(results));await browser.close();}
}
