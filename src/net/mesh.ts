import { Assembler, fragments, pack, unpack } from './codec';
import { NET } from './config';
import type { GamePacket, LinkStats, Participant } from '../protocol';
interface PeerLink {
  sessionId?:string;pc:RTCPeerConnection; reliable?:RTCDataChannel; fast?:RTCDataChannel; assembler:Assembler;
  direct:{at:number;rtt:number}[];relay:{at:number;rtt:number}[];pending:Map<number,number>;
  relayPending:Map<number,number>;budget:{at:number;count:number;bytes:number};routeRequest?:{id:number;at:number};lastAck:number;probeAt:number;betterAt:number;route:'relay'|'direct';candidates:RTCIceCandidateInit[];makingOffer:boolean;retryAt:number;
}
export class RouteMesh {
  private links=new Map<number,PeerLink>();private serial=0;private probeAt=0;private packetId=0;
  onRoute=(_id:number,_route:'relay'|'direct')=>{};
  onBytes=(_direction:'sent'|'received',_size:number)=>{};
  onGamePacket=(_peer:number,_route:'relay'|'direct',_direction:'sent'|'received',_kind:'input'|'snapshot',_bytes:number)=>{};
  private preferences=new Map<number,'relay'|'direct'>();
  /** Only installed by the separate QA build; the production bundle has no command. */
  declare qaPreference:(peer:number,route:'relay'|'direct'|'auto')=>void;
  constructor(private id:number,private signal:(peer:number,data:unknown)=>void,private relay:(peer:number,bytes:Uint8Array)=>boolean,private receive:(peer:number,packet:GamePacket)=>void,private now=()=>performance.now(),private iceServers:RTCIceServer[]=[{urls:'stun:stun.l.google.com:19302'}]){
    if(import.meta.env?.DEV)this.qaPreference=(peer,route)=>{
      if(route==='auto')this.preferences.delete(peer);else this.preferences.set(peer,route);
      const link=this.links.get(peer);if(link&&route==='relay')this.setRoute(peer,link,'relay');
    };
  }
  setPeers(players:Participant[]){
    const peers=players.filter(p=>p.id!==this.id&&p.connected&&p.present);
    for(const [id,link] of this.links)if(!peers.some(p=>p.id===id&&p.sessionId===link.sessionId)){link.pc?.close();this.links.delete(id);}
    if(typeof RTCPeerConnection==='undefined')return;
    for(const p of peers)if(!this.links.has(p.id)){
      const pc=new RTCPeerConnection({iceServers:this.iceServers});
      const link:PeerLink={sessionId:p.sessionId,pc,assembler:new Assembler(),direct:[],relay:[],pending:new Map(),relayPending:new Map(),budget:{at:this.now(),count:0,bytes:0},lastAck:0,probeAt:0,betterAt:0,route:'relay',candidates:[],makingOffer:false,retryAt:0};this.links.set(p.id,link);
      pc.onicecandidate=e=>{if(e.candidate)this.signal(p.id,{candidate:e.candidate.toJSON()});};
      pc.ondatachannel=e=>this.bind(p.id,link,e.channel);
      pc.onconnectionstatechange=()=>{if(['failed','closed','disconnected'].includes(pc.connectionState))this.setRoute(p.id,link,'relay');};
      if(this.id>p.id){
        this.bind(p.id,link,pc.createDataChannel('control',{ordered:true}));
        this.bind(p.id,link,pc.createDataChannel('frames',{ordered:false,maxRetransmits:0}));
        void this.offer(p.id,link);
      }
    }
  }
  private async offer(id:number,link:PeerLink,restart=false){try{link.makingOffer=true;await link.pc.setLocalDescription(await link.pc.createOffer({iceRestart:restart}));this.signal(id,{description:link.pc.localDescription?.toJSON()});}catch{this.setRoute(id,link,'relay');}finally{link.makingOffer=false;}}
  async acceptSignal(id:number,data:{description?:RTCSessionDescriptionInit;candidate?:RTCIceCandidateInit}){
    const link=this.links.get(id);if(!link)return;
    try{
      if(data.description){
        if(data.description.type==='offer'&&(link.makingOffer||link.pc.signalingState!=='stable'))return;
        await link.pc.setRemoteDescription(data.description);
        for(const c of link.candidates.splice(0))await link.pc.addIceCandidate(c);
        if(data.description.type==='offer'){await link.pc.setLocalDescription(await link.pc.createAnswer());this.signal(id,{description:link.pc.localDescription?.toJSON()});}
      }else if(data.candidate){if(link.pc.remoteDescription)await link.pc.addIceCandidate(data.candidate);else if(link.candidates.length<64)link.candidates.push(data.candidate);}
    }catch{this.setRoute(id,link,'relay');}
  }
  private bind(id:number,link:PeerLink,channel:RTCDataChannel){
    if(channel.label==='control')link.reliable=channel;else if(channel.label==='frames')link.fast=channel;else{channel.close();return;}
    channel.binaryType='arraybuffer';channel.onclose=()=>this.setRoute(id,link,'relay');channel.onerror=()=>this.setRoute(id,link,'relay');
    channel.onopen=()=>{link.lastAck=this.now();};
    channel.onmessage=e=>{
      if(!(e.data instanceof ArrayBuffer))return;
      const now=this.now(),r=link.budget,elapsed=Math.max(0,now-r.at);r.count=Math.max(0,r.count-elapsed*.3)+1;r.bytes=Math.max(0,r.bytes-elapsed*2048)+e.data.byteLength;r.at=now;
      if(e.data.byteLength>NET.chunkBytes+12||r.count>600||r.bytes>4*NET.maxFrameBytes){this.setRoute(id,link,'relay');link.pc.close();return;}
      this.onBytes('received',e.data.byteLength);try{const data=link.assembler.receive(e.data,this.now());if(data)this.packet(id,unpack<GamePacket>(data),'direct',data.length);}catch{/* Invalid peer packets never reach simulation. */}};
  }
  private setRoute(id:number,link:PeerLink,route:'relay'|'direct'){
    if(link.route===route)return;link.route=route;link.betterAt=0;this.onRoute(id,route);
  }
  private sendDirect(link:PeerLink,bytes:Uint8Array,reliable:boolean){
    const channel=reliable?link.reliable:link.fast;if(channel?.readyState!=='open'||channel.bufferedAmount+bytes.length>NET.maxBufferedBytes)return false;
    try{for(const part of fragments(bytes,++this.packetId)){channel.send(part as Uint8Array<ArrayBuffer>);this.onBytes('sent',part.byteLength);}return true;}catch{return false;}
  }
  isDirect(id:number){const l=this.links.get(id);return l?.route==='direct'&&this.now()-l.lastAck<NET.directTimeoutMs;}
  send(id:number,packet:GamePacket,reliable=false){
    const bytes=pack(packet),link=this.links.get(id);
    if(link?.route==='direct'&&this.now()-link.lastAck<NET.directTimeoutMs&&this.sendDirect(link,bytes,reliable)){
      if(packet.kind==='input'||packet.kind==='snapshot')this.onGamePacket(id,'direct','sent',packet.kind,bytes.length);return true;
    }
    if(link)this.setRoute(id,link,'relay');const sent=this.relay(id,bytes);
    if(sent&&(packet.kind==='input'||packet.kind==='snapshot'))this.onGamePacket(id,'relay','sent',packet.kind,bytes.length);return sent;
  }
  receiveRelay(id:number,bytes:Uint8Array){try{this.packet(id,unpack<GamePacket>(bytes),'relay',bytes.length);}catch{/* Invalid frame. */}}
  private packet(id:number,packet:GamePacket,route:'relay'|'direct',bytes=0){
    const link=this.links.get(id),now=this.now();
    if(!packet||typeof packet!=='object')return;
    if(['ping','pong','route-request','route-ready'].includes(packet.kind)&&(!Number.isSafeInteger((packet as any).id)||!Number.isFinite((packet as any).at??0)))return;
    if(packet.kind==='route-request'&&route==='direct'&&link&&Number.isSafeInteger(packet.id)){this.sendDirect(link,pack({kind:'route-ready',id:packet.id}),true);return;}
    if(packet.kind==='route-ready'&&route==='direct'&&link){if(link.routeRequest?.id===packet.id&&now-link.routeRequest.at<NET.directTimeoutMs){link.routeRequest=undefined;if(!(import.meta.env?.DEV&&this.preferences.get(id)==='relay'))this.setRoute(id,link,'direct');}return;}
    if(packet.kind==='ping'){
      const pong:GamePacket={kind:'pong',id:packet.id,at:packet.at};
      if(route==='direct'&&link)this.sendDirect(link,pack(pong),false);else this.relay(id,pack(pong));return;
    }
    if(packet.kind==='pong'){
      if(link){if(route==='direct'){const sent=link.pending.get(packet.id);if(sent===undefined)return;link.pending.delete(packet.id);link.direct.push({at:now,rtt:now-sent});link.lastAck=now;}else{const sent=link.relayPending.get(packet.id);if(sent===undefined)return;link.relayPending.delete(packet.id);link.relay.push({at:now,rtt:now-sent});}}
      return;
    }
    if(packet.kind==='input'||packet.kind==='snapshot')this.onGamePacket(id,route,'received',packet.kind,bytes);
    this.receive(id,packet);
  }
  tick(){
    const now=this.now();
    for(const [id,l] of this.links){
      if(this.id>id&&l.pc.connectionState==='failed'&&!l.makingOffer&&now-l.retryAt>=5000){l.retryAt=now;void this.offer(id,l,true);}
      if(l.route==='direct'&&now-l.lastAck>=NET.directTimeoutMs)this.setRoute(id,l,'relay');
      l.direct=l.direct.filter(s=>now-s.at<=NET.sampleWindowMs);l.relay=l.relay.filter(s=>now-s.at<=NET.sampleWindowMs);
      for(const pending of [l.pending,l.relayPending])for(const [key,at] of pending)if(now-at>NET.sampleWindowMs)pending.delete(key);
      // Short direct probes also detect failure while all tanks stand still.
      const last=l.probeAt;
      if(now-last>=200&&l.fast?.readyState==='open'){l.probeAt=now;const key=++this.serial;l.pending.set(key,now);this.sendDirect(l,pack({kind:'ping',id:key,at:now}),false);}
      if(import.meta.env?.DEV&&this.preferences.has(id)){
        if(this.preferences.get(id)==='relay')this.setRoute(id,l,'relay');
        else if(l.fast?.readyState==='open'&&l.reliable?.readyState==='open'&&l.route!=='direct'&&(!l.routeRequest||now-l.routeRequest.at>=NET.directTimeoutMs)){
          l.routeRequest={id:++this.serial,at:now};this.sendDirect(l,pack({kind:'route-request',id:l.routeRequest.id}),true);
        }
        continue;
      }
      if(l.direct.length>=5&&l.relay.length>=3){const d=p95(l.direct.map(s=>s.rtt))!,r=p95(l.relay.map(s=>s.rtt))!;
        const lost=[...l.pending.values()].filter(at=>now-at>=NET.directTimeoutMs).length;
        if(r-d>=NET.improvementMs&&d<=r*(1-NET.improvementRatio)&&lost===0&&l.reliable?.readyState==='open'){
          l.betterAt ||= now;if(now-l.betterAt>=NET.sampleWindowMs&&l.route!=='direct'&&(!l.routeRequest||now-l.routeRequest.at>=NET.directTimeoutMs)){l.routeRequest={id:++this.serial,at:now};this.sendDirect(l,pack({kind:'route-request',id:l.routeRequest.id}),true);}
        }else l.betterAt=0;
      }
    }
    if(now-this.probeAt>=NET.probeMs){this.probeAt=now;for(const [id,link] of this.links){const key=++this.serial;link.relayPending.set(key,now);this.relay(id,pack({kind:'ping',id:key,at:now}));}}
  }
  stats():LinkStats[]{const now=this.now();return [...this.links].map(([peerId,l])=>({peerId,directRtt:p95(l.direct.map(s=>s.rtt)),relayRtt:p95(l.relay.map(s=>s.rtt)),loss:[...l.pending.values()].filter(at=>now-at>NET.directTimeoutMs).length/Math.max(1,l.direct.length+l.pending.size),route:l.route}));}
  removePeer(id:number){const link=this.links.get(id);if(link){link.pc.close();this.links.delete(id);}}
  close(){for(const l of this.links.values())l.pc.close();this.links.clear();}
}
export function p95(values:number[]):number|null {if(!values.length)return null;const a=[...values].sort((a,b)=>a-b);return a[Math.min(a.length-1,Math.floor(a.length*.95))];}
