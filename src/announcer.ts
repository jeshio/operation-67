export const CALLOUTS = {
  power: { text: 'SIX SEVEN', priority: 100 },
  lastStand: { text: 'ВСЯ НАДЕЖДА НА ТЕБЯ!', priority: 95 },
  legend: { text: 'ЛЕГЕНДА СЕКТОРА 67!', priority: 90 },
  boss: { text: 'БОСС — В ЛОМ!', priority: 80 },
  six: { text: 'ШЕСТЬ ЗА СЕМЬ!', priority: 70 },
  master: { text: 'ХОЗЯИН АРЕНЫ!', priority: 60 },
  unstoppable: { text: 'НЕ ОСТАНОВИТЬ!', priority: 50 },
  steel: { text: 'СТАЛЬНАЯ СЕРИЯ!', priority: 40 },
  point: { text: 'ТОЧКА НАША!', priority: 30 },
} as const;
export type Callout = keyof typeof CALLOUTS;
export class AnnouncerGate {
  private last = -Infinity;
  private phrases = new Map<Callout, number>();
  reset() { this.last = -Infinity; this.phrases.clear(); }
  choose(candidates: Callout[], time: number): Callout | undefined {
    const best = [...candidates].sort((a, b) => CALLOUTS[b].priority - CALLOUTS[a].priority)[0];
    if (!best || time - this.last < 12 || time - (this.phrases.get(best) ?? -Infinity) < 60) return;
    this.last = time; this.phrases.set(best, time); return best;
  }
}
