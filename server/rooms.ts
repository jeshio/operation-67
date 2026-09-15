import { Room, matchMaker, definePlugins, type Client } from '@colyseus/core';
import { WebRTCPlugin } from 'colyseus/plugins/webrtc';
import { RoomState } from './state';
import { rankRooms } from './matchmaking';
import { BattleCoordinator } from './coordinator';
import { NET } from '../src/net/config';
import { pack, unpack } from '../src/net/codec';
import { matches, validBatch, type BattleCheckpoint, type GamePacket, type HealthReport, type RoomInfo, type JoinRequest } from '../src/protocol';
import { randomBytes } from 'node:crypto';
interface JoinOptions {identity:string;name:string;skin:number;foreground:boolean;public:boolean;version:number;registry:RoomRegistry;}
class CheckedWebRTCPlugin extends WebRTCPlugin {
  constructor(gate:(client:Client,size:number)=>boolean){super();
    for(const [type,fn] of Object.entries(this.messages)){
      (this.messages as Record<string,Function>)[type]=(client:Client,message:unknown)=>{
        const size=JSON.stringify(message??null).length;
        if(size<=NET.maxSignalBytes&&gate(client,size))(fn as Function)(client,message);
      };
    }
  }
}
export class BattleRoom extends Room<{state:RoomState}> {
  plugins=definePlugins({webrtc:new CheckedWebRTCPlugin((client,size)=>this.limit(client,size))});
  state=new RoomState();coordinator!:BattleCoordinator;registry!:RoomRegistry;
  private peers=new Map<number,Client>();private identities=new Map<string,number>();private rates=new Map<string,{at:number;count:number;bytes:number}>();
  onCreate(options:JoinOptions){
    this.registry=options.registry;this.maxClients=NET.players;this.autoDispose=false;this.setPatchRate(100);
    const code=this.registry.code();
    this.coordinator=new BattleCoordinator(this.roomId,code,options.public,{
      send:(id,type,value)=>{const peer=this.peers.get(id);if(peer)peer.send(type,['backup','candidate-check'].includes(type)?pack(value):value);},
      broadcast:(type,value)=>this.broadcast(type,value),
      changed:info=>{this.state.update(info);this.broadcast('info',info);},
      closed:()=>{void this.disconnect();},
    });
    this.registry.rooms.set(this.roomId,this);
    this.setMetadata({code,public:options.public,version:NET.version});
    this.clock.setInterval(()=>this.coordinator.tick(),50);
    this.onMessage('hello',client=>{if(!this.limit(client,32))return;const id=this.id(client);if(id!==undefined){client.send('joined',{id,info:this.coordinator.info});const cp=this.coordinator.checkpoints.at(-1);if(cp)client.send('backup',pack(cp));}});
    this.onMessage('ping',(client,data)=>{if(this.limit(client,32)&&Number.isFinite(data?.at))client.send('pong',{at:data.at});});
    this.onMessage('start',client=>{if(this.limit(client,32)){const id=this.id(client);if(id!==undefined)this.coordinator.start(id);}});
    this.onMessage('leave',client=>{const id=this.id(client);if(id!==undefined){this.coordinator.disconnect(id,true);this.peers.delete(id);}void client.leave();});
    this.onMessage('ready',(client,data)=>{if(!this.limit(client,64))return;const id=this.id(client);if(id!==undefined&&typeof data?.nonce==='string')this.coordinator.ready(id,data.nonce);});
    this.onMessage('lease-request',(client,data)=>{const id=this.id(client);if(id!==undefined&&this.limit(client,64)&&Number.isSafeInteger(data?.nonce))this.coordinator.renew(id,data);});
    for(const type of ['checkpoint','host-stopped'])this.onMessage(type,(client,data)=>{
      const id=this.id(client);if(id===undefined||!(data instanceof Uint8Array)||!this.limit(client,data.byteLength))return;
      try{this.coordinator.checkpoint(id,unpack<BattleCheckpoint>(data),type==='host-stopped');}catch{this.invalid(client);}
    });
    this.onMessage('health',(client,data:HealthReport)=>{
      const id=this.id(client);if(id===undefined||!this.limit(client,512)||!data||typeof data.foreground!=='boolean'||!Array.isArray(data.links)||data.links.length>3)return;
      const metric=(n:unknown)=>n===null||typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=10000;
      if(!metric(data.stepP95)||!metric(data.serverRtt)||!data.links.every(l=>l&&Number.isSafeInteger(l.peerId)&&metric(l.directRtt)&&metric(l.relayRtt)&&Number.isFinite(l.loss)&&l.loss>=0&&l.loss<=1))return;
      this.coordinator.health(id,data);
    });
    this.onMessage('relay',(client,data)=>{
      const id=this.id(client);if(id===undefined||!Array.isArray(data?.targets)||data.targets.length>3||!(data.bytes instanceof Uint8Array)||!this.limit(client,data.bytes.length))return;
      let packet:GamePacket;try{packet=unpack<GamePacket>(data.bytes);}catch{return this.invalid(client);}
      if(!packet||typeof packet!=='object')return;
      if(packet.kind==='snapshot'){if(!this.coordinator.authorized(id)||!matches(packet,this.coordinator.context)||!Number.isSafeInteger(packet.tick))return;}
      else if(packet.kind==='input'){if(!validBatch(packet,id,this.coordinator.context)||data.targets.some((n:number)=>n!==this.coordinator.info.host))return;}
      else if(!['ping','pong'].includes(packet.kind)||!Number.isSafeInteger((packet as any).id)||!Number.isFinite((packet as any).at)||data.bytes.length>256)return;
      for(const target of new Set<number>(data.targets)){if(target===id)continue;const peer=this.peers.get(target);if(peer){const buffered=(peer.ref as {bufferedAmount?:number}).bufferedAmount??0;if(buffered>NET.maxBufferedBytes)continue;peer.send('relay',{sender:id,bytes:data.bytes});this.registry.metrics.bytesOut+=data.bytes.length;}}
      this.registry.metrics.bytesIn+=data.bytes.length;
    });
    this.onMessage('route',(client,data)=>{const id=this.id(client);if(id!==undefined&&this.limit(client,64)&&['relay','direct'].includes(data?.route))this.registry.log({matchId:this.roomId,hostEpoch:this.coordinator.info.hostEpoch,playerId:id,route:data.route,peerId:data.peerId});});
  }
  onAuth(_client:Client,options:JoinOptions){
    if(options.version!==NET.version||!this.registry.validIdentity(options.identity))throw Error('VERSION');
    if(typeof options.name!=='string'||!/^([\p{L}\p{N} _.-]){1,16}$/u.test(options.name)||!Number.isInteger(options.skin)||options.skin<0||options.skin>5||typeof options.foreground!=='boolean')throw Error('INVALID');
    const returning=[...this.coordinator.seats.values()].some(p=>p.identity===options.identity&&p.present);
    if(!returning&&this.coordinator.presentCount>=NET.players)throw Error('FULL');return true;
  }
  onJoin(client:Client,options:JoinOptions){
    const old=[...this.coordinator.seats.values()].find(p=>p.identity===options.identity);
    if(old){const previous=this.peers.get(old.id);if(previous){this.identities.delete(previous.sessionId);previous.send('game-error',{code:'SESSION_REPLACED',message:'Игра открыта в другой вкладке.'});void previous.leave();}}
    const id=this.coordinator.join(options.identity,options.name,options.skin,options.foreground,client.sessionId);
    this.peers.set(id,client);this.identities.set(client.sessionId,id);
  }
  async replaceSession(identity:string){
    const seat=[...this.coordinator.seats.values()].find(p=>p.identity===identity),previous=seat&&this.peers.get(seat.id);
    if(!previous)return;
    previous.send('game-error',{code:'SESSION_REPLACED',message:'Игра открыта в другой вкладке.'});
    previous.leave();
    // Colyseus must release its socket seat before a full room can reserve the replacement.
    const until=performance.now()+1000;
    while(this.clients.includes(previous)&&performance.now()<until)await new Promise(resolve=>setTimeout(resolve,5));
  }
  onLeave(client:Client){const id=this.id(client);this.identities.delete(client.sessionId);this.rates.delete(client.sessionId);if(id!==undefined&&this.peers.get(id)===client){this.peers.delete(id);this.coordinator.disconnect(id);}}
  onDispose(){this.registry.rooms.delete(this.roomId);}
  private id(client:Client){return this.identities.get(client.sessionId);}
  private invalid(client:Client){client.send('game-error',{code:'INVALID',message:'Неверные сетевые данные.'});}
  private limit(client:Client,bytes:number){
    const now=performance.now(),r=this.rates.get(client.sessionId)??{at:now,count:0,bytes:0};const elapsed=Math.max(0,now-r.at);r.count=Math.max(0,r.count-elapsed*.15);r.bytes=Math.max(0,r.bytes-elapsed*2048);r.at=now;r.count++;r.bytes+=bytes;this.rates.set(client.sessionId,r);
    if(bytes>NET.maxFrameBytes||r.count>300||r.bytes>4*NET.maxFrameBytes){void client.leave(4008);return false;}return true;
  }
}
export class RoomRegistry {
  rooms=new Map<string,BattleRoom>();private guests=new Map<string,number>();private serial:Promise<unknown>=Promise.resolve();
  metrics={bytesIn:0,bytesOut:0,wireBytesIn:0,wireBytesOut:0};private events:unknown[]=[];
  constructor(readonly maxRooms=4){}
  code(){let code:string;do{code=randomBytes(3).toString('hex').toUpperCase();}while([...this.rooms.values()].some(r=>r.coordinator.info.code===code));return code;}
  validIdentity(identity:string){return this.guests.has(identity);}
  log(event:unknown){this.events.push({at:Date.now(),event});if(this.events.length>200)this.events.shift();}
  join(body:{version:number;token?:string;request:JoinRequest;foreground?:boolean;rtt?:number}){
    const work=this.serial.then(()=>this.reserve(body));this.serial=work.catch(()=>{});return work;
  }
  private async reserve(body:{version:number;token?:string;request:JoinRequest;foreground?:boolean;rtt?:number}){
    if(body.version!==NET.version)throw Error('VERSION');const r=body.request;
    if(!r||!['quick','private','public','code'].includes(r.mode))throw Error('INVALID');
    const name=typeof r.name==='string'?r.name.trim().normalize('NFC'):'';
    if(!/^[\p{L}\p{N} _.-]{1,16}$/u.test(name)||!Number.isInteger(r.skin)||r.skin<0||r.skin>5)throw Error('INVALID');
    const now=Date.now();for(const [token,at] of this.guests)if(now-at>86400000)this.guests.delete(token);
    const token=body.token&&this.guests.has(body.token)?body.token:randomBytes(24).toString('hex');
    if(this.guests.size>=2000&&!this.guests.has(token))throw Error('BUSY');this.guests.set(token,now);
    const options={identity:token,name,skin:r.skin,foreground:body.foreground!==false,public:r.mode!=='private',version:NET.version};
    let candidates:BattleRoom[]=[];
    if(r.mode==='code'){
      const room=[...this.rooms.values()].find(room=>room.coordinator.info.code===String(r.code).trim().toUpperCase());if(!room)throw Error('NOT_FOUND');candidates=[room];
    }else if(r.mode==='quick'){
      // The joining player's coordinator RTT is a common additive cost for every room.
      candidates=rankRooms([...this.rooms.values()].filter(room=>{
        const c=room.coordinator,phase=c.checkpoints.at(-1)?.simulation.core.phase;return c.info.public&&c.info.stage!=='closed'&&c.presentCount<NET.players&&!['over','dying'].includes(phase??'');
      }).map(room=>({room,hostRtt:room.coordinator.hostLatency(),wave:room.coordinator.checkpoints.at(-1)?.simulation.core.wave??0,players:room.coordinator.presentCount}))).map(r=>r.room);
    }
    for(const room of candidates){try{await room.replaceSession(token);return{token,reservation:await matchMaker.joinById(room.roomId,options)};}catch(error){if(r.mode==='code')throw Error(room.coordinator.presentCount>=NET.players?'FULL':'NOT_FOUND');}}
    if(this.rooms.size>=this.maxRooms)throw Error('BUSY');
    return{token,reservation:await matchMaker.create('battle',options)};
  }
  directory(){return [...this.rooms.values()].filter(r=>r.coordinator.info.public).map(r=>({roomId:r.roomId,players:r.coordinator.presentCount,wave:r.coordinator.checkpoints.at(-1)?.simulation.core.wave??0,hostRtt:r.coordinator.hostLatency()}));}
  debug(){return{process:{uptime:process.uptime(),cpu:process.cpuUsage(),memory:process.memoryUsage()},rooms:[...this.rooms.values()].map(r=>r.coordinator.debug()),metrics:this.metrics,events:this.events};}
}
