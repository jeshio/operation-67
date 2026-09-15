import type { Point } from './simulation';
export interface Knockback { x:number; z:number; remaining:number; source:number; }
export interface Pushable extends Point { hp:number; knockback?:Knockback; }
export const RAM_PUSH={duration:.3,speed:32,decay:5,step:.12} as const;
/** Shared external motion: server and prediction integrate the same decaying impulse. */
export function advanceKnockback(t:Pushable,dt:number,radius:number,free:(x:number,z:number,r:number)=>boolean){
 const k=t.knockback;if(!k)return false;
 if(t.hp<=0){delete t.knockback;return false;}
 const time=Math.min(Math.max(0,dt),k.remaining),decay=Math.exp(-RAM_PUSH.decay*time),integral=(1-decay)/RAM_PUSH.decay;
 const dx=k.x*integral,dz=k.z*integral,steps=Math.max(1,Math.ceil(Math.hypot(dx,dz)/RAM_PUSH.step));
 for(let i=0;i<steps;i++){if(free(t.x+dx/steps,t.z,radius))t.x+=dx/steps;if(free(t.x,t.z+dz/steps,radius))t.z+=dz/steps;}
 k.x*=decay;k.z*=decay;k.remaining=Math.max(0,k.remaining-time);if(k.remaining<=1e-8)delete t.knockback;
 return true;
}
