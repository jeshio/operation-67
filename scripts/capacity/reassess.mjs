// Re-evaluate recorded samples without replacing the original observation report.
import { readFileSync,writeFileSync } from 'node:fs';
import { createReadStream } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';
import { aggregate,accumulate,finishAggregate,checkMemoryPlateau } from './analysis.mjs';
const path=process.argv[2];if(!path?.endsWith('.json'))throw Error('Pass a completed stage JSON path');
const original=JSON.parse(readFileSync(path,'utf8'));
if(original.schemaVersion!==1||!original.completed)throw Error('Only completed stages can be reassessed');
const reference=process.argv[3]?JSON.parse(readFileSync(process.argv[3],'utf8')).profiles:{};
const groups={};
const lines=createInterface({input:createReadStream(path.replace(/\.json$/,'.samples.jsonl.gz')).pipe(createGunzip()),crlfDelay:Infinity});
for await(const line of lines){const sample=JSON.parse(line);if(['normal','heavy'].includes(sample.phase))accumulate(groups[sample.phase]??=aggregate(),sample,original.config);}
const profiles=Object.fromEntries(Object.entries(groups).map(([name,a])=>[name,finishAggregate(a,reference[name])]));
const memoryPlateau=checkMemoryPlateau(Object.values(groups).flatMap(a=>a.memory).sort((a,b)=>a.at-b.at));
const passed=original.errors.length===0&&Object.values(profiles).every(p=>p.passed)&&original.faults.every(f=>f.pass!==false)&&!memoryPlateau?.sustainedGrowth;
const report={...original,profiles,memoryPlateau,passed,cause:original.errors[0]?.cause??Object.values(profiles).find(p=>!p.passed)?.cause??null,
 acceptance:passed&&!original.config.smoke&&!original.config.functional&&original.config.seconds>=300&&original.config.warmup>=60&&!!profiles.normal&&!!profiles.heavy,
 reassessment:{sourceReport:path,originalPassed:original.passed,originalCause:original.cause,at:new Date().toISOString(),analysisHash:createHash('sha256').update(readFileSync(new URL('./analysis.mjs',import.meta.url))).digest('hex')}};
const output=path.replace(/\.json$/,'.reassessed.json');writeFileSync(output,JSON.stringify(report,null,2));console.log(JSON.stringify({output,passed:report.passed,cause:report.cause}));
