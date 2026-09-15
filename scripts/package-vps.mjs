import { cpSync,mkdtempSync,mkdirSync,realpathSync,writeFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root=fileURLToPath(new URL('../',import.meta.url));
const stage=mkdtempSync(join(tmpdir(),'roma67-package-'));
const archive=resolve(process.argv[2]??join(root,'test-artifacts/roma67-vps.tar.gz'));
try{
 for(const name of ['dist','dist-server','deploy'])cpSync(join(root,name),join(stage,name),{recursive:true});
 mkdirSync(join(stage,'node_modules'));cpSync(realpathSync(join(root,'node_modules/ws')),join(stage,'node_modules/ws'),{recursive:true});
 cpSync(join(root,'deploy/vps/Caddyfile'),join(stage,'Caddyfile'));cpSync(join(root,'deploy/vps/uninstall.sh'),join(stage,'uninstall.sh'));
 writeFileSync(join(stage,'.managed-by'),'roma-operation-67-v1\n');
 writeFileSync(join(stage,'package.json'),JSON.stringify({name:'roma-operation-67-runtime',private:true,type:'module',version:'1.0.0'}));
 mkdirSync(resolve(archive,'..'),{recursive:true});const result=spawnSync('tar',['-czf',archive,'-C',stage,'.'],{stdio:'inherit'});if(result.status!==0)throw Error('Не удалось собрать архив');console.log(archive);
}finally{rmSync(stage,{recursive:true,force:true});}
