import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { github, pages, repository } from './github.mjs';
const marker=id=>`<!-- operation67-security:${id} -->`;
const markerPattern=new RegExp('<!-- operation67-security:([\\w-]+) -->');
const safe=value=>String(value??'неизвестно').replace(/[\r\n`<>[\]@]/g,' ').slice(0,250);
const digest=value=>createHash('sha256').update(value).digest('hex');
export function issuePlan(report,issues) {
  if(report.format!==1||!Array.isArray(report.findings)||!Array.isArray(report.errors))throw Error('Invalid watcher report.');
  const changes=[],active=new Set();
  const upsert=(id,title,body,labels)=>{
    active.add(id);const stamp=digest(body),content=`${marker(id)}\n<!-- content:${stamp} -->\n${body}`;
    const old=issues.find(i=>i.body?.includes(marker(id)));
    if(!old)changes.push({kind:'create',id,title,body:content,labels});
    else if(old.state!=='open'||!old.body.includes(`<!-- content:${stamp} -->`))changes.push({kind:'update',number:old.number,id,title,body:content,labels,state:'open',notify:true});
  };
  if(report.errors.length||report.state==='not_checked')upsert('scanner-failure','Security Watcher: проверка не выполнена','Проверка безопасности не завершена. Отсутствие уязвимостей не установлено.\n\nОткройте последний запуск Security Watcher, исправьте ошибку источника/сканера/разрешений и повторите проверку. Не закрывайте открытые security Issues на основании этого запуска.',['security','action-required','scanner-failure']);
  for(const f of report.findings){
    if(!['high','critical'].includes(f.severity)&&f.applicability!=='unknown'&&!issues.some(i=>i.body?.includes(marker(f.fingerprint))))continue;
    if(!/^[a-f0-9]{64}$/.test(f.fingerprint))throw Error('Invalid finding fingerprint.');
    const body=[`Компонент: ${safe(f.package)} ${safe(f.version)} (${safe(f.scope)}).`,`Уязвимость: ${safe(f.id)}; серьёзность: ${safe(f.severity)}.`,`Production может быть затронут: неизвестно — сопоставьте установленный artifact с APP_CONTRACT.`,`Применимость: ${f.applicability==='unknown'?'НЕЯСНА — требуется проверка диапазона':'версия входит в диапазон advisory'}.`,`Исправление доступно: ${f.fixAvailable?'да':'нет/неизвестно'}; исправленная версия: ${safe(f.fixed)}.`,`Тесты исправления: ${safe(f.prChecks??'не запускались')}.`,`Security PR: ${f.prUrl??'не найден'}.`,`Официальный advisory: https://github.com/advisories/${safe(f.id)}`,`Действие: изучите advisory, проверьте security PR и CI, затем используйте установленный вторым мастером release pipeline.`,`Если advisory допускает выполнение кода/обход прав и production был доступен в уязвимый период, возможна компрометация: сохраните evidence и используйте incident mode. Обычное обновление не доказывает устранение последствий.`].join('\n\n');
    upsert(f.fingerprint,`[${f.severity.toUpperCase()}] ${safe(f.package)} ${safe(f.version)} — ${safe(f.id)}`,body,['security','action-required',f.applicability==='unknown'?'applicability-unknown':f.severity]);
  }
  if(!report.errors.length&&report.state!=='not_checked')for(const old of issues){
    const id=markerPattern.exec(old.body??'')?.[1];
    if(!id||id==='watchdog'||active.has(id)||old.state!=='open')continue;
    if(id==='scanner-failure')changes.push({kind:'resolve',number:old.number,body:'Проверки npm и GitHub Actions снова выполнены. Это не проверка состояния production.'});
    else if(/^[a-f0-9]{64}$/.test(id))changes.push({kind:'resolve',number:old.number,body:'Эта версия/проблема больше не найдена в полностью проверенном текущем checkout. Проверьте оставшиеся security Issues: пакет мог обновиться на другую уязвимую версию. Состояние production и возможный incident автоматически не закрываются.'});
  }
  return changes;
}
export async function syncReport(report,repo,call=github){
  const prefix=`/repos/${repo}`,all=await pages(`${prefix}/issues?state=all&labels=security`,call);
  const issues=all.filter(i=>!i.pull_request&&i.user?.login==='github-actions[bot]');
  const prs=(await pages(`${prefix}/pulls?state=open`,call)).filter(p=>p.user?.login==='dependabot[bot]');
  for(const f of report.findings){const pr=prs.find(p=>p.title?.includes(f.package));if(!pr)continue;
    f.prUrl=`https://github.com/${repo}/pull/${pr.number}`;
    const checks=await call(`${prefix}/commits/${pr.head.sha}/check-runs`);const runs=checks.check_runs??[];
    f.prChecks=!runs.length?'не запускались':runs.some(r=>r.conclusion&&['failure','timed_out','cancelled','action_required','startup_failure'].includes(r.conclusion))?'не прошли':runs.every(r=>r.status==='completed'&&['success','neutral','skipped'].includes(r.conclusion))?'прошли':'выполняются';
  }
  const changes=issuePlan(report,issues);
  const existingLabels=new Set((await pages(`${prefix}/labels`,call)).map(l=>l.name));
  for(const name of new Set(changes.flatMap(c=>c.labels??[])))if(!existingLabels.has(name)){await call(`${prefix}/labels`,{method:'POST',body:{name,color:name==='critical'?'b60205':'d93f0b'}});existingLabels.add(name);}
  for(const c of changes){
    if(c.kind==='create')await call(`${prefix}/issues`,{method:'POST',body:{title:c.title,body:c.body,labels:c.labels}});
    else if(c.kind==='resolve'){await call(`${prefix}/issues/${c.number}/comments`,{method:'POST',body:{body:c.body}});await call(`${prefix}/issues/${c.number}`,{method:'PATCH',body:{state:'closed',state_reason:'completed'}});}
    else{await call(`${prefix}/issues/${c.number}`,{method:'PATCH',body:{title:c.title,body:c.body,labels:c.labels,state:c.state}});await call(`${prefix}/issues/${c.number}/comments`,{method:'POST',body:{body:'Изменилось состояние проблемы. Обновлены сведения в описании Issue; требуется повторная проверка.'}});}
  }
  return changes.length;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  let report;try{report=JSON.parse(readFileSync(process.argv[2]??'test-artifacts/security/watch.json','utf8'));}catch{report={format:1,state:'not_checked',findings:[],errors:['Report unavailable.']};}
  try{const count=await syncReport(report,repository());console.log(`Security issue changes: ${count}`);}catch{console.error('Security notifications failed. Inspect workflow permissions and retry.');process.exitCode=2;}
}
