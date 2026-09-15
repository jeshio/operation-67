import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
const browser=await chromium.launch({channel:'chromium',headless:true}),results=[];
try{
 for(const delayMs of [0,2000]){
  const context=await browser.newContext(),page=await context.newPage();let intercepted=0;
  if(delayMs)await page.route('**/host-worker-*.js',async route=>{intercepted++;await new Promise(r=>setTimeout(r,delayMs));await route.continue();});
  await page.goto('http://127.0.0.1:5197/?qa&guest=1');await page.waitForFunction(()=>!!window.__multiplayerQA);
  const at=Date.now();await page.evaluate(()=>window.__multiplayerQA.join('private'));await page.waitForFunction(()=>!!window.__multiplayerQA.state().state,null,{timeout:5000});
  const elapsed=Date.now()-at,state=await page.evaluate(()=>window.__multiplayerQA.state());assert.equal(state.room.hostEpoch,1,'first assignment survives a slow Worker download');assert(elapsed<5000);if(delayMs){assert(intercepted>0);assert(elapsed>=delayMs);}
  results.push({workerDelayMs:delayMs,joinMs:elapsed,hostEpoch:state.room.hostEpoch});await context.close();
 }
 await writeFile('test-artifacts/multiplayer/cold-host.json',JSON.stringify(results,null,2));console.log('PASS: '+JSON.stringify(results));
}finally{await browser.close();}
