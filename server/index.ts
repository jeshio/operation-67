import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { RoomService, type Peer } from './rooms';
import { emptyInput } from '../src/simulation';

export function createGameServer({root=resolve('dist'),origins=process.env.ALLOWED_ORIGINS?.split(',')??[],maxRooms=Math.min(32,Math.max(1,Number(process.env.MAX_ROOMS)||32))}={}){
  const rooms=new RoomService(maxRooms);
  const http=createServer(async(req,res)=>{
    if(req.url==='/health'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:true,rooms:rooms.rooms.size}));return;}
    try{
      const pathname=decodeURIComponent(new URL(req.url??'/', 'http://localhost').pathname);
      const file=resolve(root,`.${pathname==='/'?'/index.html':pathname}`);if(!file.startsWith(resolve(root)+sep))throw Error();
      const mime:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.wav':'audio/wav','.ttf':'font/ttf','.woff2':'font/woff2','.svg':'image/svg+xml'};
      const content=await readFile(file);res.writeHead(200,{'Content-Type':mime[extname(file)]??'application/octet-stream','Cache-Control':extname(file)==='.html'?'no-cache':'public, max-age=3600','X-Content-Type-Options':'nosniff'});res.end(content);
    }catch{res.writeHead(404);res.end('Not found');}
  });
  const wss=new WebSocketServer({noServer:true,maxPayload:4096,perMessageDeflate:false});
  http.on('upgrade',(req,socket,head)=>{
    const origin=req.headers.origin;
    if(req.url!=='/ws'||(origin&&origins.length&&!origins.includes(origin))){socket.destroy();return;}
    if(wss.clients.size>=160){socket.destroy();return;}wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws,req));
  });
  wss.on('connection',ws=>{
    let pong=true;const peer:Peer={seq:-1,ack:-1,input:emptyInput(),inputAt:0,messages:0,windowAt:0,send:m=>{if(ws.readyState===WebSocket.OPEN){if(ws.bufferedAmount>1_000_000){ws.close(1013);return;}ws.send(JSON.stringify(m));}},close:()=>ws.close(1000,'Открыта другая вкладка')};
    ws.on('message',raw=>{try{rooms.receive(peer,JSON.parse(raw.toString()));}catch{ws.close(1007);}});
    ws.on('close',()=>{rooms.rooms.size&&peer.room?.disconnect(peer,Date.now());clearInterval(heartbeat);});
    ws.on('error',()=>ws.close());ws.on('pong',()=>{pong=true;});
    const heartbeat=setInterval(()=>{if(!pong){ws.terminate();return;}pong=false;ws.ping();},10000);heartbeat.unref();
  });
  let previous=performance.now(),accumulator=0,frames=0;
  const timer=setInterval(()=>{const now=performance.now();accumulator+=Math.min(.1,(now-previous)/1000);previous=now;while(accumulator>=1/60){rooms.step(1/60);accumulator-=1/60;if(++frames%3===0)for(const room of rooms.rooms.values())room.broadcast();}},8);
  timer.unref();
  return {http,rooms,close:()=>{clearInterval(timer);for(const ws of wss.clients)ws.terminate();wss.close();return new Promise<void>(r=>http.close(()=>r()));}};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const app=createGameServer(),port=Number(process.env.PORT??5179),host=process.env.HOST??'127.0.0.1';
  app.http.listen(port,host,()=>console.log(`ОПЕРАЦИЯ 67 · мультиплеер: http://${host}:${port}/`));
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>void app.close().then(()=>process.exit()));
}
