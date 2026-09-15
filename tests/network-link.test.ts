import test from 'node:test';
import assert from 'node:assert/strict';
import { NetworkGame } from '../src/network';
import { RoomService, type Peer } from '../server/rooms';
import { emptyInput, type Input } from '../src/simulation';
import type { ServerMessage, ClientMessage } from '../src/protocol';
import { muzzles } from '../src/weapons';

/** Ordered transport, two independent links and real client/server code, driven by a virtual clock. */
function linkFixture(lag=0, fps=60) {
  let now=10000, tick=0, accumulator=0;
  const scheduled:{at:number;run:()=>void}[]=[], sockets:Socket[]=[], clients:NetworkGame[]=[];
  const service=new RoomService();
  const originalWS=Object.getOwnPropertyDescriptor(globalThis,'WebSocket');
  const originalLocation=Object.getOwnPropertyDescriptor(globalThis,'location');
  class Socket {
    static OPEN=1; readyState=1; bufferedAmount=0; dropUp=false; delayUp=lag; delayDown=lag; upAt=0; downAt=0;
    onopen?:()=>void;onmessage?:(e:{data:string})=>void;onclose?:(e:{code:number;reason:string})=>void;onerror?:()=>void;
    sent:ClientMessage[]=[]; received:ServerMessage[]=[];
    peer:Peer={seq:-1,ack:-1,input:emptyInput(),inputAt:0,messages:0,windowAt:0,
      send:message=>{const data=JSON.stringify(message);this.downAt=Math.max(this.downAt,now+this.delayDown);scheduled.push({at:this.downAt,run:()=>{if(this.readyState===1){this.received.push(JSON.parse(data));this.onmessage?.({data});}}});},
      close:()=>this.close()};
    constructor(_url:string){sockets.push(this);scheduled.push({at:now,run:()=>this.onopen?.()});}
    send(data:string){const message=JSON.parse(data);this.sent.push(message);if(this.dropUp)return;this.upAt=Math.max(this.upAt,now+this.delayUp);scheduled.push({at:this.upAt,run:()=>{if(this.readyState===1)service.receive(this.peer,message,now);}});}
    close(){if(this.readyState!==1)return;this.readyState=3;this.peer.room?.disconnect(this.peer,now);this.onclose?.({code:1006,reason:''});}
  }
  Object.defineProperty(globalThis,'WebSocket',{value:Socket,configurable:true,writable:true});
  Object.defineProperty(globalThis,'location',{value:new URL('http://localhost:5179'),configurable:true});
  const pump=()=>{let at:number;while((at=scheduled.findIndex(task=>task.at<=now))>=0)scheduled.splice(at,1)[0].run();};
  const run=(seconds:number,input:(game:NetworkGame,index:number)=>Input=()=>emptyInput())=>{
    for(let f=0;f<Math.round(seconds*240);f++){
      now+=1000/240;tick++;pump();
      if(tick%4===0){service.step(1/60,now);if(tick%12===0)for(const room of service.rooms.values())room.broadcast();pump();}
      if(tick%(240/fps)===0){
        accumulator+=1/fps;
        while(accumulator>=1/60-1e-9){clients.forEach((game,i)=>game.step(input(game,i)));accumulator-=1/60;}
        clients.forEach(game=>game.render(1/fps,Math.max(0,accumulator*60)));pump();
      }
    }
  };
  const add=(code?:string)=>{const game=new NetworkGame(null,'link-test',()=>now);clients.push(game);game.onRound=()=>game.releaseInput();game.onConnectionLoss=()=>game.releaseInput();game.enter({type:'join',mode:code?'code':'private',code,name:`Игрок ${clients.length}`,skin:clients.length-1});run(1);return game;};
  const first=add(), room=sockets[0].peer.room!;assert(room);const second=add(room.code);
  const clearArena=()=>{room.sim.obstacles=[];room.sim.enemies=[];room.sim.portals=[];room.sim.spawnTimer=9999;room.sim.remainingToSpawn=1;room.sim.bullets=[];};
  const start=()=>{first.start();run(3.4+lag/250);assert.equal(room.sim.phase,'playing');clearArena();for(const [i,m] of [...room.sim.members.values()].entries()){m.tank.x=i?8:-8;m.tank.z=0;}room.broadcast();run(.4+lag/1000);};
  const cleanup=()=>{clients.forEach(g=>g.stop());if(originalWS)Object.defineProperty(globalThis,'WebSocket',originalWS);else Reflect.deleteProperty(globalThis,'WebSocket');if(originalLocation)Object.defineProperty(globalThis,'location',originalLocation);else Reflect.deleteProperty(globalThis,'location');};
  return {service,room,first,second,sockets,run,start,clearArena,cleanup,now:()=>now};
}
const driving=(game:NetworkGame):Input=>({...emptyInput(),x:.8,aim:{x:game.view.player.x,z:game.view.player.z-1},fire:true});

