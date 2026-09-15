export function add(hist,value){if(Number.isFinite(value)&&value>=0){const key=Math.min(60000,Math.ceil(value));hist[key]=(hist[key]??0)+1;}}
export function merge(a,b){for(const [key,value] of Object.entries(b??{}))a[key]=(a[key]??0)+value;}
export function quantile(hist,p){const a=Object.entries(hist).map(([k,v])=>[Number(k),v]).sort((a,b)=>a[0]-b[0]),total=a.reduce((n,x)=>n+x[1],0);if(!total)return null;let n=0;for(const [v,c] of a){n+=c;if(n>=Math.max(1,Math.ceil(total*p)))return v;}return null;}
export const describe=hist=>({count:Object.values(hist).reduce((a,b)=>a+b,0),p50:quantile(hist,.5),p95:quantile(hist,.95),p99:quantile(hist,.99)});
export function routeFor(mode,roomIndex,peerIndex){return mode==='mixed'?(peerIndex<(roomIndex%2===0?1:2)?'direct':'relay'):mode;}
export function routePolicy(mode,roomIndex,player,roster){
 const peers=roster.filter(p=>p.id!==player.host).map(p=>p.id).sort((a,b)=>b-a),routes={};
 for(const p of roster)if(p.id!==player.id){const nonHost=player.id===player.host?p.id:player.id;routes[p.id]=(player.id===player.host||p.id===player.host)?routeFor(mode,roomIndex,peers.indexOf(nonHost)):'relay';}return routes;
}
export function routeProblems(mode,roomIndex,player,roster){
 const expected=routePolicy(mode,roomIndex,player,roster),problems=[];
 for(const [key,count] of Object.entries(player.traffic??{})){
  const [id,route]=key.split(':');if((player.id===player.host||Number(id)===player.host)&&count.packets&&expected[id]!==route)problems.push(`traffic ${key}`);
 }
 for(const [id,route] of Object.entries(expected))if(player.id===player.host||Number(id)===player.host){
   const link=player.links?.find(l=>l.peerId===Number(id));if(link?link.route!==route:route==='direct')problems.push(`link ${id} expected ${route}`);
   const received=Object.entries(player.traffic??{}).some(([key,v])=>key.startsWith(`${id}:${route}:received:`)&&v.packets>0);
   if(!received)problems.push(`no confirmed game delivery from ${id}`);
 }
 return problems;
}
export function resourceDelta(previous,current,seconds){
 if(!previous||!current||!(seconds>0))return null;
 return{cpuPercent:((current.cpu?.usage_usec??0)-(previous.cpu?.usage_usec??0))/seconds/10000,
   throttledMs:((current.cpu?.throttled_usec??0)-(previous.cpu?.throttled_usec??0))/1000,
   memoryBytes:current.memoryBytes,memoryAnonBytes:current.memoryStat?.anon??null,
   oomKills:(current.memoryEvents?.oom_kill??0)-(previous.memoryEvents?.oom_kill??0)};
}
export function aggregate(){return{samples:0,ack:{},gaps:{},scheduler:{},step:{},rtt:{},referenceRtt:{},eventLoop:{},gameCpu:{},httpsCpu:{},generatorCpu:{},wireInKiBps:{},wireOutKiBps:{},traffic:{},hosts:{},delivery:{},staleSnapshotSamples:0,tcpRetransmissions:0,tcpRetransmittedBytes:0,maxTcpSendQueue:0,tickWindows:0,goodTickWindows:0,issues:{},memory:[],maxGameMemory:0,maxHttpsMemory:0,maxGeneratorMemory:0};}
function hostSample(a,key,rate,steps){
 const host=a.hosts[key]??={windows:0,good:0,steps:{}};merge(host.steps,steps);
 if(rate!=null){host.windows++;a.tickWindows++;if(rate>=58){host.good++;a.goodTickWindows++;}}
}
export function issue(a,type,message){a.issues[type]??={count:0,first:message};a.issues[type].count++;}
export function accumulate(a,s,{version,route,rooms}){
 a.samples++;const m=s.server;
 if(s.players.length!==rooms*4)issue(a,'functional','Missing player samples');
 const healthRooms=m?.health?.rooms;if(healthRooms!==rooms)issue(a,'vps',`Coordinator has ${healthRooms} rooms; expected ${rooms}`);
 if(m?.production?.rooms>0)issue(a,'production','A player joined the production game');
 if(!m||s.at-m.receivedAt>5000)issue(a,'telemetry','VPS telemetry is stale');
 add(a.referenceRtt,m?.referenceRttMs??m?.icmpRttMs);add(a.eventLoop,m?.qa?.runtime?.eventLoopP95Ms);
 if(s.resources?.game){add(a.gameCpu,s.resources.game.cpuPercent);if(s.resources.game.oomKills)issue(a,'vps','Game service OOM');}
 if(s.resources?.https){add(a.httpsCpu,s.resources.https.cpuPercent);if(s.resources.https.oomKills)issue(a,'vps','HTTPS service OOM');}
 add(a.wireInKiBps,s.resources?.wireInKiBps);add(a.wireOutKiBps,s.resources?.wireOutKiBps);add(a.generatorCpu,s.generator?.cpuPercent);
 a.tcpRetransmissions+=s.resources?.tcpRetransmissions??0;a.tcpRetransmittedBytes+=s.resources?.tcpRetransmittedBytes??0;
 a.maxTcpSendQueue=Math.max(a.maxTcpSendQueue,...(m?.tcp??[]).map(c=>c.sendQueue));
 a.maxGameMemory=Math.max(a.maxGameMemory,m?.game?.memoryBytes??0);a.maxHttpsMemory=Math.max(a.maxHttpsMemory,m?.https?.memoryBytes??0);
 a.maxGeneratorMemory=Math.max(a.maxGeneratorMemory,s.generator?.memoryBytes??0);
 a.memory.push({at:s.at,heap:m?.qa?.process?.memory?.heapUsed??null,rss:m?.qa?.process?.memory?.rss??null});
 for(const p of s.players){
  merge(a.ack,p.acknowledgements);merge(a.gaps,p.gaps);merge(a.scheduler,p.scheduler);add(a.rtt,p.serverRtt);
  merge(a.step,p.stepTimes);
  if(!p.connected||p.recovering||p.error||p.phase!=='playing')issue(a,'functional',`Player ${p.slot}: ${p.error||p.phase||'not connected'} recovering=${p.recovering}`);
  if((p.players??[]).filter(x=>x.present).length!==4||new Set(p.players?.map(x=>x.id)).size!==4)issue(a,'functional','Invalid roster');
  // Rare delivery stalls are governed by the agreed p99 interval criterion.
  // Actual recovering/disconnected states above remain a hard failure.
  if(p.snapshotAgeMs>500)a.staleSnapshotSamples++;
  if(version!=='baseline'&&p.id===p.host)hostSample(a,p.slot,p.tickRate10s,p.stepTimes);
  if(version!=='baseline'&&p.connected&&!p.recovering&&p.phase==='playing'){
   for(const problem of routeProblems(route,Math.floor(p.slot/4),p,p.players??[])){
    // A delayed packet does not itself change the selected route. Delivery quality
    // is checked by ACKs, snapshot intervals and pauses; each pair must deliver in the phase.
    if(!problem.startsWith('no confirmed game delivery'))issue(a,'routes',`${p.slot}: ${problem}`);
   }
   for(const [id,wanted] of Object.entries(routePolicy(route,Math.floor(p.slot/4),p,p.players??[])))if(p.id===p.host||Number(id)===p.host){
    const key=`${p.slot}:${p.epoch??''}:${id}:${wanted}`;
    a.delivery[key] ||= Object.entries(p.traffic??{}).some(([k,v])=>k.startsWith(`${id}:${wanted}:received:`)&&v.packets>0);
   }
  }
  for(const [key,v] of Object.entries(p.traffic??{})){const [,route,direction]=key.split(':'),name=`${route}:${direction}`;a.traffic[name]??={packets:0,bytes:0};a.traffic[name].packets+=v.packets;a.traffic[name].bytes+=v.bytes;}
 }
 if(version==='baseline'&&m?.fresh!==false)for(const r of m?.qa?.rooms??[]){merge(a.step,r.stepTimes);hostSample(a,r.code,r.tickRate10s,r.stepTimes);}
}
export function finishAggregate(a,reference){
 const metrics=Object.fromEntries(['ack','gaps','scheduler','step','rtt','referenceRtt','eventLoop','gameCpu','httpsCpu','generatorCpu','wireInKiBps','wireOutKiBps'].map(k=>[k,describe(a[k])]));
 for(const p of ['p50','p95','p99'])if(metrics.step[p]!==null)metrics.step[p]/=100;
 const reasons=[];for(const [type,value] of Object.entries(a.issues))reasons.push({type,...value});
 if(Object.values(a.delivery).some(received=>!received))reasons.push({type:'routes',first:'A host link delivered no game packets during the measured phase'});
 if(a.samples<10)reasons.push({type:'incomplete',first:'Fewer than ten measured seconds'});
 if(!a.tickWindows||a.goodTickWindows/a.tickWindows<.95)reasons.push({type:'quality',first:'Fewer than 95% of tick windows sustain 58 Hz'});
 const hosts=Object.fromEntries(Object.entries(a.hosts).map(([key,h])=>[key,{tickWindowSuccess:h.windows?h.good/h.windows:null,windows:h.windows,stepP95Ms:quantile(h.steps,.95)/100}]));
 if(Object.values(hosts).some(h=>h.windows&&h.tickWindowSuccess<.95))reasons.push({type:'quality',first:'An individual host fails the 58 Hz window criterion'});
 if(Object.values(hosts).some(h=>h.stepP95Ms>16.7))reasons.push({type:'quality',first:'An individual host step p95 exceeds 16.7 ms'});
 if(metrics.step.p95>16.7)reasons.push({type:'quality',first:'Host step p95 exceeds 16.7 ms'});
 if(metrics.gaps.p99>250)reasons.push({type:'quality',first:'Snapshot interval p99 exceeds 250 ms'});
 if(!metrics.ack.count)reasons.push({type:'incomplete',first:'No acknowledged inputs'});
 if(!metrics.step.count)reasons.push({type:'incomplete',first:'No measured simulation steps'});
 if(reference?.metrics?.ack?.p95!=null&&metrics.ack.p95>reference.metrics.ack.p95+50)reasons.push({type:'quality',first:'Acknowledgement p95 regressed by more than 50 ms'});
 const drift=reference?.metrics?.referenceRtt?.p50!=null&&metrics.referenceRtt.p50!=null?metrics.referenceRtt.p50-reference.metrics.referenceRtt.p50:null;
 if(drift!==null&&Math.abs(drift)>50)reasons.push({type:'network',first:`Reference RTT changed by ${drift} ms; repeat required`});
 const generatorLimited=metrics.scheduler.p95>20;
 if(generatorLimited)reasons.push({type:'generator',first:'Generator input scheduler p95 lag exceeds 20 ms'});
 const memoryPlateau=checkMemoryPlateau(a.memory);
 if(memoryPlateau?.sustainedGrowth)reasons.push({type:'quality',first:'Retained heap keeps growing in consecutive ten-minute windows'});
 let cause=reasons.some(r=>r.type==='production')?'production':reasons.some(r=>r.type==='telemetry')?'telemetry':reasons.some(r=>r.type==='vps')?'vps':generatorLimited?'generator':reasons.some(r=>r.type==='network')?'network':reasons.some(r=>r.type==='routes')?'routes':reasons.length?'vps-or-game':null;
 // A degraded external path on a lightly loaded coordinator is not a VPS capacity ceiling.
 if(reasons.length&&reasons.every(r=>['functional','quality','network','routes'].includes(r.type))&&metrics.rtt.p95>500&&metrics.gameCpu.p95<45&&metrics.httpsCpu.p95<15&&!generatorLimited)cause='network';
 if(reasons.length&&a.tcpRetransmissions>0&&a.goodTickWindows/Math.max(1,a.tickWindows)>=.95&&metrics.gameCpu.p95<45&&metrics.httpsCpu.p95<15&&!generatorLimited&&reasons.every(r=>['functional','quality','network'].includes(r.type)))cause='network';
 return{passed:reasons.length===0,cause,reasons,metrics,tickWindowSuccess:a.tickWindows?a.goodTickWindows/a.tickWindows:null,
   samples:a.samples,hosts,staleSnapshotSamples:a.staleSnapshotSamples,traffic:a.traffic,tcpRetransmissions:a.tcpRetransmissions,tcpRetransmittedBytes:a.tcpRetransmittedBytes,maxTcpSendQueue:a.maxTcpSendQueue,maxGameMemory:a.maxGameMemory,maxHttpsMemory:a.maxHttpsMemory,maxGeneratorMemory:a.maxGeneratorMemory,memoryPlateau};
}
export function checkMemoryPlateau(points){
 if(!points.length||points.at(-1).at-points[0].at<45*60000)return null;
 const bins=new Map();for(const p of points)if(p.heap!==null){const i=Math.floor((p.at-points[0].at)/600000);if(i>0)bins.set(i,Math.min(bins.get(i)??Infinity,p.heap));}
 const lows=[...bins.values()];const growth=lows.slice(1).map((v,i)=>v-lows[i]);return{tenMinuteHeapLows:lows,sustainedGrowth:growth.length>=3&&growth.slice(-3).every(v=>v>2*1024*1024)};
}
export function recommendedRooms(maximum,route){const n=Math.floor(maximum*.75);return route==='mixed'?n-n%2:n;}
export function reusable(result,config){return result?.completed&&result?.signature===config.signature&&result?.passed===true;}
