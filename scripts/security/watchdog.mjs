import { github, pages, repository } from './github.mjs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
export function watcherHealth(runs,now=Date.now()){
  const relevant=runs.filter(r=>r.head_branch==='main'&&['schedule','workflow_dispatch','push'].includes(r.event)&&r.status==='completed');
  const success=relevant.filter(r=>r.conclusion==='success').sort((a,b)=>Date.parse(b.updated_at)-Date.parse(a.updated_at))[0];
  const latest=[...relevant].sort((a,b)=>Date.parse(b.updated_at)-Date.parse(a.updated_at))[0];
  if(!success||!Number.isFinite(Date.parse(success.updated_at))||now-Date.parse(success.updated_at)>8*86400000)return 'stale';
  return latest&&latest.conclusion!=='success'?'failed':'healthy';
}
export async function checkWatcher(repo,call=github){
  const prefix=`/repos/${repo}`,response=await call(`${prefix}/actions/workflows/security-watch.yml/runs?branch=main&per_page=100`);
  if(!Array.isArray(response.workflow_runs))throw Error('Missing workflow history.');
  const state=watcherHealth(response.workflow_runs),marker='<!-- operation67-security:watchdog -->';
  const issues=await pages(`${prefix}/issues?state=all`,call),old=issues.find(i=>i.user?.login==='github-actions[bot]'&&!i.pull_request&&i.body?.includes(marker));
  const body=`${marker}\nSecurity Watcher: ${state==='stale'?'нет успешной полной проверки более восьми дней или watcher ещё не запускался':'последний запуск завершился ошибкой'}.\n\nОткройте Actions → Security Watcher, устраните ошибку и запустите вручную. Проверяйте квоту Actions и состояние расписания. Этот watchdog не обнаружит полную остановку GitHub Actions.`;
  if(state==='healthy'){
    if(old?.state==='open'){await call(`${prefix}/issues/${old.number}/comments`,{method:'POST',body:{body:'Security Watcher снова завершил полную проверку. Регулярный heartbeat отключён.'}});await call(`${prefix}/issues/${old.number}`,{method:'PATCH',body:{state:'closed'}});}
  }else if(!old)await call(`${prefix}/issues`,{method:'POST',body:{title:'Security Watcher требует внимания',body}});
  else if(old.state!=='open'||old.body!==body){await call(`${prefix}/issues/${old.number}`,{method:'PATCH',body:{body,state:'open'}});await call(`${prefix}/issues/${old.number}/comments`,{method:'POST',body:{body:'Обнаружено изменение состояния проверок. Смотрите описание Issue.'}});}
  return state;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)try{console.log(`Watcher: ${await checkWatcher(repository())}`);}catch{console.error('Watchdog failed; no healthy status established.');process.exitCode=2;}
