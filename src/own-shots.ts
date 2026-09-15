import type { Bullet, GameEvent, Tank } from './simulation';
import { muzzles } from './weapons';

/** Birth correction belongs to a projectile, never to the moving player after birth. */
export class OwnShots {
  private births = new Map<number, { at: number; x: number; z: number; y: number }>();
  private pending = new Set<number>();
  reset() { this.births.clear(); this.pending.clear(); }
  confirm(events: GameEvent[], id: number) {
    for (const e of events) if (e.type === 'shot' && e.source === id) for (const tip of e.muzzles ?? []) this.pending.add(tip.bulletId);
  }
  present(bullets: Bullet[], tank: Tank, now: number) {
    const ids = new Set(bullets.map(b => b.id));
    for (const id of this.births.keys()) if (!ids.has(id)) this.births.delete(id);
    const result = bullets.map(b => {
      if (this.pending.has(b.id) && !this.births.has(b.id)) {
        const tip = muzzles(tank, b.power)[b.barrel ?? 0];
        this.births.set(b.id, { at: now, x: tip.x - b.x, z: tip.z - b.z, y: tip.y - (b.y ?? .75) });
      }
      const birth = this.births.get(b.id), weight = birth ? Math.max(0, 1 - (now - birth.at) / 80) : 0;
      return birth ? { ...b, x: b.x + birth.x * weight, z: b.z + birth.z * weight, y: (b.y ?? .75) + birth.y * weight } : b;
    });
    this.pending.clear();
    return result;
  }
}
