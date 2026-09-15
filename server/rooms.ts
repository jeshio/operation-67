import { randomBytes } from 'node:crypto';
import { CoopSimulation } from '../src/coop';
import { emptyInput, type Input, type GameEvent } from '../src/simulation';
import { validInput, PROTOCOL, type ClientMessage, type ServerMessage, type RoomInfo, type PresenceEvent } from '../src/protocol';

export interface Peer { send(message:ServerMessage):void; close():void; token?:string; room?:Room; id?:number; seq:number; ack:number; controlEpoch?:number; input:Input; inputAt:number; messages:number; windowAt:number; }
export class Room {
  sim=new CoopSimulation(); peers=new Map<number,Peer>(); identities=new Map<string,number>(); disconnected=new Map<number,number>();
  owner=-1; round=0; countdown:number|null=null; emptySince:number|null=null; events:GameEvent[]=[]; private nextId=-1; private presenceId=0; private lost=new Set<number>();
  constructor(readonly code:string,readonly publicRoom:boolean){if(publicRoom)this.countdown=3;}
  info():RoomInfo{return{code:this.code,public:this.publicRoom,owner:this.owner,round:this.round,countdown:this.countdown};}
  private notify(id:number,kind:PresenceEvent['kind'],except?:number){
    const m=this.sim.members.get(id);if(!m)return;
    const event:PresenceEvent={id:++this.presenceId,playerId:id,name:m.name,kind};
    for(const [other,p] of this.peers)if(other!==except)p.send({type:'presence',event});
  }
  join(peer:Peer,name:string,skin:number,now:number){
    let id=this.identities.get(peer.token!);
    const old=id===undefined?undefined:this.sim.members.get(id);
    if(!old?.present&&[...this.sim.members.values()].filter(m=>m.present).length>=4)throw Error('В комнате уже четыре игрока.');
    if(id===undefined){if(this.identities.size>=128)throw Error('Комната завершила набор. Создай новый бой.');id=this.nextId--;this.identities.set(peer.token!,id);}
    const wasPresent=!!old?.present, wasLost=this.lost.delete(id);
    const previous=this.peers.get(id);if(previous){previous.room=undefined;previous.close();}
    const used=new Set([...this.sim.members.values()].filter(m=>m.present&&m.id!==id).map(m=>m.name));let display=name;
    for(let i=2;used.has(display);i++)display=`${name.slice(0,12)} ·${i}`;
    this.sim.addMember(id,display,skin);this.peers.set(id,peer);this.disconnected.delete(id);this.emptySince=null;
    peer.room=this;peer.id=id;peer.seq=-1;peer.ack=-1;peer.input=emptyInput();peer.inputAt=now;
    if(!this.peers.has(this.owner))this.owner=id;
    peer.send({type:'joined',id,room:this.info()});this.snapshot(peer,[]);
    if(!wasPresent)this.notify(id,'joined',id);else if(wasLost)this.notify(id,'returned',id);
  }
  disconnect(peer:Peer,now:number,leave=false){
    if(peer.id===undefined||this.peers.get(peer.id)!==peer)return;
    this.peers.delete(peer.id);const m=this.sim.members.get(peer.id)!;m.connected=false;
    this.disconnected.set(peer.id,now);if(leave){m.present=false;this.disconnected.delete(peer.id);this.lost.delete(peer.id);this.notify(peer.id,'left');}
    if(peer.id===this.owner)this.owner=this.peers.keys().next().value??peer.id;
    if(!this.peers.size)this.emptySince=now;peer.room=undefined;
  }
  start(peer:Peer){if(peer.id!==this.owner)throw Error('Следующий бой запускает создатель комнаты.');if(this.sim.phase!=='menu'&&this.sim.phase!=='over')return;this.countdown=3;}
  step(dt:number,now:number){
    for(const [id,since] of this.disconnected){
      if(now-since>=30000){this.sim.members.get(id)!.present=false;this.disconnected.delete(id);this.lost.delete(id);this.notify(id,'left');}
      else if(now-since>=3000&&!this.lost.has(id)){this.lost.add(id);this.notify(id,'lost');}
    }
    if(!this.peers.size)return;
    if(this.countdown!==null){this.countdown=Math.max(0,this.countdown-dt);if(!this.countdown){
      this.countdown=null;this.round++;this.events=[];this.sim.start(false);
      // Commands still in transit belong to the previous battle, including held abilities.
      for(const p of this.peers.values()){p.input=emptyInput();p.inputAt=0;p.controlEpoch=0;}
    }}
    const inputs=new Map<number,Input>();
    for(const [id,p] of this.peers){if(now-p.inputAt<300&&(p.controlEpoch??0)===(this.sim.members.get(id)?.tank.controlEpoch??0))inputs.set(id,p.input);p.ack=p.seq;p.input={...p.input,power:false,dash:false,firePressed:false};}
    const epochs=new Map([...this.sim.members].map(([id,m])=>[id,m.tank.controlEpoch]));
    this.sim.updateAll(dt,inputs);
    for(const [id,p] of this.peers)if(epochs.get(id)!==this.sim.members.get(id)?.tank.controlEpoch){p.input=emptyInput();p.inputAt=0;}
    this.events.push(...this.sim.drainEvents());
  }
  snapshot(peer:Peer,events:GameEvent[],resync?:number){peer.send({type:'snapshot',room:this.info(),state:this.sim.state(),ack:peer.ack,events,eventCursor:this.sim.eventCursor,resync});}
  broadcast(){const events=this.events.splice(0);for(const peer of this.peers.values())this.snapshot(peer,events);}
}
export class RoomService {
  rooms=new Map<string,Room>(); guests=new Map<string,number>();
  constructor(readonly maxRooms=32){}
  receive(peer:Peer,data:unknown,now=Date.now()){
    try{
      // A mobile connection can deliver a second of valid input in one burst.
      // Keep the sustained limit while allowing that burst to drain normally.
      peer.messages=Math.max(0,peer.messages-Math.max(0,now-peer.windowAt)*.09);peer.windowAt=now;
      if(++peer.messages>180)throw Error('Слишком много команд.');
      if(!data||typeof data!=='object')throw Error('Неверное сообщение.');const m=data as ClientMessage;
      if(m.type==='hello'){
        if(m.version!==PROTOCOL)throw Error('Обнови страницу: версия игры изменилась.');
        if(peer.token)return;
        peer.token=typeof m.token==='string'&&this.guests.has(m.token)?m.token:randomBytes(24).toString('hex');
        if(this.guests.size>=2000&&!this.guests.has(peer.token))throw Error('Сервер занят. Попробуй позже.');
        this.guests.set(peer.token,now);peer.send({type:'welcome',token:peer.token});return;
      }
      if(!peer.token)throw Error('Сначала установи соединение.');this.guests.set(peer.token,now);
      if(m.type==='join'){
        if(peer.room)throw Error('Сначала выйди из текущей комнаты.');
        const name=typeof m.name==='string'?m.name.trim().normalize('NFC'):'';
        if(!/^[\p{L}\p{N} _.-]{1,16}$/u.test(name))throw Error('Имя: 1–16 букв, цифр, пробелов, точек или дефисов.');
        if(!Number.isInteger(m.skin)||m.skin<0||m.skin>5)throw Error('Выбери танк.');
        let room:Room|undefined;
        if(m.mode==='code'){room=this.rooms.get(String(m.code).trim().toUpperCase());if(!room)throw Error('Комната не найдена или уже закрыта.');}
        else if(m.mode==='quick')room=[...this.rooms.values()].filter(r=>r.publicRoom&&r.sim.phase!=='over'&&r.sim.phase!=='dying'&&[...r.sim.members.values()].filter(p=>p.present).length<4).sort((a,b)=>a.sim.wave-b.sim.wave)[0];
        else if(m.mode!=='private'&&m.mode!=='public')throw Error('Неверный способ входа.');
        if(!room){if(this.rooms.size>=this.maxRooms)throw Error('Все комнаты заняты. Попробуй позже.');let code:string;do{code=randomBytes(4).toString('hex').slice(0,6).toUpperCase();}while(this.rooms.has(code));room=new Room(code,m.mode!=='private');this.rooms.set(code,room);}
        room.join(peer,name,m.skin,now);
      }else if(m.type==='input'){
        if(!peer.room||!validInput(m.input)||!Number.isSafeInteger(m.seq)||m.seq<0)return;
        if(m.round!==undefined&&m.round!==peer.room.round)return;
        if((m.controlEpoch??0)!==(peer.room.sim.members.get(peer.id!)?.tank.controlEpoch??0))return;
        if(m.seq<=peer.seq)return;peer.seq=m.seq;peer.inputAt=now;peer.controlEpoch=m.controlEpoch??0;
        peer.input={...m.input,firePressed:peer.input.firePressed||m.input.firePressed,power:peer.input.power||m.input.power,dash:peer.input.dash||m.input.dash};
      }else if(m.type==='resync')peer.room?.snapshot(peer,[],Number.isSafeInteger(m.request)?m.request:undefined);
      else if(m.type==='start')peer.room?.start(peer);
      else if(m.type==='leave'){peer.room?.disconnect(peer,now,true);peer.send({type:'left'});}
    }catch(error){peer.send({type:'error',message:error instanceof Error?error.message:'Не удалось выполнить действие.'});}
  }
  step(dt:number,now=Date.now()){
    for(const [code,room] of this.rooms){if(room.emptySince!==null&&now-room.emptySince>=60000){this.rooms.delete(code);continue;}room.step(dt,now);}
    for(const [token,last] of this.guests)if(now-last>86400000)this.guests.delete(token);
  }
}
