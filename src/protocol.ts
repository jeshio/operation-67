import type { Input, GameEvent } from './simulation';
import type { BattleState } from './coop';
export const PROTOCOL=4;
export type JoinRequest={type:'join';mode:'quick'|'private'|'public'|'code';code?:string;name:string;skin:number};
export type ClientMessage=JoinRequest|{type:'hello';version:number;token?:string}|{type:'input';seq:number;round?:number;controlEpoch?:number;input:Input}|{type:'start'}|{type:'resync';request?:number}|{type:'leave'};
export interface RoomInfo {code:string;public:boolean;owner:number;round:number;countdown:number|null;}
export interface PresenceEvent { id: number; playerId: number; name: string; kind: 'joined'|'left'|'lost'|'returned'; }
export type ServerMessage={type:'presence';event:PresenceEvent}|{type:'welcome';token:string}|{type:'joined';id:number;room:RoomInfo}|{type:'snapshot';room:RoomInfo;state:BattleState;ack:number;events:GameEvent[];eventCursor?:number;resync?:number}|{type:'error';message:string}|{type:'left'};
export function validInput(value:unknown):value is Input {
  if(!value||typeof value!=='object')return false;const i=value as Input;
  return [i.x,i.z,i.aim?.x,i.aim?.z].every(n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=100)&&typeof i.fire==='boolean'&&typeof i.power==='boolean'&&(i.dash===undefined||typeof i.dash==='boolean')&&(i.firePressed===undefined||typeof i.firePressed==='boolean');
}
