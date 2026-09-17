import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { once } from 'node:events';
import { createServer } from 'node:net';
import assert from 'node:assert/strict';
import { smoke } from '../smoke-production.mjs';
const archive=resolve(process.argv.slice(2).find(s=>!s.startsWith('--'))??'test-artifacts/roma67-vps.tar.gz');
mkdirSync('test-artifacts/security',{recursive:true});const dir=mkdtempSync(resolve('test-artifacts/security/unpacked-'));
let child;
try{
 const sum=readFileSync(archive+'.sha256','utf8').split(/\s/)[0];
 const unpack=spawnSync('python3',['scripts/security/archive.py','extract',archive,sum,dir,...(process.argv.includes('--allow-local')?['--allow-local']:[])],{stdio:'inherit'});
 assert.equal(unpack.status,0,'Archive must verify before execution');
 const release=JSON.parse(readFileSync(dir+'/release.json','utf8'));
 const probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(r=>probe.close(r));
 const base=`http://127.0.0.1:${port}`;
 // Node may otherwise find a missing package in the checkout's ancestor node_modules.
 // Restrict module/file reads to this artifact; native runtime addons remain enabled.
 child=spawn(process.execPath,['--permission',`--allow-fs-read=${dir}`,'--allow-addons','dist-server/index.js'],{cwd:dir,env:{PATH:process.env.PATH,NODE_ENV:'production',HOST:'127.0.0.1',PORT:String(port),ALLOWED_ORIGINS:'https://game.example.com'},stdio:['ignore','pipe','pipe']});
 const exited=once(child,'exit');let ready=false;
 for(let n=0;n<100;n++){try{if((await fetch(base+'/ready')).status===200){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,50));}
 assert(ready,'Unpacked runtime starts without source tree');
 await smoke(base,release.commit,{allowLocal:true});
 const admission=await fetch(base+'/api/join',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({version:release.protocol,request:{type:'join',mode:'private',name:'Проверка',skin:0}})});
 assert.equal(admission.status,200,'Room creation works using only packaged dependencies');await admission.arrayBuffer();
 await assert.rejects(smoke(base,'f'.repeat(40),{allowLocal:true}),/mismatch/);
 child.kill('SIGUSR2');await new Promise(r=>setTimeout(r,100));assert.equal((await fetch(base+'/ready')).status,503);
 await assert.rejects(smoke(base,release.commit,{allowLocal:true}),/503/);
 assert.equal((await fetch(base+'/api/join',{method:'POST'})).status,503);
 child.kill('SIGHUP');await new Promise(r=>setTimeout(r,100));await smoke(base,release.commit,{allowLocal:true});
 const start=Date.now();child.kill('SIGTERM');const [code]=await Promise.race([exited,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('Shutdown exceeded 11 seconds')),11000);timer.unref();})]);
 assert.equal(code,0);assert(Date.now()-start<11000);
 console.log('PASS: isolated artifact dependency reads, room creation, matching build, wrong identity, drain/resume, bounded shutdown');
}finally{if(child?.exitCode===null)child.kill('SIGKILL');rmSync(dir,{recursive:true,force:true});}
