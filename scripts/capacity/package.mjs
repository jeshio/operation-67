import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync,readFileSync,writeFileSync,existsSync,rmSync,symlinkSync } from 'node:fs';
import { resolve,dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as buildServer } from 'esbuild';
import { build as buildClient } from 'vite';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),out=resolve(root,'test-artifacts/capacity-build');
const revision='fb703a6970939c86b5c67d2099065e1e0059d985';
mkdirSync(out,{recursive:true});
const files=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root}).toString().split('\0').filter(Boolean).sort();
const hash=createHash('sha256');for(const path of files){if(existsSync(resolve(root,path))){hash.update(path+'\0');hash.update(readFileSync(resolve(root,path)));}}
const sourceHash=hash.digest('hex'),buildId=`capacity-${new Date().toISOString().replaceAll(/[:.]/g,'-')}-${sourceHash.slice(0,12)}`;
writeFileSync(resolve(out,'source-diff.patch'),execFileSync('git',['diff','--binary',revision],{cwd:root}));
writeFileSync(resolve(out,'source-files.json'),JSON.stringify(files));
// Include untracked migration files as well as the diff of tracked files.
writeFileSync(resolve(out,'source-files.nul'),files.filter(path=>existsSync(resolve(root,path))).join('\0')+'\0');
execFileSync('tar',['-czf',resolve(out,'current-source.tar.gz'),'--null','-T',resolve(out,'source-files.nul')],{cwd:root});
const baseline=resolve(out,'baseline-source');
rmSync(baseline,{recursive:true,force:true});mkdirSync(baseline);
writeFileSync(resolve(out,'baseline-source.tar'),execFileSync('git',['archive',revision],{cwd:root,maxBuffer:128*1024*1024}));
execFileSync('tar',['-xf',resolve(out,'baseline-source.tar'),'-C',baseline]);
symlinkSync(resolve(root,'node_modules'),resolve(baseline,'node_modules'),'dir');
const serverPath=resolve(baseline,'server/index.ts');
let original=readFileSync(serverPath,'utf8');
if(!original.includes('wss.clients.size>=160'))throw Error('Baseline connection gate changed');
original=original.replace('wss.clients.size>=160','wss.clients.size>=(process.env.GAME_QA===\'1\'?512:160)');
original=original.slice(0,original.indexOf('\nif(process.argv[1]'));
writeFileSync(serverPath,original);
const networkPath=resolve(baseline,'src/network.ts');
writeFileSync(networkPath,readFileSync(networkPath,'utf8').replace('new WebSocket(import.meta.env?.VITE_SERVER_URL||url.href)','new WebSocket(new URLSearchParams(location.search).get(\'capacityWs\')||import.meta.env?.VITE_SERVER_URL||url.href)'));

for(const version of ['current','baseline']){
 const client=resolve(out,version+'-client');
 await buildClient({root,configFile:false,base:'./',define:{'import.meta.env.DEV':'true',...(version==='current'?{'import.meta.env.VITE_SERVER_URL':JSON.stringify(process.env.CAPACITY_ENDPOINT??'https://67.jeshio.ru/qa-colyseus')}:{})},
   resolve:version==='baseline'?{alias:[{find:resolve(root,'src/network.ts'),replacement:resolve(baseline,'src/network.ts')},{find:'./network',replacement:resolve(baseline,'src/network.ts')}]}:undefined,
   build:{outDir:client,emptyOutDir:true,rollupOptions:{input:version==='current'?{network:resolve(root,'qa-network.html'),game:resolve(root,'index.html')}:resolve(root,'qa-network.html')}}});
 execFileSync('tar',['-czf',resolve(out,version+'-client.tar.gz'),'-C',client,'.']);
}
const runtime=resolve(out,'baseline-runtime');rmSync(runtime,{recursive:true,force:true});mkdirSync(resolve(runtime,'dist-server'),{recursive:true});mkdirSync(resolve(runtime,'dist'));
await buildServer({entryPoints:[resolve(root,'scripts/capacity/baseline-entry.ts')],bundle:true,platform:'node',format:'esm',target:'node22',
  alias:{'capacity-baseline-server':serverPath,'capacity-baseline-rooms':resolve(baseline,'server/rooms.ts')},
  external:['bufferutil','utf-8-validate'],banner:{js:"import { createRequire as capacityCreateRequire } from 'node:module'; const require=capacityCreateRequire(import.meta.url);"},
  outfile:resolve(runtime,'dist-server/index.js')});
writeFileSync(resolve(runtime,'package.json'),JSON.stringify({name:'operation67-capacity-baseline',private:true,type:'module'}));
execFileSync('tar',['-czf',resolve(out,'baseline-runtime.tar.gz'),'-C',runtime,'.']);
execFileSync('node',['scripts/package-vps.mjs',resolve(out,'current-runtime.tar.gz')],{cwd:root,stdio:'inherit'});
const artifacts={'current-source.tar.gz':createHash('sha256').update(readFileSync(resolve(out,'current-source.tar.gz'))).digest('hex')};for(const version of ['current','baseline'])for(const kind of ['client','runtime']){
 const path=`${version}-${kind}.tar.gz`;artifacts[path]=createHash('sha256').update(readFileSync(resolve(out,path))).digest('hex');
}
writeFileSync(resolve(out,'manifest.json'),JSON.stringify({buildId,sourceHash,baselineRevision:revision,node:process.version,artifacts,createdAt:new Date().toISOString()},null,2));
console.log(JSON.stringify({buildId,sourceHash,out}));
