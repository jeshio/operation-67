import test from 'node:test';
import assert from 'node:assert/strict';
import { observe,percentile,mergeHistogram,intendedRoute } from '../src/qa-capacity-metrics';
import { CoopSimulation } from '../src/coop';
import { resetCapacityWorkload,maintainCapacityWorkload } from '../src/qa-capacity-workload';
import { NetworkGame } from '../src/network';
import { aggregate,accumulate,finishAggregate,resourceDelta,routePolicy,routeProblems,recommendedRooms,reusable,checkMemoryPlateau } from '../scripts/capacity/analysis.mjs';
import { bounded,assertProductionEmpty,assertGeneratorWithinLimits,assertTunnelWithinLimits,assertVpsWithinLimits,measuredPhase } from '../scripts/capacity/safety.mjs';
import { summarizePhases } from '../scripts/capacity/phases.mjs';
import { mkdtempSync,writeFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

test('capacity percentiles merge sample counts rather than percentile averages',()=>{
 const a={},b={};for(let i=0;i<99;i++)observe(a,10);observe(b,1000);mergeHistogram(a,b);
 assert.equal(percentile(a,.95),10);assert.equal(percentile(a,1),1000);assert.equal(percentile({},.5),null);
 observe(a,NaN);observe(a,-1);assert.equal(Object.values(a).reduce((a:any,b:any)=>a+b,0),100);
});
test('local network adapter overload is a generator limit, and lost telemetry stops the run',()=>{
 assert.doesNotThrow(()=>assertTunnelWithinLimits(undefined));
 assert.doesNotThrow(()=>assertTunnelWithinLimits({at:1000,cpuMean10s:15},2000));
 assert.throws(()=>assertTunnelWithinLimits({at:1000,cpuMean10s:95},2000),(e:any)=>e.cause==='generator'&&e.resource.component==='interface-tunnel');
 assert.throws(()=>assertTunnelWithinLimits({at:1000,cpuMean10s:0},7000),(e:any)=>e.cause==='telemetry');
});
test('mixed routes split host links exactly in half across adjacent rooms and both directions',()=>{
 const roster=[-1,-2,-3,-4].map(id=>({id}));let direct=0;
 for(let room=0;room<4;room++)for(let peer=0;peer<3;peer++)if(intendedRoute('mixed',room,peer)==='direct')direct++;
 assert.equal(direct,6);
 for(let room=0;room<2;room++)for(const p of roster.slice(1)){
  const h=routePolicy('mixed',room,{id:-1,host:-1},roster),c=routePolicy('mixed',room,{id:p.id,host:-1},roster);assert.equal(h[p.id],c[-1]);
 }
 const p={id:-2,host:-1,links:[{peerId:-1,route:'direct'}],traffic:{'-1:direct:received:snapshot':{packets:20}}};
 assert.equal(routeProblems('direct',0,p,roster).length,0);
 assert(routeProblems('relay',0,p,roster).length>0);p.traffic={};assert(routeProblems('direct',0,p,roster).length>0,'a label without actual delivery is insufficient');
 const relay={id:-2,host:-1,links:[],traffic:{'-1:relay:received:snapshot':{packets:1}}};
 assert.equal(routeProblems('relay',0,relay,roster).length,0,'relay delivery does not depend on WebRTC preparation finishing');
 assert(routeProblems('direct',0,relay,roster).length>0);
});
test('CPU sampling subtracts cumulative counters and excludes unrelated startup time',()=>{
 const d=resourceDelta({cpu:{usage_usec:1000000,throttled_usec:100}},{cpu:{usage_usec:1500000,throttled_usec:200100},memoryBytes:42,memoryEvents:{oom_kill:0}},2);
 assert.equal(d.cpuPercent,25);assert.equal(d.throttledMs,200);assert.equal(resourceDelta(null,{},2),null);
});
test('capacity recommendations reserve 25% and preserve exact mixed-route proportions',()=>{
 assert.equal(recommendedRooms(32,'relay'),24);assert.equal(recommendedRooms(10,'mixed'),6);
 assert.equal(reusable({completed:true,passed:true,signature:'a'},{signature:'a'}),true);
 assert.equal(reusable({completed:false,passed:true,signature:'a'},{signature:'a'}),false);
 assert.equal(reusable({completed:true,passed:true,signature:'a'},{signature:'b'}),false);
});
test('memory plateau check ignores warmup and distinguishes bounded churn from retained growth',()=>{
 const points=Array.from({length:3600},(_,i)=>({at:i*1000,heap:10e6+Math.floor(i/600)*3e6}));
 assert.equal(checkMemoryPlateau(points).sustainedGrowth,true);
 for(const p of points)p.heap=20e6+(p.at%20000)*20;
 assert.equal(checkMemoryPlateau(points).sustainedGrowth,false);
});
test('heavy workload is QA-only state setup with real late waves and stable member identities',()=>{
 const sim=new CoopSimulation();for(let id=-1;id>=-4;id--)sim.addMember(id,'QA '+id,0);sim.start(false);
 const config={profile:'heavy' as const,seed:6702};resetCapacityWorkload(sim,config);
 assert.equal(sim.wave,41);assert.equal(sim.members.size,4);assert([...sim.members.values()].every(m=>m.tank.hp===10000));
 sim.wave=46;assert.equal(maintainCapacityWorkload(sim,config),true);assert.equal(sim.wave,41);
});
test('incomplete data and stale route delivery cannot produce a passing capacity report',()=>{
 const a=aggregate();assert.equal(finishAggregate(a).passed,false);
 assert.equal(finishAggregate(a).cause,'vps-or-game');
 accumulate(a,{at:10000,players:[],server:{receivedAt:10000,health:{rooms:0},production:{rooms:1}},generator:{}},{version:'current',route:'relay',rooms:4});
 assert.equal(finishAggregate(a).cause,'production');
});
test('route proof requires real delivery across the phase without treating one delayed interval as a route switch',()=>{
 const a=aggregate(),p={slot:1,id:-2,host:-1,connected:true,recovering:false,phase:'playing',links:[{peerId:-1,route:'direct'}],players:[{id:-1},{id:-2}],periodMs:40};
 const s={at:10000,players:[p],server:{receivedAt:10000,health:{rooms:1}},generator:{}};
 accumulate(a,s,{version:'current',route:'direct',rooms:1});assert.equal(a.issues.routes,undefined);
 p.periodMs=1000;accumulate(a,s,{version:'current',route:'direct',rooms:1});assert(finishAggregate(a).reasons.some(r=>r.type==='routes'));
 assert.equal(routeProblems('direct',0,p,p.players).length,1,'preflight always requires actual delivery');
 Object.assign(p,{traffic:{'-1:direct:received:snapshot':{packets:20,bytes:1000}}});
 accumulate(a,s,{version:'current',route:'direct',rooms:1});assert(!finishAggregate(a).reasons.some(r=>r.type==='routes'));
});
test('first host assignment can identify the player before the hello reply',()=>{
 const g=new NetworkGame(null,'early-assignment',undefined,{endpoint:'http://127.0.0.1:1',webrtc:false});
 try{
  (g as any).channel={sessionId:'own-connection',leave:async()=>{}};
  (g as any).receiveInfo({matchId:'early',revision:1,round:0,hostEpoch:1,host:-1,owner:-1,backup:0,stage:'preparing',players:[{id:-1,sessionId:'own-connection',name:'Host',skin:0,present:true,connected:true,foreground:true}]});
  assert.equal(g.id,-1);assert.equal(g.view.localId,-1,'prepare no longer sees the initial zero id');
 }finally{g.stop();}
});
test('capacity safety stops for real players and treats missing health as unknown',()=>{
 assert.doesNotThrow(()=>assertProductionEmpty({rooms:0}));
 assert.throws(()=>assertProductionEmpty({rooms:1}),e=>e.cause==='production');
 assert.throws(()=>assertProductionEmpty({error:'timeout'}),e=>e.cause==='telemetry');
 assert.equal(measuredPhase('warmup','normal'),false);assert.equal(measuredPhase('connecting','connecting'),false);
 assert.equal(measuredPhase('normal','normal'),true);assert.equal(measuredPhase('heavy','between'),false);
});
test('capacity connection deadline rejects a hung join and permits a completed one',async()=>{
 await assert.rejects(bounded(new Promise(()=>{}),10,'join timeout'),/join timeout/);
 assert.equal(await bounded(Promise.resolve(7),100,'timeout'),7);
});
test('generator exhaustion stops the run as a stand limit and preserves its resource evidence',()=>{
 assert.doesNotThrow(()=>assertGeneratorWithinLimits({memoryBytes:100,memoryLimit:1000}));
 assert.throws(()=>assertGeneratorWithinLimits({memoryBytes:950,memoryLimit:1000}),e=>e.cause==='generator'&&e.resource.memoryBytes===950);
 assert.throws(()=>assertGeneratorWithinLimits({memoryEvents:{oom_kill:1}}),e=>e.cause==='generator');
});
test('VPS memory guard stops before an OOM and identifies the constrained service',()=>{
 assert.doesNotThrow(()=>assertVpsWithinLimits({game:{memoryBytes:500,memoryLimit:'1000'},https:{memoryBytes:100,memoryLimit:'max'}}));
 assert.throws(()=>assertVpsWithinLimits({https:{memoryBytes:960,memoryLimit:'1000'}}),e=>e.cause==='vps'&&e.resource.service==='https');
 assert.throws(()=>assertVpsWithinLimits({game:{memoryEvents:{oom_kill:1}}}),e=>e.cause==='vps'&&e.resource.service==='game');
});
test('a service failure cannot be relabelled as external network trouble',()=>{
 const a=aggregate();Object.assign(a,{samples:10,ack:{100:10},gaps:{50:10},step:{20:10},tickWindows:10,goodTickWindows:10,rtt:{1000:10},gameCpu:{5:10},httpsCpu:{5:10},issues:{vps:{count:1,first:'Game service OOM'}}});
 assert.equal(finishAggregate(a).cause,'vps');
});
test('fast rooms cannot hide a slow host, while isolated network stalls use the agreed percentile threshold',()=>{
 const a=aggregate();Object.assign(a,{samples:10,ack:{100:100},gaps:{50:999,600:1},step:{20:100},tickWindows:1000,goodTickWindows:990,staleSnapshotSamples:1});
 a.hosts={fast:{windows:990,good:990,steps:{20:100}},slow:{windows:10,good:0,steps:{20:10}}};
 assert(finishAggregate(a).reasons.some(r=>r.first==='An individual host fails the 58 Hz window criterion'));
 a.hosts.slow.good=10;a.goodTickWindows=1000;
 assert.equal(finishAggregate(a).passed,true,'a single stall below the p99 budget is recorded, not treated as an actual recovery pause');
 assert.equal(finishAggregate(a).staleSnapshotSamples,1);
});
test('capacity phase summaries keep connection and injected-fault latency separate from battle',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'capacity-phases-')),path=join(dir,'samples.gz');
 try{
  const samples=['connecting','warmup-normal','normal','fault-mass-relay-fallback'].map((phase,i)=>({phase,at:1000,players:[{acknowledgements:{[10**i]:5}}],server:{receivedAt:1000,health:{rooms:1}},generator:{}}));
  writeFileSync(path,gzipSync(samples.map(s=>JSON.stringify(s)).join('\n')));
  const result=await summarizePhases(path,{version:'baseline',route:'relay',rooms:1},[{ms:150},{ms:250}]);
  assert.equal(result.phases.normal.metrics.ack.p95,100);assert.equal(result.phases['fault-mass-relay-fallback'].metrics.ack.p95,1000);
  assert.equal(result.phases.normal.samples,1);assert.equal(result.joinsMs.p95,250);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
