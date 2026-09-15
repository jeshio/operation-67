import { MODULES, type ModuleId } from './modules';
import { checkTouchControls, checkOnlineTouch } from './touch-qa';
import type { NetworkGame } from './network';
import type { Controls } from './input';
import { autopilot } from './autopilot';
import type { Simulation } from './simulation';
import type { GameRenderer } from './render';
export function mountQA(sim: Simulation, render: GameRenderer, start: (intro: boolean) => void, stats: () => unknown, controls: Controls, online?:()=>NetworkGame|undefined) {
  const panel = document.createElement('details'); panel.id = 'qa-panel'; panel.style.cssText = 'position:absolute;bottom:185px;right:20px;z-index:50;background:#102632ed;color:white;padding:12px;border:1px solid #83bbc6;border-radius:8px;max-width:350px;max-height:75vh;overflow:auto;font:12px monospace';
  panel.innerHTML = '<summary>Проверка разработки</summary><div id="qa-buttons" style="display:flex;flex-wrap:wrap;gap:5px;margin-top:10px"></div><pre id="qa-stats" style="white-space:pre-wrap;font-size:11px"></pre><pre id="qa-result" style="white-space:pre-wrap"></pre>';
  document.querySelector('#app')!.append(panel);
  const result = panel.querySelector('#qa-result')!;
  const button = (title: string, fn: () => void | Promise<void>) => { const b = document.createElement('button'); b.textContent = title; b.style.cssText = 'font:11px Arial;padding:7px;background:#d6eeea;border:0;border-radius:3px;color:#112a36'; b.onclick = () => { void fn(); }; panel.querySelector('#qa-buttons')!.append(b); };
  button('Телефон / компьютер', () => controls.setTouchMode(!controls.touchMode));
  button('Тест сетевых касаний', async () => { const game=online?.();result.textContent=game?await checkOnlineTouch(controls,game):'Сначала создай сетевую комнату и начни бой.'; });
  button('Тест касаний', () => { start(false); result.textContent = checkTouchControls(controls, sim, render); sim.pause(); controls.clear(); });
  button('Сектор и выстрелы',()=>{
    start(false);sim.spawnTimer=9999;sim.enemies=[];sim.portals=[];sim.obstacles=[];sim.player.x=0;sim.player.z=0;controls.setTouchMode(true);document.body.dataset.controls='active';
    const el=document.querySelector('#aim-stick')!,r=el.getBoundingClientRect();el.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,pointerType:'touch',pointerId:901,button:0,clientX:r.left+r.width/2,clientY:r.top+r.height/2-40}));
  });
  button('Удержать движение и огонь', () => {
    start(false);sim.spawnTimer=9999;sim.enemies=[];sim.portals=[];document.body.dataset.phase='playing';document.body.dataset.controls='active';controls.setTouchMode(true);
    for(const [id,selector,dx] of [[801,'#move-stick',36],[802,'#aim-stick',40]] as const){const el=document.querySelector(selector)!,r=el.getBoundingClientRect();el.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,pointerType:'touch',pointerId:id,button:0,clientX:r.left+r.width/2+dx,clientY:r.top+r.height/2}));}
  });
  for(const kind of ['Поле','Укрытие','67'])button('Лазер: '+kind,()=>{
    start(false);sim.player.x=0;sim.player.z=3;sim.player.hp=10000;sim.spawnTimer=9999;sim.remainingToSpawn=1;sim.enemies=[];sim.portals=[];sim.obstacles=[];sim.lev.x=4;sim.lev.z=5;
    controls.setTouchMode(true);document.body.dataset.phase='playing';document.body.dataset.controls='active';
    if(kind==='Укрытие'){const d=render.stickDirection({x:0,y:-1}),n=Math.hypot(d.x,d.z);sim.obstacles=[{id:91000,x:sim.player.x+d.x/n*6,z:sim.player.z+d.z/n*6,w:2,d:2,kind:'cover',hp:Infinity}];}
    if(kind==='67')sim.powerTime=7;
    const el=document.querySelector('#aim-stick')!,r=el.getBoundingClientRect();el.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,pointerType:'touch',pointerId:880,button:0,clientX:r.left+r.width/2,clientY:r.top+r.height/2-40}));
  });
  button('Отпустить прицел',()=>controls.clear());
  for(const kind of ['drill','hail','factory','miss'] as const)button('Край корпуса: '+kind,()=>{
    start(false);sim.player.x=0;sim.player.z=4;sim.player.hp=10000;sim.spawnTimer=9999;sim.remainingToSpawn=1;sim.obstacles=[];sim.portals=[];sim.lev.x=17;sim.lev.z=14;sim.lev.cooldown=9999;
    controls.setTouchMode(true);render.hangar(0);render.render(sim,0);
    const d=render.stickDirection({x:0,y:-1}),n=Math.hypot(d.x,d.z),dx=d.x/n,dz=d.z/n,side=kind==='miss'?2.2:1.6;
    const e=sim.createEnemy(kind==='miss'?'factory':kind,{x:sim.player.x+dx*7-dz*side,z:sim.player.z+dz*7+dx*side});
    e.angle=e.bodyAngle=Math.atan2(dx,dz);e.state='recover';e.stateTime=9999;sim.enemies=[e];
    controls.setTouchMode(true);document.body.dataset.phase='playing';document.body.dataset.controls='active';
    const el=document.querySelector('#aim-stick')!,r=el.getBoundingClientRect();el.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,pointerType:'touch',pointerId:880,button:0,clientX:r.left+r.width/2,clientY:r.top+r.height/2-40}));
    setTimeout(()=>{if(sim.enemies.includes(e))result.textContent=`${kind}: ${sim.fired} выстрелов, ${e.maxHp-e.hp} урона. ${kind==='miss'?'Ожидается 0.':'Край гусеницы должен получать урон.'}`;},1600);
  });
  button('Опасности за экраном', () => {
    start(false);sim.player.x=0;sim.player.z=0;sim.player.hp=10000;sim.spawnTimer=9999;sim.enemies=[];sim.portals=[];sim.hazards=[];
    const sniper=sim.createEnemy('sniper',{x:-17,z:12});sniper.angle=Math.atan2(-sniper.x,-sniper.z);sniper.state='windup';sniper.stateTime=.9;
    const mortar=sim.createEnemy('mortar',{x:17,z:-12});mortar.state='windup';mortar.stateTime=1.2;
    const factory=sim.createEnemy('factory',{x:-17,z:9});factory.state='windup';factory.stateTime=.9;
    sim.enemies=[sniper,mortar,factory];sim.addHazard(sniper,sniper,.32,.9,20,'line',sniper.angle,30,true);sim.addHazard(mortar,sim.player,1.8,1.2,16);
    sim.portals.push({id:999001,x:17,z:12,kind:'light',remaining:1.5});
  });
  button('Камера по краям', async () => {
    start(false);sim.spawnTimer=9999;sim.enemies=[];sim.portals=[];sim.obstacles=[];sim.player.hp=10000;
    const samples:string[]=[];
    for(const [x,z] of [[-18,14],[18,14],[18,-14],[-18,-14],[0,7]]){
      sim.player.x=x;sim.player.z=z;render.render(sim,1/60);const p=render.screen(sim.player),r=render.layout.free;
      samples.push(`${x},${z}: ${p.x>=r.left&&p.x<=r.right&&p.y>=r.top&&p.y<=r.bottom?'PASS':'FAIL'}`);
      await new Promise(resolve=>setTimeout(resolve,250));
    }
    sim.pause();result.textContent=samples.join('\n');
  });
  button('Заряд 67', () => { sim.charge = 67; });
  button('Урон 55', () => { sim.damagePlayer(55); });
  button('Поражение', () => { sim.powerTime = 0; sim.damagePlayer(100); });
  button('Рекорд +2000', () => { sim.score += 2000; });
  button('Последние секунды предметов', () => { for(const p of sim.pickups)p.life=3; });
  for (const wave of [2,3,5,6,9,10,15]) button(`Волна ${wave}`, () => { start(false); sim.wave = wave-1; sim.enemies=[];sim.portals=[];sim.beginWave(); });
  button('Два босса', () => {
    start(false);sim.wave=14;sim.beginWave();sim.player.x=0;sim.player.z=4;sim.player.hp=10000;
    for(let i=0;i<180;i++){sim.update(1/60,{x:0,z:0,aim:{x:0,z:-5},fire:false,power:false});render.handle(sim.drainEvents());render.render(sim,1/60);}
  });
  button('Четыре босса · 45',()=>{
    start(false);sim.wave=44;sim.beginWave();sim.obstacles=[];sim.portals=[];sim.spawnTimer=9999;sim.remainingToSpawn=0;sim.player.x=0;sim.player.z=5;sim.player.hp=10000;
    sim.enemies=sim.wavePlan.bosses.map((kind,i)=>{const e=sim.createEnemy(kind,{x:-9+i*6,z:-5});e.cooldown=999;e.state='recover';e.stateTime=999;return e;});
    result.textContent='45-я волна: 2 Завода + 2 Барьера. Четыре отдельные шкалы.';
  });
  button('Боевой тест', async () => {
    start(false);let frames=0;
    while(sim.phase==='playing'&&sim.wave<11&&frames<60*600){
      for(let i=0;i<60&&sim.phase==='playing';i++){sim.update(1/60,autopilot(sim));render.handle(sim.drainEvents());if(i%6===0)render.render(sim,.1);frames++;}
      result.textContent=`Без бессмертия: волна ${sim.wave}, броня ${Math.ceil(sim.player.hp)}`;await new Promise(r=>setTimeout(r,0));
    }
    result.textContent=`Обычный бой: волна ${sim.wave} · ${Math.round(sim.elapsed)} с · ${sim.kills} врагов · броня ${Math.ceil(sim.player.hp)}`;sim.pause();
  });
  button('Таран и отбрасывание',()=>{start(false);sim.obstacles=[];sim.spawnTimer=9999;sim.portals=[];sim.player.x=sim.player.z=0;sim.healTimer=999;sim.lev.x=.7;sim.lev.z=0;const boss=sim.createEnemy('drill',{x:0,z:-7}),ally=sim.createEnemy('shooter',{x:-.7,z:0});boss.angle=0;boss.state='windup';boss.stateTime=.9;ally.state='recover';ally.stateTime=999;sim.enemies=[boss,ally];setTimeout(()=>{result.textContent=`Таран: Рома ${Math.round(sim.player.hp)} брони / z ${sim.player.z.toFixed(1)}; союзник босса ${Math.round(ally.hp)} брони / z ${ally.z.toFixed(1)}; Лев ${sim.lev.hp} брони`;},1900);});
  button('Самолёт и повреждения',()=>{start(false);sim.obstacles=[];sim.enemies=[];sim.portals=[];sim.spawnTimer=9999;sim.player.x=0;sim.player.z=5;sim.player.hp=18;sim.healTimer=999;sim.player.adrenaline=true;sim.player.modules=['armor','cannon','turbo','ram'];sim.player.maxHp=130;sim.scheduleDelivery('boss',5,2);for(const [i,hp] of [50,35,20].entries()){const e=sim.createEnemy('shooter',{x:-5+i*5,z:-3});e.hp=e.maxHp*hp/100;e.cooldown=999;e.pathTimer=999;e.state='recover';e.stateTime=999;sim.enemies.push(e);}});
  button('Самолёт в полёте',()=>{start(false);sim.obstacles=[];sim.enemies=[];sim.portals=[];sim.player.x=0;sim.player.z=4;sim.scheduleDelivery('boss',5,0);sim.elapsed=.95;sim.spawnTimer=9999;});
  button('Ремонтная зона',()=>{start(false);sim.player.x=sim.player.z=0;sim.player.hp=40;sim.healTimer=999;sim.spawnTimer=9999;sim.repairZone={x:0,z:0,until:sim.elapsed+10,healed:{},pending:{},noticeAt:{}};});
  button('Добыча босса',()=>{start(false);sim.obstacles=[];sim.enemies=[];sim.portals=[];sim.spawnTimer=9999;sim.player.x=0;sim.player.z=5;sim.dropBossLoot({x:0,z:0},'drill');});
  button('Россыпь на четверых',()=>{start(false);sim.obstacles=[];sim.enemies=[];sim.portals=[];sim.spawnTimer=9999;sim.player.x=0;sim.player.z=8;const original=sim.lootParticipants;sim.lootParticipants=()=>[0,-2,-3,-4].map(id=>({...sim.player,id}));try{sim.dropBossLoot({x:0,z:0},'hail');}finally{sim.lootParticipants=original;}});
  for(const module of Object.keys(MODULES) as ModuleId[])button(`Установить: ${MODULES[module].name}`,()=>{
    if(sim.phase!=='playing')start(false);sim.enemies=[];sim.portals=[];sim.spawnTimer=9999;sim.remainingToSpawn=1;
    sim.player.modules=(sim.player.modules??[]).filter(id=>id!==module);sim.lootBatch={id:99999,eligible:[sim.player.id],claimed:[]};
    sim.pickups=[{id:99000,x:sim.player.x,z:sim.player.z,kind:'module',module,life:999,batchId:99999}];
    panel.open=false;
  });
  button('Все модули на танке',()=>{if(sim.phase!=='playing')start(false);sim.player.modules=Object.keys(MODULES) as ModuleId[];sim.player.maxHp=130;sim.player.hp=130;sim.spawnTimer=9999;sim.enemies=[];sim.portals=[];});
  button('Предметы на поле',()=>{
    start(false);sim.spawnTimer=9999;sim.enemies=[];sim.portals=[];sim.obstacles=[];sim.player.x=0;sim.player.z=0;
    for(const [i,kind] of (['heal','charge','rapid'] as const).entries())sim.pickups.push({id:900100+i,x:-4+i*4,z:-5,kind,life:120});
  });
  button('Возврат после блокировки',async()=>{result.textContent='Имитируем уход…';window.dispatchEvent(new Event('pagehide'));await new Promise(r=>setTimeout(r,800));window.dispatchEvent(new Event('pageshow'));result.textContent='pagehide → pageshow. Бой ждёт нажатия продолжения.';});
  button('Восстановление графики',()=>{const extension=render.renderer.getContext().getExtension('WEBGL_lose_context');extension?.loseContext();setTimeout(()=>extension?.restoreContext(),800);});
  button('Бонусы', () => {
    if(sim.phase!=='playing')start(false);sim.player.hp=70;sim.charge=20;sim.powerTime=0;
    for(const [i,kind] of (['heal','charge','rapid'] as const).entries())sim.pickups.push({id:900000+i,x:sim.player.x,z:sim.player.z,kind,life:12});
  });
  button('На точку', () => { if(sim.capture){sim.player.x=sim.capture.x;sim.player.z=sim.capture.z;} });
  button('Серия 7', () => sim.announce('steel'));
  button('Легенда', () => sim.announce('legend'));
  button('Босс взрыв', () => { const e=sim.enemies.find(e=>['drill','hail','factory'].includes(e.kind)); if(e)sim.killEnemy(e); });
  button('Фаза 2', () => { for(const e of sim.enemies)if(['drill','hail','factory'].includes(e.kind))e.hp=e.maxHp/2; });
  button('Вступление', () => start(true));
  button('Тест клавиш', async () => {
    start(false); const old = render.screen(sim.player); const oldAngle = sim.player.angle;
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', key: 'ц' }));
    await new Promise(r => setTimeout(r, 400)); window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', key: 'ц' }));
    const moved = render.screen(sim.player), inputPass = moved.y < old.y - 20 && Math.abs(moved.x - old.x) < 2;
    const canvas = render.renderer.domElement, r = canvas.getBoundingClientRect();
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: r.left + r.width * 0.7, clientY: r.top + r.height * 0.4 }));
    await new Promise(resolve => setTimeout(resolve, 100));
    sim.charge = 67; window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ' })); window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space', key: ' ' }));
    await new Promise(resolve => setTimeout(resolve, 100));
    const powerPass = sim.powerTime > 6.7 && sim.charge === 0, aimPass = Math.abs(oldAngle - sim.player.angle) > 0.1;
    const projected = render.screen({x:6,z:-4}), matched = render.aim(projected.x,projected.y); const accuracy = Math.hypot(matched.x-6,matched.z+4)<0.001;
    result.textContent = `W / русская Ц: ${inputPass ? 'PASS' : 'FAIL'}\nПрицел мышью: ${aimPass ? 'PASS' : 'FAIL'}\nСовпадение прицела и цели: ${accuracy ? 'PASS' : 'FAIL'}\nПробел: ${powerPass ? 'PASS' : 'FAIL'}`;
  });
  button('Тест 45 волн', async () => {
    start(false); let frames=0,peak=0,firstCharge=0; const limit=60*7200;
    while(sim.wave<46 && frames<limit){
      for(let i=0;i<180 && sim.wave<46;i++){
        sim.player.hp=10000; if(sim.charge===67&&!firstCharge)firstCharge=sim.wave;
        sim.update(1/60,autopilot(sim)); const events=sim.drainEvents();render.handle(events);
        if(i%12===0)render.render(sim,0.2); frames++;peak=Math.max(peak,sim.enemies.length+sim.portals.length);
      }
      result.textContent=`Длинный бой: ${sim.wave}/45 · ${Math.round(sim.elapsed)} с`; await new Promise(r=>setTimeout(r,0));
    }
    sim.player.hp=100;sim.pause();result.textContent=`45 волн: ${sim.wave>=46?'PASS':'FAIL'}\nПервый заряд: ${firstCharge}\nПик врагов: ${peak}\n${JSON.stringify(render.stats())}`;
  });
  button('Тест перезапусков', async () => {
    const samples: unknown[] = [];
    for (let i = 0; i < 5; i++) { start(false); for (let f = 0; f < 240; f++) { sim.update(1/60, {x:0,z:0,aim:{x:0,z:-10},fire:true,power:false}); render.handle(sim.drainEvents()); render.render(sim,1/60); } samples.push(render.stats()); await new Promise(r => setTimeout(r, 0)); }
    sim.pause(); result.textContent = 'Пять перезапусков:\n' + samples.map((s) => JSON.stringify(s)).join('\n');
  });
  setInterval(() => { panel.querySelector('#qa-stats')!.textContent = JSON.stringify({ ...stats() as object, layout: render.layout, playerScreen: render.screen(sim.player), wave: sim.wave, hp: sim.player.hp, charge: sim.charge, power: +sim.powerTime.toFixed(2), x: +sim.player.x.toFixed(2), z: +sim.player.z.toFixed(2), phase: sim.phase }, null, 1); }, 500);
}
