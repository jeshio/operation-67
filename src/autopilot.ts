// Development-only test driver. It uses normal movement, aim, firing and power input.
import type { Simulation, Point, Input } from './simulation';
export function autopilot(sim: Simulation): Input {
  const dist = (p: Point) => Math.hypot(p.x - sim.player.x, p.z - sim.player.z);
  const visible = sim.enemies.filter(e => sim.lineOfSight(sim.player, e));
  const targets = visible.sort((a,b) => {
    const priority = (e: typeof a) => (e.kind === 'medic' ? -20 : 0) + (sim.capture && Math.hypot(e.x-sim.capture.x,e.z-sim.capture.z)<4 ? -30 : 0) + dist(e);
    return priority(a)-priority(b);
  });
  const target = targets[0], any = target ?? sim.enemies[0];
  let goal: Point | undefined = sim.capture?.status !== 'complete' && sim.capture ? sim.capture : !target ? any : undefined;
  if (goal && dist(goal) < 0.5) goal = undefined;
  if (!sim.capture && target?.kind === 'barrier' && target.state === 'move') goal = { x: target.x + Math.cos(target.angle)*4, z: target.z - Math.sin(target.angle)*4 };
  // A ram may leave the driver closer than its muzzle: back out before firing again.
  if(target&&dist(target)<2.2){
    const candidates=Array.from({length:16},(_,i)=>({x:sim.player.x+Math.sin(i*Math.PI/8)*3,z:sim.player.z+Math.cos(i*Math.PI/8)*3})).filter(p=>sim.walkable(p.x,p.z,.7)&&sim.lineOfSight(sim.player,p,.7));
    candidates.sort((a,b)=>Math.hypot(b.x-target.x,b.z-target.z)-Math.hypot(a.x-target.x,a.z-target.z));
    if(candidates[0])goal=candidates[0];
  }
  let x=0,z=0;
  if (goal) {
    if (sim.lineOfSight(sim.player,goal,0.72)) {x=goal.x-sim.player.x;z=goal.z-sim.player.z;}
    else {const path=sim.findPath(sim.player,goal);if(path[0]){x=path[0].x-sim.player.x;z=path[0].z-sim.player.z;}}
  }
  return {x,z,aim:target??any??{x:0,z:0},fire:!!target,power:sim.charge===67};
}
