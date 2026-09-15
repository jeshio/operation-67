export const CONFIG = {
  title: 'Рома: операция 67', city: 'Ханты-Мансийск', sector: 'Сектор 67',
  player: { firstName: 'Рома', name: 'РОМА-67', hp: 100, damage: 25, cooldown: 0.3, speed: 7, radius: 0.64, color: 0x278bc4, accent: 0xffa53f },
  lev: { firstName: 'Лев', name: 'ЛЕВ-02', damage: 10, cooldown: 1, speed: 7.4, heal: 20, healThreshold: 60, healCooldown: 20, color: 0xf2c343 },
  arena: { halfWidth: 19, halfDepth: 15 },
  power: { max: 67, hit: 1, kill: 10, duration: 7 },
  waves: { first: 4, increment: 2, max: 24, maxActive: 12, breakDuration: 6, warning: 1.5, spawnInterval: 1 },
  limits: { bullets: 160, particles: 300, tracks: 180 },
  enemy: {
    light: { hp: 25, damage: 8, speed: 2.3, cooldown: 2.8, range: 7, radius: 0.6 },
    shooter: { hp: 50, damage: 10, speed: 1.8, cooldown: 2.3, range: 11, radius: 0.65 },
    flanker: { hp: 40, damage: 7, speed: 4.1, cooldown: 2.3, range: 8, radius: 0.55 },
    sniper: { hp: 60, damage: 20, speed: 1.7, cooldown: 4.2, range: 24, radius: 0.65 },
    mortar: { hp: 65, damage: 16, speed: 1.6, cooldown: 4.2, range: 24, radius: 0.7 },
    medic: { hp: 55, damage: 6, speed: 2.1, cooldown: 3, range: 9, radius: 0.65 },
    saw: { hp: 300, damage: 16, speed: 2.6, cooldown: 4, range: 14, radius: 0.9 },
    squall: { hp: 400, damage: 9, speed: 2.8, cooldown: 2.7, range: 13, radius: 0.9 },
    barrier: { hp: 500, damage: 12, speed: 1.7, cooldown: 2.8, range: 11, radius: 1 },
    drill: { hp: 2400, damage: 22, speed: 1.8, cooldown: 4.5, range: 24, radius: 1.25 },
    hail: { hp: 2600, damage: 18, speed: 1.2, cooldown: 4.8, range: 30, radius: 1.25 },
    factory: { hp: 3000, damage: 12, speed: 1.1, cooldown: 4.5, range: 30, radius: 1.25 },
  },
  lines: { hello: 'Рома, я с тобой!', heal: 'Держись, брат! Сейчас починю.', power: 'Вот это SIX SEVEN!', wave: 'Я прикрою. Погнали!', ready: 'Рома, жми пробел! Сейчас будет мощно.', shooters: 'Вижу стрелков! Используй укрытия.', heavy: 'Большой танк! Береги SIX SEVEN.', firstWave: 'Отлично, Рома! Первая волна — наша.', clear: 'Чисто! Следующая волна уже близко.' },
} as const;

export type EnemyKind = keyof typeof CONFIG.enemy;
export interface Obstacle { id: number; x: number; z: number; w: number; d: number; hp: number; kind: 'cover' | 'crate'; }
export const makeObstacles = (): Obstacle[] => [
  { x: -8, z: -3, w: 4.5, d: 2.8, kind: 'cover' },
  { x: 8, z: 3, w: 4.5, d: 2.8, kind: 'cover' },
  { x: -9, z: 6.5, w: 2, d: 3, kind: 'cover' },
  { x: 8.5, z: -7, w: 3, d: 2.6, kind: 'cover' },
  { x: -0.5, z: -7, w: 4, d: 1.7, kind: 'cover' },
  ...[[-3, 1], [-4.5, 1], [3, -1.5], [3, -3], [-13, -8], [12, 8]].map(([x, z]) => ({ x, z, w: 1.3, d: 1.3, kind: 'crate' })),
].map((o, id) => ({ ...o, id, kind: o.kind as Obstacle['kind'], hp: o.kind === 'crate' ? 50 : Infinity }));

export const ENEMY_META: Record<EnemyKind, { name: string; tier: 'regular' | 'mini' | 'boss'; color: number }> = {
  light: { name: 'Разведчик', tier: 'regular', color: 0xcf5750 },
  shooter: { name: 'Стрелок', tier: 'regular', color: 0xc7523e },
  flanker: { name: 'Обходчик', tier: 'regular', color: 0xe78045 },
  sniper: { name: 'Снайпер', tier: 'regular', color: 0x9867bd },
  mortar: { name: 'Миномётчик', tier: 'regular', color: 0xb59155 },
  medic: { name: 'Ремонтник', tier: 'regular', color: 0x55a393 },
  saw: { name: 'ПИЛА', tier: 'mini', color: 0xf0773d },
  squall: { name: 'ШКВАЛ', tier: 'mini', color: 0xa260bd },
  barrier: { name: 'БАРЬЕР', tier: 'mini', color: 0x65869d },
  drill: { name: 'БУР', tier: 'boss', color: 0xdc782d },
  hail: { name: 'ГРАД', tier: 'boss', color: 0x8d65c5 },
  factory: { name: 'ЗАВОД', tier: 'boss', color: 0x548c82 },
};
export const POINTS = [
  { name: 'Радиовышка', x: -14, z: -2 },
  { name: 'Склад', x: 14, z: 0 },
  { name: 'Ангар', x: 0, z: 7 },
] as const;
export const BALANCE = {
  capture: { radius: 2.6, capture: 3, firstDuration: 5, durationStep: 4, maxDuration: 25, firstChargeBonus: 27, spawnInterval: 1.8 },
  dash: { duration: 0.2, cooldown: 4, speed: 24 },
  pickups: { life: 12, radius: 1.3, rapidDuration: 6 },
  hazards: 36, pickupLimit: 16,
};
