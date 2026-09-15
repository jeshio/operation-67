import type { Point } from './simulation';
/** All times are authoritative game seconds, including the five-second boss delay. */
export interface Delivery extends Point { id:number; source:'boss'|'emergency'; count:number; startAt:number; landed:boolean; batchId?:number; }
export interface RepairZone extends Point { until:number; healed:Record<number,number>; pending:Record<number,number>; noticeAt:Record<number,number>; }
export const breakDuration=(wave:number)=>wave%5===0?20:wave%3===0?10:6;
export function deliveryStage(d:Delivery,time:number){const age=time-d.startAt;return age<0?'waiting':age<1?'approach':age<3?'parachute':'landed';}
export const damageStage=(hp:number,maxHp:number)=>hp<=0?0:hp/maxHp<=.2?3:hp/maxHp<=.35?2:hp/maxHp<=.5?1:0;
