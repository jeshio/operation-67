import type { GameEvent } from './simulation';

export type Lesson = 'fire' | 'dash' | 'power';
export class Tutorial {
  private learned: Record<string, boolean> = {};
  private clock = 0;
  private last: Partial<Record<Lesson, number>> = {};
  private next = 0;
  private until = 0;
  current?: Lesson;
  constructor(private storage: Pick<Storage, 'getItem'|'setItem'> | null, private key = 'roma-guide-v2', public touch = true) {
    try { const saved = JSON.parse(storage?.getItem(key) ?? '{}'); if (saved && typeof saved === 'object') this.learned = saved; } catch { /* Optional storage. */ }
  }
  private id(lesson: Lesson) { return `${this.touch ? 'touch' : 'desktop'}:${lesson}${this.touch && lesson === 'fire' ? ':stick' : ''}`; }
  knows(lesson: Lesson) { return this.learned[this.id(lesson)] === true; }
  restart() { this.clock = this.until = this.next = 0; this.last = {}; this.current = undefined; }
  repeat() { for (const lesson of ['fire','dash','power'] as const) delete this.learned[this.id(lesson)]; this.save(); this.restart(); }
  private save() { try { this.storage?.setItem(this.key, JSON.stringify(this.learned)); } catch { /* Keep in memory. */ } }
  confirm(events: GameEvent[], localId: number, network: boolean) {
    for (const event of events) {
      const own = network ? event.actorId === localId : (event.type === 'shot' ? event.owner === 'roma' : true);
      if (!own) continue;
      const lesson: Lesson | undefined = event.type === 'shot' ? 'fire' : event.type === 'dash' ? 'dash' : event.type === 'power' ? 'power' : undefined;
      if (lesson && !this.knows(lesson)) { this.learned[this.id(lesson)] = true; this.save(); if (this.current === lesson) { this.current = undefined; this.next = this.clock + 2; } }
    }
  }
  update(dt: number, active: boolean, dashReady: boolean, powerReady: boolean): Lesson | undefined {
    if (!active) return;
    this.clock += dt;
    if (this.current && (this.clock >= this.until || (this.current === 'power' && !powerReady) || (this.current === 'dash' && !dashReady))) { this.current = undefined; this.next = this.clock + 2; }
    const eligible = (key: Lesson) => !this.knows(key) && this.clock - (this.last[key] ?? -Infinity) >= 12;
    const power = powerReady && eligible('power');
    if (power || (!this.current && this.clock >= this.next)) {
      const next = power ? 'power' : this.touch && this.clock >= .5 && eligible('fire') ? 'fire' : dashReady && this.clock >= 5 && eligible('dash') ? 'dash' : undefined;
      if (next) { this.current = next; this.last[next] = this.clock; this.until = this.clock + 3; }
    }
    return this.current;
  }
}
