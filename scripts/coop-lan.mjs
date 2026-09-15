import { networkInterfaces } from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('../',import.meta.url)));
if(Number(process.versions.node.split('.')[0])<22){console.error('Для нового мультиплеера нужен Node.js 22.12+ или 24. Установите его и повторите запуск.');process.exit(1);}
const build=spawnSync('pnpm',['build'],{stdio:'inherit'});
if(build.status!==0)process.exit(build.status??1);
console.log('\nОПЕРАЦИЯ 67 · ИГРАЕМ ВМЕСТЕ');
console.log('На компьютере: http://localhost:5179/');
console.log('Для телефона в том же Wi-Fi:');
for(const [name,entries] of Object.entries(networkInterfaces()))if(!/^(utun|tun|tap|bridge|docker|veth)/.test(name))for(const e of entries??[])if(e.family==='IPv4'&&!e.internal)console.log(`http://${e.address}:5179/`);
console.log('Нажмите «Быстрый бой» или создайте комнату с друзьями и передайте её код. Компьютер и это окно должны оставаться включёнными.\nДля игры через интернет потребуется размещение на сервере. Остановка: Control+C.\n');
const child=spawn(process.execPath,['dist-server/index.js'],{stdio:'inherit',env:{...process.env,HOST:'0.0.0.0',PORT:'5179'}});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
child.on('error',error=>{console.error(error.message);process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code??0;});
