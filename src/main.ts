import { GuideView } from './guide-view';
import './style.css';
import './hangar.css';
import './battle-ui.css';
import { GameProfile } from './profile';
import { Simulation } from './simulation';
import { GameRenderer } from './render';
import { Controls } from './input';
import { GameAudio } from './audio';
import { GameStorage } from './storage';
import { BattleRecords } from './records';
import { GameUI } from './ui';
import { NetworkGame } from './network';
import { OnlineUI } from './online-ui';
import { emptyInput } from './simulation';
import { guardGameGestures, measureViewport } from './viewport';

const app = document.querySelector<HTMLElement>('#app')!;
app.innerHTML = '<div id="arena"></div>';
let backend: Storage | null = null;
try { backend = window.localStorage; } catch { /* Optional storage. */ }
const qaMode = import.meta.env.DEV && new URLSearchParams(location.search).has('qa');
const storage = new GameStorage(backend, qaMode ? 'roma-operation-67-qa' : undefined), audio = new GameAudio(storage);
const profile=new GameProfile(backend,qaMode?'roma-online-profile-qa':'roma-online-profile');
const solo=new Simulation();let simulation=solo;
const onlineStorage=new GameStorage(backend,qaMode?'roma-online-qa':'roma-online-v1');
const soloRecords = new BattleRecords(storage), onlineRecords = new BattleRecords(onlineStorage);
let soloBattle = '';
const recordSolo = () => soloRecords.observe({score:solo.score,wave:solo.wave,time:solo.elapsed,battleId:soloBattle},solo.phase);

