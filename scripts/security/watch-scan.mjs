import { mkdirSync, writeFileSync } from 'node:fs';
import { scanReport } from './dependencies.mjs';
import { scanActions } from './actions-advisories.mjs';
const report=scanReport();
try{report.findings.push(...await scanActions());report.actions='checked';}catch(error){report.actions='not_checked';report.errors.push(`GitHub Actions advisory check could not be completed: ${String(error.message).slice(0,180)}`);}
report.state=report.errors.length?'not_checked':report.findings.length?'vulnerable':'clean';
mkdirSync('test-artifacts/security',{recursive:true});writeFileSync('test-artifacts/security/watch.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({state:report.state,findings:report.findings.length,errors:report.errors}));
// Findings are a successful scan; failure to scan is a failed workflow.
process.exitCode=report.errors.length?2:0;
