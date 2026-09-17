import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function parseAudit(text, exitCode) {
  if(exitCode!==0&&exitCode!==1)throw Error('Audit process did not complete.');
  let data;try{data=JSON.parse(text);}catch{throw Error('Audit returned invalid JSON.');}
  if(!data||data.error||!data.metadata?.vulnerabilities||!data.advisories||typeof data.advisories!=='object')throw Error('Audit response is incomplete.');
  const counts=data.metadata.vulnerabilities;
  if(!['info','low','moderate','high','critical'].every(k=>Number.isInteger(counts[k])&&counts[k]>=0))throw Error('Audit severity counts are invalid.');
  const findings=[];
  for(const a of Object.values(data.advisories)) {
    if(!a||typeof a.module_name!=='string'||!['info','low','moderate','high','critical'].includes(a.severity)||!Array.isArray(a.findings)||!a.findings.length)throw Error('Audit finding is incomplete.');
    const id=a.github_advisory_id??String(a.id);
    if(!/^(GHSA-[\w-]+|\d+)$/.test(id))throw Error('Audit advisory identifier is invalid.');
    for(const f of a.findings) {
      if(typeof f.version!=='string'||!Array.isArray(f.paths)||!f.paths.every(p=>typeof p==='string'))throw Error('Audit dependency path is incomplete.');
      findings.push({id,package:a.module_name,version:f.version,workspace:'.',severity:a.severity,affected:a.vulnerable_versions??'unknown',fixed:a.patched_versions??'unknown',fixAvailable:typeof a.patched_versions==='string'&&!['<0.0.0','*',''].includes(a.patched_versions),url:/^GHSA-/.test(id)?`https://github.com/advisories/${id}`:'https://github.com/advisories',paths:f.paths,production:'unknown'});
    }
  }
  if(Object.values(counts).some(n=>n>0)&&!findings.length)throw Error('Audit counts and findings disagree.');
  if(exitCode===1&&!findings.length)throw Error('Audit failed without findings.');
  return findings;
}
export const fingerprint=f=>createHash('sha256').update(JSON.stringify([f.id,f.package,f.version,f.workspace])).digest('hex');
export function scanDependencies(directory=process.cwd(),runner=spawnSync) {
  const run=args=>{const r=runner('pnpm',['audit','--json',...args],{cwd:directory,encoding:'utf8',timeout:90000,maxBuffer:16*1024*1024});return parseAudit(r.stdout,r.status);};
  const findings=run([]),runtime=run(['--prod']);
  const runtimeKeys=new Set(runtime.map(f=>fingerprint(f)));
  return findings.map(f=>({...f,scope:runtimeKeys.has(fingerprint(f))?'runtime':'build',fingerprint:fingerprint(f)}));
}
export function scanReport(directory=process.cwd()) {
  const report={format:1,checkedAt:new Date().toISOString(),lockSha256:createHash('sha256').update(readFileSync(resolve(directory,'pnpm-lock.yaml'))).digest('hex'),state:'not_checked',findings:[],errors:[]};
  try{report.findings=scanDependencies(directory);report.state=report.findings.length?'vulnerable':'clean';}
  catch(e){report.errors.push(e instanceof Error?e.message:'Scanner failure.');}
  return report;
}
export function reportExit(report) {return report.errors.length?2:report.findings.some(f=>['high','critical'].includes(f.severity))?1:0;}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const report=scanReport();const destination=process.argv[2]??'test-artifacts/security/dependencies.json';
  mkdirSync(resolve(destination,'..'),{recursive:true});writeFileSync(destination,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({state:report.state,findings:report.findings.map(({id,package:name,version,severity,scope,fixAvailable})=>({id,name,version,severity,scope,fixAvailable})),errors:report.errors}));
  process.exitCode=reportExit(report);
}
