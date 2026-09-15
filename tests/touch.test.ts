import test from 'node:test';
import assert from 'node:assert/strict';
import { stickVector, TouchState } from '../src/touch-state.ts';
import { Simulation, emptyInput } from '../src/simulation.ts';
import { CONFIG } from '../src/config.ts';

test('stick dead zone, smooth proportional speed and clamping outside the disc', () => {
  assert.deepEqual(stickVector(0,0,56),{x:0,y:0});
  assert.deepEqual(stickVector(56*.18,0,56),{x:0,y:0});
  assert.ok(Math.abs(stickVector(56*.59,0,56).x-.5)<1e-10);
  assert.equal(stickVector(560,0,56).x,1);
  const diagonal=stickVector(-56,56,56); assert.ok(Math.abs(Math.hypot(diagonal.x,diagonal.y)-1)<1e-10); assert.ok(diagonal.x<0 && diagonal.y>0);
});

test('independent pointer ownership: two sticks, third-finger abilities and no hijacking', () => {
  const s=new TouchState(); assert.ok(s.begin('move',1)); assert.ok(s.begin('aim',2));
  assert.equal(s.begin('move',3),false); assert.equal(s.begin('power',1),false);
  s.update(1,56,0,56); s.update(2,0,-56,56); assert.ok(s.begin('dash',3));
  assert.deepEqual(s.consume(),{dash:true,power:false,firePressed:true}); assert.deepEqual(s.consume(),{dash:false,power:false,firePressed:false});
  s.end(3); assert.equal(s.move.x,1); assert.equal(s.aim.y,-1);
  s.end(1); assert.equal(s.move.x,0); assert.equal(s.aim.y,-1); s.update(1,-56,0,56); assert.equal(s.move.x,0);
  assert.ok(s.begin('power',4)); s.end(4); assert.ok(s.consume().power); assert.equal(s.consume().power,false);
  s.end(2); assert.deepEqual(s.aim,{x:0,y:0});
});

test('pause and restart clear sticks and queued abilities; stale moves cannot revive them', () => {
  const s=new TouchState(); s.begin('move',1);s.begin('aim',2);s.begin('power',3);s.begin('dash',4);s.update(1,56,0,56);s.update(2,0,56,56);
  s.clear(); s.update(1,56,0,56);s.update(2,0,56,56);
  assert.deepEqual(s.move,{x:0,y:0});assert.deepEqual(s.aim,{x:0,y:0});assert.deepEqual(s.consume(),{dash:false,power:false,firePressed:false});assert.ok(s.begin('move',5));
});

test('analog movement stays proportional; keyboard diagonal never exceeds maximum speed', () => {
  function distance(x:number,z:number) {
    const sim=new Simulation();sim.start(false);sim.obstacles=[];sim.player.x=0;sim.player.z=0;sim.spawnTimer=9999;
    for(let i=0;i<30;i++)sim.update(1/60,{...emptyInput(),x,z});
    return Math.hypot(sim.player.x,sim.player.z);
  }
  assert.ok(Math.abs(distance(.25,0)-CONFIG.player.speed*.5*.25)<1e-9);
  assert.ok(Math.abs(distance(1,0)-distance(1,1))<1e-9);
  assert.equal(distance(0,0),0);
});
