import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'chromium',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.env.QA_PANEL_URL??'http://127.0.0.1:5197/qa-panel.html');await page.getByRole('button',{name:'Новый отряд'}).click();
 await page.waitForFunction(()=>[...document.querySelectorAll('iframe')].every(f=>f.contentWindow.__multiplayerQA?.state().state?.phase==='playing'));
 const before=await page.evaluate(()=>[...document.querySelectorAll('iframe')].map(f=>f.contentWindow.__multiplayerQA.state().state.players.reduce((n,p)=>n+p.fired,0)));
 await page.getByRole('button',{name:'Включить ботов'}).click();await page.waitForFunction(before=>[...document.querySelectorAll('iframe')].every((f,i)=>f.contentWindow.__multiplayerQA.state().state.players.reduce((n,p)=>n+p.fired,0)>before[i]),before,{timeout:10000});
 const after=await page.evaluate(()=>[...document.querySelectorAll('iframe')].map(f=>f.contentWindow.__multiplayerQA.state()));assert(after.every((s,i)=>s.state.players.reduce((n,p)=>n+p.fired,0)>before[i]));
 const epoch=after[0].room.hostEpoch;await page.getByRole('button',{name:'Отключить хоста'}).click();
 await page.waitForFunction(epoch=>{const games=[...document.querySelectorAll('iframe')].map(f=>f.contentWindow.__multiplayerQA.state()).filter(g=>g.connected);return games.length===3&&games.every(g=>!g.recovering&&g.room.hostEpoch>epoch);},epoch,{timeout:3000});
 assert.equal(errors.length,0,errors.join('\n'));await page.screenshot({path:'test-artifacts/multiplayer/qa-panel.png'});console.log('PASS: QA panel, four separate identities, bots and host crash');
}finally{await browser.close();}
