import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
export function flattenGraph(value,out=new Map()){
  if(Array.isArray(value)){for(const v of value)flattenGraph(v,out);return out;}
  if(!value||typeof value!=='object')return out;
  for(const group of ['dependencies','devDependencies','optionalDependencies'])for(const [name,d] of Object.entries(value[group]??{})){
    if(typeof d.version!=='string')throw Error('Incomplete dependency graph.');
    out.set(`${name}@${d.version}`,{name,version:d.version});flattenGraph(d,out);
  }return out;
}
export function checkSources(text){
  for(const match of text.matchAll(/(?:tarball:\s*|resolution:\s*\{tarball:\s*)(https?:\/\/[^\s,}]+)/g)){
    const url=new URL(match[1]);if(url.protocol!=='https:'||url.username||url.password)throw Error('Insecure dependency source.');
    if(url.hostname==='registry.npmjs.org')continue;
    if(url.hostname==='codeload.github.com'&&/^\/uNetworking\/uWebSockets\.js\/tar\.gz\/[a-f0-9]{40}$/.test(url.pathname))continue;
    throw Error('New dependency source requires explicit review.');
  }
  if(/(?:git\+ssh|git\+http:|http:|(?:^|[\s'"{,])(?:file:|link:))/m.test(text))throw Error('Unsupported dependency source requires review.');
}
export function resolutions(text){
  const section=text.split(/^packages:\s*$/m)[1]?.split(/^snapshots:\s*$/m)[0];
  if(!section)throw Error('Unsupported lockfile package layout.');
  const result=new Map();
  for(const m of section.matchAll(/^  (.+):\n((?: {4}[^\n]*\n|\n)*)/gm)){
    const name=m[1].replace(/^['"]|['"]$/g,''),resolution=/^    resolution: (.+)$/m.exec(m[2])?.[1];
    if(!resolution)throw Error('Unverified lockfile resolution.');
    result.set(name,resolution);
  }
  if(!result.size)throw Error('Empty dependency graph.');return result;
}
export async function review(base,head){
  if(![base,head].every(s=>/^[a-f0-9]{40}$/.test(s)))throw Error('Expected explicit base/head commit SHAs.');
  mkdirSync('test-artifacts/security',{recursive:true});const temp=mkdtempSync(resolve('test-artifacts/security/graph-'));
  try{
    const locks=new Map();
    const graph=sha=>{
      const dir=mkdtempSync(join(temp,sha+'-'));
      for(const file of ['package.json','pnpm-lock.yaml','pnpm-workspace.yaml']){
        const data=execFileSync('git',['show',`${sha}:${file}`],{encoding:'utf8'});writeFileSync(join(dir,file),data);if(file==='pnpm-lock.yaml'){checkSources(data);locks.set(sha,resolutions(data));}
      }
      const output=spawnSync('pnpm',['list','--lockfile-only','--json','--depth','Infinity','--config.ignore-pnpmfile=true'],{cwd:dir,encoding:'utf8',timeout:30000,maxBuffer:32*1024*1024});
      if(output.status!==0)throw Error('Could not read dependency graph.');const result=flattenGraph(JSON.parse(output.stdout));if(!result.size)throw Error('Empty dependency graph.');return result;
    };
    const before=graph(base),after=graph(head),added=[...after].filter(([key])=>!before.has(key)).map(([,v])=>v);
    for(const [key,value] of locks.get(head))if(locks.get(base).has(key)&&locks.get(base).get(key)!==value)throw Error('Existing package integrity/source changed; separate review required.');
    if(added.length>100)throw Error('Large dependency change requires a separate review.');
    const packages=[];
    for(const p of added){
      if(!/^(@[a-z0-9._-]+\/)?[a-zA-Z0-9._-]+$/.test(p.name)||!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(p.version))throw Error('Non-registry package change requires explicit review.');
      const response=await fetch(`https://registry.npmjs.org/${encodeURIComponent(p.name)}/${encodeURIComponent(p.version)}`,{signal:AbortSignal.timeout(15000),redirect:'error'});
      if(!response.ok)throw Error('Package metadata could not be verified.');const data=await response.json();
      if(data.name!==p.name||data.version!==p.version||!data.dist?.integrity)throw Error('Package identity is unverified.');
      const locked=/integrity:\s*([^,} ]+)/.exec(locks.get(head).get(`${p.name}@${p.version}`)??'')?.[1];
      if(locked!==data.dist.integrity)throw Error('Registry and lockfile integrity differ.');
      const hooks=Object.fromEntries(Object.entries(data.scripts??{}).filter(([name])=>['preinstall','install','postinstall','prepare'].includes(name)));
      if(Object.keys(hooks).length&&!(p.name==='esbuild'&&Object.keys(hooks).length===1&&hooks.postinstall==='node install.js'))throw Error(`Install/prepare hooks require review for ${p.name}.`);
      packages.push({...p,hooks,deprecated:!!data.deprecated});
      if(data.deprecated)throw Error(`Deprecated new dependency requires review: ${p.name}.`);
    }
    writeFileSync('test-artifacts/security/dependency-review.json',JSON.stringify({base,head,added:packages,removed:[...before.keys()].filter(k=>!after.has(k))},null,2)+'\n');
    console.log(`Dependency review: ${added.length} added/changed versions.`);
  }finally{rmSync(temp,{recursive:true,force:true});}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)try{await review(process.argv[2]??process.env.PR_BASE_SHA,process.argv[3]??process.env.PR_HEAD_SHA);}catch(e){console.error(e.message);process.exitCode=2;}
