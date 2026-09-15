import { CONFIG as C, type EnemyKind, type Obstacle } from './config';
import type { Enemy, Point } from './simulation';

/** Movement clearance is deliberately separate from the visible armour hit area. */
export const HULL = {
  width: 1.25, length: 1.8, trackX: .77, trackWidth: .42, trackLength: 2.15,
  trackHitWidth: .54, // Includes the cleats and outside wheels.
  flankerStretch: 1.3, ramZ: 1.3, ramLength: 1.3, ramWidth: 1.76,
  shieldWidth: 2.5, shieldLength: .18, shieldZ: .8,
  factoryWidth: 1.6, factoryLength: 1.3, factoryZ: -.5,
} as const;
export const PROJECTILE = { radius: .15, coverRadius: .12 } as const;
export const enemyModelScale = (kind: EnemyKind) => C.enemy[kind].radius / .7;

/** Earliest contact along a segment; starting inside a shape is an immediate hit. */
export function segmentBox(from: Point, to: Point, x: number, z: number, halfX: number, halfZ: number): number | undefined {
  let enter = 0, exit = 1;
  for (const [p, d, min, max] of [[from.x, to.x-from.x, x-halfX, x+halfX], [from.z, to.z-from.z, z-halfZ, z+halfZ]]) {
    if (Math.abs(d) < 1e-10) { if (p < min || p > max) return; continue; }
    const a=(min-p)/d, b=(max-p)/d;
    enter=Math.max(enter,Math.min(a,b)); exit=Math.min(exit,Math.max(a,b));
    if (enter > exit) return;
  }
  return enter;
}
export function segmentCircle(from: Point, to: Point, center: Point, radius: number): number | undefined {
  const x=from.x-center.x,z=from.z-center.z,dx=to.x-from.x,dz=to.z-from.z;
  const c=x*x+z*z-radius*radius;if(c<=0)return 0;
  const a=dx*dx+dz*dz,b=x*dx+z*dz,d=b*b-a*c;if(a<1e-12||d<0)return;
  const t=(-b-Math.sqrt(d))/a;return t>=0&&t<=1?t:undefined;
}
export function coverHitTime(from: Point, to: Point, o: Obstacle) {
  return segmentBox(from,to,o.x,o.z,o.w/2+PROJECTILE.coverRadius,o.d/2+PROJECTILE.coverRadius);
}
export function enemyHitTime(from: Point, to: Point, e: Pick<Enemy,'x'|'z'|'bodyAngle'|'angle'|'kind'>): number | undefined {
  const scale=enemyModelScale(e.kind), margin=PROJECTILE.radius/scale;
  const local=(p:Point,angle:number):Point=>{const x=p.x-e.x,z=p.z-e.z,c=Math.cos(angle),s=Math.sin(angle);return{x:(x*c-z*s)/scale,z:(x*s+z*c)/scale};};
  const a=local(from,e.bodyAngle),b=local(to,e.bodyAngle),stretch=e.kind==='flanker'?HULL.flankerStretch:1;
  let earliest:number|undefined;
  const box=(a:Point,b:Point,x:number,z:number,w:number,d:number)=>{
    const t=segmentBox(a,b,x,z,w/2+margin,d/2+margin);
    if(t!==undefined&&(earliest===undefined||t<earliest))earliest=t;
  };
  box(a,b,0,0,HULL.width,HULL.length*stretch);
  for(const x of [-HULL.trackX,HULL.trackX])box(a,b,x,0,HULL.trackHitWidth,HULL.trackLength*stretch);
  if(e.kind==='saw'||e.kind==='drill')box(a,b,0,HULL.ramZ,HULL.ramWidth,HULL.ramLength);
  if(e.kind==='factory')box(a,b,0,HULL.factoryZ,HULL.factoryWidth,HULL.factoryLength);
  const ta=local(from,e.angle),tb=local(to,e.angle);
  box(ta,tb,0,0,1.13,1.05);
  if(e.kind==='barrier')box(ta,tb,0,HULL.shieldZ,HULL.shieldWidth,HULL.shieldLength);
  return earliest;
}
