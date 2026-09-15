import test from 'node:test';
import assert from 'node:assert/strict';
import { BattleCoordinator } from '../server/coordinator';
import { HostSimulation } from '../src/net/host';
import type { HostAssignment } from '../src/protocol';
function fixture(count=4){
 let now=10000,closed=false;const messages:{id:number;type:string;data:any}[]=[];
 const c=new BattleCoordinator('match','ABCDEF',false,{send:(id,type,data)=>messages.push({id,type,data}),broadcast:(type,data)=>messages.push({id:0,type,data}),changed:()=>{},closed:()=>{closed=true;}},()=>now);
 for(let i=0;i<count;i++)c.join(`p${i}`,`Игрок ${i+1}`,i);
 const advance=(ms:number)=>{now+=ms;c.tick();};
 const activate=()=>{const m=messages.filter(m=>m.type==='prepare').at(-1)!;c.ready(m.id,m.data.nonce);c.renew(m.id,{...c.context,nonce:now});const h=new HostSimulation();h.load(m.data as HostAssignment);return h;};
 c.tick();return{c,messages,advance,activate,now:()=>now,closed:()=>closed};
}
test('host lease never overlaps; old generation and a late ready cannot regain authority',()=>{
 const f=fixture();const h=f.activate(),old=f.c.info.host,epoch=f.c.info.hostEpoch;
 h.step(0);assert(f.c.checkpoint(old,h.checkpoint()));f.c.disconnect(old);f.advance(1499);assert.equal(f.c.info.hostEpoch,epoch);
 f.advance(2);assert(f.c.info.hostEpoch>epoch);const next=f.c.info.host;assert.notEqual(next,old);assert(!f.c.authorized(old));
 f.c.renew(old,{hostEpoch:epoch,round:0,nonce:1});assert(!f.c.authorized(old));f.c.ready(old,'old');assert.equal(f.c.info.stage,'preparing');
 f.activate();assert(f.c.authorized(next));assert(!f.c.checkpoint(old,h.checkpoint(),true));
});
test('failed backup is skipped and emergency preparation continues with the next player',()=>{
 const f=fixture();f.activate();const old=f.c.info.host;f.c.disconnect(old);f.advance(1501);const failed=f.c.info.host;
 f.advance(1001);assert.equal(f.c.info.stage,'recovering');f.advance(50);assert.notEqual(f.c.info.host,failed);f.activate();assert.equal(f.c.info.stage,'running');
});
test('graceful transfer commits final state before assignment and keeps room owner',()=>{
 const f=fixture();const h=f.activate(),old=f.c.info.host,owner=f.c.info.owner;
 h.sim.score=450;h.step(1);f.c.health(old,{foreground:false,stepP95:1,serverRtt:10,links:[]});assert.equal(f.c.info.stage,'handoff');
 assert(f.c.checkpoint(old,h.checkpoint(),true));const a=f.messages.filter(m=>m.type==='prepare').at(-1)!.data as HostAssignment;
 assert.equal(a.checkpoint?.simulation.core.score,450);assert.notEqual(a.host,old);assert.equal(f.c.info.owner,owner);assert.equal(f.c.leaseUntil,0);
 f.activate();assert.equal(f.c.info.stage,'running');
});
test('two checkpoints only, detached copies, monotonic commits and excluded departed roster',()=>{
 const f=fixture();const h=f.activate();for(let i=0;i<3;i++){h.step(i);h.sim.score=i*100;assert(f.c.checkpoint(f.c.info.host,h.checkpoint()));}
 assert.equal(f.c.checkpoints.length,2);const stale=structuredClone(f.c.checkpoints[0]);assert(!f.c.checkpoint(f.c.info.host,stale));
 h.sim.score=999;assert.equal(f.c.checkpoints.at(-1)!.simulation.core.score,200);
 f.c.disconnect(-4,true);f.c.disconnect(-1);f.advance(1501);const restored=f.activate();assert(!restored.sim.members.get(-4)!.present);assert.equal(restored.sim.score,200);
});
test('disconnect preserves identity for 30 seconds and no active players closes at 30 seconds',()=>{
 const f=fixture(2);f.activate();f.c.disconnect(-2);f.advance(29999);assert(f.c.seats.get(-2)!.present);
 assert.equal(f.c.join('p1','Вернулся',1),-2);f.c.disconnect(-2);f.advance(30001);assert(!f.c.seats.get(-2)!.present);
 f.c.health(-1,{foreground:false,stepP95:1,serverRtt:1,links:[]});f.advance(1);f.advance(30000);assert(f.closed());
});
test('best host uses worst peer latency, waits five seconds and a wave boundary, then applies cooldown',()=>{
 const f=fixture(3),h=f.activate();h.sim.start(false);h.sim.breakTime=0;h.step(0);f.c.checkpoint(-1,h.checkpoint());
 for(const id of [-1,-2,-3])f.c.health(id,{foreground:true,stepP95:1,serverRtt:100,links:[-1,-2,-3].filter(n=>n!==id).map(peerId=>({peerId,directRtt:id===-2?30:120,relayRtt:200,loss:0,route:'direct'}))});
 for(let i=0;i<141;i++){f.c.renew(-1,{...f.c.context,nonce:i});f.advance(250);}
 assert.equal(f.c.info.host,-1);assert.equal(f.c.info.stage,'running','no planned switch mid wave');
 h.sim.breakTime=3;h.step(1);f.c.checkpoint(-1,h.checkpoint());f.advance(50);assert.equal(f.c.info.stage,'handoff');f.c.checkpoint(-1,h.checkpoint(),true);assert.equal(f.c.info.host,-2);f.activate();
 f.advance(500);assert.equal(f.c.info.host,-2);
});
test('unchanged recovery does not flood room state updates',()=>{
 const f=fixture(1);f.activate();f.c.disconnect(-1);f.advance(1501);const revision=f.c.info.revision;for(let i=0;i<20;i++)f.advance(50);assert.equal(f.c.info.revision,revision);
});

test('initial Worker download gets time to finish; emergency candidates retain a short deadline',()=>{
 const f=fixture(2);assert.equal(f.c.info.stage,'preparing');f.advance(1500);assert.equal(f.c.info.stage,'preparing');assert.equal(f.c.info.hostEpoch,1);
 f.activate();f.c.disconnect(f.c.info.host);f.advance(1501);assert.equal(f.c.info.stage,'preparing');assert.equal(f.c.info.hostEpoch,2);
 f.advance(1001);assert.equal(f.c.info.stage,'recovering');
});
