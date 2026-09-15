import type { Input, GameEvent } from './simulation';
import type { BattleState, CoopCheckpoint } from './coop';
import { NET } from './net/config';
export const PROTOCOL = NET.version;
export type JoinRequest = {type:'join'; mode:'quick'|'private'|'public'|'code'; code?:string; name:string; skin:number};
export interface Participant {sessionId?:string; id:number; name:string; skin:number; connected:boolean; foreground:boolean; present:boolean;}
export type RecoveryStage = 'waiting'|'preparing'|'running'|'handoff'|'recovering'|'closed';
export interface RoomInfo {
  revision:number; reason:string; code:string; matchId:string; public:boolean; owner:number; round:number; countdown:number|null;
  host:number; backup:number; hostEpoch:number; stage:RecoveryStage; players:Participant[];
}
export interface PresenceEvent {id:number; playerId:number; name:string; kind:'joined'|'left'|'lost'|'returned';}
export interface Envelope {matchId:string; round:number; hostEpoch:number;}
export interface InputFrame extends Envelope {playerId:number; seq:number; controlEpoch:number; input:Input;}
export interface InputBatch extends Envelope {kind:'input'; frames:InputFrame[];}
export interface WorldSnapshot extends Envelope {
  kind:'snapshot'; tick:number; state:BattleState; ack:Record<string,number>; events:GameEvent[]; eventCursor:number;
}
export interface BattleCheckpoint extends Envelope {
  version:1; tick:number; simulation:CoopCheckpoint; ack:Record<string,number>; eventCursor:number; actions:Record<string,number[]>;
}
export interface HostAssignment extends Envelope {host:number; checkpoint:BattleCheckpoint|null; players:Participant[]; nonce:string;}
export interface LinkStats {peerId:number; directRtt:number|null; relayRtt:number|null; loss:number; route:'relay'|'direct';}
export interface HealthReport {foreground:boolean; stepP95:number|null; serverRtt:number|null; links:LinkStats[];}
export interface Commit extends Envelope {tick:number; state:Pick<BattleState,'score'|'wave'|'elapsed'|'phase'>; names:string[];}
export interface GameError {code:'VERSION'|'FULL'|'NOT_FOUND'|'INVALID'|'BUSY'|'CLOSED'|'SESSION_REPLACED'|'RECOVERY_TIMEOUT'; message:string;}
export type GamePacket = InputBatch | WorldSnapshot | {kind:'ping'|'pong'; id:number; at:number} | {kind:'route-request'|'route-ready';id:number};
export function validInput(value:unknown):value is Input {
  if (!value || typeof value!=='object') return false;
  const i=value as Input;
  return [i.x,i.z,i.aim?.x,i.aim?.z].every(n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=100)
    &&typeof i.fire==='boolean'&&typeof i.power==='boolean'
    &&(i.dash===undefined||typeof i.dash==='boolean')&&(i.firePressed===undefined||typeof i.firePressed==='boolean')
    &&(i.shotId===undefined||(typeof i.shotId==='string'&&i.shotId.length<=100));
}
export function matches(a:Envelope|null|undefined,b:Envelope|null|undefined) {return !!a&&!!b&&a.matchId===b.matchId&&a.round===b.round&&a.hostEpoch===b.hostEpoch;}
export function validBatch(value:unknown, identity:number, context:Envelope):value is InputBatch {
  const b=value as InputBatch;
  return !!b&&b.kind==='input'&&matches(b,context)&&Array.isArray(b.frames)&&b.frames.length>0&&b.frames.length<=NET.queueFrames
    &&b.frames.every(f=>matches(f,context)&&f.playerId===identity&&Number.isSafeInteger(f.seq)&&f.seq>=0&&Number.isSafeInteger(f.controlEpoch)&&f.controlEpoch>=0&&validInput(f.input));
}
