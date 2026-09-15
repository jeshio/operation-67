import { chromium } from '@playwright/test';
import { parseArgs } from 'node:util';
import { createReadStream,createWriteStream,existsSync,mkdirSync,readFileSync,writeFileSync,renameSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve,join } from 'node:path';
import { createGzip } from 'node:zlib';
import { once } from 'node:events';
import { cpus } from 'node:os';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { aggregate,accumulate,finishAggregate,routePolicy,routeProblems,resourceDelta,recommendedRooms,reusable,checkMemoryPlateau } from './analysis.mjs';
import { bounded,assertProductionEmpty,assertGeneratorWithinLimits,assertTunnelWithinLimits,assertVpsWithinLimits,measuredPhase } from './safety.mjs';
import { summarizePhases } from './phases.mjs';

const {values}=parseArgs({options:{
 version:{type:'string',default:'current'},route:{type:'string',default:'relay'},rooms:{type:'string',default:'4'},
 endpoint:{type:'string',default:'https://67.jeshio.ru/qa-colyseus'},url:{type:'string'},
 duration:{type:'string',default:'300'},warmup:{type:'string',default:'60'},scenarios:{type:'string',default:'normal,heavy'},
 output:{type:'string',default:'test-artifacts/capacity'},label:{type:'string'},seed:{type:'string',default:'6702'},
 suite:{type:'boolean',default:false},deploy:{type:'boolean',default:false},resume:{type:'boolean',default:false},
 'max-rooms':{type:'string',default:'128'},soak:{type:'string',default:'3600'},faults:{type:'boolean',default:false},
 'skip-restart':{type:'boolean',default:false},smoke:{type:'boolean',default:false},
 functional:{type:'string'},
}});
const broker=process.env.CAPACITY_TELEMETRY_URL??'http://127.0.0.1:5298',token=process.env.CAPACITY_BROKER_TOKEN;
if(!token)throw Error('CAPACITY_BROKER_TOKEN is required; start the telemetry broker first');
const endpoint=values.endpoint.replace(/\/$/,'');
if(!new URL(endpoint).pathname.startsWith('/qa-colyseus'))throw Error('Capacity runs require the separate /qa-colyseus endpoint');
if(!['current','baseline'].includes(values.version)||!['relay','direct','mixed'].includes(values.route))throw Error('Unknown version/route');
if(values.version==='baseline'&&values.route!=='relay')throw Error('Baseline supports the server route only');
if(values.functional&&(!['chromium','firefox','webkit'].includes(values.functional)||values.version==='baseline'||values.suite))throw Error('Functional UI runs use a current-version single stage and one browser engine');
for(const key of ['rooms','duration','warmup','max-rooms','soak','seed'])if(!Number.isSafeInteger(Number(values[key]))||Number(values[key])<0)throw Error('Invalid '+key);
if(Number(values.rooms)<1||Number(values.rooms)>128||values.route==='mixed'&&Number(values.rooms)%2)throw Error('Mixed runs need an even number of rooms');
const out=resolve(values.output);mkdirSync(out,{recursive:true});
const manifest=JSON.parse(readFileSync('test-artifacts/capacity-build/manifest.json','utf8'));
const harnessHash=createHash('sha256');for(const file of ['run.mjs','analysis.mjs','safety.mjs','phases.mjs'])harnessHash.update(readFileSync(new URL(file,import.meta.url)));
const proxyServer=process.env.CAPACITY_PROXY_SERVER;
const config={...values,endpoint,networkPath:process.env.CAPACITY_NETWORK_PATH??'system-default',proxyServer:proxyServer??null,buildId:manifest.buildId,sourceHash:manifest.sourceHash,harnessHash:harnessHash.digest('hex')};
config.signature=createHash('sha256').update(JSON.stringify({...config,resume:false,label:undefined,output:undefined})).digest('hex');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function control(path,data){
 const response=await fetch(broker+path,{method:data?'POST':'GET',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:data?JSON.stringify(data):undefined,signal:AbortSignal.timeout(path==='/deploy'?120000:15000)});
 const result=await response.json();if(!response.ok)throw Error(result.error??`Broker ${response.status}`);return result;
}
async function waitFor(fn,timeout,message){const until=Date.now()+timeout;let last;do{last=await fn();if(last)return last;if(Date.now()>=until)throw Error(message);await sleep(200);}while(true);}
async function metrics(){const m=await control('/metrics');if(!m.receivedAt||Date.now()-m.receivedAt>5000)throw Object.assign(Error('VPS telemetry unavailable or stale'),{cause:'telemetry'});return m;}
async function empty(allowStopped=false){return waitFor(async()=>{const m=await metrics();assertProductionEmpty(m.production);return m.health?.rooms===0||(allowStopped&&m.game?.processes===0&&m.health?.error);},75000,'QA rooms did not drain');}
async function configureServer(){
 if(values.deploy){await empty(true);await control('/deploy',{version:values.version});await sleep(1500);await waitFor(()=>metrics().then(m=>m.health?.ok).catch(()=>false),30000,'Staging did not start');}
 else await empty();
}
async function generatorStats(){
 const read=async file=>readFile('/sys/fs/cgroup/'+file,'utf8').catch(()=>null);
 const [cpu,memory,limit,events]=await Promise.all(['cpu.stat','memory.current','memory.max','memory.events'].map(read));
 const parse=text=>Object.fromEntries((text??'').trim().split('\n').filter(Boolean).map(line=>{const [k,v]=line.split(' ');return[k,Number(v)];}));
 return{at:Date.now(),cpu:parse(cpu),memoryBytes:memory?Number(memory):null,memoryLimit:limit&&limit.trim()!=='max'?Number(limit):null,memoryEvents:parse(events),cpuCount:cpus().length,node:process.memoryUsage()};
}
const atomic=(path,data)=>{writeFileSync(path+'.next',JSON.stringify(data,null,2));renameSync(path+'.next',path);};
let interrupted=false;process.on('SIGINT',()=>{interrupted=true;});process.on('SIGTERM',()=>{interrupted=true;});