for(const fps of [30,60,120])test(`mobile link: ${fps} fps, 120 ms each way, two drivers and five repeat battles`,()=>{
  const f=linkFixture(120,fps);
  try{
    for(let round=0;round<5;round++){
      f.start();const before=[...f.room.sim.members.values()].map(m=>({x:m.tank.x,fired:m.fired}));
      f.run(.8,driving);
      for(const [i,m] of [...f.room.sim.members.values()].entries()){
        assert(m.tank.x>before[i].x+2,'both players move on the server after restarting');
        assert(m.fired>before[i].fired,'both players shoot on the server');
      }
      assert.equal(f.first.error,'');assert.equal(f.second.error,'');
      assert(Math.abs(f.first.view.player.x-f.room.sim.members.get(f.first.id)!.tank.x)<2,'bounded reconciliation under latency');
      // Round reset and acknowledgements travel through the same link as live input.
      for(const m of f.room.sim.members.values()){m.shield=0;f.room.sim.damageTank(m.tank,1000);}
      f.run(1.3);assert.equal(f.room.sim.phase,'over');assert.equal(f.first.state?.phase,'over');
    }
  }finally{f.cleanup();}
});

test('one-way black hole: warn and rejoin the same tank while the brother keeps moving',async()=>{
  const f=linkFixture();
  try{
    f.start();const failed=f.sockets[0],own=f.room.sim.members.get(f.first.id)!,brother=f.room.sim.members.get(f.second.id)!;
    const id=f.first.id, x=own.tank.x, bx=brother.tank.x;
    failed.dropUp=true;f.run(1,driving);
    assert.equal(own.tank.x,x,'no commands reached the server');assert(brother.tank.x>bx+3,'the other link keeps working');
    assert.match(f.first.connectionNotice,/задерж/,'do not silently rubber-band forever');
    f.run(1.7,driving);assert.equal(failed.readyState,3,'replace a half-open socket even when snapshots still arrive');
    await new Promise(r=>setTimeout(r,550));f.run(1);
    assert(f.first.connected);assert.equal(f.first.id,id);assert.equal(f.room.sim.members.size,2,'reconnect does not create another tank');
    // Late callbacks from the replaced connection cannot undo the recovered identity/sequence.
    failed.onmessage?.({data:JSON.stringify({type:'joined',id:123,room:f.room.info()})});failed.onclose?.({code:1000,reason:'old socket'});
    assert.equal(f.first.id,id);assert(f.first.connected);
    assert(f.first.needsResume);f.first.continue();const fired=own.fired;f.run(.8,driving);assert(own.tank.x>x+2);assert(own.fired>fired);
  }finally{f.cleanup();}
});

test('backpressure keeps only current controls, release cancels queued abilities and a blocked writer recovers',async()=>{
  const f=linkFixture();
  try{
    f.start();const ws=f.sockets[0],count=ws.sent.length;
    ws.bufferedAmount=5000;
    f.run(.4,g=>({...driving(g),dash:true,power:true}));assert.equal(ws.sent.length,count,'do not append stale input to a blocked socket');
    f.first.releaseInput();ws.bufferedAmount=0;f.run(.1);
    const sent=ws.sent.at(-1);assert(sent?.type==='input');assert.equal(sent.input.fire,false);assert.equal(sent.input.dash,false);assert.equal(sent.input.power,false);
    // This time the writer blocks immediately after the server acknowledged everything.
    f.run(.2);ws.bufferedAmount=1000;f.run(2.8,driving);assert.equal(ws.readyState,3);
    await new Promise(r=>setTimeout(r,550));f.run(.7);assert(f.first.connected);
  }finally{f.cleanup();}
});

