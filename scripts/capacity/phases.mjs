import { createReadStream } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import { add,describe,aggregate,accumulate,finishAggregate } from './analysis.mjs';

/** Streaming postprocessing keeps startup and injected faults out of acceptance. */
export async function summarizePhases(path,config,joins=[]){
 const groups={};
 const lines=createInterface({input:createReadStream(path).pipe(createGunzip()),crlfDelay:Infinity});
 for await(const line of lines){
  if(!line)continue;const sample=JSON.parse(line);
  accumulate(groups[sample.phase]??=aggregate(),sample,{...config,rooms:config.generatorRooms??config.rooms});
 }
 const phases={};
 for(const [phase,data] of Object.entries(groups)){
  const {metrics,samples,traffic,tickWindowSuccess,maxGameMemory,maxHttpsMemory,maxGeneratorMemory,tcpRetransmissions,tcpRetransmittedBytes}=finishAggregate(data);
  phases[phase]={metrics,samples,traffic,tickWindowSuccess,maxGameMemory,maxHttpsMemory,maxGeneratorMemory,tcpRetransmissions,tcpRetransmittedBytes};
 }
 const histogram={};for(const join of joins)add(histogram,join.ms);
 return{joinsMs:describe(histogram),phases};
}
