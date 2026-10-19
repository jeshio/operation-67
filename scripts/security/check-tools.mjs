import { spawnSync, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, lstatSync, cpSync, rmSync, readFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
const run=(cmd,args,options={})=>{const r=spawnSync(cmd,args,{stdio:'inherit',timeout:180000,...options});if(r.status!==0)throw Error(`${cmd} check failed (${r.status??'not completed'}).`);};
const selected=process.argv[2]??'all';mkdirSync('test-artifacts/security',{recursive:true});
if(['all','actions'].includes(selected))run(resolve('.tools/actionlint/actionlint'),['-shellcheck=','-pyflakes=']);
if(['all','secrets'].includes(selected))run(resolve('.tools/gitleaks/gitleaks'),['git','--redact=100','--no-banner','--config','scripts/security/gitleaks.toml','--log-opts=--all','--report-format','json','--report-path','test-artifacts/security/secrets-history.json']);
if(['all','secrets'].includes(selected))for(const directory of ['dist','dist-server']){
  if(!lstatSync(directory,{throwIfNoEntry:false})?.isDirectory())throw Error('Build before checking secrets in release output.');
  run(resolve('.tools/gitleaks/gitleaks'),['dir',directory,'--redact=100','--no-banner','--config','scripts/security/gitleaks.toml','--report-format','json','--report-path',`test-artifacts/security/secrets-${directory}.json`]);
}
if(['all','secrets','sast'].includes(selected)){
  const snapshot=mkdtempSync(resolve('test-artifacts/security/source-'));
  try{
    const files=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
    for(const file of new Set(files)){
      if(/(^|\/)(?:\.env(?:\..*)?|credentials.*|secrets.*)$/.test(file)&&!file.endsWith('.env.example'))continue;
      if(file.startsWith('../')||file.startsWith('/')||file.startsWith('test-artifacts/')||!lstatSync(file,{throwIfNoEntry:false})?.isFile())continue;
      const target=join(snapshot,file);mkdirSync(dirname(target),{recursive:true});cpSync(file,target);
    }
    if(['all','secrets'].includes(selected))run(resolve('.tools/gitleaks/gitleaks'),['dir',snapshot,'--redact=100','--no-banner','--config','scripts/security/gitleaks.toml','--report-format','json','--report-path','test-artifacts/security/secrets-working.json']);
    if(['all','sast'].includes(selected)){
      const {image}=JSON.parse(readFileSync('scripts/security/tools.json','utf8')).semgrep;
      // mkdtemp creates a 0700 directory: without capabilities, container root cannot
      // read a Linux runner's snapshot. Use its owner for both input and report writes.
      const owner=`${process.getuid()}:${process.getgid()}`;
      run('docker',['run','--rm','--user',owner,'--network=none','--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','--tmpfs','/tmp:rw,nosuid,nodev,size=256m','-e','HOME=/tmp','-e','SEMGREP_SEND_METRICS=off','-e','SEMGREP_ENABLE_VERSION_CHECK=0','-v',`${resolve('test-artifacts/security')}:/reports`,'-v',`${snapshot}:/src:ro`,'-w','/src',image,'semgrep','scan','--config','scripts/security/semgrep.yml','--metrics=off','--disable-version-check','--error','--strict','--no-git-ignore','--json-output','/reports/semgrep.json','server','src','scripts/security']);
    }
  }finally{rmSync(snapshot,{recursive:true,force:true});}
}
