// The former raw WebSocket protocol has been replaced completely.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const result=spawnSync(process.execPath,['--import','tsx',fileURLToPath(new URL('./check-network-client.mjs',import.meta.url)),...process.argv.slice(2),'--players=4'],{stdio:'inherit'});
process.exitCode=result.status??1;
