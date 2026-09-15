// Local, static fixtures using the real UI/renderer. Excluded from the production entry.
import './style.css';import './hangar.css';import './battle-ui.css';
import { CoopSimulation } from './coop';import { GameRenderer } from './render';import { GameUI } from './ui';import { OnlineUI } from './online-ui';import type { NetworkGame } from './network';import { GameStorage } from './storage';import { BattleRecords } from './records';import { GameProfile } from './profile';import { MODULES,type ModuleId } from './modules';import { Controls } from './input';
const app=document.getElementById('app')!,s=new CoopSimulation(),r=new GameRenderer(document.getElementById('arena')!);
const storage=new GameStorage(null),records=new BattleRecords(storage),profile=new GameProfile(null),params=new URLSearchParams(location.search);
for(const [i,name] of ['Дядя Гоша','Пук пук','Лев','Командир Рома'].entries())s.addMember(-i-1,name,i);
s.start(false);s.player=s.members.get(-1)!.tank;s.localId=-1;s.player.hp=84;s.player.x=0;s.player.z=4;s.allies=[...s.members.values()].map(m=>m.tank);s.wave=3;s.score=2950;s.streak=4;s.charge=37;s.enemies=[];s.portals=[];s.drainEvents();s.breakTime=12;
for(const [i,t] of s.allies.entries()){t.x=i===0?0:i*3-6;t.z=i===0?4:0;}
const game={view:s,id:-1,state:s.state(),room:{code:'QA0001',public:false,owner:-1,round:1,countdown:null},connected:true,recovering:false,needsResume:false,status:'',error:'',awayMessage:'',presence:[],connectionNotice:'',continue(){},stop(){},enter(){},leave(){},start(){},nextWatch(){}} as unknown as NetworkGame;
let online:OnlineUI;const noop=()=>{};
const ui=new GameUI(app,storage,{start:noop,pause:()=>online.toggle(),resume:noop,restart:noop,skip:noop,mute:noop,music:noop,narrator:noop,settings:()=>ui.settings(),repeat:noop,menu:noop},profile,records,records);
online=new OnlineUI(game,app,profile,records,{gesture:noop,settings:()=>ui.settings()});
const controls=new Controls(r.renderer.domElement,r,()=>false,()=>online.toggle(),()=>r.resize());controls.setTouchMode(params.get('desktop')!=='1');document.body.classList.add('network-mode');document.body.dataset.controls='active';
const mode=params.get('case')??'break',module=(params.get('module')??'turbo') as ModuleId;
if(mode==='boss'||mode==='upgrade'){s.breakTime=0;s.wave=45;s.enemies=['factory','factory','barrier','barrier'].map((kind,i)=>s.createEnemy(kind as 'factory'|'barrier',{x:-8+i*5,z:-8}));}
if(mode==='capture'){s.wave=1;s.beginWave();s.breakTime=0;s.enemies=[];s.portals=[];}
if(mode==='upgrade') {s.player.modules=[module];ui.handle([{type:'upgrade',module,actorId:-1,x:s.player.x,z:s.player.z}],s);}
if(mode==='gallery'){s.breakTime=0;s.obstacles=[];s.player.z=9;s.pickups=[];Object.keys(MODULES).forEach((id,i)=>s.pickups.push({id:9100+i,kind:'module',module:id as ModuleId,x:(i%4-1.5)*4,z:Math.floor(i/4)*4-7,life:999}));}
if(mode==='detail'){s.breakTime=0;s.obstacles=[];s.player.z=8;s.pickups=[{id:9200,x:0,z:2,kind:'module',module,life:999}];}
if(mode==='break')s.scheduleDelivery('boss',5,0);
if(params.has('stress')){s.player.adrenaline=true;s.scheduleDelivery('boss',5,0);}
const nav=document.createElement('details');nav.style.cssText='position:fixed;z-index:60;bottom:0;left:0;background:#123849;color:white;font:10px Arial';nav.innerHTML='<summary>QA</summary>'+['break','boss','upgrade','capture','gallery','detail'].map(c=>`<a style="color:white;padding:5px" href="?case=${c}">${c}</a>`).join('')+Object.keys(MODULES).map(id=>`<a style="color:white;padding:5px" href="?case=detail&module=${id}">${id}</a>`).join('')+'<button id="qa-menu">Меню отряда</button><pre id="layout-report"></pre>';app.append(nav);document.getElementById('qa-menu')!.onclick=()=>online.toggle();
window.addEventListener('resize',()=>r.resize());let last=performance.now();
function frame(now:number){const dt=Math.min(.05,(now-last)/1000);last=now;game.state=s.state();r.render(s,dt);ui.update(s,mode==='upgrade'?0:dt,r);online.update([],r);ui.arrange(s,r);
 document.getElementById('layout-report')!.textContent=JSON.stringify({free:r.layout.free,player:r.screen(s.player),stats:r.stats()});requestAnimationFrame(frame);}
requestAnimationFrame(frame);
