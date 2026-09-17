import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const config=JSON.parse(readFileSync(new URL('./tools.json',import.meta.url),'utf8'));
for(const name of ['gitleaks','actionlint']){
  const tool=config[name],target=tool[`${process.platform}-${process.arch}`];if(!target)throw Error('Unsupported scanner platform.');
  const repo=name==='gitleaks'?'gitleaks/gitleaks':'rhysd/actionlint';
  const response=await fetch(`https://github.com/${repo}/releases/download/v${tool.version}/${target.asset}`,{signal:AbortSignal.timeout(120000)});
  if(!response.ok)throw Error(`Cannot download ${name}.`);const bytes=Buffer.from(await response.arrayBuffer());
  if(createHash('sha256').update(bytes).digest('hex')!==target.sha256)throw Error(`Invalid checksum for ${name}.`);
  mkdirSync('.tools/downloads',{recursive:true});mkdirSync(`.tools/${name}`,{recursive:true});const archive=`.tools/downloads/${target.asset}`;writeFileSync(archive,bytes);
  // Extract only the expected executable from the verified upstream archive.
  execFileSync('tar',['-xzf',archive,'-C',`.tools/${name}`,name]);console.log(`Verified ${name} ${tool.version}.`);
}
