import { CONFIG as C, BALANCE as B, ENEMY_META, type EnemyKind } from './config';
export interface WavePlan { wave: number; cycle: number; captureIndex: number | null; bosses: EnemyKind[]; roster: EnemyKind[]; count: number; }
const earlyCounts = [2, 4, 4, 6, 8, 10, 12, 15, 18, 22];
const earlyCaps = [2, 2, 3, 4, 5, 6, 7, 8, 10, 12];
export function wavePacing(wave: number, players = 1) {
  const w = Math.max(1, wave), ramp = Math.min(1, (w - 1) / 9), captureRamp = Math.max(0, Math.min(1, (w - 2) / 8));
  return { maxActive: Math.min(C.waves.maxActive, (earlyCaps[w - 1] ?? C.waves.maxActive) + (players >= 3 ? 1 : 0)),
    spawnInterval: 2.5 - 1.5 * ramp, captureInterval: 3.5 - 1.7 * captureRamp };
}
export function planWave(wave: number): WavePlan {
  const position = (wave - 1) % 15 + 1, cycle = Math.floor((wave - 1) / 15);
  const bosses: EnemyKind[] = [];
  if (wave % 5 === 0) bosses.push((['drill', 'hail', 'factory'] as const)[(wave / 5 - 1) % 3]);
  if (wave % 3 === 0) bosses.push((['saw', 'squall', 'barrier'] as const)[(wave / 3 - 1) % 3]);
  const roster: EnemyKind[] = ['light'];
  for (const [first, kind] of [[2, 'shooter'], [4, 'flanker'], [6, 'sniper'], [8, 'mortar'], [11, 'medic']] as const) if (wave >= first) roster.push(kind);
  const point = [2, 7, 13].indexOf(position);
  return { wave, cycle, captureIndex: point < 0 ? null : point, bosses: wave > 30 ? bosses.flatMap(kind => [kind, kind]) : bosses, roster, count: earlyCounts[wave - 1] ?? C.waves.max };
}
export function bossCaption(bosses: EnemyKind[]) {
  return [...new Set(bosses)].map(kind => {
    const count=bosses.filter(k=>k===kind).length;
    return `${ENEMY_META[kind].name}${count>1?` ×${count}`:''}`;
  }).join(' + ');
}
export const bossScale = (wave: number) => { const n = Math.floor((wave - 1) / 15); return { hp: 1 + 0.35 * n, damage: Math.min(2, 1 + 0.15 * n), interval: Math.max(0.65, 1 - 0.07 * n) }; };

export function captureDuration(wave: number) {
  const plan = planWave(wave);
  const visit = plan.cycle * 3 + (plan.captureIndex ?? 0);
  return Math.min(B.capture.maxDuration, B.capture.firstDuration + visit * B.capture.durationStep);
}
