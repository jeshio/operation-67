import type { Controls } from './input';
import type { Simulation } from './simulation';
import type { GameRenderer } from './render';

/** Development-only integration checks through the real DOM event listeners. */
export function checkTouchControls(controls: Controls, sim: Simulation, renderer: GameRenderer) {
  const results: string[] = [];
  const check = (name: string, ok: boolean) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  controls.setTouchMode(true); controls.clear();
  const left = document.querySelector<HTMLElement>('#move-stick')!, right = document.querySelector<HTMLElement>('#aim-stick')!, field = renderer.renderer.domElement;
  const dash = document.querySelector<HTMLElement>('#touch-dash')!, power = document.querySelector<HTMLElement>('#touch-power')!;
  const send = (element: HTMLElement, type: string, id: number, x = 0, y = 0) => {
    const r = element.getBoundingClientRect();
    element.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerType: 'touch', pointerId: id, button: 0, clientX: r.left + r.width / 2 + x, clientY: r.top + r.height / 2 + y }));
  };
  const read = () => controls.read(sim.player);
  try {
    document.body.dataset.phase = 'playing';document.body.dataset.controls='active';
    send(right,'pointerdown',100,5,0);let neutral=read();check('Мёртвая зона огня',!neutral.fire&&!neutral.firePressed);send(right,'pointerup',100);send(field,'pointerdown',99,60,0);neutral=read();check('Касание поля не стреляет',!neutral.fire&&!neutral.firePressed);send(field,'pointerup',99);send(left,'pointerdown',101,5,0);check('Мёртвая зона движения',!read().x&&!read().z);
    send(left,'pointermove',101,28,0);send(right,'pointerdown',102,60,-60);
    let input=read();check('Движение и огонь разными пальцами',input.fire&&Math.hypot(input.x,input.z)>.3&&Math.hypot(input.x,input.z)<.5);
    const target=renderer.screen(input.aim),origin=renderer.screen({x:sim.player.x,z:sim.player.z});check('Прицел совпадает с направлением стика',Math.abs((target.x-origin.x)+(target.y-origin.y))<.01 && target.x>origin.x);
    send(right,'pointerdown',111,-60,0);check('Другой палец не перехватывает прицел',Math.abs(read().aim.x-input.aim.x)<.001);
    send(dash,'pointerdown',103);input=read();check('Третий палец — рывок',!!input.dash&&input.fire);check('Рывок однократный',!read().dash);send(dash,'pointerup',103);
    send(power,'pointerdown',104);check('67 однократно',read().power&&!read().power);send(power,'pointerup',104);
    send(left,'pointermove',101,560,0);input=read();check('За краем стика',Math.abs(Math.hypot(input.x,input.z)-1)<.001);
    send(left,'pointerup',101);input=read();check('Огонь остаётся после отпускания движения',input.fire&&!input.x&&!input.z);
    const direction={x:input.aim.x-sim.player.x,z:input.aim.z-sim.player.z};send(right,'pointerup',102);sim.player.x+=1;input=read();sim.player.x-=1;
    check('Направление сохраняется после отпускания',!input.fire&&Math.abs(input.aim.x-sim.player.x-1-direction.x)<.001);
    send(right,'pointerdown',105,60,-20);send(right,'pointerup',105);input=read();check('Быстрое отклонение — одна попытка',!!input.firePressed&&!input.fire&&!read().firePressed);
    send(right,'pointerdown',106,40,0);send(right,'pointercancel',106);input=read();check('Отмена не оставляет выстрел',!input.fire&&!input.firePressed);
    for (const [x,y] of [[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1],[0,-1],[1,-1]]) {
      send(right,'pointerdown',120,x*50,y*50);const p=renderer.screen(read().aim),o=renderer.screen({x:sim.player.x,z:sim.player.z});check(`Прицел ${x},${y}`,Math.abs((p.x-o.x)*y-(p.y-o.y)*x)<.01 && (p.x-o.x)*x+(p.y-o.y)*y>0);send(right,'pointerup',120);read();
    }
    send(dash,'pointerdown',130);input=read();check('Кнопка сама не стреляет',!!input.dash&&!input.fire&&!input.firePressed);send(dash,'pointerup',130);
    send(left,'pointerdown',131,40,0);send(right,'pointerdown',132,40,0);send(power,'pointerdown',133);controls.clear();input=read();
    check('Очистка убирает все команды',!input.x&&!input.z&&!input.fire&&!input.firePressed&&!input.power&&!input.dash);
    send(right,'pointermove',132,40,0);check('Старый палец не оживает',!read().fire);
    send(left,'pointerdown',140,40,0);send(right,'pointerdown',141,40,0);window.dispatchEvent(new Event('blur'));input=read();
    check('Потеря фокуса ставит паузу и очищает ввод',sim.phase==='paused'&&!input.fire&&!input.x&&!input.z);
  } finally { controls.clear(); }
  return results.join('\n');
}

/** Real listeners -> animation loop -> WebSocket -> authoritative player, no local teleports. */
export async function checkOnlineTouch(controls:Controls,game:import('./network').NetworkGame){
  if(game.state?.phase!=='playing')return 'Сначала начни сетевой бой.';
  const results:string[]=[],wait=(ms:number)=>new Promise(r=>setTimeout(r,ms));
  const own=()=>structuredClone(game.state!.players.find(m=>m.id===game.id)!);
  const send=(selector:string,type:string,id:number,x=0,y=0)=>{const el=document.querySelector<HTMLElement>(selector)!,r=el.getBoundingClientRect();el.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerType:'touch',pointerId:id,button:0,clientX:r.left+r.width/2+x,clientY:r.top+r.height/2+y}));};
  const check=(name:string,pass:boolean)=>results.push(`${pass?'PASS':'FAIL'} ${name}`);
  try{
    controls.setTouchMode(true);controls.clear();await wait(100);const before=own();
    send('#move-stick','pointerdown',901,48);send('#aim-stick','pointerdown',902,0,-48);
    await wait(600);send('#move-stick','pointermove',901,160);
    send('#touch-dash','pointerdown',903);await wait(50);send('#touch-dash','pointerup',903);
    await wait(300);const moved=own();
    check('Сервер: два стика — движение и стрельба',Math.hypot(moved.tank.x-before.tank.x,moved.tank.z-before.tank.z)>.2&&moved.fired>before.fired);
    check('Сервер: рывок третьим пальцем',moved.dashCooldown>0);
    send('#move-stick','pointerup',901);await wait(250);const stopped=own();await wait(350);const still=own();
    check('Отпускание движения сохраняет огонь',Math.hypot(still.tank.x-stopped.tank.x,still.tank.z-stopped.tank.z)<.05&&still.fired>stopped.fired);
    send('#aim-stick','pointercancel',902);await wait(200);const released=own();await wait(400);
    check('Отмена пальца прицеливания прекращает огонь',own().fired===released.fired);
    send('#move-stick','pointerdown',904,-48);send('#aim-stick','pointerdown',905,-48);
    await wait(150);window.dispatchEvent(new Event('blur'));await wait(200);const paused=own();await wait(350);
    check('Потеря фокуса освобождает серверный ввод',Math.hypot(own().tank.x-paused.tank.x,own().tank.z-paused.tank.z)<.05&&own().fired===paused.fired);
  }finally{controls.clear();game.releaseInput();}
  return results.join('\n');
}
