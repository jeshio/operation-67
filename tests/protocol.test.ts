import test from 'node:test';
import assert from 'node:assert/strict';
import { HostSimulation } from '../src/net/host';
import { validCheckpoint,validSnapshot } from '../src/net/validation';
import { validBatch } from '../src/protocol';
import { pack,unpack } from '../src/net/codec';
const h=new HostSimulation();h.load({matchId:'m',round:1,hostEpoch:1,host:-1,nonce:'n',checkpoint:null,players:[{id:-1,name:'P',skin:0,present:true,connected:true,foreground:true}]});
test('checkpoint schema requires all simulation fields and valid typed maps',()=>{
 const cp=h.checkpoint();assert(validCheckpoint(unpack(pack(cp)),h.context));
 for(const key of Object.keys(cp.simulation.core)){const invalid=structuredClone(cp);delete (invalid.simulation.core as any)[key];if(['lootBatch','deliveries','repairZone'].includes(key))continue;assert(!validCheckpoint(invalid,h.context),`missing ${key}`);}
 for(const edit of [(c:any)=>c.simulation.core.breakTime=NaN,(c:any)=>c.simulation.coop.members.push(c.simulation.coop.members[0]),(c:any)=>c.simulation.coop.members[0].tank.modules=['fake'],(c:any)=>c.ack=null,(c:any)=>c.actions={'-1':Array(129).fill(1)},(c:any)=>c.simulation.core.wavePlan.roster=['fake']]){const c=structuredClone(cp);edit(c);assert(!validCheckpoint(c,h.context));}
});
test('malformed inputs and stale snapshots are rejected without throwing',()=>{
 for(const value of [null,{},[],{kind:'input',...h.context,frames:[null]}])assert.equal(validBatch(value,-1,h.context),false);
 assert(validSnapshot(h.snapshot(),h.context));assert(!validSnapshot({...h.snapshot(),hostEpoch:0},h.context));assert(!validSnapshot({...h.snapshot(),state:{phase:'playing',players:[]}},h.context));
});
