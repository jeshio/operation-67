export type Histogram=Record<string,number>;
export function observe(hist:Histogram,value:number){
  if(Number.isFinite(value)&&value>=0){const key=String(Math.min(60000,Math.ceil(value)));hist[key]=(hist[key]??0)+1;}
}
export function mergeHistogram(into:Histogram,from:Histogram){for(const [key,count] of Object.entries(from))into[key]=(into[key]??0)+count;return into;}
export function percentile(hist:Histogram,p:number):number|null{
  const values=Object.entries(hist).map(([key,count])=>[Number(key),count]).sort((a,b)=>a[0]-b[0]);
  const total=values.reduce((n,pair)=>n+pair[1],0);if(!total)return null;
  const rank=Math.max(1,Math.ceil(total*p));let n=0;for(const [value,count] of values){n+=count;if(n>=rank)return value;}return null;
}
export function describe(hist:Histogram){return{count:Object.values(hist).reduce((a,b)=>a+b,0),p50:percentile(hist,.5),p95:percentile(hist,.95),p99:percentile(hist,.99)};}
export function intendedRoute(mode:'relay'|'direct'|'mixed',roomIndex:number,peerIndex:number){
  return mode==='mixed'?(peerIndex<(roomIndex%2===0?1:2)?'direct':'relay'):mode;
}
