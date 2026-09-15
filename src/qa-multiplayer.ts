import type { NetworkGame } from './network';
import { autopilot } from './autopilot';
import { emptyInput, type Input } from './simulation';
import type { JoinRequest } from './protocol';
export function mountMultiplayerQA(enter:()=>void,getGame:()=>NetworkGame|undefined,stats:()=>unknown){
 let command:Input|undefined,bot=false;
 const game=()=>{const g=getGame();if(!g)throw Error('Сначала войди в комнату');return g;};
 const api={
  async join(mode:JoinRequest['mode']='quick',code?:string){enter();await game().enter({type:'join',mode,code,name:`QA ${new URLSearchParams(location.search).get('guest')??'1'}`,skin:Number(new URLSearchParams(location.search).get('guest')??1)%6});},
  state:()=>{const g=getGame();return{...g?.diagnostics(),error:g?.error,status:g?.status,state:g?.state,view:g?{player:g.view.player,bullets:g.view.bullets}:null,metrics:stats(),peers:g?[...((g as any).mesh?.links??[])].map(([id,l]:any)=>({id,pc:l.pc.connectionState,ice:l.pc.iceConnectionState,signaling:l.pc.signalingState,fast:l.fast?.readyState,reliable:l.reliable?.readyState})):[]};},
  input:(input:Partial<Input>|null)=>{command=input?{...emptyInput(),...input}:undefined;bot=false;},
  bot:(enabled=true)=>{bot=enabled;command=undefined;},start:()=>game().start(),sleep:()=>game().sleep(),wake:()=>game().wake(),resume:()=>game().continue(),leave:()=>game().leave(),crash:()=>game().stop(),
  endRound:()=>{const g=game() as any;g.host?.postMessage({type:'qa',action:'end-round'});},
  route:(route:'relay'|'direct')=>{const mesh=(game() as any).mesh;if(mesh)for(const [id,l] of mesh.links)if(route==='relay'||l.fast?.readyState==='open')mesh.setRoute(id,l,route);},
  ice:async()=>{const mesh=(game() as any).mesh;return Promise.all([...mesh.links].map(async([id,l]:any)=>({id,stats:[...(await l.pc.getStats()).values()].filter(s=>['candidate-pair','local-candidate','remote-candidate'].includes(s.type))})));},
  cutDirect:()=>{const mesh=(game() as any).mesh;if(mesh)for(const l of mesh.links.values())l.pc.close();},
 };
 Object.assign(window,{__multiplayerQA:api});
 const panel=document.createElement('details');panel.id='qa-multiplayer';panel.style.cssText='position:absolute;top:4px;left:4px;z-index:80;background:#102632ee;color:white;padding:8px;max-width:360px;font:11px monospace;max-height:45vh;overflow:auto';panel.innerHTML='<summary>Сетевая диагностика</summary>';
 const button=(name:string,fn:()=>unknown)=>{const b=document.createElement('button');b.textContent=name;b.onclick=()=>void fn();panel.append(b);};
 button('Бот',()=>api.bot(!bot));button('Через сервер',()=>api.route('relay'));button('Напрямую',()=>api.route('direct'));button('Обрыв WebRTC',api.cutDirect);
 const output=document.createElement('pre');output.style.whiteSpace='pre-wrap';panel.append(output);document.body.append(panel);
 setInterval(()=>{if(panel.open)output.textContent=JSON.stringify(getGame()?.diagnostics()??{status:'Нет комнаты'},null,2);},1000);
 return()=>{const g=getGame();return bot&&g?autopilot(g.view):command;};
}
