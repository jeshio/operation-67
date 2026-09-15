import { MODULES } from './modules';
import { UpgradeNotice, MODULE_DETAILS, moduleIcon } from './upgrade-notice';
import { moduleList } from './module-ui';
import { SKINS } from './coop';
import { hitFeedback } from './feedback';
import { GameProfile, NAME_ERROR } from './profile';
import { CONFIG as C, BALANCE as B, ENEMY_META } from './config';
import { CALLOUTS } from './announcer';
import { groupThreats, inside, edgePoint } from './view';
import type { GameRenderer } from './render';
import { bossCaption, planWave } from './waves';
import type { Simulation, GameEvent } from './simulation';
import type { GameStorage } from './storage';
import { BattleRecords, recordSummary } from './records';
export const formatTime = (seconds: number) => `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
const number = (n: number) => Math.floor(n).toLocaleString('ru-RU');
export class GameUI {
  private el: Record<string, HTMLElement> = {}; private toastTime = 0; private dialogueTime = 0; private waveTime = 0; private lastPhase = ''; private isRecord = false; private achievementTime = 0; private damageFlash = 0; private damageTime=0;private damageDuration=.3; private shieldFlash = 0;
  private settingsFocus?:HTMLElement;
  private upgrades=new UpgradeNotice(); private upgradeMarkup='';
  get noticeBusy(){return this.upgrades.waiting||this.toastTime>0||this.lastStandUntil>0||this.achievementTime>0||this.waveTime>0;}

  private shots = new Map<number, number>();
  private markerEls: HTMLElement[] = [];
  private lastStandUntil = 0; private lastStandActor?: number; private bossMarkup = '';
  constructor(private root: HTMLElement, private storage: GameStorage, actions: { start: () => void; pause: () => void; resume: () => void; restart: () => void; skip: () => void; mute: () => void; music: () => void; narrator: () => void; settings:()=>void; repeat:()=>void; menu:()=>void }, private profile:GameProfile, private soloRecords:BattleRecords, private onlineRecords:BattleRecords) {
    root.insertAdjacentHTML('beforeend', `
      <div id="vignette" aria-hidden="true"></div><div id="damage-flash" aria-hidden="true"></div><div id="shield-flash" aria-hidden="true"></div>
      <header class="topbar">
        <div class="brand"><span class="brand-mark">67</span><div><b>${C.player.firstName.toUpperCase()}<span class="brand-slash"> / </span>ОПЕРАЦИЯ 67</b><span class="location">${C.city.toUpperCase()} <span>—</span> ${C.sector.toUpperCase()}</span></div></div>
        <div class="top-right"><div id="run-stats" class="run-stats" hidden><div><span class="eyebrow">ВОЛНА</span><b id="wave">01</b></div><div><span class="eyebrow">ОЧКИ</span><b id="score">0</b></div><div class="streak-stat"><span class="eyebrow">СЕРИЯ</span><b id="streak">0</b></div><span id="time" class="timer">00:00</span></div><button id="pause" class="icon-button" title="Пауза · Esc" aria-label="Пауза" hidden>Ⅱ</button></div>
      </header>
      <section id="menu" class="hangar-menu">
        <header class="hangar-header"><div class="hangar-logo"><span>67</span><div>ОПЕРАЦИЯ<br><small>АНГАР БРАТЬЕВ</small></div></div><button id="menu-settings" class="gear-button" aria-label="Настройки">⚙</button></header>
        <div class="hangar-body"><div class="hangar-display"><div id="hangar-preview" aria-label="Предпросмотр выбранного танка"><span>СЕКТОР 67 <i>•</i> ХАНТЫ-МАНСИЙСК</span></div>
          <div class="hangar-skins"><div class="skin-heading"><span>ТВОЙ ТАНК</span><b id="skin-name"></b></div><div id="skin-picker">${SKINS.map((skin,i)=>`<button data-skin="${i}" style="--paint:#${skin.color.toString(16).padStart(6,'0')}" aria-label="${skin.name}" title="${skin.name}"><span class="skin-swatch"></span><i>✓</i></button>`).join('')}</div></div></div>
          <div class="hangar-actions"><div class="hangar-welcome"><span class="kicker">ЭКИПАЖ НА МЕСТЕ</span><h1>Готов к<br>приключениям?</h1><p>Рома и Лев. Один отряд.</p></div><button id="quick-entry" class="primary-button">Быстрый бой</button><button id="online-entry" class="secondary-button">Комната с друзьями</button><div class="menu-records"><div><span>Рекорд в отряде</span><b id="menu-online-record">Пока нет</b></div></div></div>
        </div>
      </section>
      <div id="settings" class="settings-backdrop" hidden><section class="settings-card" role="dialog" aria-modal="true" aria-labelledby="settings-title"><header><h2 id="settings-title">Настройки</h2><button id="settings-close" class="gear-button" aria-label="Закрыть настройки">×</button></header><form id="settings-profile" class="profile-field" novalidate><label for="settings-name">Имя в отряде</label><div class="name-edit"><input id="settings-name" maxlength="16" autocomplete="nickname" aria-describedby="settings-name-hint settings-name-error"><button class="text-button" type="submit">Сохранить</button></div><small id="settings-name-hint">Для следующего входа в комнату</small><small id="settings-name-error" class="field-error" role="status"></small></form><div class="settings-channels"><button id="sound"><span>Эффекты</span><i></i></button><button id="music"><span>Музыка</span><i></i></button><button id="narrator"><span>Диктор</span><i></i></button></div><button id="settings-guide" class="secondary-button">Повторить подсказки</button><small id="settings-note" role="status"></small><section id="settings-solo" class="settings-solo"><h3>Одиночная игра</h3><div class="menu-records"><div><span>Одиночный рекорд</span><b id="menu-record">Пока нет</b></div></div><button id="start" class="secondary-button">Играть одному</button></section></section></div>
      <button id="audio-retry" hidden>Включить звук</button>
      <div id="intro" class="intro-caption" hidden><span class="eyebrow">СЕКРЕТНЫЙ АНГАР · ДОСТУП ОТКРЫТ</span><h2>Экипаж братьев — на выезд.</h2><button id="skip" class="text-button">Пропустить вступление</button></div>
      <div id="boss-bars" class="boss-bars" hidden></div><div id="objective" class="objective" hidden><div class="objective-heading"><span id="point-arrow">↑</span><b id="point-name"></b></div><span id="point-status"></span><div class="objective-track"><i id="point-fill"></i></div><small id="point-help"></small></div><div id="achievement" class="achievement" aria-live="polite" hidden><small id="achievement-kicker">СЕРИЯ БРАТЬЕВ</small><b id="achievement-title"></b><span id="achievement-sub"></span></div>
      <div id="wave-banner" class="wave-banner" hidden><span id="wave-kicker">ПРИГОТОВЬСЯ</span><b id="wave-title">ВОЛНА 01</b></div>
      <div id="power-banner" class="power-banner" hidden>SIX <span>SEVEN</span><small>ДВОЙНЫЕ ПУШКИ · ЩИТ АКТИВЕН</small></div>
      <div id="dialogue" class="dialogue" aria-live="polite" hidden><span class="radio-icon">02</span><div><b>${C.lev.firstName.toUpperCase()}</b><p id="dialogue-text"></p></div></div>
      <div id="hud" class="bottom-hud" hidden>
        <section class="health-panel"><div class="panel-heading"><span class="eyebrow">${C.player.name} <span class="dim">/ БРОНЯ</span></span><b><span id="hp">100</span><span class="dim"> / <span id="max-hp">100</span></span></b></div><div class="health-track"><div id="health-fill"></div></div><div class="lev-status"><span>${C.lev.name} · РЕМОНТ</span><b id="heal-status">ГОТОВ</b></div><div class="dash-status"><span><kbd>SHIFT</kbd> РЫВОК</span><b id="dash-status">ГОТОВ</b></div></section>
        <div id="hint" class="control-hint"><span><kbd>W A S D</kbd> движение</span><span><kbd>МЫШЬ</kbd> прицел и огонь</span><span><kbd>ПРОБЕЛ</kbd> режим 67</span><span><kbd>SHIFT</kbd> рывок и защита</span></div>
        <section id="power-panel" class="power-panel"><div class="power-number" id="charge">0<span>/67</span></div><div class="power-copy"><span class="eyebrow" id="power-label">ЗАРЯД ХАОСА</span><b id="power-action">Попадай. Копи. Удивляй.</b><div class="power-track"><div id="power-fill"></div></div></div><kbd id="power-key">ПРОБЕЛ</kbd></section>
      </div>
      <div id="break-note" class="break-note" hidden></div>
      <div id="modal" class="modal-backdrop" hidden><section class="modal-card" role="dialog" aria-modal="true" aria-labelledby="modal-title"><span id="modal-kicker" class="kicker">ПЕРЕДЫШКА</span><h2 id="modal-title">Бой на паузе</h2><p id="modal-copy">Экипаж ждёт тебя.</p><div id="result-stats" class="result-stats" hidden></div><p id="solo-supply" class="supply-cooldown"></p><details id="solo-modules" class="module-list"><summary></summary><ul></ul></details><button id="resume" class="primary-button">ПРОДОЛЖИТЬ</button><button id="restart" class="secondary-button">Ещё бой</button><button id="pause-settings" class="secondary-button">Настройки</button><button id="solo-menu" class="text-button">Выйти в главное меню</button><span id="pause-hint" class="modal-footnote">ESC — вернуться в бой</span></section></div>
      <div id="touch-controls" class="touch-controls" aria-label="Сенсорное управление">
        <div id="move-stick" class="stick move-stick" data-touch-action="move" role="group" aria-label="Левый стик — движение"><span class="stick-thumb"></span><small>ДВИЖЕНИЕ</small></div>
        <div id="aim-stick" class="stick aim-stick" data-touch-action="aim" role="group" aria-label="Правый стик — башня и огонь"><span class="stick-thumb"></span><small>БАШНЯ · ОГОНЬ</small></div>
        <div class="touch-abilities"><button id="touch-dash" data-touch-action="dash" aria-label="Рывок"><b><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19 19 5M7 5h12v12" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg></b><small id="touch-dash-value">РЫВОК</small></button><button id="touch-power" data-touch-action="power" aria-label="SIX SEVEN"><b>67</b><small id="touch-power-value">0 / 67</small><span class="ability-caption">УСИЛЕНИЕ</span></button></div>
      </div>
      <div id="last-stand" role="status" hidden></div><div id="support-status" class="support-status" hidden></div><div id="adrenaline-status" hidden>АДРЕНАЛИН <span>УРОН +30% · СКОРОСТЬ +25%</span></div><div id="supply-marker" class="edge-marker supply-marker" hidden><i>↑</i><b>+</b></div>
      <div id="edge-markers" aria-hidden="true"></div><div id="point-marker" class="edge-marker point-marker" hidden><i>↑</i><b>⚑</b></div>

    `);
    root.insertAdjacentHTML('beforeend', `<div id="battle-stack" hidden><div id="squad-slot"></div><div id="context-slot"></div><div id="notice-slot"><aside id="upgrade-notice" role="status" hidden><div id="upgrade-icon"></div><div class="upgrade-copy"><small>УСТАНОВЛЕНО · ДО КОНЦА БОЯ</small><b id="upgrade-title"></b><p id="upgrade-detail"></p></div><i id="upgrade-progress"></i></aside></div><div id="guide-slot"></div><div id="feed-slot"></div></div>`);
    for (const e of root.querySelectorAll<HTMLElement>('[id]')) this.el[e.id] = e;
    for(const id of ['boss-bars','objective','break-note','support-status','adrenaline-status'])this.el['context-slot'].append(this.el[id]);
    for(const id of ['last-stand','power-banner','achievement','wave-banner','dialogue'])this.el['notice-slot'].append(this.el[id]);
    for (const [id, fn] of Object.entries({ start: ()=>{this.settings(false);actions.start();}, pause: actions.pause, resume: actions.resume, restart: actions.restart, skip: actions.skip, sound: actions.mute, music: actions.music, narrator: actions.narrator, "menu-settings":actions.settings,"pause-settings":actions.settings,"solo-menu":actions.menu })) this.el[id].addEventListener('click', () => { fn(); if (id !== 'pause') this.el[id].blur(); });
    this.el['settings-close'].onclick=()=>this.settings(false);
    this.el['settings-profile'].onsubmit=e=>{e.preventDefault();const input=this.el['settings-name'] as HTMLInputElement;
      const ok=profile.rename(input.value);input.setAttribute('aria-invalid',String(!ok));
      this.el['settings-name-error'].textContent=ok?'Имя сохранено':NAME_ERROR;if(ok)input.value=profile.name;
    };
    this.el['settings-name'].oninput=()=>{this.el['settings-name-error'].textContent='';this.el['settings-name'].removeAttribute('aria-invalid');};
    this.el['settings-guide'].onclick=()=>{actions.repeat();this.el['settings-note'].textContent='Подсказки появятся в следующем бою';};
    this.el['skin-picker'].querySelectorAll<HTMLElement>('[data-skin]').forEach(b=>b.onclick=()=>{profile.select(Number(b.dataset.skin));this.paintProfile();});this.paintProfile();
    this.el['modal'].addEventListener('keydown', e => {
      if (e.key !== 'Tab') return;
      const buttons = [...this.el.modal.querySelectorAll<HTMLButtonElement>('button')].filter(b => !b.hidden); const first = buttons[0], last = buttons[buttons.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    for (let i=0;i<8;i++) { const marker=document.createElement('div'); marker.className='edge-marker';marker.hidden=true;marker.innerHTML='<i>↑</i><b></b><small></small>';this.el['edge-markers'].append(marker);this.markerEls.push(marker); }
    this.refreshRecords(); this.sound();
  }
  get settingsOpen(){return !this.el.settings.hidden;}
  settings(open=true,allowSolo=false){if(open)this.settingsFocus=document.activeElement as HTMLElement;this.el.settings.hidden=!open;for(const child of this.root.children)if(child instanceof HTMLElement&&child.id!=='settings'&&child.id!=='audio-retry')child.inert=open;document.body.classList.toggle('settings-open',open);if(open){this.sound();this.refreshRecords();this.el['settings-solo'].hidden=!allowSolo;(this.el['settings-name'] as HTMLInputElement).value=this.profile.nameConfirmed?this.profile.name:'';this.el['settings-name-error'].textContent='';this.el['settings-name'].removeAttribute('aria-invalid');this.el['settings-note'].textContent='';this.el['settings-close'].focus();}else this.settingsFocus?.focus();}
  paintProfile(){this.el['skin-name'].textContent=SKINS[this.profile.skin].name;this.el['skin-picker'].querySelectorAll<HTMLElement>('[data-skin]').forEach(b=>b.setAttribute('aria-pressed',String(Number(b.dataset.skin)===this.profile.skin)));}
  audioRecovery(needed:boolean,retry:()=>void){this.el['audio-retry'].hidden=!needed;this.el['audio-retry'].onclick=retry;}
  private refreshRecords(){this.text('menu-record',recordSummary(this.soloRecords.storage.record));this.text('menu-online-record',recordSummary(this.onlineRecords.storage.record));}
  private show(id: string, visible: boolean) { this.el[id].hidden = !visible; }
  private text(id: string, value: string) { if (this.el[id].textContent!==value) this.el[id].textContent=value; }
  sound() {
    for (const [id, muted, name] of [['sound', this.storage.muted, 'эффекты'], ['music', this.storage.musicMuted, 'музыку'], ['narrator', this.storage.narratorMuted, 'диктора']] as const) {
      const button = this.el[id]; button.setAttribute('aria-label', `${muted ? 'Включить' : 'Выключить'} ${name}`); button.title = button.getAttribute('aria-label')!; button.setAttribute('aria-pressed', String(!muted)); button.classList.toggle('muted', muted);
    }
  }
  reset() { this.upgrades.reset();this.upgradeMarkup='';this.show('upgrade-notice',false);this.lastStandUntil=0;this.show('last-stand',false);this.shots.clear(); for(const marker of this.markerEls)marker.hidden=true; this.show('point-marker',false); this.lastPhase = ''; this.isRecord = false; this.achievementTime = this.damageFlash = this.damageTime = this.shieldFlash = 0;this.el['damage-flash'].style.opacity='0';this.el['shield-flash'].style.opacity='0'; this.dialogueTime = this.waveTime = this.toastTime = 0; this.show('dialogue', false); this.show('power-banner', false); this.show('wave-banner', false); }
  handle(events: GameEvent[],sim?:Simulation) {
    this.upgrades.accept(events,sim?.localId??0,!!sim?.network);
    for(const e of events)if(e.type==='lastStand'){this.lastStandUntil=3;this.lastStandActor=e.actorId;this.el['last-stand'].textContent=e.text??'ВСЯ НАДЕЖДА НА ТЕБЯ!';}
    const awards = events.filter(e => e.type === 'achievement' && e.callout).sort((a, b) => CALLOUTS[b.callout!].priority - CALLOUTS[a.callout!].priority);
    if (awards[0]) { const e = awards[0]; this.achievementTime = 2.5; this.el['achievement-title'].textContent = e.text!; this.el.achievement.dataset.level = e.callout; this.el['achievement-sub'].textContent = e.callout === 'legend' ? 'РОМА И ЛЕВ' : e.callout === 'six' ? '6 ВРАГОВ · 7 СЕКУНД' : ''; this.el['achievement-kicker'].textContent = ['steel', 'unstoppable', 'master', 'legend'].includes(e.callout!) ? 'СЕРИЯ БРАТЬЕВ · БЕЗ УРОНА' : 'ОПЕРАЦИЯ 67'; }
    for (const e of events) {
      if(e.type==='shot' && e.owner==='enemy' && e.source!==undefined) this.shots.set(e.source,.45);
      if(e.type==='hit'&&e.target===0){const impact=hitFeedback(e,sim?.player.hp,sim?.player.maxHp);this.damageFlash=Math.max(this.damageFlash,impact.opacity);this.damageTime=this.damageDuration=impact.duration;}
      if (e.type === 'shield' && e.target === 0) this.shieldFlash = 0.45;
      if (e.text && ['line', 'heal', 'ready', 'power'].includes(e.type)) { this.el['dialogue-text'].textContent = document.body.classList.contains('portrait-mode') ? this.shortLine(e) : e.text; this.dialogueTime = document.body.classList.contains('portrait-mode') ? 2 : 4; this.show('dialogue', true); }
      if (e.type === 'power') { this.toastTime = 1.8; this.show('power-banner', true); }
      if (e.type === 'wave') { this.el['wave-title'].textContent = `ВОЛНА ${e.text!.padStart(2, '0')}`; this.el['wave-kicker'].textContent = planWave(Number(e.text)).bosses.length ? bossCaption(planWave(Number(e.text)).bosses) : planWave(Number(e.text)).captureIndex !== null ? 'ЗАХВАТ И УДЕРЖАНИЕ' : 'ДЕРЖИ ОБОРОНУ'; this.waveTime = 2; this.show('wave-banner', true); }
    }
  }
  private shortLine(event: GameEvent) {
    const text=event.text ?? '';
    if(event.type==='heal')return 'Броня восстановлена!';
    if(event.type==='ready')return 'Рома, жми 67!';
    if(event.type==='power')return 'Вот это SIX SEVEN!';
    if(text.includes('Захватим'))return 'На точку! Я прикрою.';
    if(text.includes('стрелк'))return 'Стрелки! Держись укрытий.';
    if(text.includes('Большой'))return 'Босс! Береги усиление.';
    if(text.includes('на подходе'))return 'Босс на подходе! Готовь 67.';
    if(text.includes('Первая волна'))return 'Первая волна — наша!';
    if(text.includes('Следующая волна'))return 'Чисто! Готовься.';
    return text.length>38 ? `${text.slice(0,35)}…` : text;
  }
  private markers(sim: Simulation, renderer: GameRenderer, dt: number) {
    if(sim.phase!=='paused' && sim.phase!=='over')for(const [id,time] of this.shots) { if(time<=dt)this.shots.delete(id);else this.shots.set(id,time-dt); }
    const layout=renderer.layout, playing=sim.phase==='playing';
    for(const marker of this.markerEls)marker.hidden=true;
    this.show('point-marker',false);this.show('supply-marker',false);
    const destination=sim.deliveries.find(d=>!d.landed)??sim.deliveries[0];
    if(playing&&destination){
      const target=renderer.screen(destination),r=layout.free,touch=document.body.classList.contains('touch-mode');
      const panelsBottom=Math.max(0,...['boss-bars','objective','support-status','adrenaline-status','break-note'].filter(id=>!this.el[id].hidden).map(id=>this.el[id].getBoundingClientRect().bottom));
      const rect={left:layout.portrait?r.left+14:touch?150:40,right:layout.portrait?r.right-14:layout.width-(touch?180:40),top:Math.max(r.top+14,panelsBottom+20,70),bottom:layout.portrait?r.bottom-14:layout.height-(touch?100:160)};
      rect.top=Math.min(rect.top,rect.bottom-40);
      if(!inside(target,rect)){
        const origin=renderer.screen(sim.focus??sim.player),p=edgePoint(target,origin,rect),el=this.el['supply-marker'];el.hidden=false;el.style.left=`${p.x}px`;el.style.top=`${p.y}px`;
        el.querySelector('i')!.style.transform=`rotate(${Math.atan2(target.y-origin.y,target.x-origin.x)+Math.PI/2}rad)`;
      }
    }
    if(!layout.portrait || !playing)return;
    const origin=renderer.screen(sim.player);
    const threats=[...sim.enemies.map(e=>({...renderer.screen(e),id:e.id,boss:ENEMY_META[e.kind].tier!=='regular',attacking:e.state==='windup'||e.state==='execute'||this.shots.has(e.id)||sim.hazards.some(h=>h.source===e.id&&h.delay>0),portal:false})),...sim.portals.map(p=>({...renderer.screen(p),id:p.id,boss:ENEMY_META[p.kind].tier!=='regular',attacking:false,portal:true}))];
    for(const marker of groupThreats(threats,origin,layout.free)) {
      const el=this.markerEls[marker.sector];el.hidden=false;el.style.left=`${marker.x}px`;el.style.top=`${marker.y}px`;
      el.classList.toggle('attacking',marker.attacking);el.classList.toggle('boss',marker.boss);el.classList.toggle('portal',marker.portal);
      el.querySelector('i')!.style.transform=`rotate(${marker.angle+Math.PI/2}rad)`;
      el.querySelector('b')!.textContent=marker.boss?'◆':marker.portal?'!':'';
      el.querySelector('small')!.textContent=marker.count>1?String(marker.count):'';
    }
    if(sim.capture && sim.capture.status!=='complete') {
      const target=renderer.screen(sim.capture);
      if(!inside(target,layout.free)) {
        // The point uses an inner border so its flag never hides a threat marker.
        const r=layout.free, gap=Math.min(26,(r.bottom-r.top)/4,(r.right-r.left)/4), inner={left:r.left+gap,right:r.right-gap,top:r.top+gap,bottom:r.bottom-gap};
        const p=edgePoint(target,origin,inner), el=this.el['point-marker'];el.hidden=false;el.style.left=`${p.x}px`;el.style.top=`${p.y}px`;
        el.querySelector('i')!.style.transform=`rotate(${Math.atan2(target.y-origin.y,target.x-origin.x)+Math.PI/2}rad)`;
      }
    }
  }
  update(sim: Simulation, dt: number, renderer: GameRenderer) {
    if(sim.phase==='menu')this.refreshRecords();
    if(sim.phase==='playing')for(const [id,time] of this.shots){if(time<=dt)this.shots.delete(id);else this.shots.set(id,time-dt);}

    const playerScreen=renderer.screen(sim.player);
    const noticeY=Math.max(renderer.layout.free.top+10,Math.min(renderer.layout.free.bottom-70,playerScreen.y-112));
    document.body.style.setProperty('--notice-y',`${noticeY}px`);
    const playing = sim.phase === 'playing', intro = sim.phase === 'intro';
    const alive=sim.player.hp>0;document.body.classList.toggle('tank-dead', !alive);
    this.text('pause',sim.network?'Меню':'Ⅱ');this.el.pause.setAttribute('aria-label',sim.network?'Меню':'Пауза');this.el.pause.title=sim.network?'Меню · Esc':'Пауза · Esc';
    if(playing)this.lastStandUntil=Math.max(0,this.lastStandUntil-dt);
    const survivor=sim.allies?.find(t=>t.id===this.lastStandActor&&t.hp>0);
    this.show('last-stand',playing&&this.lastStandUntil>0&&!!survivor);
    if(survivor){const p=renderer.screen(survivor);this.el['last-stand'].style.left=`${Math.max(140,Math.min(renderer.layout.width-140,p.x))}px`;this.el['last-stand'].style.top=`${Math.max(renderer.layout.free.top+12,Math.min(renderer.layout.free.bottom-50,p.y-78))}px`;}
    const touch = document.body.classList.contains('touch-mode');
    this.text('pause-hint', touch ? 'Вернись в бой, когда будешь готов' : 'ESC — вернуться в бой');
    if (sim.phase !== this.lastPhase) {
      this.show('menu', sim.phase === 'menu'); this.show('intro', intro);
      this.show('run-stats', sim.phase !== 'menu'); this.show('pause', playing || intro); this.show('hud', sim.phase !== 'menu' && !intro);
      this.show('modal', sim.phase === 'paused' || sim.phase === 'over');
      document.body.dataset.phase = sim.phase;
      if (sim.phase === 'paused') {
        this.text('modal-kicker', 'ПЕРЕДЫШКА'); this.text('modal-title', 'Бой на паузе'); this.text('modal-copy', `${C.player.firstName} и ${C.lev.firstName} ждут тебя на позиции.`);
        this.show('result-stats', false); this.show('resume', true); this.show('pause-hint', true); this.text('restart', 'Начать заново'); this.el.resume.focus();
      }
      if (sim.phase === 'over' && !sim.network) {
        this.isRecord = this.soloRecords.isRecord;
        this.text('modal-kicker', this.isRecord ? 'НОВЫЙ ОДИНОЧНЫЙ РЕКОРД' : 'ЭКИПАЖ ВЕРНУЛСЯ НА БАЗУ'); this.text('modal-title', this.isRecord ? 'Вот это было мощно!' : `Хороший бой, ${C.player.firstName}.`);
        this.text('modal-copy', `${C.lev.firstName} уже чинит танк. Ещё одна попытка?`);
        this.el['result-stats'].innerHTML = `<div><b>${number(sim.score)}</b><span>ОЧКОВ</span></div><div><b>${sim.wave}</b><span>ВОЛНА</span></div><div><b>${formatTime(sim.elapsed)}</b><span>В БОЮ</span></div><p>Одиночный рекорд <strong>${number(this.soloRecords.storage.record.score)}</strong></p>`;
        this.show('result-stats', true); this.show('resume', false); this.show('pause-hint', false); this.text('restart', 'Ещё бой'); this.el.restart.focus();
      }
      this.lastPhase = sim.phase;
    }
    if (sim.phase !== 'paused' && sim.phase !== 'over') { this.toastTime -= dt; this.dialogueTime -= dt; this.waveTime -= dt; this.achievementTime -= dt; this.damageTime=Math.max(0,this.damageTime-dt);if(!this.damageTime)this.damageFlash=0; this.shieldFlash = Math.max(0, this.shieldFlash - dt * 2); }
    this.show('power-banner', this.toastTime > 0 && playing); this.show('dialogue', this.dialogueTime > 0 && (playing || intro)); this.show('wave-banner', this.waveTime > 0 && playing && this.achievementTime <= 0 && this.toastTime <= 0);
    this.show('achievement', playing && this.achievementTime > 0 && this.toastTime <= 0);
    this.el['damage-flash'].style.opacity = String(this.damageFlash*Math.min(1,this.damageTime/this.damageDuration)); this.el['shield-flash'].style.opacity = String(this.shieldFlash);
    this.text('streak', String(sim.streak)); this.text('dash-status', sim.dashTime > 0 ? 'РЫВОК!' : sim.dashCooldown > 0 ? `${sim.dashCooldown.toFixed(1)} С` : 'ГОТОВ');
    const bosses = sim.enemies.filter(e => ENEMY_META[e.kind].tier !== 'regular');
    this.el['boss-bars'].classList.toggle('crowded', bosses.length > 2);
    this.show('boss-bars', bosses.length > 0 && playing);
    const bossMarkup = bosses.map(e => `<div class="boss-bar ${ENEMY_META[e.kind].tier}"><div><b>${ENEMY_META[e.kind].name}</b><span>${e.enraged ? 'ФАЗА 2 · ' : ''}${e.state === 'windup' ? 'АТАКА!' : `${Math.ceil(e.hp)} / ${Math.ceil(e.maxHp)}`}</span></div><i><em style="width:${Math.max(0, e.hp / e.maxHp * 100)}%"></em></i></div>`).join('');
    if (bossMarkup!==this.bossMarkup) { this.el['boss-bars'].innerHTML=bossMarkup;this.bossMarkup=bossMarkup; }
    const point = sim.capture; this.show('objective', playing && !!point && point.status !== 'complete');
    if (point) {
      const holding = point.progress >= B.capture.capture, remaining = Math.max(0, point.duration - point.progress - point.hold);
      this.text('point-name', point.name); this.el.objective.dataset.status = point.status;
      this.text('point-status', `${point.status === 'contested' ? 'ОСПАРИВАЕТСЯ' : point.status === 'away' ? 'ДВИГАЙСЯ К ТОЧКЕ' : holding ? 'УДЕРЖАНИЕ' : 'ЗАХВАТ'} · ${remaining.toFixed(1)} С`);
      this.el['point-fill'].style.width = `${((point.progress + point.hold) / point.duration) * 100}%`;
      this.text('point-help', point.status === 'contested' ? 'Убери врагов из круга' : point.status === 'away' ? 'Встань в светящийся круг' : 'Оставайся в круге. Лев прикроет.');
      const target=renderer.screen(point), origin=renderer.screen(sim.player);
      this.el['point-arrow'].style.transform = `rotate(${Math.atan2(target.y-origin.y,target.x-origin.x)+Math.PI/2}rad)`;
    }
    this.text('wave', String(sim.wave || 1).padStart(2, '0')); this.text('score', number(sim.score)); this.text('time', formatTime(sim.elapsed));
    this.text('hp', String(Math.ceil(sim.player.hp))); this.text('max-hp',String(sim.player.maxHp)); moduleList(this.el['solo-modules'],sim.player.modules??[]); this.el['health-fill'].style.width = `${100*sim.player.hp/sim.player.maxHp}%`; this.el['health-fill'].classList.toggle('low', sim.player.hp/sim.player.maxHp < .35);
    this.text('solo-supply',`Экстренный ремонт с воздуха: ${sim.elapsed>=sim.emergencyReadyAt?'готов':`через ${Math.ceil(sim.emergencyReadyAt-sim.elapsed)} с`}`);
    this.show('adrenaline-status',playing&&!!sim.player.adrenaline&&alive);
    const delivery=sim.deliveries.find(d=>!d.landed)??sim.deliveries[0],zone=sim.repairZone;
    const supplyText=delivery?(sim.elapsed<delivery.startAt?`Ремонт с воздуха через ${Math.ceil(delivery.startAt-sim.elapsed)} с`:!delivery.landed?'Снабжение · ящик в центре арены':'Ремонт доставлен · к зелёной метке'):'';
    this.text('support-status',[supplyText,zone?`Ремонтная зона · ${Math.ceil(zone.until-sim.elapsed)} с`:null].filter(Boolean).join(' / '));this.show('support-status',playing&&!!(delivery||zone));
    this.text('heal-status', sim.healTimer > 0 ? `${Math.ceil(sim.healTimer)} С` : 'ГОТОВ');
    const power = sim.powerTime > 0, ready = sim.charge >= C.power.max;
    this.text('touch-dash-value', sim.dashCooldown > 0 ? `${sim.dashCooldown.toFixed(1)} С` : 'РЫВОК');
    this.el['touch-dash'].setAttribute('aria-disabled', String(!playing || !alive || sim.dashCooldown > 0));
    this.text('touch-power-value', power ? `${sim.powerTime.toFixed(1)} С` : ready ? 'ГОТОВО' : `${sim.charge} / 67`);
    this.el['touch-power'].setAttribute('aria-disabled', String(!playing || !alive || !ready || power));
    this.el['touch-power'].classList.toggle('ready', ready || power);
    this.el['touch-power'].style.setProperty('--charge', `${power ? sim.powerTime / 7 * 100 : sim.charge / 67 * 100}%`);
    const chargeMarkup = power ? `${sim.powerTime.toFixed(1)}<span>СЕК</span>` : `${sim.charge}<span>/67</span>`;
    if (this.el.charge.innerHTML!==chargeMarkup) this.el.charge.innerHTML=chargeMarkup;
    this.el['power-fill'].style.width = `${power ? sim.powerTime / 7 * 100 : sim.charge / 67 * 100}%`;
    this.text('power-label', power ? 'SIX SEVEN АКТИВЕН' : ready ? 'ГОТОВО К ХАОСУ' : 'ЗАРЯД ХАОСА');
    this.text('power-action', power ? 'Двойные пушки. Полная защита.' : ready ? `${C.player.firstName}, жми пробел!` : sim.rapidTime > 0 ? `Скорострельность ×2 · ${sim.rapidTime.toFixed(1)} с` : 'Попадания заряжают режим');
    this.el['power-panel'].classList.toggle('ready', ready || power); this.el['power-key'].classList.toggle('charged', ready);
    this.show('hint', playing && alive && !(sim.moved > 8 && sim.fired >= 3));
    this.show('break-note',playing&&sim.breakTime>0);
    if(sim.breakTime>0){const title=`${(sim.wave+1)%5===0&&sim.breakTime<=5?'БОСС ЧЕРЕЗ':'ПЕРЕДЫШКА'} · ${Math.ceil(sim.breakTime)} с`;const markup=`<strong>${title}</strong><span>Соберите ремонт<br>и выберите модули</span>`;if(this.el['break-note'].innerHTML!==markup)this.el['break-note'].innerHTML=markup;}

    const priority=playing&&this.lastStandUntil>0&&!!survivor?'last-stand':playing&&this.toastTime>0?'power-banner':playing&&this.upgrades.waiting?'upgrade-notice':playing&&this.achievementTime>0?'achievement':playing&&this.waveTime>0?'wave-banner':(playing||intro)&&this.dialogueTime>0&&sim.breakTime<=0?'dialogue':null;
    // On the shortest viewports, the installation/major announcement temporarily owns
    // the secondary status row. Delivery markers and tank effects remain visible.
    if(touch&&renderer.layout.height<600&&priority&&priority!=='dialogue'){this.show('support-status',false);this.show('adrenaline-status',false);}
    const menuOpen=this.settingsOpen||document.body.classList.contains('battle-menu-open');
    this.upgrades.update(dt,priority==='upgrade-notice'&&!menuOpen);
    const module=this.upgrades.current;
    if(module&&this.upgradeMarkup!==module){
      this.upgradeMarkup=module;const meta=MODULES[module],card=this.el['upgrade-notice'];
      card.style.setProperty('--module-color',`#${meta.color.toString(16).padStart(6,'0')}`);
      this.el['upgrade-icon'].innerHTML=moduleIcon(module);this.text('upgrade-title',meta.name);this.text('upgrade-detail',MODULE_DETAILS[module]);
      card.dataset.module=module;
    }
    this.el['upgrade-progress'].style.transform=`scaleX(${this.upgrades.progress})`;
    for(const id of ['last-stand','power-banner','achievement','wave-banner','dialogue','upgrade-notice'])this.show(id,id===priority&&(id!=='upgrade-notice'||!!module));
    this.el['notice-slot'].hidden=!priority;
    this.el['feed-slot'].hidden=!!priority;
    this.show('battle-stack',playing||intro);
  }
  /** Measure one flow of panels, shared by the camera, names and edge markers. */
  arrange(sim:Simulation,renderer:GameRenderer){
    if(this.root.scrollTop||this.root.scrollLeft)this.root.scrollTo(0,0);
    const header=this.root.querySelector<HTMLElement>('.topbar')!,health=this.root.querySelector<HTMLElement>('.health-panel')!;
    const touch=document.body.classList.contains('touch-mode'),stack=this.el['battle-stack'];
    const headerBottom=Math.max(header.getBoundingClientRect().bottom,touch&&!this.el.hud.hidden?health.getBoundingClientRect().bottom:0);
    stack.style.top=`${Math.round(headerBottom+6)}px`;
    const guide=this.root.querySelector<HTMLElement>('#guide');if(guide&&guide.parentElement!==this.el['guide-slot'])this.el['guide-slot'].append(guide);
    const controls=this.root.querySelector<HTMLElement>('.touch-abilities');
    const bottom=touch&&sim.player.hp>0&&controls?controls.getBoundingClientRect().top-22:renderer.layout.height-(touch?160:150);
    renderer.setHudBounds(stack.hidden?headerBottom:stack.getBoundingClientRect().bottom+20,bottom);
    this.markers(sim,renderer,0);
  }
}