try {
  const renderer = new GameRenderer(document.querySelector('#arena')!);
  let controls: Controls;
  let network:NetworkGame|undefined,onlineUI:OnlineUI|undefined;
  let queuedPower = false, queuedDash = false, queuedFire = false;
  let guide: GuideView; let wasAlive = true;let frameReset=true,backgrounded=false,graphicsLost=false;
  const clearInput = () => { controls?.clear(); queuedPower = queuedDash = queuedFire = false; network?.releaseInput(); };
  const saveProgress=()=>{if(network)onlineRecords.flush();else{recordSolo();soloRecords.flush();}};
  const gesture=()=>{clearInput();void audio.unlock();};
  const resume = () => { gesture();simulation.resume();frameReset=true; };
  const start = (intro: boolean) => { saveProgress();soloBattle=`solo:${Date.now()}:${Math.random().toString(36).slice(2)}`;audio.reset();gesture();simulation.start(intro);simulation.player.skin=profile.skin;frameReset=true; renderer.reset(); ui.reset(); guide?.reset(); storage.seenIntro = true; storage.save(); };
  const pause = () => { if(ui.settingsOpen){ui.settings(false);return;}if(network){onlineUI?.toggle();clearInput();if(onlineUI?.blocked)audio.pause();else audio.resume();return;} if (simulation.phase === 'paused') { resume(); } else if (simulation.phase === 'playing' || simulation.phase === 'intro' || simulation.phase === 'dying') { simulation.pause(); audio.pause(); } clearInput(); };
  const ui = new GameUI(app, storage, {
    start: () => start(true), restart: () => start(false), pause,
    resume,
    settings:()=>{clearInput();if(network)onlineUI?.toggle(true);else simulation.pause();audio.pause();ui.settings(true,!network&&simulation.phase==='menu');},
    repeat:()=>guide.repeat(),
    menu:()=>{saveProgress();clearInput();simulation.phase='menu';renderer.reset();ui.reset();audio.reset();guide.reset();},
    skip: () => simulation.skipIntro(),
    music: () => { storage.musicMuted = !storage.musicMuted; storage.save(); audio.setOptions(storage); ui.sound(); },
    narrator: () => { storage.narratorMuted = !storage.narratorMuted; storage.save(); audio.setOptions(storage); ui.sound(); },
    mute: () => { storage.muted = !storage.muted; storage.save(); audio.setOptions(storage); ui.sound(); },
  },profile,soloRecords,onlineRecords);
  guide = new GuideView(app,backend,qaMode?'roma-guide-qa-v2':'roma-guide-v2');
  const suspend = () => { saveProgress();if(network)onlineUI?.toggle(true);else simulation.pause(); clearInput(); audio.pause();frameReset=true; };
  const hide=()=>{if(backgrounded)return;backgrounded=true;suspend();network?.sleep();};
  const wake=()=>{if(!backgrounded)return;backgrounded=false;frameReset=true;network?.wake();layoutPending=true;};
  let viewport = measureViewport(document.documentElement.clientWidth,window.innerHeight,window.visualViewport);
  let layoutPending = true;
  const syncOrientation = () => { layoutPending=true; };
  const applyViewport = () => {
    if (!layoutPending) return;
    layoutPending=false;
    const next=measureViewport(document.documentElement.clientWidth,window.innerHeight,window.visualViewport,viewport);
    if (controls?.touchMode && (next.width>=next.height)!==(viewport.width>=viewport.height)) suspend();
    viewport=next;
    app.style.setProperty('--app-width',`${viewport.width}px`);
    app.style.setProperty('--app-height',`${viewport.height}px`);
    renderer.resize();
  };
  controls = new Controls(renderer.renderer.domElement, renderer, () => simulation.phase === 'playing' && simulation.player.hp>0 && !backgrounded&&!ui.settingsOpen&&(!network || !onlineUI?.blocked), pause, syncOrientation);
  if (qaMode && new URLSearchParams(location.search).has('touch')) controls.setTouchMode(true);
  applyViewport();
  guardGameGestures(app,()=>!ui.settingsOpen&&(!network||!onlineUI?.blocked)&&['playing','intro','dying'].includes(simulation.phase));
  window.addEventListener('blur', suspend);
  document.addEventListener('visibilitychange', () => { if(document.hidden)hide();else wake(); });
  window.addEventListener('pagehide',hide);window.addEventListener('pageshow',wake);
  window.addEventListener('resize', syncOrientation);
  window.visualViewport?.addEventListener('resize',syncOrientation);
  window.addEventListener('orientationchange', () => { if (controls.touchMode) suspend(); });
  let graphicsNotice:HTMLElement|undefined;
  renderer.renderer.domElement.addEventListener('webglcontextlost',e=>{
    e.preventDefault();graphicsLost=true;suspend();if(graphicsNotice)return;
    graphicsNotice=document.createElement('section');graphicsNotice.className='error-card';graphicsNotice.id='graphics-recovery';
    graphicsNotice.innerHTML='<h2>Восстанавливаем графику…</h2><p>Если арена не вернулась, обнови страницу.</p><button class="primary-button">Обновить игру</button>';
    graphicsNotice.querySelector('button')!.onclick=()=>location.reload();app.append(graphicsNotice);
  });
  renderer.renderer.domElement.addEventListener('webglcontextrestored',()=>{graphicsLost=false;graphicsNotice?.remove();graphicsNotice=undefined;resetPresentation();renderer.resize();});
  const resetPresentation=()=>{clearInput();audio.reset();ui.reset();guide.reset();renderer.reset();frameReset=true;};
  let networkAudioBlocked=true;
  let previous = performance.now(), accumulator = 0, frameCount = 0, sampleTime = previous, fps = 60;
  renderer.renderer.setAnimationLoop(now => {
    if(backgrounded||document.hidden){previous=now;accumulator=0;return;}
    applyViewport();
    if(frameReset){previous=now;accumulator=0;sampleTime=now;frameCount=0;frameReset=false;}
    const dt = Math.min((now - previous) / 1000, 0.1); previous = now;
    const input = controls.read(simulation.player); queuedPower ||= input.power; queuedDash ||= !!input.dash; queuedFire ||= !!input.firePressed;
    accumulator += dt;
    while (accumulator >= 1 / 60) {
      if(network){network.step(ui.settingsOpen||onlineUI?.blocked||simulation.player.hp<=0?{...emptyInput(),aim:input.aim}:{...input,power:queuedPower,dash:queuedDash,firePressed:queuedFire});queuedPower=queuedDash=queuedFire=false;accumulator-=1/60;continue;}
      if (simulation.phase!=='paused' && simulation.phase!=='over') renderer.captureMotion(simulation);
      simulation.update(1 / 60, { ...input, power: queuedPower, dash: queuedDash, firePressed: queuedFire }); queuedPower = false; queuedDash = false; queuedFire = false; accumulator -= 1 / 60;
    }
    if(network)network.render(dt,accumulator*60);else recordSolo();
    const alive=simulation.player.hp>0;if(alive!==wasAlive){clearInput();wasAlive=alive;}
    if(network){const blocked=ui.settingsOpen||!!onlineUI?.blocked;if(blocked!==networkAudioBlocked){networkAudioBlocked=blocked;if(blocked)audio.pause();else audio.resume();}}
    const events = network?network.events.splice(0):simulation.drainEvents(); renderer.handle(events,simulation); if(!ui.settingsOpen&&(!network||!onlineUI?.blocked)){audio.handle(events, simulation);audio.update(simulation);} ui.handle(events,simulation);guide.handle(events,simulation);
    renderer.hangar(profile.skin,!network&&simulation.phase==='menu'?document.querySelector<HTMLElement>('#hangar-preview')!.getBoundingClientRect():undefined);
    const controllable=simulation.phase==='playing'&&alive&&!ui.settingsOpen&&(!network||!onlineUI?.blocked);
    renderer.aimAllowed=controllable;renderer.aiming=controllable&&(controls.aiming||!!input.firePressed);
    if(!graphicsLost)renderer.render(simulation, dt, network?1:accumulator*60); ui.update(simulation, dt, renderer);onlineUI?.update(events,renderer);
    ui.audioRecovery(audio.needsAction,()=>{void audio.retry();});
    document.body.dataset.controls=controllable?'active':'inactive';
    guide.update(simulation,dt,renderer,controllable&&!ui.noticeBusy);
    ui.arrange(simulation,renderer);
    frameCount++; if (now - sampleTime > 1000) { fps = frameCount * 1000 / (now - sampleTime); frameCount = 0; sampleTime = now; }
  });
  const onlineButton=document.querySelector<HTMLButtonElement>('#online-entry')!;
  const enterOnline=(mode:'friends'|'quick'='friends')=>{
    if(network)return;saveProgress();clearInput();audio.reset();audio.unlock();document.body.classList.add('network-mode');
    const suffix=qaMode?new URLSearchParams(location.search).get('guest')??'qa':'';
    network=new NetworkGame(backend,`roma-online-token${suffix}`);simulation=network.view;ui.reset();renderer.reset();renderer.resize();
    onlineUI=new OnlineUI(network,app,profile,onlineRecords,{gesture,settings:()=>{clearInput();onlineUI?.toggle(true);audio.pause();ui.settings();}});
    network.onSnapshot=(state,room)=>onlineRecords.observe({score:state.score,wave:state.wave,time:state.elapsed,battleId:`${room.code}:${room.round}`,team:state.players.map(p=>p.name)},state.phase);
    network.onRound=resetPresentation;network.onRestore=resetPresentation;
    network.onControlReset=clearInput;
    network.onConnectionLoss=()=>{clearInput();audio.pause();onlineUI?.toggle(true);frameReset=true;};
    network.onLeave=()=>{if(!network)return;onlineRecords.flush();const u=new URL(location.href);u.searchParams.delete('room');history.replaceState(null,'',u);ui.settings(false);onlineUI?.destroy();onlineUI=undefined;network?.stop();network=undefined;simulation=solo;simulation.phase='menu';ui.reset();document.body.classList.remove('network-mode');renderer.reset();renderer.resize();clearInput();audio.reset();guide.reset();};
    if(mode==='quick')onlineUI.requestJoin({mode:'quick'});
  };
  onlineButton.onclick=()=>enterOnline();
  document.querySelector<HTMLButtonElement>('#quick-entry')!.onclick=()=>enterOnline('quick');
  if(new URLSearchParams(location.search).has('room'))enterOnline();
  // Only local development with an explicit query exposes controls for integration QA.
  if (import.meta.env.DEV && qaMode) {
    void import('./qa').then(({ mountQA }) => mountQA(simulation, renderer, start, () => ({ fps: +fps.toFixed(1), ...renderer.stats(), audio: audio.stats() }), controls,()=>{onlineUI?.toggle(false);return network;}));
  }
} catch (error) {
  console.error(error);
  app.innerHTML = '<section class="error-card"><span class="kicker">ОПЕРАЦИЯ 67</span><h1>Танку нужна 3D-графика</h1><p>Не удалось запустить WebGL 2. Открой игру в современном Safari или Chrome. На компьютере проверь, что аппаратное ускорение включено.</p><button onclick="location.reload()" class="primary-button">ПОПРОБОВАТЬ ЕЩЁ РАЗ</button></section>';
}