test('invalid mobile aim cannot silently discard movement/fire; normal held input is paced at 30 Hz',()=>{
  const f=linkFixture();
  try{
    f.start();const ws=f.sockets[0],before=ws.sent.length,m=f.room.sim.members.get(f.first.id)!,x=m.tank.x;
    f.run(1,g=>({...driving(g),aim:{x:NaN,z:Infinity}}));
    assert(m.tank.x>x+4);assert(m.fired>0);assert.equal(f.first.error,'');
    const sent=ws.sent.slice(before).filter(m=>m.type==='input');assert(sent.length<=32&&sent.length>=28);
    assert(sent.every(m=>m.type==='input'&&Number.isFinite(m.input.aim.x)&&Number.isFinite(m.input.aim.z)));
    f.first.releaseInput();const atRelease=m.tank.x;f.run(.35);assert(Math.abs(m.tank.x-atRelease)<.12,'pause releases without waiting for input timeout');
  }finally{f.cleanup();}
});

test('new round rejects delayed commands from the previous round and tolerates a valid mobile burst',()=>{
  const f=linkFixture();
  try{
    f.start();const peer=f.sockets[0].peer,oldRound=f.room.round;
    for(const m of f.room.sim.members.values()){m.shield=0;f.room.sim.damageTank(m.tank,1000);}f.run(1);f.start();
    const m=f.room.sim.members.get(peer.id!)!,x=m.tank.x,fired=m.fired;
    f.service.receive(peer,{type:'input',seq:100000,round:oldRound,input:driving(f.first)},f.now());f.room.step(1/60,f.now());
    assert.equal(m.tank.x,x);assert.equal(m.fired,fired);assert(peer.seq<100000);
    const messages=f.sockets[0].received.length;
    const sequence=peer.seq;for(let i=0;i<110;i++)f.service.receive(peer,{type:'input',seq:sequence+i+1,round:f.room.round,input:driving(f.first)},f.now());
    f.room.step(1/60,f.now());f.run(.05);assert(m.tank.x>x);assert(!f.sockets[0].received.slice(messages).some(m=>m.type==='error'));
    for(let i=0;i<200;i++)f.service.receive(peer,{type:'input',seq:200000+i,round:f.room.round,input:emptyInput()},f.now());
    f.run(.05);assert(f.sockets[0].received.slice(messages).some(m=>m.type==='error'),'unbounded floods still rejected');
  }finally{f.cleanup();}
});

test('delayed own shells start at the visible muzzle, including turning and dual guns; tap is consumed once',()=>{
  const f=linkFixture(120,120);
  try{
    f.start();const own=f.room.sim.members.get(f.first.id)!;
    const seen=new Set<number>();let checked=0;
    const original=f.first.render.bind(f.first);
    f.first.render=(dt,fraction)=>{
      original(dt,fraction);
      for(const b of f.first.view.bullets.filter(b=>b.source===f.first.id))if(!seen.has(b.id)){
        seen.add(b.id);const tip=muzzles(f.first.view.player,b.power)[b.barrel??0];
        assert(Math.hypot(b.x-tip.x,b.z-tip.z)<1e-8,'first visible frame is at the current muzzle');assert(Math.abs(b.y!-tip.y)<1e-8);checked++;
      }
    };
    f.run(.8,g=>({...driving(g),aim:{x:g.view.player.x+6,z:g.view.player.z-4}}));
    own.charge=67;f.run(.8,g=>({...driving(g),power:true,aim:{x:g.view.player.x-6,z:g.view.player.z+4}}));
    assert(checked>=6);f.first.releaseInput();f.run(.4);assert.equal(f.first.error,'');
    own.tank.cooldown=0;const before=own.fired;
    f.first.step({...emptyInput(),aim:{x:0,z:-10},firePressed:true});f.first.step({...emptyInput(),aim:{x:0,z:-10}});f.run(.7);
    assert.equal(own.fired,before+1,'up arriving before the server tick preserves one tap, not held fire');
  }finally{f.cleanup();}
});


