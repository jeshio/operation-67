import { WebSocketTransport, type TransportOptions } from '@colyseus/ws-transport';
/** Count actual WebSocket payloads, including framework state and checkpoints. */
export class MeasuredTransport extends WebSocketTransport {
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
