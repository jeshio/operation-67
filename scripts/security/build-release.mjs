import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { NET } from '../../src/net/config.ts';
const hasGit=existsSync('.git');
const commit=hasGit?execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim():process.env.RELEASE_COMMIT;
if(!/^[a-f0-9]{40}$/.test(commit))throw Error('Invalid build commit.');
if(process.env.GITHUB_SHA&&process.env.GITHUB_SHA!==commit)throw Error('Checkout differs from GITHUB_SHA.');
const dirty=hasGit?execFileSync('git',['status','--porcelain','--untracked-files=normal'],{encoding:'utf8'}).trim().length>0:process.env.RELEASE_DIRTY!=='false';
if(process.env.CI&&dirty)throw Error('CI requires a clean checkout.');
const release={format:1,commit,dirty,protocol:NET.version,node:process.versions.node,platform:process.platform,arch:process.arch};
const serverOnly=process.argv.includes('--server-only');
if(!serverOnly){const result=spawnSync('pnpm',['exec','vite','build'],{stdio:'inherit',env:{...process.env,NODE_ENV:'production'}});if(result.status!==0)process.exit(result.status??1);}
await build({entryPoints:['server/index.ts'],bundle:true,platform:'node',format:'esm',packages:'external',alias:{'colyseus/plugins/webrtc':resolve('node_modules/colyseus/build/plugins/webrtc.mjs')},outfile:'dist-server/index.js',define:{__RELEASE_COMMIT__:JSON.stringify(commit),__RELEASE_DIRTY__:JSON.stringify(dirty)},logLevel:'info'});
mkdirSync('dist-server',{recursive:true});writeFileSync('dist-server/release.json',JSON.stringify(release,null,2)+'\n');
if(!serverOnly)writeFileSync('dist/release.json',JSON.stringify(release,null,2)+'\n');
console.log(`Build ${commit}${dirty?' (local working changes; not deployable)':''}`);