async function runStage(totalRooms,label,{seconds=Number(values.duration),warmup=Number(values.warmup),faults=false,references={}}={}){
 const rooms=values.functional?totalRooms-1:totalRooms;
 const prefix=`${values.version}-${values.route}-${totalRooms}-${label}`,resultPath=join(out,prefix+'.json');
 if(values.resume&&existsSync(resultPath)){const prior=JSON.parse(readFileSync(resultPath));if(reusable(prior,config)){console.log(`Resume: ${prefix} already passed`);return prior;}}
 await empty();if(!values['skip-restart']){await control('/restart',{});await sleep(1500);await waitFor(()=>metrics().then(m=>m.health?.ok).catch(()=>false),30000,'QA restart failed');}
 const report={schemaVersion:1,signature:config.signature,config:{...config,rooms:totalRooms,generatorRooms:rooms,seconds,warmup},startedAt:new Date().toISOString(),completed:false,passed:false,profiles:{},joins:[],faults:[],errors:[]};
 atomic(resultPath,report);
 const browsers=[],clients=[],serverSamples=[],runtimeErrors=[];let serverBefore,generatorBefore,phase='connecting',lastSampleAt=0,aborting=false,interval,functionalProcess;
 const gzip=createGzip({level:3}),stream=createWriteStream(join(out,prefix+'.samples.jsonl.gz'));gzip.pipe(stream);
 const aggregates={},serverTicks=new Map(),started=Date.now();let serialize=Promise.resolve(),samplingError,sampling=false,fallbackAggregate;
 async function record(value){if(!gzip.write(JSON.stringify(value)+'\n'))await once(gzip,'drain');}
 async function sample(){
  const now=Date.now(),samplePhase=phase,m=await metrics(),g=await generatorStats();
  assertProductionEmpty(m.production);
  assertGeneratorWithinLimits(g);
  assertTunnelWithinLimits(m.localTunnel);
  if(values.version==='baseline')for(const r of m.qa?.rooms??[]){
   const history=serverTicks.get(r.code)??[];history.push({at:m.at,tick:r.tick});while(history.length>15)history.shift();serverTicks.set(r.code,history);
   const before=[...history].reverse().find(p=>m.at-p.at>=9900);r.tickRate10s=before?1000*(r.tick-before.tick)/(m.at-before.at):null;
  }
  const states=(await bounded(Promise.all(clients.filter(c=>!c.closed&&c.ready).map(async c=>{try{return{slot:c.slot,...await c.page.evaluate(()=>window.__capacityQA.sample())};}catch(e){if(c.closed)return null;throw e;}})),12000,'Browser sampling timeout')).filter(Boolean);
  const dt=serverBefore?(m.at-serverBefore.at)/1000:0;
  m.fresh=dt>0;
  const resources={game:resourceDelta(serverBefore?.game,m.game,dt),https:resourceDelta(serverBefore?.https,m.https,dt),
   wireInKiBps:dt>0?((m.qa?.metrics?.wireBytesIn??0)-(serverBefore?.qa?.metrics?.wireBytesIn??0))/dt/1024:null,
   wireOutKiBps:dt>0?((m.qa?.metrics?.wireBytesOut??0)-(serverBefore?.qa?.metrics?.wireBytesOut??0))/dt/1024:null};
  const priorTcp=new Map((serverBefore?.tcp??[]).map(c=>[c.id,c]));resources.tcpRetransmissions=0;resources.tcpRetransmittedBytes=0;
  if(dt>0)for(const c of m.tcp??[]){const old=priorTcp.get(c.id);if(old){resources.tcpRetransmissions+=Math.max(0,c.retransmissions-old.retransmissions);resources.tcpRetransmittedBytes+=Math.max(0,c.bytesRetransmitted-old.bytesRetransmitted);}}
  if(generatorBefore){const elapsed=(g.at-generatorBefore.at)/1000;g.cpuPercent=((g.cpu.usage_usec??0)-(generatorBefore.cpu.usage_usec??0))/elapsed/10000;}
  const data={at:now,elapsedMs:now-started,phase:samplePhase,players:states.map(({room,...s})=>s),server:m,resources,generator:g,samplingIntervalMs:lastSampleAt?now-lastSampleAt:null};
  if(measuredPhase(samplePhase,phase))accumulate(aggregates[phase]??=aggregate(),data,{version:values.version,route:values.route,rooms});
  if(samplePhase===phase&&phase==='fault-mass-relay-fallback')accumulate(fallbackAggregate??=aggregate(),data,{version:values.version,route:'relay',rooms});
  serverSamples.push({at:m.at,wire:m.qa?.metrics,game:m.game,https:m.https,phase});if(serverSamples.length>2)serverSamples.shift();
  await record(data);serverBefore=m;generatorBefore=g;lastSampleAt=now;
  if(phase==='functional'&&states.some(p=>!p.connected||p.recovering||p.error))throw Error('A background room stopped during the functional UI test');
  assertVpsWithinLimits(m);
  return states;
 }
 function enqueue(){if(sampling)return serialize;sampling=true;serialize=serialize.then(()=>{if(!aborting)return sample();}).catch(e=>{
   samplingError=e;aborting=true;functionalProcess?.kill('SIGTERM');
   // Stop traffic immediately, including while a join or fault assertion awaits a page.
   void Promise.allSettled(browsers.map(b=>b.close()));
 }).finally(()=>{sampling=false;});return serialize;}
 async function hold(seconds){const until=Date.now()+seconds*1000;let printed=0;while(Date.now()<until){
   if(interrupted)throw Object.assign(Error('Interrupted'),{cause:'interrupted'});if(samplingError)throw samplingError;
   await sleep(Math.min(1000,Math.max(0,until-Date.now())));
   const elapsed=Math.floor((Date.now()-started)/1000);if(elapsed-printed>=60){printed=elapsed;console.log(`${prefix}: ${phase}, ${elapsed}s elapsed`);}
 }await serialize;if(samplingError)throw samplingError;}
 async function state(c){return c.page.evaluate(()=>window.__capacityQA.status());}
 async function routes(reset,profile){
   for(let room=0;room<rooms;room++){
    const group=clients.slice(room*4,room*4+4).filter(c=>!c.closed),states=await Promise.all(group.map(state));
    await Promise.all(group.map((c,i)=>c.page.evaluate(next=>window.__capacityQA.configure(next),{workload:{profile,seed:Number(values.seed)+room},reset,routes:values.version==='baseline'?{}:routePolicy(values.route,room,states[i],states[i].players??[])})));
   }
   if(values.version==='baseline')await control('/workload',{profile,seed:Number(values.seed),reset});
 }
 try{
  interval=setInterval(()=>{if(!aborting&&Date.now()-lastSampleAt>=900)void enqueue();},1000);
  for(let room=0;room<rooms;room++){
    const roomAt=Date.now();if(interrupted)throw Error('Interrupted');if(samplingError)throw samplingError;
    if(room%4===0){const browser=await chromium.launch({headless:true,handleSIGINT:false,handleSIGTERM:false,handleSIGHUP:false,...(proxyServer?{proxy:{server:proxyServer}}:{}),args:['--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows','--disable-features=WebRtcHideLocalIpsWithMdns']});browsers.push(browser);report.browserVersion=browser.version();}
    const browser=browsers.at(-1);let code;
    for(let player=0;player<4;player++){
      const slot=room*4+player,context=await browser.newContext(),page=await context.newPage();page.setDefaultTimeout(25000);
      const c={slot,room,browser,context,page,closed:false};clients.push(c);page.on('pageerror',e=>runtimeErrors.push({slot,message:e.message,at:Date.now()}));
      const url=new URL(values.url??endpoint+'/qa-network.html');url.searchParams.set('capacity','1');url.searchParams.set('guest',String(slot));url.searchParams.set('version',values.version);url.searchParams.set('endpoint',endpoint);url.searchParams.set('capacityWs',endpoint.replace(/^http/,'ws')+'/ws');
      c.url=url.href;
      const began=Date.now();await page.goto(c.url);await page.waitForFunction(()=>!!window.__capacityQA);c.ready=true;
      await bounded(page.evaluate(code=>window.__capacityQA.join(code),code),25000,'Connection request timed out');
      await page.waitForFunction(()=>{const s=window.__capacityQA.status();if(s.error)throw Error(s.error);return s.connected&&s.players?.length>0;});
      const s=await state(c);code=s.code;report.joins.push({slot,ms:Date.now()-began});
    }
    await clients[room*4].page.evaluate(()=>window.__capacityQA.start());
    await Promise.all(clients.slice(room*4,room*4+4).map(c=>c.page.waitForFunction(()=>window.__capacityQA.status().phase==='playing')));
    await sleep(Math.max(0,1000-(Date.now()-roomAt)));
  }
  if(values.functional){
    phase='warmup';await routes(true,'heavy');await hold(warmup);phase='functional';
    const log=createWriteStream(join(out,prefix+'.functional.log'));
    functionalProcess=spawn(process.execPath,['scripts/check-multiplayer-browsers.mjs',values.functional],{env:{...process.env,QA_URL:endpoint+'/',QA_PROXY_SERVER:proxyServer??'',QA_LOCAL_ICE:'1',QA_REPORT_SUFFIX:`-capacity-${totalRooms}-${values.route}`},stdio:['ignore','pipe','pipe']});
    functionalProcess.stdout.pipe(log,{end:false});functionalProcess.stderr.pipe(log,{end:false});
    const code=await bounded(new Promise((resolve,reject)=>{functionalProcess.on('exit',resolve);functionalProcess.on('error',reject);}),180000,'Functional browser test timed out');log.end();
    if(samplingError)throw samplingError;
    report.functional={engine:values.functional,backgroundRooms:rooms,exitCode:code};if(code!==0)throw Error('Functional browser test failed; see its separate report');
  }else for(const profile of values.scenarios.split(',')){
    if(!['normal','heavy'].includes(profile))throw Error('Unknown workload');
    phase='warmup-'+profile;await routes(true,profile);await hold(warmup);
    if(values.version!=='baseline')await waitFor(async()=>{
      const samples=await Promise.all(clients.map(async c=>({slot:c.slot,...await c.page.evaluate(()=>window.__capacityQA.sample())})));
      return samples.every(p=>routeProblems(values.route,Math.floor(p.slot/4),p,p.players??[]).length===0);
    },20000,'Requested game routes were not established and confirmed');
    await serialize;for(const c of clients)await c.page.evaluate(()=>window.__capacityQA.sample());
    phase=profile;console.log(`${prefix}: measuring ${profile} for ${seconds}s with ${rooms*4} real browser clients`);
    await hold(seconds);phase='between';
    report.profiles[profile]=finishAggregate(aggregates[profile]??aggregate(),references[profile]);
    console.log(`${prefix}: ${profile} ${report.profiles[profile].passed?'PASS':report.profiles[profile].cause}`);
    atomic(resultPath,{...report,profiles:report.profiles});
  }
  if(faults&&values.version!=='baseline'){
    phase='fault-guest-reconnect';
    const firstGroup=clients.slice(0,4),firstStates=await Promise.all(firstGroup.map(state)),guest=firstGroup[firstStates.findIndex(p=>p.id!==p.host)];
    const guestBefore=await state(guest),disconnectAt=Date.now();await guest.page.evaluate(()=>window.__capacityQA.disconnect());
    // WebSocket.close() is asynchronous; first observe the actual loss.
    await guest.page.waitForFunction(()=>!window.__capacityQA.status().connected,{},{timeout:5000});
    await waitFor(async()=>{const s=await state(guest);return s.connected&&!s.recovering&&s.id===guestBefore.id;},10000,'Guest reconnection timeout');
    await guest.page.evaluate(()=>window.__capacityQA.resume());report.faults.push({kind:'guest-reconnect',elapsedMs:Date.now()-disconnectAt,playerId:guestBefore.id});
    phase='fault-join-during-battle';guest.closed=true;await guest.page.evaluate(()=>window.__capacityQA.leave());await guest.context.close();
    await waitFor(async()=>{const s=await state(firstGroup.find(c=>c!==guest));return !s.players?.some(p=>p.id===guestBefore.id&&p.present);},5000,'Departed player still holds a seat');
    guest.context=await guest.browser.newContext();guest.page=await guest.context.newPage();guest.ready=false;guest.closed=false;
    await guest.page.goto(guest.url);await guest.page.waitForFunction(()=>!!window.__capacityQA);guest.ready=true;
    await bounded(guest.page.evaluate(code=>window.__capacityQA.join(code),guestBefore.code),25000,'Replacement player join timeout');
    await guest.page.waitForFunction(()=>{const s=window.__capacityQA.status();if(s.error)throw Error(s.error);return s.connected&&!s.recovering&&s.players?.filter(p=>p.present).length===4;});
    const newGuest=await state(guest);if(newGuest.id===guestBefore.id)throw Error('New guest unexpectedly reused the departed identity');
    report.faults.push({kind:'join-during-battle',departedId:guestBefore.id,newId:newGuest.id});await routes(false,'heavy');await hold(3);
    for(let room=0;room<Math.min(4,rooms);room++){
      phase='fault-host-'+room;
      const group=clients.slice(room*4,room*4+4),states=await Promise.all(group.map(state)),host=group[states.findIndex(s=>s.id===s.host)];
      const stateAt=Date.now(),old=await state(host),began=Date.now();host.closed=true;await host.page.close();
      const closedTickUpper=old.tick+Math.ceil(((old.snapshotAgeMs??50)+Date.now()-stateAt+10)*60/1000);
      const survivors=group.filter(c=>c!==host);
      await waitFor(async()=>{const s=await Promise.all(survivors.map(state));return s.every(p=>p.epoch!==old.epoch&&p.connected&&!p.recovering&&p.phase==='playing');},5000,'Host recovery timeout');
      const survivorStates=await Promise.all(survivors.map(state)),restored=survivorStates.find(s=>s.id===s.host);const recoveryMs=Date.now()-began,rollbackTicks=Math.max(0,old.tick-restored.preparedCheckpointTick),rollbackUpperBoundTicks=Math.max(0,closedTickUpper-restored.preparedCheckpointTick);
      const proof=restored.restoreProof;if(!proof||!proof.scoreMatches||!proof.eventCursorMatches||!proof.rosterMatches||!proof.rewardsMatch)throw Error('Restored checkpoint changed rewards, score, event cursor, or roster');
      host.page=await host.context.newPage();host.ready=false;host.closed=false;await host.page.goto(host.url);await host.page.waitForFunction(()=>!!window.__capacityQA);host.ready=true;await host.page.evaluate(code=>window.__capacityQA.join(code),old.code);
      await host.page.waitForFunction(()=>{const s=window.__capacityQA.status();return s.connected&&!s.recovering&&s.phase==='playing';});
      const back=await state(host);if(back.id!==old.id||back.id===back.host||back.players.filter(p=>p.present).length!==4)throw Error('Former host rejoin changed identity/roster');
      const boundedRtt=Number.isFinite(old.serverRtt)&&Number.isFinite(back.serverRtt)&&Math.max(old.serverRtt,back.serverRtt)<=150;
      report.faults.push({room,kind:'host-close-return',recoveryMs,rollbackTicks,rollbackUpperBoundTicks,restoreProof:proof,oldHost:old.id,newHost:back.host,serverRttBefore:old.serverRtt,serverRtt:back.serverRtt,pass:boundedRtt?recoveryMs<=3000&&rollbackUpperBoundTicks<=30:null});
      await routes(false,'heavy');await hold(3);
    }
    if(values.route!=='relay'){
      phase='fault-mass-relay-switch';
      const began=Date.now();await Promise.all(clients.map(c=>c.page.evaluate(()=>{window.__capacityQA.configure({routes:Object.fromEntries((window.__capacityQA.status().players??[]).map(p=>[p.id,'relay']))});window.__capacityQA.cutDirect();})));
      await waitFor(async()=>{const s=await Promise.all(clients.map(state));return s.every(p=>p.connected&&!p.recovering&&p.links.every(l=>l.route==='relay'));},5000,'Mass relay fallback failed');
      const transitionMs=Date.now()-began;await hold(3);await serialize;
      for(const c of clients)await c.page.evaluate(()=>window.__capacityQA.sample());
      phase='fault-mass-relay-fallback';await hold(30);
      report.faults.push({kind:'mass-relay-fallback',transitionMs,quality:finishAggregate(fallbackAggregate??aggregate()),states:(await Promise.all(clients.map(state))).map(({room,...s})=>s)});
    }
  }
  if(runtimeErrors.length)throw Error('Browser runtime errors: '+runtimeErrors.slice(0,3).map(e=>e.message).join('; '));
  report.completed=true;report.passed=Object.values(report.profiles).every(p=>p.passed)&&report.faults.every(f=>f.pass!==false)&&(!values.functional||report.functional?.exitCode===0);
  report.memoryPlateau=checkMemoryPlateau(Object.values(aggregates).flatMap(a=>a.memory).sort((a,b)=>a.at-b.at));
  if(report.memoryPlateau?.sustainedGrowth){report.passed=false;report.errors.push({message:'Retained memory grows throughout the hour',cause:'vps-or-game'});}
 }catch(e){const failure=samplingError??e;report.errors.push({message:failure.message,cause:failure.cause??'setup-or-runtime',resource:failure.resource});console.error(prefix,failure.message);}
 finally{
  aborting=true;clearInterval(interval);await serialize;
  for(const [profile,a] of Object.entries(aggregates))if(!report.profiles[profile])report.profiles[profile]=finishAggregate(a,references[profile]);
  report.runtimeErrors=runtimeErrors;report.durationSeconds=(Date.now()-started)/1000;report.finishedAt=new Date().toISOString();
  report.cause=report.errors[0]?.cause??Object.values(report.profiles).find(p=>!p.passed)?.cause??null;
  report.acceptance=report.passed&&!values.smoke&&!values.functional&&seconds>=300&&warmup>=60&&!!report.profiles.normal&&!!report.profiles.heavy;
  if(values.smoke)report.note='Short instrumentation smoke; not a capacity acceptance run';
  if(functionalProcess?.exitCode===null)functionalProcess.kill('SIGTERM');
  await Promise.allSettled(clients.filter(c=>!c.closed).map(c=>bounded(c.page.evaluate(()=>window.__capacityQA.dispose()),2000,'Cleanup timeout')));
  await Promise.allSettled(browsers.map(b=>b.close()));
  gzip.end();await once(stream,'finish');atomic(resultPath,report);
  report.phaseMeasurements=await summarizePhases(join(out,prefix+'.samples.jsonl.gz'),report.config,report.joins);atomic(resultPath,report);
 }
 console.log(`${prefix}: ${report.passed?'PASS':'NOT PASSED'}; ${resultPath}`);return report;
}

