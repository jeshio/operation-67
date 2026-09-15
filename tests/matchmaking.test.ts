import test from 'node:test';
import assert from 'node:assert/strict';
import { rankRooms } from '../server/matchmaking';
test('quick match ranks known latency, then wave and occupancy without waiting',()=>{
 const a={id:'a',hostRtt:100,wave:1,players:2},b={id:'b',hostRtt:20,wave:5,players:1},c={id:'c',hostRtt:20,wave:5,players:3};
 assert.deepEqual(rankRooms([a,b,c]).map(r=>r.id),['c','b','a']);assert.deepEqual(rankRooms([a]),[a]);assert.deepEqual(rankRooms([]),[]);
});
test('partial measurements cannot create a cyclic ranking; fallback uses wave then occupancy',()=>{
 const rooms=[{id:'a',hostRtt:100,wave:1,players:2},{id:'b',hostRtt:null,wave:2,players:2},{id:'c',hostRtt:20,wave:3,players:3}];
 for(const order of [rooms,[...rooms].reverse(),[rooms[1],rooms[2],rooms[0]]])assert.deepEqual(rankRooms(order).map(r=>r.id),['a','b','c']);
});
