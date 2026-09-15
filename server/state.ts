import { schema,t } from '@colyseus/schema';
import type { RoomInfo } from '../src/protocol';
const ParticipantState=schema({
 id:t.int16().default(0),name:t.string().default(''),skin:t.uint8().default(0),
 connected:t.boolean().default(false),foreground:t.boolean().default(false),present:t.boolean().default(false),sessionId:t.string().default(''),
},'ParticipantState');
export class RoomState extends schema({
 revision:t.uint32().default(0),reason:t.string().default('created'),matchId:t.string().default(''),code:t.string().default(''),public:t.boolean().default(false),
 owner:t.int16().default(0),round:t.uint32().default(0),countdown:t.int8().default(-1),host:t.int16().default(0),backup:t.int16().default(0),hostEpoch:t.uint32().default(0),stage:t.string().default('waiting'),
 players:t.map(ParticipantState),
},'BattleRoomState') {
 update(info:RoomInfo){
  const {players,countdown,...fields}=info;Object.assign(this,fields);this.countdown=countdown??-1;
  for(const id of this.players.keys())if(!players.some(p=>String(p.id)===id))this.players.delete(id);
  for(const player of players){const id=String(player.id),existing=this.players.get(id);if(existing)existing.assign({...player,sessionId:player.sessionId??''});else this.players.set(id,new ParticipantState({...player,sessionId:player.sessionId??''}));}
 }
}
