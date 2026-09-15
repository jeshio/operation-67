import { networkInterfaces } from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
const vite = 'node_modules/vite/bin/vite.js';
if (!existsSync(vite)) { console.error('Сначала установите зависимости: pnpm install'); process.exit(1); }
// Prefer the Mac Wi-Fi interface even when a VPN owns the default route.
const hardware = process.platform === 'darwin' ? spawnSync('/usr/sbin/networksetup', ['-listallhardwareports'], { encoding: 'utf8' }).stdout ?? '' : '';
const wifi = hardware.match(/Hardware Port: (?:Wi-Fi|AirPort)\nDevice: (\S+)/)?.[1];
const addresses = Object.entries(networkInterfaces()).flatMap(([name, entries]) => (entries ?? [])
  .filter(entry => entry.family === 'IPv4' && !entry.internal && !/^(utun|tun|tap|bridge|docker|veth)/.test(name))
  .map(entry => ({ name, address: entry.address }))).sort((a,b) => Number(b.name === wifi) - Number(a.name === wifi));
if (!addresses.length) { console.error('Нет адреса локальной сети. Подключите компьютер к Wi-Fi и запустите ещё раз.'); process.exit(1); }
for (const args of [['node_modules/typescript/bin/tsc','--noEmit'], [vite,'build']]) {
  const result = spawnSync(process.execPath,args,{stdio:'inherit'});
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log('\nРОМА: ОПЕРАЦИЯ 67 — ИГРА НА ТЕЛЕФОНЕ');
console.log('Подключите телефон к тому же Wi-Fi и откройте в Safari или Chrome:');
for (const { name, address } of addresses) console.log(`  http://${address}:5178/  (${name === wifi ? 'Wi-Fi' : name})`);
console.log('Можно играть вертикально или горизонтально. Оставьте компьютер и это окно включёнными.');
console.log('Остановка: Control+C. Публикации в интернете нет.\n');
const server=spawn(process.execPath,[vite,'preview','--host','0.0.0.0','--port','5178','--strictPort'],{stdio:'inherit'});
for (const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>server.kill(signal));
server.on('error',error=>{console.error(error.message);process.exitCode=1;});
server.on('exit',(code,signal)=>{process.exitCode=signal ? 0 : code ?? 1;});
