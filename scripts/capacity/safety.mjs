export function bounded(promise,ms,message){
 let timer;
 return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(message)),ms);})]).finally(()=>clearTimeout(timer));
}
export function assertProductionEmpty(status){
 if(status?.rooms>0)throw Object.assign(Error('Production player joined; capacity test stopped'),{cause:'production'});
 if(status?.rooms!==0)throw Object.assign(Error('Cannot confirm production is empty'),{cause:'telemetry'});
}
export function measuredPhase(started,finished){return started===finished&&['normal','heavy'].includes(started);}
export function assertGeneratorWithinLimits(g){
 if((g.memoryEvents?.oom_kill??0)>0||g.memoryLimit&&g.memoryBytes>g.memoryLimit*.9){
  throw Object.assign(Error('Generator memory limit reached'),{cause:'generator',resource:{memoryBytes:g.memoryBytes,memoryLimit:g.memoryLimit,memoryEvents:g.memoryEvents}});
 }
}
export function assertTunnelWithinLimits(tunnel,now=Date.now()){
 if(tunnel===undefined)return;
 if(!Number.isFinite(tunnel.at)||now-tunnel.at>5000)throw Object.assign(Error('Local interface tunnel telemetry is stale'),{cause:'telemetry'});
 if(tunnel.cpuMean10s>=90)throw Object.assign(Error('Local interface tunnel CPU saturated'),{cause:'generator',resource:{component:'interface-tunnel',cpuMean10s:tunnel.cpuMean10s,maxRssBytes:tunnel.maxRssBytes}});
}
export function assertVpsWithinLimits(metrics){
 for(const service of ['game','https']){
  const m=metrics[service],limit=Number(m?.memoryLimit);
  if((m?.memoryEvents?.oom_kill??0)>0||Number.isFinite(limit)&&limit>0&&m.memoryBytes>limit*.95){
   throw Object.assign(Error('VPS '+service+' memory limit reached'),{cause:'vps',resource:{service,memoryBytes:m.memoryBytes,memoryLimit:m.memoryLimit,memoryEvents:m.memoryEvents}});
  }
 }
}
