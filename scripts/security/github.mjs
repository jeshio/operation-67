/** REST client for trusted default-branch workflows. Never log headers or response bodies. */
export async function github(path,{method='GET',body,token=process.env.GITHUB_TOKEN,fetcher=fetch,pagination=false}={}) {
  if(!path.startsWith('/')||path.includes('://'))throw Error('Invalid GitHub API path.');
  const response=await fetcher(`https://api.github.com${path}`,{method,headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'operation67-security',...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000),redirect:'error'});
  if(!response.ok)throw Error(`GitHub API ${method} failed (${response.status}).`);
  const data=response.status===204?undefined:await response.json();
  if(!pagination)return data;
  const match=/<([^>]+)>;\s*rel="next"/.exec(response.headers.get('link')??'');let next=null;
  if(match){const url=new URL(match[1]);if(url.origin!=='https://api.github.com'||url.username||url.password)throw Error('Invalid GitHub pagination origin.');next=url.pathname+url.search;}
  return {items:data,next};
}
export async function pages(path,call=github){const result=[];for(let page=1;page<=100;page++){const data=await call(`${path}${path.includes('?')?'&':'?'}per_page=100&page=${page}`);if(!Array.isArray(data))throw Error('Invalid paginated GitHub result.');result.push(...data);if(data.length<100)return result;}throw Error('GitHub pagination exceeded safety limit.');}
export async function cursorPages(path,call=github){
  const result=[],seen=new Set();let next=path+`${path.includes('?')?'&':'?'}per_page=100`;
  for(let n=0;n<100;n++){
    if(seen.has(next)||!next.startsWith('/advisories?'))throw Error('Invalid advisory cursor.');seen.add(next);
    const page=await call(next,{pagination:true});
    if(!page||!Array.isArray(page.items)||page.next!==null&&typeof page.next!=='string')throw Error('Invalid advisory page.');
    result.push(...page.items);if(!page.next)return result;next=page.next;
  }throw Error('Advisory pagination exceeded safety limit.');
}
export function repository(value=process.env.GITHUB_REPOSITORY){if(!/^[\w.-]+\/[\w.-]+$/.test(value??''))throw Error('GITHUB_REPOSITORY is required.');return value;}
