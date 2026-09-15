import type { CoopSimulation } from './coop';

export type CapacityWorkload = {profile:'normal'|'heavy';seed:number};

/** Imported into QA bundles only. The baseline adapter uses the same fixture. */
export function resetCapacityWorkload(sim:CoopSimulation,workload:CapacityWorkload){
  // Preserve monotonic display time and score so the old client accepts this QA reset.
  const elapsed=sim.elapsed,score=sim.score;
  (sim as unknown as {seed:number}).seed=workload.seed;
  sim.start(false);
  if(workload.profile==='heavy'){sim.wave=40;sim.beginWave();}
  sim.elapsed=elapsed;sim.score=score;
  maintainCapacityWorkload(sim,workload);
}

export function maintainCapacityWorkload(sim:CoopSimulation,workload:CapacityWorkload){
  let reset=false;
  if(sim.phase==='over'||sim.phase==='dying'||workload.profile==='heavy'&&sim.wave>45){
    resetCapacityWorkload(sim,workload);reset=true;
  }
  for(const m of sim.members.values())if(m.present){m.tank.maxHp=10000;m.tank.hp=10000;}
  return reset;
}
