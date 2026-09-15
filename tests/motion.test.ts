import test from 'node:test';import assert from 'node:assert/strict';
import { MotionFrames } from '../src/motion.ts';import { measureViewport } from '../src/viewport.ts';
test('120 Hz rendering advances between 60 Hz simulation steps instead of repeating frames',()=>{
  const m=new MotionFrames(),p={id:0,x:0,z:0};let accumulator=0,previous=0;const differences:number[]=[];
  for(let i=0;i<240;i++){accumulator+=1/120;while(accumulator>=1/60){m.capture([p]);p.x+=.1;accumulator-=1/60;}const x=m.sample(p,accumulator*60).x;if(i>3)differences.push(x-previous);previous=x;}
  assert.ok(differences.every(d=>Math.abs(d-.05)<1e-8));const frozen=m.sample(p,.4).x;p.x=50;assert.equal(m.sample(p,1,true).x,frozen);m.reset();assert.equal(m.sample(p,1).x,50);
});
test('browser zoom cannot change logical orientation; normal browser chrome resizes height',()=>{
  const stable={width:390,height:700};assert.deepEqual(measureViewport(800,300,{width:200,height:100,scale:2},stable),stable);
  assert.deepEqual(measureViewport(390,844,{width:390,height:620,scale:1},stable),{width:390,height:620});
});
