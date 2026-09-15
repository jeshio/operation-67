import { readFileSync,existsSync,writeFileSync } from 'node:fs';
import { resolve,relative } from 'node:path';

const out=resolve(process.argv[2]??'test-artifacts/capacity');
const read=path=>JSON.parse(readFileSync(path,'utf8'));
const manifest=read('test-artifacts/capacity-build/manifest.json');
const buildLink=relative(out,resolve('test-artifacts/capacity-build'));
const cases=[['baseline','relay','Старая версия'],['current','relay','Новая: сервер'],['current','direct','Новая: напрямую'],['current','mixed','Новая: смешанная']];
function assessed(version,route,r){const base=resolve(out,`${version}-${route}-${r.rooms}-${r.label}`);return existsSync(base+'.reassessed.json')?read(base+'.reassessed.json'):existsSync(base+'.json')?read(base+'.json'):r;}
const fmt=v=>v==null?'—':String(Math.round(v*100)/100);
const why={network:'признаки ограничения сети',generator:'генератор',vps:'ресурсы VPS','vps-or-game':'ресурсы VPS или работа игры',production:'появились обычные игроки',telemetry:'измерения недоступны',routes:'состав маршрутов', 'setup-or-runtime':'ошибка запуска или сценария'};
const lines=['# Вместимость VPS: результаты браузерных испытаний','',
 'Основная игра остаётся на прежней версии с лимитом **4 комнаты / 16 игроков**. Тестовая игра: 60% одного ядра и 512 МиБ; HTTPS: 20% и 192 МиБ. Четыре независимых браузерных профиля на комнату. Генератор — Chromium в Docker на Mac, по четыре комнаты на процесс браузера, без 3D.', '',
 `Исходная ревизия: \`${manifest.baselineRevision}\`. Сборка: \`${manifest.buildId}\`. Контрольная сумма исходников: \`${manifest.sourceHash}\`. [Манифест и суммы архивов](${buildLink}/manifest.json); [полные исходники сборки](${buildLink}/current-source.tar.gz).`, '',
 '| Серия | Полностью прошли, комнат | Повторно прошли | Рекомендованный лимит после часа | Ограничение |',
 '|---|---:|---:|---:|---|'];
const series=[];
for(const [version,route,name] of cases){
 const path=resolve(out,`${version}-${route}-series.json`),s=existsSync(path)?read(path):null;series.push({version,route,name,s});
 const latest=s?.results?.at(-1),a=latest?assessed(version,route,latest):null,limit=a?.reassessment&&!a.passed?a.cause:s?.limitedBy;
 lines.push(`| ${name} | ${s?.maximumPassed===0?'ни одной полной ступени':s?.maximumPassed??'не завершено'} | ${s?.maximumRepeated??'—'} | ${s?.recommendedRooms??'не подтверждён'} | ${limit?why[limit]??limit:s?.limitFound?'граница уточнена':s?.finishedAt?'максимум не найден':'серия не завершена'} |`);
}
lines.push('','Успешные короткие smoke-проверки в таблицу вместимости не входят. Достижение потолка генератора или 128 комнат без перегрузки VPS доказывает только «проверено не менее N комнат». Отсутствие рекомендованного лимита означает, что часовая приёмка ещё не выполнена или не пройдена. Провал первой ступени при ограничении стенда не означает вместимость ноль или максимум четыре комнаты. Классификация сети — вывод из задержек, повторных передач и свободных ресурсов; источник помех требует сравнительного повтора.','');
for(const {version,route,name,s} of series){
 lines.push('## '+name,'');
 if(!s){lines.push('Серия ещё не завершена.','');continue;}
 lines.push(`[Итог серии](${version}-${route}-series.json).`, '',
 '| Ступень | Комнат | Итог | Обычный / тяжёлый бой: ACK p95, мс | Игра CPU p95, % ядра | HTTPS CPU p95, % ядра |',
 '|---|---:|---|---|---|---|');
 for(const r of s.results??[]){
  const a=assessed(version,route,r),n=a.profiles?.normal?.metrics,h=a.profiles?.heavy?.metrics;
  const link=`${version}-${route}-${r.rooms}-${r.label}`;
  lines.push(`| [${r.label}](${link}.json) · [секунды](${link}.samples.jsonl.gz) | ${r.rooms} | ${a.completed===false?'не завершён; ':''}${a.passed?'пройдено':why[a.cause]??a.cause??'не пройдено'}${a.reassessment?' (пересчёт)':''} | ${fmt(n?.ack?.p95)} / ${fmt(h?.ack?.p95)} | ${fmt(n?.gameCpu?.p95)} / ${fmt(h?.gameCpu?.p95)} | ${fmt(n?.httpsCpu?.p95)} / ${fmt(h?.httpsCpu?.p95)} |`);
 }
 lines.push('');
 const failed=(s.results??[]).filter(r=>!r.passed);
 for(const r of failed){
  const link=`${version}-${route}-${r.rooms}-${r.label}`;
  const reasons=[...new Set(Object.values(assessed(version,route,r).profiles??{}).flatMap(p=>(p.reasons??[]).map(x=>x.first)))];
  if(reasons.length)lines.push(`- ${r.rooms} комнат, ${r.label}: ${reasons.join('; ')}.`);
  for(const error of assessed(version,route,r).errors??[])lines.push(`- Остановка ${r.label}: ${error.message}.`);
  const reassessed=resolve(out,link+'.reassessed.json');
  if(existsSync(reassessed)){const a=read(reassessed);lines.push(`- [Отдельный пересчёт оценки](${link}.reassessed.json): ${a.passed?'пройдено':why[a.cause]??a.cause}. Исходные измерения и первоначальная оценка сохранены; это не новый прогон.`);}
 }
 if(failed.length)lines.push('');
}
lines.push('## Как читать измерения','',
 '- Каждый итог ступени содержит исходные гистограммы в секундном JSONL и p50/p95/p99 в JSON. `phaseMeasurements` отдельно показывает вход, прогрев каждого сценария, обычный и тяжёлый бой, переподключение и внесённые сбои. Вход измеряется от загрузки страницы до состава комнаты.',
 '- Процент CPU относится к одному ядру. Нагрузка генератора не приписывается VPS. Показатели трафика приложения не включают TCP/TLS-заголовки; сетевые интерфейсы и TCP-повторы записаны отдельно.',
 '- Частота симуляции берётся у вычисляющего хоста, в старой версии — у сервера. ACK означает наблюдение фактически обработанного ввода. Маршрут подтверждается игровыми кадрами в обе стороны.',
 '- Прямые соединения внутри Docker не показывают долю успешного WebRTC между реальными провайдерами. Проверки физического iPhone и домашней сети описываются отдельно в основном QA-отчёте.',
 '- Повышение рабочего лимита не входит в эту работу. Общая рекомендация должна опираться на серверный маршрут и выдерживать отказ прямых соединений.','');
writeFileSync(resolve(out,'REPORT.md'),lines.join('\n'));console.log(resolve(out,'REPORT.md'));
