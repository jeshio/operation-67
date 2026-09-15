import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync,writeFileSync,openSync,closeSync,fstatSync,readSync } from 'node:fs';
import { resolve } from 'node:path';

const target=process.env.CAPACITY_SSH??'jeshio@89.19.211.4',port=Number(process.env.CAPACITY_BROKER_PORT??5298);
const token=randomBytes(24).toString('hex'),dir=resolve('test-artifacts/capacity');mkdirSync(dir,{recursive:true});
writeFileSync(resolve(dir,'broker.env'),`CAPACITY_BROKER_TOKEN=${token}\n`,{mode:0o600});
let sampler,latest,version='current',busy=false,commands=0,icmpRtt=null,tcpRtt=null,tcpAt=0,probing=false;
let stopping=false,samplerRestart,samplerFailures=0;
const pending=new Map();
const proxyMetricsPath=process.env.CAPACITY_PROXY_METRICS,proxyCpu=[];
let lastProxyAt=0;
function proxyMetrics(){
 if(!proxyMetricsPath)return undefined;
 let fd;
 try{
  fd=openSync(proxyMetricsPath,'r');const size=fstatSync(fd).size,buffer=Buffer.alloc(Math.min(size,4096));
  readSync(fd,buffer,0,buffer.length,size-buffer.length);
  const lines=buffer.toString().split('\n');lines.pop();
  const value=JSON.parse(lines.at(-1));
  if(value.at!==lastProxyAt){proxyCpu.push(value.cpuPercent);if(proxyCpu.length>10)proxyCpu.shift();lastProxyAt=value.at;}
  return{...value,cpuMean10s:proxyCpu.reduce((a,b)=>a+b,0)/proxyCpu.length};
 }catch{return{error:'Local interface tunnel telemetry unavailable'};}finally{if(fd!==undefined)closeSync(fd);}
}
const sshOptions=['-o','BatchMode=yes','-o','ConnectTimeout=30','-o','ServerAliveInterval=10','-o','ServerAliveCountMax=3','-o','ControlMaster=auto','-o','ControlPersist=600','-o','ControlPath=/tmp/roma67-capacity-%r-%h-%p'];
if(process.env.CAPACITY_SSH_PROXY_PORT){
 const proxyPort=Number(process.env.CAPACITY_SSH_PROXY_PORT);
 if(!Number.isSafeInteger(proxyPort)||proxyPort<1024||proxyPort>65535)throw Error('Invalid local SSH proxy port');
 sshOptions[sshOptions.length-1]=`ControlPath=/tmp/roma67-capacity-direct-${proxyPort}-%r-%h-%p`;
 sshOptions.push('-o',`ProxyCommand=/usr/bin/nc -X connect -x 127.0.0.1:${proxyPort} %h %p`);
}
function ssh(command){return new Promise((resolve,reject)=>{
 const p=spawn('ssh',[...sshOptions,target,command]);let out='',err='';
 p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>err+=d);p.on('error',reject);
 p.on('exit',code=>code===0?resolve(out):reject(Error(err||out||`SSH exited ${code}`)));
});}
function startSampler(){
 clearTimeout(samplerRestart);
 sampler?.kill();latest=undefined;let buffer='';
 sampler=spawn('ssh',[...sshOptions,target,`CAPACITY_VERSION=${version} python3 -u /tmp/roma67-capacity/vps-metrics.py`]);
 const current=sampler;
 current.stdout.on('data',chunk=>{buffer+=chunk;let end;while((end=buffer.indexOf('\n'))>=0){
   const line=buffer.slice(0,end);buffer=buffer.slice(end+1);try{const data=JSON.parse(line);
     if(data.command){pending.get(data.command)?.resolve(data.result);pending.delete(data.command);}
     else if(data.commandError){for(const p of pending.values())p.reject(Error(data.commandError));pending.clear();}
     else if(data.at){samplerFailures=0;latest={...data,receivedAt:Date.now(),icmpRttMs:icmpRtt,referenceRttMs:Date.now()-tcpAt<5000?tcpRtt:null,referenceRttKind:'https-health-round-trip',localTunnel:proxyMetrics()};}
   }catch{}
 }});
 current.stderr.on('data',chunk=>process.stderr.write(chunk));
 current.on('error',e=>console.error(e.message));
 current.on('exit',code=>{if(sampler!==current)return;latest=undefined;if(!stopping){console.error(`VPS sampler exited (${code}); telemetry marked unavailable`);if(++samplerFailures<=5)samplerRestart=setTimeout(startSampler,2000);}});
}
const ping=process.env.CAPACITY_SSH_PROXY_PORT?null:spawn('/sbin/ping',['-n','-i','1','89.19.211.4']);
ping?.stdout.on('data',data=>{const match=/time[=<]([\d.]+)\s*ms/.exec(String(data));if(match)icmpRtt=Number(match[1]);});ping?.on('error',()=>{});
const probeTimer=setInterval(async()=>{
 if(probing)return;probing=true;const at=performance.now();
 try{const response=await fetch('https://67.jeshio.ru/health',{cache:'no-store',signal:AbortSignal.timeout(3000)});await response.arrayBuffer();if(response.ok){tcpRtt=performance.now()-at;tcpAt=Date.now();}}
 catch{}finally{probing=false;}
},1000);
startSampler();
async function workload(command){
 if(version!=='baseline')return{ok:true};const id=++commands;
 return new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{pending.delete(id);reject(Error('Baseline workload command timeout'));},10000);
   pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value);},reject:e=>{clearTimeout(timer);reject(e);}});
   sampler.stdin.write(JSON.stringify({...command,id,action:'workload'})+'\n');
 });
}
const server=createServer(async(req,res)=>{
 res.setHeader('Content-Type','application/json');
 if(req.headers.authorization!==`Bearer ${token}`){res.writeHead(401);res.end('{}');return;}
 try{
  if(req.method==='GET'&&req.url==='/metrics'){res.end(JSON.stringify(latest??{error:'Sampler unavailable'}));return;}
  let size=0,body='';for await(const chunk of req){size+=chunk.length;if(size>8192)throw Error('Request too large');body+=chunk;}
  const data=JSON.parse(body||'{}');
  if(req.url==='/workload'){res.end(JSON.stringify(await workload(data)));return;}
  if(busy)throw Error('Staging operation already running');
  if(req.url==='/deploy'||req.url==='/restart'){
    if(latest?.production?.rooms!==0||Date.now()-(latest?.receivedAt??0)>5000)throw Error('Production must be freshly confirmed empty');
    if(req.url==='/deploy'&&!['baseline','current'].includes(data.version))throw Error('Unknown version');
    busy=true;
    try{
      if(req.url==='/deploy'){
        version=data.version;
        await ssh(`sudo QA_RUNTIME_SECONDS=86400 QA_MAX_ROOMS=128 bash /tmp/roma67-capacity/staging.sh up /tmp/roma67-capacity/${version}-runtime.tar.gz /tmp/roma67-capacity/${version}-client.tar.gz`);
      }else await ssh('sudo systemctl restart roma67-qa');
      startSampler();res.end(JSON.stringify({ok:true,version}));
    }finally{busy=false;}return;
  }
  if(req.url==='/stop'){
    if(latest?.health?.rooms>0)throw Error('QA rooms have not drained');
    await ssh('sudo bash /tmp/roma67-capacity/staging.sh down');res.end('{"ok":true}');return;
  }
  res.writeHead(404);res.end('{}');
 }catch(e){res.writeHead(409);res.end(JSON.stringify({error:e.message}));}
});
server.listen(port,'0.0.0.0',()=>console.log(`Capacity telemetry broker: port ${port}; token stored in test-artifacts/capacity/broker.env`));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{stopping=true;clearTimeout(samplerRestart);clearInterval(probeTimer);sampler?.kill();ping?.kill();server.close(()=>process.exit());});
