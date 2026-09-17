import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from '@colyseus/core';
import { MeasuredTransport } from './transport';
import { BattleRoom, RoomRegistry } from './rooms';
import { NET } from '../src/net/config';
import { monitorEventLoopDelay } from 'node:perf_hooks';
const errors:Record<string,string>={VERSION:'Обнови страницу: версия игры изменилась.',FULL:'В комнате уже четыре игрока.',NOT_FOUND:'Комната не найдена или уже закрыта.',INVALID:'Проверь имя и выбранный танк.',BUSY:'Все комнаты заняты. Попробуй позже.'};
export function roomLimitFromEnvironment(env:NodeJS.ProcessEnv=process.env){
  return Math.min(env.GAME_QA==='1'?128:64,Math.max(1,Math.floor(Number(env.MAX_ROOMS)||4)));
}
export function createGameServer({root=resolve('dist'),origins=process.env.ALLOWED_ORIGINS?.split(',')??[],maxRooms=roomLimitFromEnvironment(),qa=process.env.GAME_QA==='1'}={}){
  const registry=new RoomRegistry(maxRooms);
  const lag=qa?monitorEventLoopDelay({resolution:10}):undefined;lag?.enable();
  const http=createServer();
  const handler=async(req:IncomingMessage,res:ServerResponse)=>{
    const origin=req.headers.origin;
    if(origin&&origins.length&&!origins.includes(origin)){res.writeHead(403);res.end();return;}
    if(origin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Headers','Content-Type');}
    if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
    const json=(status:number,body:unknown)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
    const pathname=new URL(req.url??'/', 'http://localhost').pathname;
    if(pathname==='/health'){json(200,{ok:true,version:NET.version,rooms:registry.rooms.size,maxRooms:registry.maxRooms});return;}
    if(pathname==='/api/ping'){json(200,{ok:true,version:NET.version});return;}
    if(pathname==='/api/rooms'){json(200,registry.directory());return;}
    if(pathname==='/api/qa'&&qa){json(200,{...registry.debug(),runtime:{eventLoopP95Ms:(lag?.percentile(95)??0)/1e6,eventLoopP99Ms:(lag?.percentile(99)??0)/1e6,...transport.queueMetrics()}});lag?.reset();return;}
    if(pathname==='/api/join'&&req.method==='POST'){
      try{
        let size=0;const parts:Buffer[]=[];
        for await(const chunk of req){size+=chunk.length;if(size>NET.maxInputBytes){json(413,{code:'INVALID',message:errors.INVALID});return;}parts.push(chunk);}
        const result=await registry.join(JSON.parse(Buffer.concat(parts).toString()));json(200,result);
      }catch(error){const code=error instanceof Error&&errors[error.message]?error.message:'INVALID';json(code==='BUSY'?503:code==='NOT_FOUND'?404:400,{code,message:errors[code]});}
      return;
    }
    try{
      const file=resolve(root,`.${decodeURIComponent(pathname)==='/'?'/index.html':decodeURIComponent(pathname)}`);if(!file.startsWith(resolve(root)+sep))throw Error();
      const mime:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.wav':'audio/wav','.ttf':'font/ttf','.woff2':'font/woff2','.svg':'image/svg+xml'};
      const content=await readFile(file);res.writeHead(200,{'Content-Type':mime[extname(file)]??'application/octet-stream','Cache-Control':extname(file)==='.html'?'no-cache':'public, max-age=3600','X-Content-Type-Options':'nosniff'});res.end(content);
    }catch{res.writeHead(404);res.end('Not found');}
  };
  const transport=new MeasuredTransport({server:http,maxPayload:NET.maxFrameBytes+4096,perMessageDeflate:false,verifyClient:(info:{origin:string})=>!info.origin||!origins.length||origins.includes(info.origin)},registry.metrics);
  const game=new Server({transport,greet:false,gracefullyShutdown:false,express:app=>{app.get('/',handler);app.use(handler);}});
  class RegisteredRoom extends BattleRoom {override onCreate(options:any){if(registry.rooms.size>=maxRooms||options.version!==NET.version||!registry.validIdentity(options.identity))throw Error('BUSY');super.onCreate({...options,registry});}}
  game.define('battle',RegisteredRoom);
  return{http,rooms:registry,game,listen:(port=5179,host='127.0.0.1')=>game.listen(port,host),close:()=>{lag?.disable();return game.gracefullyShutdown(false);}};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(Number(process.versions.node.split('.')[0])<22)throw Error('Colyseus requires Node.js 22 or newer. Use Node.js 24.');
  const app=createGameServer();void app.listen(Number(process.env.PORT??5179),process.env.HOST??'127.0.0.1').then(()=>console.log('ОПЕРАЦИЯ 67 · Colyseus · игрок-хост'));
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>void app.close().then(()=>process.exit()));
}