async function suite(){
 const results=[],series={config,results,startedAt:new Date().toISOString()},seriesPath=join(out,`${values.version}-${values.route}-series.json`);
 let references={},lastGood=0,firstBad=null;
 const run=async(n,label,options={})=>{
  let r=await runStage(n,label,{references,...options});results.push({rooms:n,label,passed:r.passed,cause:r.cause,profiles:r.profiles});atomic(seriesPath,series);
  if(['network','telemetry'].includes(r.cause)){
    const retryLabel=label+'-'+r.cause+'-retry';
    console.log(`External link or telemetry changed; repeating ${n} rooms once without changing VPS limits`);
    await waitFor(()=>metrics().then(m=>!!m.health?.ok).catch(()=>false),30000,'Telemetry did not recover for a retry');
    r=await runStage(n,retryLabel,{references,...options});results.push({rooms:n,label:retryLabel,passed:r.passed,cause:r.cause,profiles:r.profiles});atomic(seriesPath,series);
  }
  return r;
 };
 for(const n of [4,8,16,32,64,128].filter(n=>n<=Number(values['max-rooms']))){
  const r=await run(n,'ladder');if(n===4)references=r.profiles;
  if(r.passed)lastGood=n;else{firstBad=n;if(['production','telemetry','generator','network','routes','setup-or-runtime'].includes(r.cause)){series.limitedBy=r.cause;break;}break;}
 }
 if(firstBad&&lastGood&&!series.limitedBy){
  while(firstBad-lastGood>2){const n=Math.floor((lastGood+firstBad)/4)*2;if(n<=lastGood)break;const r=await run(n,'refine');if(r.passed)lastGood=n;else{firstBad=n;if(['production','telemetry','generator','network','routes','setup-or-runtime'].includes(r.cause)){series.limitedBy=r.cause;break;}}}
 }
 series.maximumPassed=lastGood;series.firstNotPassed=firstBad;
 if(lastGood&&!['production','telemetry'].includes(series.limitedBy)){
  const repeat=await run(lastGood,'repeat');
  if(repeat.passed){series.maximumRepeated=lastGood;series.proposedRooms=recommendedRooms(lastGood,values.route);
    if(series.proposedRooms>0){
      const soak=await run(series.proposedRooms,'soak',{seconds:Number(values.soak)/2,warmup:Number(values.warmup),faults:true});
      if(soak.acceptance&&Number(values.soak)>=3600){series.recommendedRooms=series.proposedRooms;series.recommendedPlayers=series.proposedRooms*4;}
    }
  }
 }
 series.finishedAt=new Date().toISOString();series.limitFound=lastGood>0&&!!firstBad&&firstBad-lastGood<=2&&!series.limitedBy;atomic(seriesPath,series);console.log(JSON.stringify({series:seriesPath,maximumPassed:series.maximumPassed,recommendedRooms:series.recommendedRooms,limitedBy:series.limitedBy}));
 if(!series.recommendedRooms)process.exitCode=1;
}
try{await configureServer();if(values.suite)await suite();else{const r=await runStage(Number(values.rooms),values.label??'single',{faults:values.faults});if(!r.passed)process.exitCode=1;}}
catch(e){console.error(e);atomic(join(out,`${values.version}-${values.route}-setup-failure-${Date.now()}.json`),{schemaVersion:1,config,completed:false,passed:false,cause:e.cause??'setup-or-runtime',error:e.message});process.exitCode=1;}
