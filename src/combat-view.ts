import { CONFIG as C } from './config';
import type { Bullet, Enemy, Point } from './simulation';
import type { Obstacle } from './config';
import { coverHitTime, enemyHitTime } from './tank-shape';

/** Enemies and friendly shells share the latest snapshot clock (up to 50 ms ahead).
 * No extra interpolation delay on targets while a local shell uses fresh state. */
export function presentEnemies(current: Enemy[], previous: Enemy[], interval: number, elapsed: number,
  walkable: (x:number,z:number,radius:number)=>boolean, clear: (a:Point,b:Point,radius:number)=>boolean): Enemy[] {
  const lead=Math.min(.05,Math.max(0,elapsed));
  return current.map(e=>{
    const old=previous.find(p=>p.id===e.id),result={...e};
    if(!old||interval<=0||interval>.25||old.state!==e.state||e.hp<=0||Math.hypot(e.x-old.x,e.z-old.z)>4)return result;
    const x=e.x+(e.x-old.x)/interval*lead,z=e.z+(e.z-old.z)/interval*lead,r=C.enemy[e.kind].radius;
    if(walkable(x,z,r)&&clear(e,{x,z},r)){result.x=x;result.z=z;}
    return result;
  });
}

/** Never display an extrapolated projectile through a known target or cover.
 * Stopping presentation does not award damage, hits, flashes or charge. */
export function presentFriendlyBullet(b:Bullet,elapsed:number,enemies:Enemy[],obstacles:Obstacle[]):Bullet {
  const lead=Math.min(.05,Math.max(0,elapsed)),end={x:b.x+b.vx*lead,z:b.z+b.vz*lead};let time=1;
  for(const o of obstacles){const t=coverHitTime(b,end,o);if(t!==undefined)time=Math.min(time,t);}
  for(const e of enemies){
    if(e.hp<=0||b.hitIds?.includes(e.id))continue;
    const t=enemyHitTime(b,end,e);if(t!==undefined)time=Math.min(time,t);
  }
  return {...b,x:b.x+(end.x-b.x)*time,z:b.z+(end.z-b.z)*time};
}
