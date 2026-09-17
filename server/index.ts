import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server, matchMaker } from '@colyseus/core';
import { MeasuredTransport } from './transport';
import { BattleRoom, RoomRegistry } from './rooms';
import { NET } from '../src/net/config';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { RateLimit, RequestError, clientAddress, configuredOrigins, configuredProxies, object, originAllowed, readJoinBody, securityHeaders } from './security';
import { release } from './release';

const errors:Record<string,string>={VERSION:'Обнови страницу: версия игры изменилась.',FULL:'В комнате уже четыре игрока.',NOT_FOUND:'Комната не найдена или уже закрыта.',INVALID:'Проверь имя и выбранный танк.',BUSY:'Сервер временно занят. Попробуй позже.',RATE_LIMIT:'Слишком много попыток. Подожди немного.'};
export function roomLimitFromEnvironment(env:NodeJS.ProcessEnv=process.env){
  return Math.min(env.GAME_QA==='1'?128:64,Math.max(1,Math.floor(Number(env.MAX_ROOMS)||4)));
}
export function createGameServer({root=resolve('dist'),origins=process.env.ALLOWED_ORIGINS?.split(',')??[],maxRooms=roomLimitFromEnvironment(),qa=process.env.GAME_QA==='1',production=process.env.NODE_ENV==='production',trustedProxies=configuredProxies(process.env.TRUSTED_PROXY_IPS??'')}={}){
  origins=configuredOrigins(origins,production);
  if(production&&qa)throw Error('QA is forbidden in production.');
  const registry=new RoomRegistry(maxRooms);
  const lag=qa?monitorEventLoopDelay({resolution:10}):undefined;lag?.enable();
  const http=createServer({requestTimeout:10000,headersTimeout:10000,keepAliveTimeout:5000,maxHeaderSize:16384});
  http.maxConnections=512;http.maxRequestsPerSocket=1000;
  const joins=new RateLimit(60,60000),codes=new RateLimit(24,60000),creates=new RateLimit(8,60000),globalJoins=new RateLimit(240,60000,1),upgrades=new RateLimit(60,60000);
  let listening=false,closing=false,closed:Promise<void>|undefined;
  const json=(res:ServerResponse,status:number,body:unknown)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
  const handler=async(req:IncomingMessage,res:ServerResponse)=>{
    securityHeaders(res,origins);
    const origin=req.headers.origin;
    if(!originAllowed(origin,origins,production)){json(res,403,{code:'FORBIDDEN'});return;}
    if(origin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');}
    let pathname:string;
    try{pathname=decodeURIComponent(new URL(req.url??'/', 'http://localhost').pathname);}catch{json(res,400,{code:'INVALID'});return;}
    if(pathname.includes('\\')||pathname.includes('\0')||pathname.split('/').some(part=>part.startsWith('.'))){json(res,404,{code:'NOT_FOUND'});return;}
    if(pathname.startsWith('/matchmake')||pathname.startsWith('/__')){json(res,404,{code:'NOT_FOUND'});return;}
    if(req.method==='OPTIONS'){
      if(pathname!=='/api/join'){json(res,404,{code:'NOT_FOUND'});return;}
      res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type');res.writeHead(204);res.end();return;
    }
    if(pathname==='/api/join'){
      if(req.method!=='POST'){res.setHeader('Allow','POST, OPTIONS');json(res,405,{code:'INVALID'});return;}
      if(!listening||closing||registry.draining){json(res,503,{code:'BUSY',message:errors.BUSY});return;}
      const address=clientAddress(req,trustedProxies);
      const rateError=()=>{res.setHeader('Retry-After','10');json(res,429,{code:'RATE_LIMIT',message:errors.RATE_LIMIT});};
      if(!joins.take(address)||!globalJoins.take('all')){rateError();return;}
      try{
        const body=await readJoinBody(req);
        if(!object(body))throw new RequestError(400,'INVALID');
        if(object(body.request)){
          const mode=body.request.mode;
          if(mode==='code'&&!codes.take(address)){rateError();return;}
          if(['private','public','quick'].includes(mode)&&!creates.take(address)){rateError();return;}
        }
        const result=await registry.join(body as Parameters<RoomRegistry['join']>[0]);
        if(!res.destroyed)json(res,200,result);
      }catch(error){
        const code=error instanceof Error&&errors[error.message]?error.message:'INVALID';
        if(error instanceof RequestError){res.setHeader('Connection','close');res.once('finish',()=>req.destroy());}
        if(!res.destroyed)json(res,error instanceof RequestError?error.status:code==='BUSY'?503:code==='NOT_FOUND'?404:400,{code,message:errors[code]});
      }
      return;
    }
    if(!['GET','HEAD'].includes(req.method??'')){res.setHeader('Allow','GET, HEAD');json(res,405,{code:'INVALID'});return;}
    if(pathname==='/health'){json(res,200,{ok:true,version:NET.version,rooms:registry.rooms.size,maxRooms:registry.maxRooms,release,draining:registry.draining});return;}
    if(pathname==='/ready'){const ready=listening&&!closing&&!registry.draining;json(res,ready?200:503,{ok:ready,release});return;}
    if(pathname==='/api/ping'){json(res,200,{ok:true,version:NET.version});return;}
    if(pathname==='/api/rooms'){json(res,200,registry.directory());return;}
    if(pathname==='/api/qa'&&qa){json(res,200,{...registry.debug(),runtime:{eventLoopP95Ms:(lag?.percentile(95)??0)/1e6,eventLoopP99Ms:(lag?.percentile(99)??0)/1e6,...transport.queueMetrics()}});lag?.reset();return;}
    if(pathname.startsWith('/api/')){json(res,404,{code:'NOT_FOUND'});return;}
    try{
      const directory=await realpath(root),file=await realpath(resolve(directory,`.${pathname==='/'?'/index.html':pathname}`));
      if(!file.startsWith(directory+sep))throw Error();
      if(file.slice(directory.length+1).split(sep).some(part=>part.startsWith('.')))throw Error();
      const mime:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.wav':'audio/wav','.ttf':'font/ttf','.woff2':'font/woff2','.svg':'image/svg+xml'};
      if(!mime[extname(file)]||extname(file)==='.html'&&file!==resolve(directory,'index.html')&&!qa)throw Error();
      if(!(await stat(file)).isFile())throw Error();
      const content=await readFile(file);res.writeHead(200,{'Content-Type':mime[extname(file)],'Content-Length':content.byteLength,'Cache-Control':extname(file)==='.html'?'no-cache':'public, max-age=3600'});res.end(req.method==='HEAD'?undefined:content);
    }catch{json(res,404,{code:'NOT_FOUND'});}
  };
  const transport=new MeasuredTransport({server:http,maxPayload:NET.maxFrameBytes+4096,perMessageDeflate:false,verifyClient:(info:{origin:string;req:IncomingMessage})=>!closing&&!registry.draining&&originAllowed(info.origin,origins,production)&&upgrades.take(clientAddress(info.req,trustedProxies))},registry.metrics);
  transport.httpHandler=(req,res)=>{void handler(req,res).catch(()=>{if(!res.headersSent)json(res,500,{code:'INTERNAL'});else res.destroy();});};
  // Only /api/join may grant seats. HTTP exposure is disabled independently of room privacy.
  matchMaker.controller.exposedMethods=[];
  const game=new Server({transport,greet:false,gracefullyShutdown:false});
  class RegisteredRoom extends BattleRoom {override onCreate(options:any){if(registry.draining||registry.rooms.size>=maxRooms||options.version!==NET.version||!registry.validIdentity(options.identity))throw Error('BUSY');super.onCreate({...options,registry});}}
  game.define('battle',RegisteredRoom);
  // Covers direct game.listen(), including the existing Colyseus testing harness.
  http.on('listening',()=>{listening=true;});http.on('close',()=>{listening=false;});
  return{http,rooms:registry,game,
    listen:(port=5179,host='127.0.0.1')=>game.listen(port,host),
    drain:(enabled=true)=>{if(!closing)registry.draining=enabled;},
    close:()=>{closing=true;registry.draining=true;lag?.disable();return closed??=game.gracefullyShutdown(false);},
  };
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(Number(process.versions.node.split('.')[0])<22)throw Error('Use a supported Node.js 22.12+ or Node.js 24 LTS.');
  if(process.env.NODE_ENV==='production'&&!/^[a-f0-9]{40}$/.test(release.commit))throw Error('Production requires an identified build.');
  const app=createGameServer();
  void app.listen(Number(process.env.PORT??5179),process.env.HOST??'127.0.0.1').then(()=>console.log('ОПЕРАЦИЯ 67 · сервер готов')).catch(()=>{console.error('Server startup failed.');process.exit(1);});
  let stopping=false;
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{
    if(stopping)return;stopping=true;
    const timeout=setTimeout(()=>{console.error('Shutdown deadline exceeded.');process.exit(1);},10000);timeout.unref();
    void app.close().then(()=>process.exit(0),()=>process.exit(1));
  });
  process.on('SIGUSR2',()=>app.drain(true));process.on('SIGHUP',()=>app.drain(false));
}
