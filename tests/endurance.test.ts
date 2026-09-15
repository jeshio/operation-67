import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../src/simulation.ts';
import { autopilot } from '../src/autopilot.ts';

test('45 complete waves with real projectiles and capture: bounded objects and five fresh runs', () => {
  const s=new Simulation(6702);s.start(false);let frames=0,firstCharge=0,peak=0,peakHazards=0;
  while(s.wave<46 && frames++<60*7200){
    s.player.hp=10000; // Isolate lifecycle/endurance from driver skill; no damage or kill shortcuts.
    if(s.charge===67&&!firstCharge)firstCharge=s.wave;
    s.update(1/60,autopilot(s));s.drainEvents();peak=Math.max(peak,s.enemies.length+s.portals.length);peakHazards=Math.max(peakHazards,s.hazards.length);
    assert.ok(peak<=12);assert.ok(s.bullets.length<=160);assert.ok(s.hazards.length<=36);assert.ok(s.pickups.length<=16);assert.equal(s.phase,'playing');
  }
  assert.equal(s.wave,46,`wave=${s.wave}, point=${JSON.stringify(s.capture)}, enemies=${JSON.stringify(s.enemies)}, player=${JSON.stringify(s.player)}`);assert.ok(firstCharge>0,'normal play eventually charges power');
  console.log(`45 waves: ${Math.round(s.elapsed)} simulated seconds; ${s.kills} destroyed; peak enemies ${peak}, hazards ${peakHazards}; charge wave ${firstCharge}`);
  for(let i=0;i<5;i++){s.start(false);assert.equal(s.streak,0);assert.equal(s.hazards.length,0);assert.equal(s.pickups.length,0);assert.equal(s.enemies.length,0);assert.equal(s.player.hp,100);assert.equal(s.obstacles.length,11);}
});
