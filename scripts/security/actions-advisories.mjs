import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { github, cursorPages } from './github.mjs';
import { fingerprint } from './dependencies.mjs';
// Deliberately supports only the comparator syntax published by GitHub for our
// Actions. Unknown ranges fail visibly; they are never treated as unaffected.
export function inRange(version,range){
  const parts=version.replace(/^v/,'').split('.').map(Number);if(parts.length!==3||parts.some(n=>!Number.isSafeInteger(n)))return null;
  const clauses=range.split(',').map(s=>s.trim());let result=true;
  for(const clause of clauses){const m=/^(<=|>=|<|>|=)?\s*(\d+)\.(\d+)\.(\d+)$/.exec(clause);if(!m)return null;
    const other=m.slice(2).map(Number);let cmp=0;for(let i=0;i<3;i++){if(parts[i]!==other[i]){cmp=parts[i]>other[i]?1:-1;break;}}
    const op=m[1]??'=';result&&=op==='<'?cmp<0:op==='<='?cmp<=0:op==='>'?cmp>0:op==='>='?cmp>=0:cmp===0;
  }return result;
}
export function usedActions(root='.github/workflows'){
  const result=new Map();
  for(const file of readdirSync(root).filter(f=>/\.ya?ml$/.test(f))){for(const line of readFileSync(`${root}/${file}`,'utf8').split('\n')){
    if(!/^\s*(?:-\s*)?uses:/.test(line))continue;
    const match=/^\s*(?:-\s*)?uses:\s*([^\s#]+)(?:\s*#\s*(v\d+\.\d+\.\d+))?\s*$/.exec(line);if(!match)throw Error(`Unverified action declaration (${file}).`);
    if(match[1].startsWith('./'))continue;
    const ref=/^([\w.-]+\/[\w.-]+)(?:\/[\w./-]+)?@([a-f0-9]{40})$/.exec(match[1]);if(!ref||!match[2])throw Error(`Action must have a full SHA and version annotation (${file}).`);
    result.set(`${ref[1]}@${ref[2]}`,{package:ref[1],sha:ref[2],version:match[2].slice(1)});
  }}return [...result.values()];
}
export async function scanActions(call=github){
  const actions=usedActions(),packages=encodeURIComponent([...new Set(actions.map(a=>a.package))].join(','));
  const advisories=await cursorPages(`/advisories?ecosystem=actions&type=reviewed&affects=${packages}`,call),findings=[];
  if(!actions.length)throw Error('No Actions were inspected.');
  for(const a of advisories){
    if(!a||!/^GHSA-[\w-]+$/.test(a.ghsa_id??'')||!['low','medium','moderate','high','critical','unknown'].includes(a.severity)||!Array.isArray(a.vulnerabilities))throw Error('Invalid Actions advisory response.');
    for(const v of a.vulnerabilities)if(!v.package||typeof v.package.name!=='string'||typeof v.vulnerable_version_range!=='string'||v.first_patched_version!==null&&v.first_patched_version!==undefined&&typeof v.first_patched_version!=='string')throw Error('Incomplete Actions advisory.');
  }
  for(const action of actions){
    let ref=await call(`/repos/${action.package}/git/ref/tags/v${action.version}`);
    for(let depth=0;ref.object?.type==='tag'&&depth<4;depth++)ref=await call(`/repos/${action.package}/git/tags/${ref.object.sha}`);
    if(ref.object?.type!=='commit'||ref.object.sha!==action.sha)throw Error('Action version annotation does not match its upstream commit.');
    for(const a of advisories){if(a.withdrawn_at)continue;for(const v of a.vulnerabilities??[]){if(v.package?.name?.toLowerCase()!==action.package.toLowerCase())continue;
      const affected=inRange(action.version,v.vulnerable_version_range);if(affected===false)continue;
      const f={id:a.ghsa_id,package:action.package,version:action.version,workspace:'.github/workflows',severity:a.severity==='medium'?'moderate':a.severity,scope:'build',production:'unknown',fixed:v.first_patched_version??'unknown',fixAvailable:!!v.first_patched_version,url:`https://github.com/advisories/${a.ghsa_id}`,applicability:affected===null||a.severity==='unknown'?'unknown':'affected'};findings.push({...f,fingerprint:fingerprint(f)});
    }}
  }return findings;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const file=process.argv[2]??'test-artifacts/security/dependencies.json',report=JSON.parse(readFileSync(file,'utf8'));
  try{const findings=await scanActions();report.findings.push(...findings);report.actions='checked';if(findings.length)report.state='vulnerable';}
  catch(error){report.errors.push(`GitHub Actions advisory check could not be completed: ${String(error.message).slice(0,180)}`);report.actions='not_checked';report.state='not_checked';}
  writeFileSync(file,JSON.stringify(report,null,2)+'\n');console.log(`Actions advisories: ${report.actions}`);process.exitCode=report.errors.length?2:report.findings.some(f=>['high','critical'].includes(f.severity)||f.applicability==='unknown')?1:0;
}
