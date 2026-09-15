import { chmodSync,cpSync,mkdtempSync,mkdirSync,realpathSync,writeFileSync,rmSync,readFileSync,readdirSync,symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve,relative,dirname,sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root=fileURLToPath(new URL('../',import.meta.url)),modules=join(root,'node_modules'),store=join(modules,'.pnpm');
const stage=mkdtempSync(join(tmpdir(),'roma67-package-')),archive=resolve(process.argv[2]??join(root,'test-artifacts/roma67-vps.tar.gz'));
const manifest=JSON.parse(readFileSync(join(root,'package.json'),'utf8'));
const runtimeNames=['@colyseus/core','@colyseus/schema','@colyseus/ws-transport','@msgpack/msgpack','express'];
const runtimeDependencies=Object.fromEntries(runtimeNames.map(name=>[name,manifest.dependencies[name]]));
const copied=new Set();
function copyPackage(path){
 const actual=realpathSync(path),part=relative(store,actual).split(sep)[0];
 if(part==='..'||!part)throw Error(`Dependency outside pnpm store: ${path}`);
 if(copied.has(part))return;copied.add(part);
 const source=join(store,part),dest=join(stage,'node_modules/.pnpm',part);cpSync(source,dest,{recursive:true,verbatimSymlinks:true});
 const scan=dir=>{for(const entry of readdirSync(dir,{withFileTypes:true})){const child=join(dir,entry.name);if(entry.isSymbolicLink())copyPackage(child);else if(entry.isDirectory()&&entry.name.startsWith('@'))scan(child);}};
 scan(join(source,'node_modules'));
}
try{
 chmodSync(stage,0o755);
 for(const name of ['dist','dist-server','deploy'])cpSync(join(root,name),join(stage,name),{recursive:true});
 mkdirSync(join(stage,'node_modules/.pnpm'),{recursive:true});
 for(const name of runtimeNames){
  const source=join(modules,name);copyPackage(source);const dest=join(stage,'node_modules',name);mkdirSync(dirname(dest),{recursive:true});
  symlinkSync(relative(dirname(source),realpathSync(source)),dest);
 }
 cpSync(join(root,'deploy/vps/Caddyfile'),join(stage,'Caddyfile'));cpSync(join(root,'deploy/vps/uninstall.sh'),join(stage,'uninstall.sh'));
 writeFileSync(join(stage,'.managed-by'),'roma-operation-67-v1\n');
 writeFileSync(join(stage,'package.json'),JSON.stringify({name:'roma-operation-67-runtime',private:true,type:'module',version:manifest.version,engines:manifest.engines,dependencies:runtimeDependencies}));
 mkdirSync(dirname(archive),{recursive:true});const result=spawnSync('tar',['-czf',archive,'-C',stage,'.'],{stdio:'inherit'});if(result.status!==0)throw Error('Не удалось собрать архив');console.log(`${archive} (${copied.size} runtime packages)`);
}finally{rmSync(stage,{recursive:true,force:true});}
