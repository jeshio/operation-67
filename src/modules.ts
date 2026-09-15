import { CONFIG as C, BALANCE as B } from './config';
export const MODULES = {
  armor: { labelBg:'#285347', boss:'drill', name:'Бронекомплект', effect:'+30 максимальной брони', mark:'БР', color:0x729a86 },
  cannon: { labelBg:'#70412e', boss:'drill', name:'Усиленная пушка', effect:'+20% урона', mark:'УД', color:0xb89465 },
  turbo: { labelBg:'#24556d', boss:'drill', name:'Турбонаддув', effect:'Рывок каждые 3 с', mark:'ТБ', color:0x6c9aaa },
  ram: { labelBg:'#625129', boss:'drill', name:'Таранный отвал', effect:'Таран: 40 урона', mark:'ТР', color:0xa39379 },
  loader: { labelBg:'#563c76', boss:'hail', name:'Автозаряжатель', effect:'+15% скорострельности', mark:'АЗ', color:0xa28cba },
  splash: { labelBg:'#743444', boss:'hail', name:'Осколочный заряд', effect:'Осколки: 12 урона', mark:'ОС', color:0xb5876d },
  pierce: { labelBg:'#626122', boss:'hail', name:'Бронебойный сердечник', effect:'Пробивает двух врагов', mark:'ББ', color:0xa9a575 },
  ballistics: { labelBg:'#334878', boss:'hail', name:'Баллистический модуль', effect:'+25% скорости снарядов', mark:'БЛ', color:0x7d9eac },
  repair: { labelBg:'#315d32', boss:'factory', name:'Ремонтный блок', effect:'Авторемонт: 2 брони/с', mark:'РМ', color:0x72a787 },
  capacitor: { labelBg:'#71532b', boss:'factory', name:'Конденсатор', effect:'+3 заряда за уничтожение', mark:'КН', color:0xb8a268 },
  magnet: { labelBg:'#693d67', boss:'factory', name:'Магнит', effect:'Подбор с 2,2 м', mark:'МГ', color:0x9e829e },
  tracks: { labelBg:'#285c5b', boss:'factory', name:'Усиленная ходовая', effect:'+15% скорости', mark:'ХД', color:0x839c9b },
} as const;
export type ModuleId = keyof typeof MODULES;
export type BigBoss = typeof MODULES[ModuleId]['boss'];
export interface Equipped { modules?: ModuleId[]; adrenaline?: boolean; }
export const hasModule = (t: Equipped, id: ModuleId) => !!t.modules?.includes(id);
export function tankStats(t: Equipped) {
  return { maxHp:C.player.hp+(hasModule(t,'armor')?30:0), damageMultiplier:t.adrenaline?1.3:1, damage:C.player.damage*(hasModule(t,'cannon')?1.2:1)*(t.adrenaline?1.3:1),
    speed:C.player.speed*(hasModule(t,'tracks')?1.15:1)*(t.adrenaline?1.25:1), cooldown:C.player.cooldown/(hasModule(t,'loader')?1.15:1),
    dashCooldown:hasModule(t,'turbo')?3:B.dash.cooldown, bulletSpeed:24*(hasModule(t,'ballistics')?1.25:1), pickupRadius:hasModule(t,'magnet')?2.2:B.pickups.radius };
}
// Enumerate distinct sets, then find a matching. Randomness is uniform over maximal sets,
// not over assignments (which would bias sets with more possible recipients).
export function chooseModules(boss: BigBoss, players: Equipped[], random:()=>number): ModuleId[] {
  const pool=(Object.keys(MODULES) as ModuleId[]).filter(id=>MODULES[id].boss===boss);
  let best:ModuleId[][]=[[]];
  const match=(ids:ModuleId[],at=0,used=0):boolean => at===ids.length || players.some((p,i)=>!(used&(1<<i))&&!hasModule(p,ids[at])&&match(ids,at+1,used|(1<<i)));
  for(let mask=1;mask<1<<pool.length;mask++){
    const ids=pool.filter((_,i)=>mask&(1<<i));if(ids.length>players.length||ids.length<best[0].length||!match(ids))continue;
    if(ids.length>best[0].length)best=[];best.push(ids);
  }
  return best[Math.min(best.length-1,Math.floor(random()*best.length))];
}
