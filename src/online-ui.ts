import { placeNames } from './view';
import { JoinFlow, type JoinIntent } from './join-flow';
import { MODULES } from './modules';
import { moduleList } from './module-ui';
import { BattleRecords, recordSummary } from './records';
import type { GameProfile } from './profile';
import { NetworkGame } from './network';
import { SKINS } from './coop';
import type { GameEvent } from './simulation';
import type { GameRenderer } from './render';

export class OnlineUI {
  private refs:Record<string,HTMLElement>={};
  element:HTMLElement;private card:HTMLElement;private flow:JoinFlow;private entryStage='';private menu=false;private feed:{text:string;until:number}[]=[];private copied='';private copiedUntil=0;private savedRound=-1;private names=new Map<number,HTMLElement>();
  constructor(private game:NetworkGame,root:HTMLElement,private profile:GameProfile,private records:BattleRecords,private actions:{gesture:()=>void;settings:()=>void}){
    this.element=document.createElement('section');this.element.id='online';this.element.innerHTML=`
      <div id="net-names"></div><div id="net-team"></div><div id="net-feed" aria-live="polite"></div><div id="net-connection" role="status" hidden></div>
      <div id="net-observe" hidden><b>Танк подбит</b><span>Вернёшься после завершения волны — с 50 брони</span><small id="net-progress"></small><button id="net-watch">Другой напарник →</button></div>
      <div id="net-overlay"><div class="net-card" role="dialog" aria-modal="true" aria-labelledby="net-heading"><div class="net-card-header"><span class="kicker">ОПЕРАЦИЯ 67 · ОТРЯД</span><button id="net-settings" class="gear-button" aria-label="Настройки">⚙</button></div><h2 id="net-heading">Твой танк. Твой отряд.</h2>
      <div id="net-profile"><p class="entry-copy">Создай свой отряд или введи код приглашения.</p>
      <div class="net-room-actions"><button class="secondary-button" type="button" id="net-create">Создать комнату</button>
      <div id="net-create-options" hidden><label class="room-option"><input type="radio" name="room-kind" value="private" checked> Личная <small>Вход по приглашению</small></label><label class="room-option"><input type="radio" name="room-kind" value="public"> Общая <small>Могут зайти другие игроки</small></label><button id="net-confirm-create" type="button" class="secondary-button">Создать</button></div>
      <button type="button" id="net-code-entry" class="secondary-button">Войти по коду</button><div id="net-code-box" class="net-code" hidden><input id="net-code" maxlength="6" placeholder="КОД КОМНАТЫ" aria-label="Код комнаты"><button type="button" id="net-join">Войти</button></div>
      </div></div>
      <form id="net-name-form" class="profile-field" novalidate hidden><label for="net-name">Имя над танком</label><input id="net-name" maxlength="16" autocomplete="nickname" placeholder="Например, Лев" enterkeyhint="go" aria-describedby="net-name-error"><small id="net-name-error" class="field-error" role="status"></small><button class="primary-button" type="submit">В бой</button><button id="net-name-back" type="button" class="text-button">Назад</button></form>
      <div id="net-joining" role="status" hidden><div class="joining-symbol" aria-hidden="true">67</div><p>Скоро ты будешь на арене</p></div><div id="net-entry-error" hidden><p id="net-entry-message" role="alert"></p><button id="net-retry" class="primary-button">Попробовать ещё раз</button></div>
      <div id="net-room" hidden><div class="room-composition"><p id="net-room-info"></p><div id="net-roster"></div><div class="net-two"><button id="net-copy-code">Копировать код</button><button id="net-copy-link">Ссылка другу</button></div></div><p id="net-supply" class="supply-cooldown"></p><details id="net-modules" class="module-list"><summary></summary><ul></ul></details><div id="net-results"></div><p id="net-room-hint"></p><button id="net-start" class="primary-button">Начать бой</button><button id="net-back" class="secondary-button">Продолжить бой</button></div>
      <p id="net-status" role="status"></p><button id="net-leave" class="text-button">Выйти в главное меню</button></div></div>`;
    root.append(this.element);for(const e of this.element.querySelectorAll<HTMLElement>('[id]'))this.refs[e.id]=e;this.card=this.element.querySelector('.net-card')!;
    this.flow=new JoinFlow(profile,request=>{actions.gesture();game.enter(request);},()=>game.stop());
    const name=this.get<HTMLInputElement>('net-name');name.value=profile.nameConfirmed?profile.name:'';
    name.oninput=()=>{this.flow.error='';name.removeAttribute('aria-invalid');};
    this.get('net-name-form').onsubmit=e=>{e.preventDefault();this.flow.confirm(name.value);name.setAttribute('aria-invalid',String(!!this.flow.error));this.paintEntry();};
    this.get('net-name-back').onclick=()=>{if(this.flow.intent?.mode==='quick')game.leave();else{this.flow.back();this.paintEntry();}};
    this.get('net-retry').onclick=()=>{this.flow.retry();this.paintEntry();};
    const join=(mode:JoinIntent['mode'])=>this.requestJoin({mode,code:this.get<HTMLInputElement>('net-code').value.trim()});
    this.get('net-create').onclick=()=>{this.get('net-create-options').hidden=!this.get('net-create-options').hidden;this.get('net-code-box').hidden=true;};
    this.get('net-confirm-create').onclick=()=>join(this.element.querySelector<HTMLInputElement>('[name=room-kind]:checked')?.value==='public'?'public':'private');
    this.get('net-code-entry').onclick=()=>{this.get('net-code-box').hidden=!this.get('net-code-box').hidden;this.get('net-create-options').hidden=true;this.get('net-code').focus();};
    this.get('net-join').onclick=()=>join('code');this.get('net-code').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();join('code');}};this.get('net-settings').onclick=actions.settings;
    this.get('net-leave').onclick=()=>game.leave();this.get('net-start').onclick=()=>{actions.gesture();game.continue();game.start();};this.get('net-back').onclick=()=>this.toggle(false);this.get('net-watch').onclick=()=>game.nextWatch();
    const copy=async(text:string)=>{try{await navigator.clipboard.writeText(text);this.copied='Скопировано';this.copiedUntil=performance.now()+5000;}catch{this.copied=text;this.copiedUntil=performance.now()+15000;}};
    this.get('net-copy-code').onclick=()=>void copy(game.room?.code??'');this.get('net-copy-link').onclick=()=>{const u=new URL(location.href);u.search='';u.searchParams.set('room',game.room?.code??'');void copy(u.href);};
    const code=new URLSearchParams(location.search).get('room');if(code){this.get<HTMLInputElement>('net-code').value=code.toUpperCase();this.get('net-code-box').hidden=false;}this.paintEntry();
  }
  requestJoin(intent:JoinIntent){this.flow.request(intent);this.paintEntry();}
  private paintEntry(){
    const room=!!this.game.room,stage=this.flow.stage;
    this.get('net-profile').hidden=room||stage!=='friends';
    this.get('net-name-form').hidden=room||stage!=='name';
    this.get('net-joining').hidden=room||stage!=='connecting';
    this.get('net-entry-error').hidden=room||stage!=='error';
    this.get('net-entry-message').textContent=this.flow.error;
    this.get('net-name-error').textContent=stage==='name'?this.flow.error:'';
    this.get('net-status').hidden=!room&&stage!=='friends';
    this.get('net-settings').hidden=!room&&stage==='connecting';
    this.get('net-leave').hidden=!room&&stage==='name';
    this.get('net-leave').textContent=!room&&stage==='connecting'?'Отмена':'Выйти в главное меню';
    if(!room)this.get('net-heading').textContent=stage==='name'?'Как тебя зовут?':stage==='connecting'?(this.flow.intent?.mode==='quick'?'Ищем отряд…':'Подключаемся…'):stage==='error'?'Не удалось войти':'Комната с друзьями';
    if(stage!==this.entryStage){
      this.entryStage=stage;
      if(stage==='name'){const name=this.get<HTMLInputElement>('net-name');if(this.profile.nameConfirmed)name.value=this.profile.name;name.focus();}
      else if(stage==='connecting'){this.get<HTMLInputElement>('net-name').blur();this.get('net-leave').focus();}
      else if(stage==='error')this.get('net-retry').focus();
    }
  }
  get<T extends HTMLElement=HTMLElement>(id:string){return this.refs[id] as T;}
  get blocked(){return this.game.recovering||this.game.needsResume||!this.game.connected||!this.game.room||this.menu||this.game.view.phase!=='playing';}
  toggle(value=!this.menu){this.menu=value;if(!value){this.game.continue();this.actions.gesture();}}
  destroy(){for(const id of ['net-team','net-feed','net-connection'])this.get(id).remove();this.element.remove();document.body.classList.remove('battle-menu-open');}
  update(events:GameEvent[],renderer:GameRenderer){
    const g=this.game,s=g.state,room=g.room;this.flow.observe(room,g.error);this.paintEntry();const playing=s?.phase==='playing'||s?.phase==='dying';
    if(room&&room.round!==this.savedRound){this.savedRound=room.round;if(!g.needsResume)this.menu=false;}
    this.get('net-overlay').hidden=!!room&&!!playing&&!this.menu&&!g.needsResume&&!g.recovering&&g.connected;
    const overlayOpen=!this.get('net-overlay').hidden;document.body.classList.toggle('battle-menu-open',overlayOpen);
    const feedParent=overlayOpen?this.card:document.getElementById('feed-slot')!;if(this.get('net-feed').parentElement!==feedParent)feedParent.append(this.get('net-feed'));
    const connectionParent=overlayOpen?this.card:document.getElementById('context-slot')!;if(this.get('net-connection').parentElement!==connectionParent)connectionParent.append(this.get('net-connection'));
    this.get('net-room').hidden=!room;this.get('net-team').hidden=!room;
    const connection=this.get('net-connection');connection.textContent=g.connectionNotice;connection.hidden=!room||!playing||!g.connected||!g.connectionNotice;
    const status=g.error||(g.recovering?'Восстанавливаем связь…':!g.connected?g.status:performance.now()<this.copiedUntil?this.copied:'');if(this.get('net-status').textContent!==status)this.get('net-status').textContent=status;
    const now=performance.now();
    const words={joined:'вошёл в отряд',left:'вышел',lost:'потерял связь',returned:'снова на связи'};
    for(const e of g.presence.splice(0))this.feed.push({text:`${e.name} ${words[e.kind]}`,until:now+5000});
    for(const e of events)if(e.type==='upgrade'&&e.module&&e.actorId!==g.id)this.feed.push({text:`${s?.players.find(p=>p.id===e.actorId)?.name??'Игрок'} установил ${MODULES[e.module].name}`,until:now+5000});

    this.feed=this.feed.filter(e=>e.until>now).slice(-3);this.get('net-feed').textContent=this.feed.map(e=>e.text).join('\n');
    if(!s||!room){if(g.error&&this.flow.stage==='friends')this.get('net-heading').textContent='Комната закрыта';return;}
    for(const [id,label] of this.names)if(!s.players.some(p=>p.id===id)){label.remove();this.names.delete(id);}
    for(const p of s.players){let label=this.names.get(p.id);if(!label){label=document.createElement('span');label.className='net-name';label.textContent=p.name;this.names.set(p.id,label);this.get('net-names').append(label);}label.textContent=p.name;label.style.color=`#${SKINS[p.skin].color.toString(16).padStart(6,'0')}`;const t=g.view.allies?.find(t=>t.id===p.id)??p.tank,point=renderer.screen(t),free=renderer.layout.free;label.hidden=p.tank.hp<=0||!playing||point.x<free.left||point.x>free.right||point.y-58<free.top||point.y>free.bottom;label.style.left=`${point.x}px`;label.style.top=`${point.y-38}px`;}
    const tags=s.players.filter(p=>p.tank.hp>0).sort((a,b)=>Number(b.id===g.id)-Number(a.id===g.id)).map(p=>{
      const label=this.names.get(p.id)!,point=renderer.screen(g.view.allies?.find(t=>t.id===p.id)??p.tank);
      label.hidden=false;return {...point,id:p.id,width:label.offsetWidth,height:label.offsetHeight};
    }).filter(p=>p.x>=renderer.layout.free.left&&p.x<=renderer.layout.free.right&&p.y<=renderer.layout.free.bottom);
    for(const label of this.names.values())label.hidden=true;
    if(playing&&!overlayOpen)for(const p of placeNames(tags,renderer.layout.free)){const label=this.names.get(p.id)!;label.hidden=false;label.style.left=`${p.x}px`;label.style.top=`${p.y}px`;label.style.transform='none';}
    const heading=g.recovering?'Восстанавливаем связь…':s.phase==='over'?'Отряд вернулся на базу':playing?'Бой продолжается':'Собираем отряд';this.get('net-heading').textContent=heading;
    this.get('net-room-info').textContent=`${room.public?'Общая':'Личная'} комната ${room.code} · ${s.players.length}/4`;
    this.get('net-room-hint').textContent=g.awayMessage|| (playing?'Твой танк остаётся на арене. Меню не останавливает общий бой.':room.countdown!==null?`Начинаем через ${Math.ceil(room.countdown)}…`:room.owner===g.id?'Можно начать одному. Остальные подключатся по ходу боя.':'Ждём, когда создатель начнёт бой.');
    this.get('net-start').hidden=!!playing||room.owner!==g.id||room.countdown!==null;this.get('net-start').textContent=s.phase==='over'?'Ещё бой':'Начать бой';this.get('net-back').hidden=!playing;for(const id of ['net-start','net-back'])(this.get(id) as HTMLButtonElement).disabled=g.recovering;
    const team=this.get('net-team');const teamKey=s.players.map(p=>`${p.id}:${p.skin}:${p.name}:${Math.ceil(p.tank.hp)}:${p.connected}`).join('|');
    if(team.dataset.key!==teamKey){team.dataset.key=teamKey;team.replaceChildren(...s.players.map(p=>{const line=document.createElement('div');line.className=p.id===g.id?'self':'';line.style.setProperty('--paint',`#${SKINS[p.skin].color.toString(16).padStart(6,'0')}`);const n=document.createElement('b');n.textContent=p.name;const hp=document.createElement('span');hp.textContent=!p.connected?'Нет связи':p.tank.hp<=0?'Подбит':`${Math.ceil(p.tank.hp)} ♥`;line.append(n,hp);return line;}));}
    const roster=this.get('net-overlay').hidden?document.getElementById('squad-slot')!:this.get('net-roster');if(team.parentElement!==roster)roster.append(team);
    const dead=g.view.player.hp<=0&&s.phase==='playing';this.get('net-observe').hidden=!dead||this.menu||g.needsResume||g.recovering;this.get('net-watch').hidden=s.players.filter(p=>p.tank.hp>0).length<2;
    this.get('net-progress').textContent=s.breakTime>0?'Ищем безопасное место для возвращения':s.capture?`Точка: ${Math.max(0,s.capture.duration-s.capture.progress-s.capture.hold).toFixed(1)} с удержания осталось`:`Волна ${s.wave} · осталось врагов: ${s.enemies.length+s.portals.length+s.remaining}`;

    this.get('net-supply').textContent=`Экстренный ремонт с воздуха: ${s.elapsed>=(s.emergencyReadyAt??0)?'готов':`через ${Math.ceil((s.emergencyReadyAt??0)-s.elapsed)} с`}`;
    moduleList(this.get('net-modules'),s.players.find(p=>p.id===g.id)?.tank.modules??[]);
    const results=this.get('net-results');
    const resultKey=JSON.stringify([room.code,room.round,s.score,s.wave,s.players.map(p=>[p.id,p.name,p.kills,Math.round(p.damage),p.bestStreak]),this.records.storage.record]);
    if(s.phase==='over'&&results.dataset.key!==resultKey){
      results.dataset.key=resultKey;results.replaceChildren();
      if(this.records.isRecord){const badge=document.createElement('b');badge.className='net-record-badge';badge.textContent='Новый рекорд в отряде!';results.append(badge);}
      const total=document.createElement('h3');total.textContent=`${s.score.toLocaleString('ru-RU')} очков · волна ${s.wave}`;results.append(total);
      const best=document.createElement('p');best.className='net-record-summary';best.textContent=`Рекорд в отряде: ${recordSummary(this.records.storage.record)}`;results.append(best);
      const label=document.createElement('h4');label.textContent='Личный вклад';results.append(label);
      for(const p of s.players){const line=document.createElement('p');line.textContent=`${p.name}: ${p.kills} уничтожений · ${Math.round(p.damage)} урона · серия ${p.bestStreak}`;results.append(line);}
    }
    results.hidden=s.phase!=='over';
  }
}
