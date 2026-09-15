import type { Point, Tank } from './simulation';

/** Shared model dimensions. Root elevation is not affected by the companion's scale. */
export const GUN = { rootY: .04, turretY: .94, y: .15, normalTip: 1.765, powerTip: 1.725, spread: .7, muzzleDepth: .25, normalRecoil: .16, powerRecoil: .22, levScale: .78 } as const;
export interface Muzzle extends Point { y: number; barrel: number; }
export function muzzles(t: Pick<Tank, 'x'|'z'|'angle'|'recoil'>, power = false, scale = 1): Muzzle[] {
  const forward = ((power ? GUN.powerTip : GUN.normalTip) - t.recoil * (power ? GUN.powerRecoil : GUN.normalRecoil)) * scale;
  const sx = Math.sin(t.angle), sz = Math.cos(t.angle);
  return (power ? [-GUN.spread, GUN.spread] : [0]).map((side, barrel) => ({
    x: t.x + sx * forward + sz * side * scale,
    z: t.z + sz * forward - sx * side * scale,
    y: GUN.rootY + (GUN.turretY + GUN.y) * scale, barrel,
  }));
}
