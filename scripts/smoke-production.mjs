import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
export async function smoke(base,expected,{allowLocal=false}={}){
 const url=new URL(base);if(!/^[a-f0-9]{40}$/.test(expected))throw Error('Expected full commit SHA is required');
 if(url.username||url.password||url.search||url.hash||url.pathname!=='/')throw Error('Use an origin URL without credentials');
 if(url.protocol!=='https:'&&!(allowLocal&&url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)))throw Error('HTTPS required (local tests may explicitly allow loopback HTTP)');
 const get=path=>fetch(new URL(path,url),{redirect:'error',signal:AbortSignal.timeout(5000)});
 for(const path of ['/health','/ready']){const res=await get(path);if(res.status!==200)throw Error(`${path}: HTTP ${res.status}`);const body=await res.json();if(body.ok!==true||body.release?.commit!==expected)throw Error(`${path}: release identity/readiness mismatch`);}
 const page=await get('/');if(page.status!==200||!page.headers.get('content-security-policy')?.includes("script-src 'self'")||page.headers.get('x-content-type-options')!=='nosniff')throw Error('Page status or security headers failed');
 const html=await page.text();const assets=[...html.matchAll(/(?:src|href)="(\/assets\/[^"<>]+)"/g)].map(m=>m[1]);if(!assets.length)throw Error('No production assets');
 for(const asset of assets){const res=await get(asset);if(res.status!==200)throw Error('Production asset unavailable');await res.arrayBuffer();}
 for(const path of ['/api/qa','/matchmake/join/battle','/.env'])if((await get(path)).status!==404)throw Error('Unexpected public route');
 return {ok:true,commit:expected};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{console.log(JSON.stringify(await smoke(process.argv[2],process.argv[3],{allowLocal:process.argv.includes('--allow-local-http')})));}catch(e){console.error(`Smoke failed: ${e.message}`);process.exitCode=1;}
}