test('five background/next-round recoveries use applied battle identity and discard historical effects',()=>{
  const f=linkFixture(80);
  try{
    f.start();let rounds=0,restores=0;f.first.onRound=()=>{rounds++;};f.first.onRestore=()=>{restores++;};
    for(let cycle=0;cycle<5;cycle++){
      f.first.events=[];f.first.sleep();const own=f.room.sim.members.get(f.first.id)!;
      f.run(.3,driving);const x=own.tank.x;f.run(.4,driving);assert.equal(own.tank.x,x,'background sends no held actions');assert.equal(f.first.events.length,0);
      for(const m of f.room.sim.members.values()){m.shield=0;f.room.sim.damageTank(m.tank,1000);}f.run(1.2);assert.equal(f.room.sim.phase,'over');
      // A joined message can announce the new round before its snapshot is applied.
      f.room.start(f.sockets[0].peer);f.run(3.3);f.clearArena();
      f.sockets[0].peer.seq=f.sockets[0].peer.ack=-1;f.sockets[0].peer.input=emptyInput();
      f.sockets[0].peer.send({type:'joined',id:f.first.id,room:f.room.info()});f.run(.2);
      f.first.wake();assert(f.first.recovering);f.run(.5);
      assert.equal(rounds,cycle+1,'each applied battle resets exactly once');assert(!f.first.recovering);assert(f.first.needsResume);assert.equal(f.first.events.length,0,'missed effects are never replayed');
      const fired=own.fired;f.run(.3,driving);assert.equal(own.fired,fired,'resuming requires a button');
      f.first.continue();f.run(.6,driving);assert(own.fired>fired);f.first.events=[];
      const cursor=f.room.sim.eventCursor;f.sockets[0].peer.send({type:'snapshot',room:f.room.info(),state:f.room.sim.state(),ack:f.sockets[0].peer.ack,eventCursor:cursor,events:[{type:'explode',x:0,z:0,eventId:cursor}]});f.run(.15);
      assert(!f.first.events.some(e=>e.type==='explode'&&e.eventId===cursor),'event duplicates are ignored');
    }
    assert.equal(restores,0);
  }finally{f.cleanup();}
});

test('returning to ended/closed rooms and same-round resync; queued snapshots cannot cross fresh-state boundary',()=>{
  const f=linkFixture(120);
  try{
    f.start();f.first.sleep();for(const m of f.room.sim.members.values()){m.shield=0;f.room.sim.damageTank(m.tank,1000);}f.run(1.3);
    f.first.wake();f.run(.5);assert.equal(f.first.state?.phase,'over');assert.match(f.first.awayMessage,/пока тебя не было/);assert(f.first.needsResume);
    f.start();f.first.continue();f.first.events=[];f.first.sleep();f.run(31);
    f.first.wake();const old=f.first.state;f.sockets[0].onmessage?.({data:JSON.stringify({type:'snapshot',room:f.room.info(),state:{...f.room.sim.state(),score:999999},ack:0,events:[{type:'explode',x:0,z:0,eventId:999999}]})});
    assert.equal(f.first.state,old,'queued frame ignored until explicit resync response');f.run(.6);assert.notEqual(f.first.state?.score,999999);assert.equal(f.first.events.length,0);
    f.first.sleep();f.first.wake();f.sockets[0].onmessage?.({data:JSON.stringify({type:'error',message:'Комната не найдена или уже закрыта.'})});
    assert(!f.first.recovering);assert(!f.first.room);assert.match(f.first.error,/закрыта/);
  }finally{f.cleanup();}
});

test('records follow accepted server snapshots, survive background/round changes and reject historical scores',async()=>{
  const {BattleRecords}=await import('../src/records');const {GameStorage}=await import('../src/storage');
  const f=linkFixture();const records=[new BattleRecords(new GameStorage(null)),new BattleRecords(new GameStorage(null))];
  for(const [i,g] of [f.first,f.second].entries())g.onSnapshot=(s,r)=>records[i].observe({score:s.score,wave:s.wave,time:s.elapsed,battleId:`${r.code}:${r.round}`,team:s.players.map(p=>p.name)},s.phase);
  try{
    f.start();f.room.sim.score=650;f.room.sim.wave=2;f.room.broadcast();f.run(.1);
    assert(records.every(r=>r.storage.record.score===650&&r.isRecord));
    const old=structuredClone(f.first.state!);old.elapsed=0;old.score=99999;
    f.sockets[0].onmessage?.({data:JSON.stringify({type:'snapshot',state:old,room:f.room.info(),ack:0,events:[]})});
    assert.equal(records[0].storage.record.score,650);assert.equal(f.first.state!.score,650);
    f.first.sleep();f.room.sim.score=1200;f.room.broadcast();f.run(.2);assert.equal(records[0].storage.record.score,650);assert.equal(records[1].storage.record.score,1200);
    f.first.wake();f.run(.2);assert.equal(records[0].storage.record.score,1200);assert(f.first.needsResume);
    f.room.sim.phase='over';f.room.broadcast();f.run(.1);assert(records[0].isRecord);records[0].flush();
    const same=structuredClone(f.first.state!);f.sockets[0].onmessage?.({data:JSON.stringify({type:'snapshot',state:same,room:f.room.info(),ack:0,events:[]})});assert(records[0].isRecord);
    f.first.continue();f.start();assert(!records[0].isRecord);assert.equal(records[0].storage.record.score,1200);
    f.room.sim.score=1400;f.room.broadcast();f.run(.1);assert(records[0].isRecord);f.first.leave();records[0].flush();assert.equal(records[0].storage.record.score,1400);
  }finally{f.cleanup();}
});

