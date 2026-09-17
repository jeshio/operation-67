import { chmodSync,cpSync,mkdtempSync,mkdirSync,realpathSync,writeFileSync,rmSync,readFileSync,readdirSync,symlinkSync,lstatSync,readlinkSync } from 'node:fs';
import { join,resolve,relative,dirname,sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { verifyBuild } from './security/artifact.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),modules=join(root,'node_modules'),store=join(modules,'.pnpm');
const release=verifyBuild(root),local=process.argv.includes('--allow-dirty');
if(!local&&(release.dirty||release.platform!=='linux'))throw Error('Production archives require a clean Linux build. --allow-dirty is for local testing only.');
const archive=resolve(process.argv.slice(2).find(s=>!s.startsWith('--'))??join(root,'test-artifacts/roma67-vps.tar.gz'));
mkdirSync(join(root,'test-artifacts/security'),{recursive:true});
const stage=mkdtempSync(join(root,'test-artifacts/security/package-'));
const manifest=JSON.parse(readFileSync(join(root,'package.json'),'utf8'));
const runtimeNames=['@colyseus/core','@colyseus/schema','@colyseus/ws-transport','@msgpack/msgpack','express'];
const runtimeDependencies=Object.fromEntries(runtimeNames.map(name=>[name,manifest.dependencies[name]]));
const copied=new Set();
const excluded=/(?:^|\/)(?:\.git|\.github|\.codex|\.claude|\.npmrc|\.pypirc|\.env(?:\..*)?|credentials[^/]*|secrets[^/]*|[^/]+\.(?:pem|key|p12|pfx|sql|dump))$/i;
// @colyseus/schema's optional TypeScript peer is for schema-codegen, not runtime.
const compilerPeer=path=>path.endsWith('/node_modules/typescript')||path.endsWith('/node_modules/.bin');
function copyPackage(path){
 const actual=realpathSync(path),part=relative(store,actual).split(sep)[0];
 if(part==='..'||!part)throw Error('Dependency outside pnpm store');
 if(copied.has(part))return;copied.add(part);
 const source=join(store,part),dest=join(stage,'node_modules/.pnpm',part);
 cpSync(source,dest,{recursive:true,verbatimSymlinks:true,filter:p=>!excluded.test(p)&&!compilerPeer(p)});
 const scan=dir=>{for(const entry of readdirSync(dir,{withFileTypes:true})){const child=join(dir,entry.name);if(compilerPeer(child))continue;if(entry.isSymbolicLink())copyPackage(child);else if(entry.isDirectory()&&entry.name.startsWith('@'))scan(child);}};
 scan(join(source,'node_modules'));
}
try{
 chmodSync(stage,0o755);
 for(const name of ['dist','dist-server'])cpSync(join(root,name),join(stage,name),{recursive:true});
 mkdirSync(join(stage,'node_modules/.pnpm'),{recursive:true});
 for(const name of runtimeNames){const source=join(modules,name);copyPackage(source);const dest=join(stage,'node_modules',name);mkdirSync(dirname(dest),{recursive:true});symlinkSync(relative(dirname(source),realpathSync(source)),dest);}
 writeFileSync(join(stage,'.managed-by'),'roma-operation-67-v1\n');
 writeFileSync(join(stage,'package.json'),JSON.stringify({name:'roma-operation-67-runtime',private:true,type:'module',version:manifest.version,engines:manifest.engines,dependencies:runtimeDependencies},null,2)+'\n');
 writeFileSync(join(stage,'release.json'),JSON.stringify(release,null,2)+'\n');
 const packages=[];
 const inventory={format:1,commit:release.commit,files:{}};
 const walk=dir=>{for(const name of readdirSync(dir).sort()){const file=join(dir,name),rel=relative(stage,file).split(sep).join('/'),stat=lstatSync(file);
   if(excluded.test(rel))throw Error('Prohibited runtime file');
   if(stat.isSymbolicLink()){
     const target=readlinkSync(file),resolved=relative(stage,resolve(dirname(file),target));
     if(target.startsWith('/')||resolved==='..'||resolved.startsWith('../'))throw Error('Runtime symlink escapes artifact');
     realpathSync(file);inventory.files[rel]={link:target};
   }else if(stat.isDirectory())walk(file);
   else if(stat.isFile()){
     inventory.files[rel]={sha256:createHash('sha256').update(readFileSync(file)).digest('hex')};
     if(name==='package.json'&&rel.startsWith('node_modules/')){const p=JSON.parse(readFileSync(file,'utf8'));if(p.name&&p.version)packages.push({name:p.name,version:p.version,path:rel});}
   }else throw Error('Unsupported runtime entry');
 }};
 walk(stage);
 if(packages.some(p=>['typescript','vite','esbuild','tsx','@playwright/test'].includes(p.name)))throw Error('Development tool found in runtime artifact');
 writeFileSync(join(stage,'dependencies.json'),JSON.stringify({format:1,commit:release.commit,packages},null,2)+'\n');
 inventory.files['dependencies.json']={sha256:createHash('sha256').update(readFileSync(join(stage,'dependencies.json'))).digest('hex')};
 writeFileSync(join(stage,'integrity.json'),JSON.stringify(inventory,null,2)+'\n');
 mkdirSync(dirname(archive),{recursive:true});const result=spawnSync('tar',['-czf',archive,'-C',stage,'.'],{stdio:'inherit',env:{...process.env,COPYFILE_DISABLE:'1'}});if(result.status!==0)throw Error('Archive creation failed');
 const sha=createHash('sha256').update(readFileSync(archive)).digest('hex');writeFileSync(archive+'.sha256',`${sha}  ${archive.split('/').at(-1)}\n`);
 console.log(`${archive}: ${packages.length} runtime packages; sha256=${sha}; dirty=${release.dirty}`);
}finally{rmSync(stage,{recursive:true,force:true});}
