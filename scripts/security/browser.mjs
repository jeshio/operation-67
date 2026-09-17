import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createGameServer } from '../../dist-server/index.js';
const app=createGameServer({origins:[],production:false,qa:false});await app.listen(0);
const base=`http://127.0.0.1:${app.http.address().port}`;
let browser;const pages=[],errors=[],violations=[],workers=[],audioResponses=[];
try{
 browser=await chromium.launch({headless:true,channel:'chromium',args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--allow-loopback-in-peer-connection','--disable-features=WebRtcHideLocalIpsWithMdns']});
 for(let i=0;i<2;i++){
  const context=await browser.newContext({viewport:{width:960,height:720}});
  await context.addInitScript(({i})=>{
   localStorage.setItem('roma-online-profile',JSON.stringify({name:`Проверка ${i+1}`,skin:i,nameConfirmed:true}));
   window.__securityProbe={connections:[],audio:[],violations:[]};
   document.addEventListener('securitypolicyviolation',e=>window.__securityProbe.violations.push(e.violatedDirective));
   const Peer=window.RTCPeerConnection;window.RTCPeerConnection=class extends Peer{
    generated=0;accepted=0;candidateErrors=0;
    constructor(options){super({...options,iceServers:[]});this.addEventListener('icecandidate',e=>{if(e.candidate)this.generated++;});window.__securityProbe.connections.push(this);}
    async addIceCandidate(c){try{await super.addIceCandidate(c);this.accepted++;}catch(e){this.candidateErrors++;throw e;}}
   };
   const Audio=window.AudioContext;window.AudioContext=class extends Audio{constructor(...args){super(...args);window.__securityProbe.audio.push(this);}};
  },{i});
  const page=await context.newPage();pages.push(page);page.on('pageerror',e=>errors.push(e.message));page.on('worker',w=>workers.push(w.url()));page.on('response',r=>{if(r.url().endsWith('.wav'))audioResponses.push(r.status());});
  const response=await page.goto(base);assert(response.headers()['content-security-policy'].includes("worker-src 'self' blob:"));
  await page.locator('#online-entry').click();
  if(i===0){await page.locator('#net-create').click();await page.locator('#net-confirm-create').click();}
  else{const code=[...app.rooms.rooms.values()][0].coordinator.info.code;await page.locator('#net-code-entry').click();await page.locator('#net-code').fill(code);await page.locator('#net-join').click();}
  await page.locator('#net-room').waitFor({state:'visible'});
 }
 await pages[0].locator('#net-start').click();
 for(const page of pages){await page.locator('#net-overlay').waitFor({state:'hidden'});await page.waitForFunction(()=>window.__securityProbe.connections.some(p=>p.connectionState==='connected'),null,{timeout:20000});}
 assert(workers.some(url=>url.includes('host-worker')),'Host WebWorker starts under CSP');
 for(const page of pages){await page.waitForFunction(()=>window.__securityProbe.audio.some(a=>a.state==='running'));violations.push(...await page.evaluate(()=>window.__securityProbe.violations));assert.equal(await page.evaluate(()=>typeof window.__multiplayerQA),'undefined');}
 assert(audioResponses.length>0&&audioResponses.every(s=>s===200),'Audio assets load');assert.deepEqual(errors,[]);assert.deepEqual(violations,[]);
 mkdirSync('test-artifacts/security',{recursive:true});await pages[0].screenshot({path:'test-artifacts/security/browser.png'});
 writeFileSync('test-artifacts/security/browser.json',JSON.stringify({ok:true,browser:browser.version(),players:2,worker:true,webRTC:true,audio:true,cspViolations:violations,errors},null,2));
 console.log('PASS: production UI, WebGL, host Worker, direct WebRTC, audio, CSP, no QA globals');
}catch(error){
 const states=await Promise.all(pages.map(p=>p.evaluate(()=>({connections:window.__securityProbe?.connections.map(c=>({connection:c.connectionState,ice:c.iceConnectionState,signaling:c.signalingState,generated:c.generated,accepted:c.accepted,candidateErrors:c.candidateErrors})),audio:window.__securityProbe?.audio.map(a=>a.state),violations:window.__securityProbe?.violations})).catch(()=>null)));
 console.error(JSON.stringify({errors,states,workers,audioResponses}));throw error;
}finally{await browser?.close();await app.close();}