test('module movement stays reconciled under latency and modules survive resume but reset next round',()=>{
  const f=linkFixture(120,60);
  try{
    f.start();const own=f.room.sim.members.get(f.first.id)!;
    own.tank.modules=['tracks','turbo','armor'];own.tank.maxHp=130;own.tank.hp=125;f.room.broadcast();f.run(.4);
    const start=own.tank.x;f.run(.8,driving);assert(own.tank.x-start>4.1);assert(Math.abs(f.first.view.player.x-own.tank.x)<1.5);assert.equal(f.first.view.player.maxHp,130);
    f.first.sleep();f.run(.3);f.first.wake();f.run(.5);assert.deepEqual(f.first.state?.players.find(p=>p.id===own.id)?.tank.modules,['tracks','turbo','armor']);f.first.continue();f.run(.3,driving);
    for(const m of f.room.sim.members.values()){m.shield=0;f.room.sim.damageTank(m.tank,1000);}f.run(1.3);f.start();assert.deepEqual(own.tank.modules,[]);assert.equal(f.first.view.player.maxHp,100);
  }finally{f.cleanup();}
});

test('adrenaline uses authoritative movement, support resync skips past effects, death/respawn resets former-life input',()=>{
 const f=linkFixture(120,60);
 try{
  f.start();const a=f.room.sim.members.get(f.first.id)!,b=f.room.sim.members.get(f.second.id)!;let resets=0;f.first.onControlReset=()=>{resets++;f.first.releaseInput();};
  a.tank.modules=['tracks'];b.shield=0;f.room.sim.damageTank(b.tank,1000);f.run(.5);assert(a.tank.adrenaline);assert(f.first.view.player.adrenaline);
  const x=a.tank.x;f.run(.6,driving);assert(a.tank.x>x+3.6);assert(Math.abs(f.first.view.player.x-a.tank.x)<2);
  f.room.sim.finishWave();f.run(.5);assert.equal(b.tank.hp,50);assert(!a.tank.adrenaline);assert(!f.first.view.player.adrenaline);
  f.first.sleep();f.room.sim.dropBossLoot({x:0,z:0},'drill');f.run(8.3);f.first.wake();f.run(.5);assert(f.first.needsResume);assert(f.first.view.deliveries.some(d=>d.landed));assert(f.first.events.every(e=>e.type!=='supplyLand'&&e.type!=='supply'));
  f.first.continue();f.run(.3);f.room.sim.breakTime=0;a.shield=0;f.room.sim.damageTank(a.tank,1000);f.room.sim.finishWave();f.run(.6);assert(resets>0);assert.equal(a.tank.hp,50);const at=a.tank.x;f.run(.5);assert.equal(a.tank.x,at);f.run(.5,driving);assert(a.tank.x>at+1);
 }finally{f.cleanup();}
});

test('ram impulse is predicted with server motion under latency and resumes neutral movement after the push',()=>{
 const f=linkFixture(120,60);
 try{
  f.start();const a=f.room.sim.members.get(f.first.id)!;a.tank.knockback={x:30,z:6,remaining:.3,source:999};const x=a.tank.x;f.room.broadcast();f.run(.25);assert(a.tank.x>x+3);assert(Math.abs(f.first.view.player.x-a.tank.x)<2);f.run(.6);assert(!a.tank.knockback);assert(!f.first.view.player.knockback);const after=a.tank.x;f.run(.5);assert.equal(a.tank.x,after);f.run(.5,driving);assert(a.tank.x>after+1);
 }finally{f.cleanup();}
});
