import { encode, decode } from '@msgpack/msgpack';
import { NET } from './config';
export function pack(value:unknown):Uint8Array {const bytes=encode(value,{ignoreUndefined:true});if(bytes.byteLength>NET.maxFrameBytes)throw Error('Frame too large');return bytes;}
export function unpack<T>(value:ArrayBuffer|Uint8Array):T {const bytes=value instanceof Uint8Array?value:new Uint8Array(value);if(bytes.byteLength>NET.maxFrameBytes)throw Error('Frame too large');return decode(bytes,{maxArrayLength:8192,maxMapLength:8192,maxStrLength:65536,maxBinLength:NET.maxFrameBytes}) as T;}
const HEADER=12, MAGIC=0x6705;
export function fragments(bytes:Uint8Array,id:number):Uint8Array[] {
  if(bytes.length>NET.maxFrameBytes)throw Error('Frame too large');const total=Math.ceil(bytes.length/NET.chunkBytes)||1;
  return Array.from({length:total},(_,index)=>{const part=bytes.subarray(index*NET.chunkBytes,(index+1)*NET.chunkBytes),out=new Uint8Array(HEADER+part.length),view=new DataView(out.buffer);view.setUint16(0,MAGIC);view.setUint32(2,id);view.setUint16(6,index);view.setUint16(8,total);view.setUint16(10,part.length);out.set(part,HEADER);return out;});
}
export class Assembler {
  private pending=new Map<number,{at:number;parts:Map<number,Uint8Array>;total:number;bytes:number}>();
  receive(data:ArrayBuffer|Uint8Array,now:number):Uint8Array|undefined {
    for(const [id,a] of this.pending)if(now-a.at>NET.assemblyMs)this.pending.delete(id);
    const bytes=data instanceof Uint8Array?data:new Uint8Array(data);if(bytes.length<HEADER)return;
    const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),id=view.getUint32(2),index=view.getUint16(6),total=view.getUint16(8);
    if(view.getUint16(0)!==MAGIC||!total||total>NET.maxChunks||index>=total||view.getUint16(10)!==bytes.length-HEADER)return;
    let a=this.pending.get(id);if(!a){if(this.pending.size>=8)this.pending.delete(this.pending.keys().next().value!);a={at:now,parts:new Map(),total,bytes:0};this.pending.set(id,a);}
    if(a.total!==total||a.parts.has(index))return;a.parts.set(index,bytes.slice(HEADER));a.bytes+=bytes.length-HEADER;
    if(a.bytes>NET.maxFrameBytes){this.pending.delete(id);return;}if(a.parts.size!==total)return;
    const out=new Uint8Array(a.bytes);let at=0;for(let i=0;i<total;i++){const part=a.parts.get(i)!;out.set(part,at);at+=part.length;}this.pending.delete(id);return out;
  }
  clear(){this.pending.clear();}
}
