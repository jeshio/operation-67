import type { Point } from './simulation';

export interface MotionPose extends Point { id: number; angle?: number; bodyAngle?: number; }
const turn = (a: number, b: number, alpha: number) => a + Math.atan2(Math.sin(b-a), Math.cos(b-a))*alpha;

/** Presentation only: blend the last fixed step without changing collision or attack timing. */
export class MotionFrames {
  private previous = new Map<number, MotionPose>();
  private displayed = new Map<number, MotionPose>();
  capture(entities: MotionPose[]) {
    const ids = new Set(entities.map(e => e.id));
    for (const id of this.previous.keys()) if (!ids.has(id)) this.previous.delete(id);
    for (const id of this.displayed.keys()) if (!ids.has(id)) this.displayed.delete(id);
    for (const e of entities) {
      const pose = this.previous.get(e.id) ?? { id: e.id, x: e.x, z: e.z };
      pose.x=e.x; pose.z=e.z; pose.angle=e.angle; pose.bodyAngle=e.bodyAngle;
      this.previous.set(e.id,pose);
    }
  }
  sample(entity: MotionPose, alpha: number, frozen=false): MotionPose {
    const shown=this.displayed.get(entity.id);
    if (frozen && shown) return shown;
    const before=this.previous.get(entity.id) ?? entity;
    // Intro skips and development teleports should never sweep the tank across the map.
    const t=Math.hypot(entity.x-before.x,entity.z-before.z)>4 ? 1 : Math.max(0,Math.min(1,alpha));
    const pose=shown ?? {id:entity.id,x:entity.x,z:entity.z};
    pose.x=before.x+(entity.x-before.x)*t; pose.z=before.z+(entity.z-before.z)*t;
    pose.angle=entity.angle===undefined ? undefined : turn(before.angle ?? entity.angle,entity.angle,t);
    pose.bodyAngle=entity.bodyAngle===undefined ? undefined : turn(before.bodyAngle ?? entity.bodyAngle,entity.bodyAngle,t);
    this.displayed.set(entity.id,pose); return pose;
  }
  point(point: Point): Point { return 'id' in point ? this.displayed.get(point.id as number) ?? point : point; }
  reset() { this.previous.clear(); this.displayed.clear(); }
}
