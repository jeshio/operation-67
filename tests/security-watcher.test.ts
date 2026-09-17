import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAudit, fingerprint, reportExit, scanDependencies } from '../scripts/security/dependencies.mjs';
import { issuePlan, syncReport } from '../scripts/security/watch-issues.mjs';
import { watcherHealth } from '../scripts/security/watchdog.mjs';
import { inRange } from '../scripts/security/actions-advisories.mjs';
const empty=JSON.stringify({metadata:{vulnerabilities:{info:0,low:0,moderate:0,high:0,critical:0}},advisories:{}});
test('audit errors and malformed responses never become a clean scan',()=>{
  assert.deepEqual(parseAudit(empty,0),[]);
  for(const [text,status] of [['',0],['{}',0],[empty,1],[empty,2],[JSON.stringify({error:{code:'NETWORK'}}),1]])assert.throws(()=>parseAudit(text,status));
  assert.throws(()=>scanDependencies('.',()=>({status:null,stdout:''})));
  assert.equal(reportExit({errors:['offline'],findings:[]}),2);
});
const finding={id:'GHSA-test-test-test',package:'example',version:'1.0.0',workspace:'.',severity:'high',scope:'runtime',fixAvailable:false};
const f={...finding,fingerprint:fingerprint(finding)};
const report={format:1,state:'vulnerable',findings:[f],errors:[]};
test('issues are deduplicated, patch/severity changes notify, and failures do not resolve vulnerabilities',()=>{
  const changes=issuePlan(report,[]);assert.equal(changes.length,1);const old={...changes[0],number:7,state:'open'};
  assert.deepEqual(issuePlan(report,[old]),[]);
  assert.equal(issuePlan({...report,findings:[{...f,fixAvailable:true,fixed:'1.0.1'}]},[old])[0].kind,'update');
  assert.equal(issuePlan({...report,findings:[{...f,severity:'critical'}]},[old])[0].kind,'update');
  const error=issuePlan({format:1,state:'not_checked',findings:[],errors:['offline']},[old]);assert.equal(error.length,1);assert.equal(error[0].id,'scanner-failure');
  assert.equal(issuePlan({format:1,state:'clean',findings:[],errors:[]},[old])[0].kind,'resolve');
  assert.equal(fingerprint(finding),f.fingerprint);assert.notEqual(fingerprint({...finding,version:'1.0.1'}),f.fingerprint);
});
test('notification delivery errors remain failures',async()=>{await assert.rejects(syncReport(report,'owner/repo',async()=>{throw Error('API unavailable');}));});
test('watchdog detects missing, stale and failed runs and stays quiet on healthy runs',()=>{
  const now=Date.now(),run={head_branch:'main',event:'schedule',status:'completed',conclusion:'success',updated_at:new Date(now).toISOString()};
  assert.equal(watcherHealth([],now),'stale');assert.equal(watcherHealth([run],now),'healthy');assert.equal(watcherHealth([run],now+9*86400000),'stale');
  assert.equal(watcherHealth([run,{...run,conclusion:'failure',updated_at:new Date(now+1000).toISOString()}],now+2000),'failed');
});
test('unknown advisory ranges remain unclear',()=>{assert.equal(inRange('7.0.1','< 7.0.2'),true);assert.equal(inRange('7.0.1','>= 7.0.2'),false);assert.equal(inRange('7.0.1','>= 6.0.0, < 8.0.0'),true);assert.equal(inRange('7.0.1','weird-range'),null);});

test('Actions scanner checks tag identity and preserves unknown applicability',async()=>{
 const {scanActions,usedActions}=await import('../scripts/security/actions-advisories.mjs');const actions=usedActions();
 const call=async(path:string)=>{
  if(path.startsWith('/advisories?'))return {items:[{ghsa_id:'GHSA-test-test-test',severity:'medium',withdrawn_at:null,vulnerabilities:[{package:{name:actions[0].package},vulnerable_version_range:'unrecognized range',first_patched_version:null}]}],next:null};
  const action=actions.find(a=>path.includes(`/repos/${a.package}/git/ref/tags/`));return {object:{type:'commit',sha:action?.sha}};
 };
 const findings=await scanActions(call);assert.equal(findings.length,1);assert.equal(findings[0].applicability,'unknown');assert.equal(findings[0].severity,'moderate');
 await assert.rejects(scanActions(async()=>({items:[{}],next:null})),/Invalid Actions advisory/);
 await assert.rejects(scanActions(async(path:string)=>path.startsWith('/advisories?')?{items:[],next:null}:{object:{type:'commit',sha:'f'.repeat(40)}}),/does not match/);
});

test('advisories follow cursor links instead of repeating page one',async()=>{
 const {cursorPages,github}=await import('../scripts/security/github.mjs');let count=0;
 const result=await cursorPages('/advisories?type=reviewed',async(path:string)=>{count++;return path.includes('after=')?{items:[2],next:null}:{items:[1],next:'/advisories?type=reviewed&after=cursor'};});
 assert.deepEqual(result,[1,2]);assert.equal(count,2);
 await assert.rejects(cursorPages('/advisories?type=reviewed',async(path:string)=>({items:[],next:path})),/cursor/);
 const page=await github('/advisories?type=reviewed',{pagination:true,token:undefined,fetcher:async()=>new Response('[]',{headers:{link:'<https://api.github.com/advisories?after=cursor>; rel="next"'}})});assert.equal(page.next,'/advisories?after=cursor');
 await assert.rejects(github('/advisories?',{pagination:true,fetcher:async()=>new Response('[]',{headers:{link:'<https://evil.example/advisories?after=x>; rel="next"'}})}),/origin/);
});
