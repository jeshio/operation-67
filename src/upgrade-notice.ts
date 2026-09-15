import { MODULES, type ModuleId } from './modules';
import type { GameEvent } from './simulation';

export const MODULE_DETAILS:Record<ModuleId,string>={
  armor:'Максимум брони +30. Сразу восстанавливает 30 брони.',
  cannon:'Твои снаряды наносят на 20% больше прямого урона.',
  turbo:'Рывок снова готов через 3 секунды вместо четырёх.',
  ram:'Во время рывка удар спереди наносит врагу 40 урона.',
  loader:'Пушка стреляет на 15% чаще. Работает вместе с 67.',
  splash:'При остановке снаряда осколки наносят соседям 12 урона.',
  pierce:'Снаряд проходит первого врага. Второму — 50% урона.',
  ballistics:'Снаряды летят на 25% быстрее.',
  repair:'После 5 секунд без урона восстанавливает 2 брони/с.',
  capacitor:'За каждое твоё уничтожение — ещё +3 к заряду 67.',
  magnet:'Подбирает обычные бонусы с расстояния 2,2 м.',
  tracks:'Танк едет на 15% быстрее. Скорость рывка прежняя.',
};
const drawings:Record<ModuleId,string>={
  armor:'M13 16 25 12v36l-12-5Zm14-4 12 4v27l-12 5ZM41 17l10 5v18l-10 4',
  cannon:'M15 43V29h16v14ZM27 30l18-18 7 7-18 18M42 15l7 7M12 48h27',
  turbo:'M12 19h16v29H12ZM36 19h16v29H36ZM16 23l8 8m-8 0 8-8m16 0 8 8m-8 0 8-8M18 13v-4m26 4v-4',
  ram:'M9 21h46l-5 23H14ZM15 44v6m17-6v6m17-6v6M19 21l4-8m22 8-4-8',
  loader:'M10 23h28v27H10ZM15 17v18m8-18v18m8-18v18m8-15v15m8-12v12m8-8v8M10 39h45',
  splash:'M26 16l6-8 6 8v28H26ZM26 22h12M14 17l5 5m26-5-5 5M9 34h8m30 0h8M16 50l5-5m27 5-5-5',
  pierce:'M26 23l6-15 6 15v28H26ZM23 29h18m-18 9h18M10 29v15m42-15v15M7 25h9m32 0h9',
  ballistics:'M10 31h44v17H10ZM24 22h16v17H24ZM32 10v8m0 27v9M18 26h-8m44 0h-8M27 26h10',
  repair:'M17 49h29M20 44l-4-20 15-9 17 11-8 13M31 15l-3 15 13 6m-1 3 7 8m-7-8-7 8',
  capacitor:'M12 19h11v31H12ZM27 19h11v31H27ZM42 19h11v31H42ZM16 13h3m12 0h3m12 0h3M30 28l-2 7h7l-2 7',
  magnet:'M12 13h13v22a7 7 0 0 0 14 0V13h13v22a20 20 0 0 1-40 0ZM12 25h13m14 0h13',
  tracks:'M12 12h15v40H12ZM37 12h15v40H37ZM12 20h15m-15 10h15m-15 10h15m10-20h15m-15 10h15m-15 10h15',
};
export function moduleIcon(id:ModuleId){return `<svg viewBox="0 0 64 64" aria-hidden="true"><path d="${drawings[id]}" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;}

/** Only confirmed local installations enter this bounded, game-time presentation. */
export class UpgradeNotice {
  private seen=new Set<ModuleId>();private pending:ModuleId[]=[];current?:ModuleId;age=0;
  reset(){this.seen.clear();this.pending=[];this.current=undefined;this.age=0;}
  accept(events:GameEvent[],localId:number,network:boolean){
    for(const e of events)if(e.type==='upgrade'&&e.module&&e.module in MODULES&&(!network||(e.actorId??e.target)===localId)&&!this.seen.has(e.module)){
      this.seen.add(e.module);this.pending.push(e.module);
    }
  }
  update(dt:number,canShow:boolean){
    if(!canShow)return;
    if(!this.current){this.current=this.pending.shift();this.age=0;}
    if(this.current){this.age+=dt;if(this.age>=4.5){this.current=undefined;this.age=0;}}
  }
  get waiting(){return !!this.current||this.pending.length>0;}
  get progress(){return Math.max(0,1-this.age/4.5);}
}
