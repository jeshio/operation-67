import { readFileSync, readdirSync, lstatSync, realpathSync } from 'node:fs';
import { resolve, join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
export function verifyBuild(root=process.cwd()) {
  const client=JSON.parse(readFileSync(join(root,'dist/release.json'),'utf8')),server=JSON.parse(readFileSync(join(root,'dist-server/release.json'),'utf8'));
  if(JSON.stringify(client)!==JSON.stringify(server)||client.format!==1||!/^[a-f0-9]{40}$/.test(client.commit)||typeof client.dirty!=='boolean')throw Error('Client/server release identity mismatch.');
  const prohibited=/(?:^|\/)(?:\.[^/]+|credentials[^/]*|secrets[^/]*|qa[^/]*\.html|qa-panel[^/]*|[^/]+\.(?:map|pem|key|p12|pfx|sql|dump))$/i;
  for(const directory of ['dist','dist-server']) {
    const base=realpathSync(join(root,directory));
    const walk=dir=>{for(const name of readdirSync(dir)){const file=join(dir,name),rel=relative(base,file).split(sep).join('/'),s=lstatSync(file);
      if(prohibited.test(rel)||s.isSymbolicLink())throw Error(`Unexpected build artifact: ${directory}/${rel}`);
      if(s.isDirectory())walk(file);
      else if(!s.isFile())throw Error('Unsupported artifact entry.');
      else if(name.endsWith('.js')&&directory==='dist'&&/__multiplayerQA|__capacityQA|__touchQA|__networkQA/.test(readFileSync(file,'utf8')))throw Error('QA control found in production client.');
    }};walk(base);
  }
  const html=readFileSync(join(root,'dist/index.html'),'utf8');
  if(/\son[a-z]+\s*=/i.test(html)||/<script(?![^>]*\bsrc=)/i.test(html))throw Error('Inline script found in production HTML.');
  return client;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){const r=verifyBuild(process.argv[2]);console.log(`Artifact checks passed: ${r.commit}; dirty=${r.dirty}`);}
