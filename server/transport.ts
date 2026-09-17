import { WebSocketTransport, type TransportOptions } from '@colyseus/ws-transport';
import type { IncomingMessage, ServerResponse } from 'node:http';
/** Count actual WebSocket payloads, including framework state and checkpoints. */
export class MeasuredTransport extends WebSocketTransport {
 /** Colyseus installs its public HTTP router at listen time. This application
  * deliberately exposes only its own HTTP API; internal matchMaker calls and
  * WebSocket seat reservations are unaffected. Install before the next I/O turn. */
 httpHandler?: (req:IncomingMessage,res:ServerResponse)=>void;
 override listen(port:number,hostname?:string,backlog?:number,listeningListener?:()=>void){
  return super.listen(port,hostname,backlog,()=>{
   listeningListener?.();
   if(this.httpHandler){this.server!.removeAllListeners('request');this.server!.on('request',this.httpHandler);}
  });
 }
 queueMetrics(){const sockets=[...this.wss.clients];return{connections:sockets.length,bufferedBytes:sockets.reduce((sum,s)=>sum+s.bufferedAmount,0),maxBufferedBytes:Math.max(0,...sockets.map(s=>s.bufferedAmount))};}
 constructor(options:TransportOptions,metrics:{wireBytesIn:number;wireBytesOut:number}){
  super(options);
  this.wss.on('connection',socket=>{
   socket.on('message',data=>{metrics.wireBytesIn+=Array.isArray(data)?data.reduce((n,b)=>n+b.length,0):data.byteLength;});
   const send=socket.send.bind(socket);
   socket.send=((...args:Parameters<typeof socket.send>)=>{
    const data=args[0];metrics.wireBytesOut+=typeof data==='string'?Buffer.byteLength(data):data instanceof ArrayBuffer?data.byteLength:ArrayBuffer.isView(data)?data.byteLength:Buffer.byteLength(String(data));
    send(...args);
   }) as typeof socket.send;
  });
 }
}
