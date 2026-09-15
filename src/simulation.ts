import { PROJECTILE, coverHitTime, enemyHitTime, segmentCircle } from './tank-shape';
import { advanceKnockback, RAM_PUSH, type Knockback } from './knockback';
import { breakDuration, type Delivery, type RepairZone } from './support';
import { MODULES, hasModule, tankStats, chooseModules, type ModuleId, type BigBoss } from './modules';
import { muzzles, GUN, type Muzzle } from './weapons';
import { CONFIG as C, BALANCE as B, ENEMY_META, POINTS, makeObstacles, type EnemyKind, type Obstacle } from './config';
import { planWave, bossScale, bossCaption, captureDuration, wavePacing, type WavePlan } from './waves';
import { CALLOUTS, type Callout } from './announcer';
export type Phase = 'menu' | 'intro' | 'playing' | 'paused' | 'dying' | 'over';
export interface Point { x: number; z: number; }
export interface Input { x: number; z: number; aim: Point; fire: boolean; firePressed?: boolean; power: boolean; dash?: boolean; shotId?: string; }
export interface Tank extends Point { id: number; angle: number; bodyAngle: number; hp: number; maxHp: number; cooldown: number; recoil: number; displayName?: string; skin?: number; netPower?: number; netShield?: number; modules?: ModuleId[]; lastDamageAt?: number; ramHits?: number[]; adrenaline?: boolean; controlEpoch?: number; knockback?:Knockback; }
export interface Enemy extends Tank { kind: EnemyKind; shotDelay: number; path: Point[]; pathTimer: number; state: 'move' | 'windup' | 'execute' | 'recover'; stateTime: number; target: Point; attack: number; attackHit: boolean; enraged: boolean; burst: number; hitPlayers?: number[]; targetId?: number; }
export interface Bullet extends Point { id: number; vx: number; vz: number; owner: 'roma' | 'lev' | 'enemy'; damage: number; life: number; power: boolean; weapon?: string; source?: number; y?: number; barrel?: number; hitIds?: number[]; pierce?: boolean; splash?: boolean; splashDamage?: number; predictionId?: string; }
export interface Portal extends Point { id: number; remaining: number; kind: EnemyKind; }
export interface Hazard extends Point { id: number; source: number; kind: 'circle' | 'line'; angle: number; radius: number; length: number; delay: number; life: number; damage: number; hit: boolean; blockedByCover: boolean; hitPlayers?: number[]; }
export interface Pickup extends Point { id: number; kind: 'heal' | 'charge' | 'rapid' | 'module'; life: number; module?: ModuleId; flight?: { from: Point; remaining: number; delay: number }; landedAt?: number; batchId?: number; deliveryId?:number; reward?:'mini'|'boss'|'emergency'; }
export interface LootBatch { id:number; eligible:number[]; claimed:number[]; }
export interface Capture extends Point { name: string; progress: number; hold: number; duration: number; status: 'capture' | 'hold' | 'contested' | 'away' | 'complete'; }
export interface GameEvent extends Point { shotId?: string; type: 'shot' | 'hit' | 'explode' | 'heal' | 'power' | 'ready' | 'wave' | 'over' | 'line' | 'crate' | 'shield' | 'dash' | 'pickup' | 'capture' | 'warning' | 'phase' | 'achievement' | 'lastStand' | 'landing' | 'upgrade' | 'supply' | 'supplyLand' | 'zoneRepair' | 'knockback'; owner?: string; text?: string; source?: number; target?: number; weapon?: string; damage?: number; hpAfter?: number; maxHp?: number; tier?: 'regular' | 'mini' | 'boss'; module?: ModuleId; pickupKind?: Pickup['kind']; amount?: number; callout?: Callout; actorId?: number; eventId?: number; tick?: number; powered?: boolean; muzzles?: (Muzzle & { bulletId: number; vx: number; vz: number })[]; }
export const emptyInput = (): Input => ({ x: 0, z: 0, aim: { x: 0, z: -4 }, fire: false, power: false, dash: false });
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);
const tank = (id: number, x: number, z: number, hp: number): Tank => ({ id, x, z, hp, maxHp: hp, angle: Math.PI, bodyAngle: Math.PI, cooldown: 0, recoil: 0 });
export function circleBox(x: number, z: number, r: number, o: Obstacle) { return Math.hypot(x - Math.max(o.x - o.w / 2, Math.min(x, o.x + o.w / 2)), z - Math.max(o.z - o.d / 2, Math.min(z, o.z + o.d / 2))) < r; }
export class Simulation {
  network = false; allies: Tank[] | null = null; focus?: Point; localId = 0;
  lootParticipants(): Tank[] { return [this.player]; }
  lootBatch: LootBatch | null = null;
  deliveries:Delivery[]=[]; repairZone:RepairZone|null=null; emergencyReadyAt=0; private bossWarned=false;
  creditDamage(_source: number | undefined, _damage:number) {}
  targetPlayers(): Tank[] { return [this.player]; }
  damageTank(t: Tank, amount: number, source?: number, weapon?: string) { if(t.id===this.player.id)this.damagePlayer(amount,source,weapon); }
  creditHit(b: Bullet, damage: number) { if(b.owner==='roma')this.addCharge(C.power.hit); }
  phase: Phase = 'menu'; previousPhase: 'intro' | 'playing' | 'dying' = 'playing';
  player = tank(0, 0, 7, C.player.hp); lev = tank(1, 2.2, 9, 100);
  enemies: Enemy[] = []; bullets: Bullet[] = []; portals: Portal[] = []; obstacles = makeObstacles(); events: GameEvent[] = [];
  hazards: Hazard[] = []; pickups: Pickup[] = []; capture: Capture | null = null; wavePlan: WavePlan = planWave(1);
  wave = 0; score = 0; elapsed = 0; charge = 0; powerTime = 0; healTimer = 0;
  breakTime = 0; spawnTimer = 0; remainingToSpawn = 0; spawnIndex = 0; introTime = 0;
  dashTime = 0; dashCooldown = 0; rapidTime = 0; deathTime = 0; streak = 0; powerKills = 0; regularKills = 0;
  protected dashDirection: Point = { x: 0, z: 1 }; protected dropIndex = 0;
  moved = 0; fired = 0; kills = 0; protected nextId = 2; private seed: number; private levPath: Point[] = []; private levPathTimer = 0;
  constructor(seed = 6702) { this.seed = seed; }
  /** Complete simulation data, captured only between fixed steps. No renderer or transport state. */
  exportCheckpoint() {
    return structuredClone({ version: 1 as const, core: {
      player: this.player,
      lev: this.lev,
      lootBatch: this.lootBatch,
      deliveries: this.deliveries,
      repairZone: this.repairZone,
      emergencyReadyAt: this.emergencyReadyAt,
      bossWarned: this.bossWarned,
      phase: this.phase,
      previousPhase: this.previousPhase,
      enemies: this.enemies,
      bullets: this.bullets,
      portals: this.portals,
      obstacles: this.obstacles,
      events: this.events,
      hazards: this.hazards,
      pickups: this.pickups,
      capture: this.capture,
      wavePlan: this.wavePlan,
      wave: this.wave,
      score: this.score,
      elapsed: this.elapsed,
      charge: this.charge,
      powerTime: this.powerTime,
      healTimer: this.healTimer,
      breakTime: this.breakTime,
      spawnTimer: this.spawnTimer,
      remainingToSpawn: this.remainingToSpawn,
      spawnIndex: this.spawnIndex,
      introTime: this.introTime,
      dashTime: this.dashTime,
      dashCooldown: this.dashCooldown,
      rapidTime: this.rapidTime,
      deathTime: this.deathTime,
      streak: this.streak,
      powerKills: this.powerKills,
      regularKills: this.regularKills,
      dashDirection: this.dashDirection,
      dropIndex: this.dropIndex,
      moved: this.moved,
      fired: this.fired,
      kills: this.kills,
      nextId: this.nextId,
      seed: this.seed,
      levPath: this.levPath,
      levPathTimer: this.levPathTimer,
    } });
  }
  importCheckpoint(checkpoint: SimulationCheckpoint) {
    if (checkpoint.version !== 1) throw new Error('Unsupported simulation checkpoint');
    const data = structuredClone(checkpoint.core);
    this.player = data.player;
    this.lev = data.lev;
    this.lootBatch = data.lootBatch;
    this.deliveries = data.deliveries;
    this.repairZone = data.repairZone;
    this.emergencyReadyAt = data.emergencyReadyAt;
    this.bossWarned = data.bossWarned;
    this.phase = data.phase;
    this.previousPhase = data.previousPhase;
    this.enemies = data.enemies;
    this.bullets = data.bullets;
    this.portals = data.portals;
    this.obstacles = data.obstacles;
    this.events = data.events;
    this.hazards = data.hazards;
    this.pickups = data.pickups;
    this.capture = data.capture;
    this.wavePlan = data.wavePlan;
    this.wave = data.wave;
    this.score = data.score;
    this.elapsed = data.elapsed;
    this.charge = data.charge;
    this.powerTime = data.powerTime;
    this.healTimer = data.healTimer;
    this.breakTime = data.breakTime;
    this.spawnTimer = data.spawnTimer;
    this.remainingToSpawn = data.remainingToSpawn;
    this.spawnIndex = data.spawnIndex;
    this.introTime = data.introTime;
    this.dashTime = data.dashTime;
    this.dashCooldown = data.dashCooldown;
    this.rapidTime = data.rapidTime;
    this.deathTime = data.deathTime;
    this.streak = data.streak;
    this.powerKills = data.powerKills;
    this.regularKills = data.regularKills;
    this.dashDirection = data.dashDirection;
    this.dropIndex = data.dropIndex;
    this.moved = data.moved;
    this.fired = data.fired;
    this.kills = data.kills;
    this.nextId = data.nextId;
    this.seed = data.seed;
    this.levPath = data.levPath;
    this.levPathTimer = data.levPathTimer;
  }
  random() { this.seed |= 0; this.seed = this.seed + 0x6D2B79F5 | 0; let t = Math.imul(this.seed ^ this.seed >>> 15, 1 | this.seed); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296; }
  emit(type: GameEvent['type'], at: Point = this.player, text?: string, owner?: string, data: Partial<GameEvent> = {}) { this.events.push({ type, x: at.x, z: at.z, text, owner, ...data }); }
  announce(callout: Callout) { this.emit('achievement', this.player, CALLOUTS[callout].text, undefined, { callout }); }
  drainEvents() { return this.events.splice(0); }
  start(intro = true) {
    this.player = tank(0, 0, intro ? 11.2 : 7, C.player.hp); this.lev = tank(1, 2.2, intro ? 13 : 9, 100);
    this.enemies = []; this.bullets = []; this.portals = []; this.hazards = []; this.pickups = []; this.lootBatch = null; this.deliveries=[]; this.repairZone=null; this.emergencyReadyAt=0; this.bossWarned=false; this.capture = null; this.obstacles = makeObstacles(); this.events = [];
    this.wave = this.score = this.elapsed = this.charge = this.powerTime = this.healTimer = this.breakTime = this.spawnTimer = this.remainingToSpawn = this.spawnIndex = this.introTime = this.moved = this.fired = this.kills = 0;
    this.dashTime = this.dashCooldown = this.rapidTime = this.deathTime = this.streak = this.powerKills = this.regularKills = this.dropIndex = 0;
    this.nextId = 2; this.levPath = []; this.levPathTimer = 0; this.wavePlan = planWave(1); this.phase = intro ? 'intro' : 'playing';
    if (!intro) this.beginWave();
  }
  skipIntro() { if (this.phase !== 'intro') return; this.player.z = 7; this.lev.z = 9; this.introTime = 6.5; this.phase = 'playing'; this.beginWave(); }
  pause() { if (this.phase === 'playing' || this.phase === 'intro' || this.phase === 'dying') { this.previousPhase = this.phase; this.phase = 'paused'; } }
  resume() { if (this.phase === 'paused') this.phase = this.previousPhase; }
  beginWave() {
    this.wave++; this.wavePlan = planWave(this.wave); this.spawnIndex = 0; this.remainingToSpawn = this.wavePlan.count; this.spawnTimer = 0; this.breakTime = 0;
    this.capture = this.wavePlan.captureIndex === null ? null : { ...POINTS[this.wavePlan.captureIndex], progress: 0, hold: 0, duration: captureDuration(this.wave), status: 'away' };
    this.emit('wave', this.player, String(this.wave));
    const names = bossCaption(this.wavePlan.bosses);
    this.emit('line', this.lev, names ? `Рома, на подходе ${names}! Готовь SIX SEVEN.` : this.capture ? `Захватим точку «${this.capture.name}»! Я прикрою.` : C.lines.wave);
  }
  finishWave() {
    if (this.breakTime > 0) return;
    this.score += 250; this.remainingToSpawn = 0; this.portals = []; this.enemies = []; this.hazards = []; this.bullets = this.bullets.filter(b => b.owner !== 'enemy');
    this.breakTime = breakDuration(this.wave); this.bossWarned=false;
    for(const t of this.lootParticipants())t.adrenaline=false;
    this.emit('line', this.lev, 'Соберите ремонт и выберите модули.');
  }
  scale() { return Math.min(2, 1 + Math.max(0, this.wave - 3) * 0.05); }
  addCharge(amount: number) { if (this.powerTime > 0) return; const old = this.charge; this.charge = Math.min(C.power.max, this.charge + amount); if (old < C.power.max && this.charge === C.power.max) this.emit('ready', this.lev, C.lines.ready); }
  activatePower() {
    if (this.phase !== 'playing' || this.charge < C.power.max || this.powerTime > 0) return false;
    this.charge = 0; this.powerTime = C.power.duration; this.powerKills = 0; this.player.cooldown = 0; this.emit('power', this.player, C.lines.power, undefined, { callout: 'power' }); return true;
  }
  activateDash(input: Input) {
    if (this.phase !== 'playing' || this.dashCooldown > 0) return false;
    const len = Math.hypot(input.x, input.z);
    this.dashDirection = len ? { x: input.x / len, z: input.z / len } : { x: Math.sin(this.player.bodyAngle), z: Math.cos(this.player.bodyAngle) };
    this.dashTime = B.dash.duration; this.dashCooldown = tankStats(this.player).dashCooldown; this.player.ramHits = []; this.emit('dash'); return true;
  }
  damagePlayer(amount: number, source?: number, weapon?: string) {
    if (this.phase !== 'playing' || amount <= 0) return;
    if (this.powerTime > 0 || this.dashTime > 0) { this.emit('shield', this.player, undefined, 'roma', { source, target: 0, weapon, damage: 0 }); return; }
    const damage = Math.min(this.player.hp, amount); this.player.hp -= damage; this.player.lastDamageAt=this.elapsed; this.streak = 0;
    this.emit('hit', this.player, undefined, 'roma', { damage, source, target: 0, weapon, hpAfter:this.player.hp,maxHp:this.player.maxHp });
    if (this.player.hp === 0) { this.phase = 'dying'; this.stopSupport(); this.deathTime = 0.8; this.emit('explode', this.player, undefined, 'roma', { tier: 'mini' }); }
  }
  walkable(x: number, z: number, radius: number) {
    return Math.abs(x) <= C.arena.halfWidth - radius && Math.abs(z) <= C.arena.halfDepth - radius && !this.obstacles.some(o => circleBox(x, z, radius, o));
  }
  move(t: Tank, dx: number, dz: number, radius: number) {
    const before = { x: t.x, z: t.z };
    const free = (x: number, z: number) => this.walkable(x, z, radius) && (!this.targetPlayers().some(p=>p.id===t.id) || this.enemies.every(e => Math.hypot(e.x - x, e.z - z) >= radius + C.enemy[e.kind].radius || Math.hypot(e.x - x, e.z - z) > Math.hypot(e.x - t.x, e.z - t.z) + 1e-8));
    if (free(t.x + dx, t.z)) t.x += dx;
    if (free(t.x, t.z + dz)) t.z += dz;
    if (distance(before, t) > 0.001) t.bodyAngle = Math.atan2(t.x - before.x, t.z - before.z);
  }
  lineOfSight(a: Point, b: Point, radius = 0.12) {
    // Exact segment/expanded-box intersection: sampling misses grazing shots at corners.
    for (const o of this.obstacles) {
      let near = 0, far = 1;
      for (const [start, delta, min, max] of [[a.x, b.x-a.x, o.x-o.w/2-radius, o.x+o.w/2+radius], [a.z, b.z-a.z, o.z-o.d/2-radius, o.z+o.d/2+radius]]) {
        if (Math.abs(delta) < 1e-9) { if (start < min || start > max) { near = 2; break; } }
        else { const t1=(min-start)/delta, t2=(max-start)/delta; near=Math.max(near,Math.min(t1,t2)); far=Math.min(far,Math.max(t1,t2)); }
      }
      if (near <= far) return false;
    }
    return true;
  }
  // Small bounded grid search keeps every route inside the arena and outside cover.
  findPath(from: Point, to: Point, radius = 0.7): Point[] {
    const size = 1.5, cols = 25, rows = 19;
    const world = (id: number): Point => ({ x: (id % cols - 12) * size, z: (Math.floor(id / cols) - 9) * size });
    const index = (p: Point) => Math.max(0, Math.min(rows - 1, Math.round(p.z / size) + 9)) * cols + Math.max(0, Math.min(cols - 1, Math.round(p.x / size) + 12));
    // A shove may leave the hull inside the route planner's extra safety margin.
    // Use its actual starting clearance for the first exit segment only.
    const clearance=Math.min(radius,C.arena.halfWidth-Math.abs(from.x),C.arena.halfDepth-Math.abs(from.z),...this.obstacles.map(o=>Math.max(0,Math.abs(from.x-o.x)-o.w/2,Math.abs(from.z-o.z)-o.d/2)));
    const exitRadius=Math.max(0,clearance-1e-5);
    const nearest = (point: Point, requireConnection: boolean) => {
      const center = index(point), candidates: number[] = [];
      for (let dz=-2;dz<=2;dz++) for (let dx=-2;dx<=2;dx++) { const col=center%cols+dx,row=Math.floor(center/cols)+dz; if(col>=0&&col<cols&&row>=0&&row<rows)candidates.push(row*cols+col); }
      candidates.sort((a,b)=>distance(world(a),point)-distance(world(b),point));
      return candidates.find(id=>{const p=world(id);return this.walkable(p.x,p.z,radius)&&(!requireConnection||this.lineOfSight(point,p,exitRadius));}) ?? center;
    };
    const start = nearest(from,true), goal = nearest(to,false), open = [start], came = new Map<number, number>(), cost = new Map([[start, 0]]), closed = new Set<number>();
    let best = start, bestDist = distance(world(start), to);
    while (open.length) {
      open.sort((a, b) => (cost.get(a)! + distance(world(a), to)) - (cost.get(b)! + distance(world(b), to)));
      const current = open.shift()!; if (closed.has(current)) continue; closed.add(current);
      const p = world(current), d = distance(p, to); if (d < bestDist) { best = current; bestDist = d; }
      if (current === goal) { best = current; break; }
      for (const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]]) {
        const col = current % cols + dx, row = Math.floor(current / cols) + dz;
        if (col < 0 || col >= cols || row < 0 || row >= rows) continue;
        const next = row * cols + col, q = world(next);
        if (closed.has(next) || !this.walkable(q.x, q.z, radius) || !this.lineOfSight(p, q, radius)) continue;
        const nc = cost.get(current)! + Math.hypot(dx, dz) * size;
        if (nc < (cost.get(next) ?? Infinity)) { cost.set(next, nc); came.set(next, current); open.push(next); }
      }
    }
    const path: Point[] = []; let at = best;
    while (at !== start && came.has(at)) { path.unshift(world(at)); at = came.get(at)!; }
    if (path.length && !this.lineOfSight(from,path[0],radius) && distance(from,world(start)) > 0.3) path.unshift(world(start));
    return path;
  }
  follow(t: Tank, path: Point[], speed: number, radius: number, dt: number) {
    while (path.length && distance(t, path[0]) < 0.3) path.shift();
    if (!path.length) return;
    const p = path[0], len = distance(t, p), step = Math.min(speed * dt, len);
    this.move(t, (p.x - t.x) / len * step, (p.z - t.z) / len * step, radius);
  }
  shoot(t: Tank, owner: Bullet['owner'], damage: number, power = false, weapon: string = owner, angle = t.angle, predictionId?: string) {
    const sx = Math.sin(angle), sz = Math.cos(angle), speed = owner === 'enemy' ? 10 : tankStats(t).bulletSpeed;
    const tips = owner === 'enemy' ? [{ x: t.x + sx * 1.25, z: t.z + sz * 1.25, y: .75, barrel: 0 }]
      : muzzles({ ...t, angle, recoil: 1 }, power, owner === 'lev' ? GUN.levScale : 1);
    const shots: NonNullable<GameEvent['muzzles']> = [];
    for (const tip of tips) {
      if (this.bullets.length >= C.limits.bullets) break;
      if (!this.lineOfSight(t, tip)) { this.emit('hit', t); continue; }
      const id = this.nextId++, vx = sx * speed, vz = sz * speed;
      this.bullets.push({ ...tip, id, vx, vz, owner, damage, life: 4, power, weapon, source: t.id, pierce:hasModule(t,'pierce'), splash:hasModule(t,'splash'), splashDamage:12*tankStats(t).damageMultiplier, hitIds:[], ...(predictionId ? {predictionId: `${predictionId}:${tip.barrel}`} : {}) });
      shots.push({ ...tip, bulletId: id, vx, vz });
    }
    if (shots.length) { t.recoil = 1; this.emit('shot', t, undefined, owner, { source: t.id, weapon, powered: power, muzzles: shots, ...(predictionId ? {shotId: predictionId} : {}) }); }
    return shots.length;
  }
  pacing() { return wavePacing(this.wave || 1); }

  createEnemy(kind: EnemyKind, p: Point, id = this.nextId++): Enemy {
    const hp = C.enemy[kind].hp * (ENEMY_META[kind].tier === 'regular' ? this.scale() : bossScale(this.wave).hp);
    return { ...tank(id, p.x, p.z, hp), kind, shotDelay: 0, cooldown: 1.5, path: [], pathTimer: 0, state: 'move', stateTime: 0, target: { ...p }, attack: 0, attackHit: false, enraged: false, burst: 0 };
  }
  queueEnemy(forced?: EnemyKind) {
    const reserved = forced ? Math.max(0, this.wavePlan.bosses.length - this.spawnIndex) : 0;
    if (this.enemies.length + this.portals.length + reserved >= this.pacing().maxActive) return false;
    const kind = forced ?? this.wavePlan.bosses[this.spawnIndex] ?? this.wavePlan.roster[(this.spawnIndex - this.wavePlan.bosses.length + this.wavePlan.roster.length) % this.wavePlan.roster.length];
    const radius = C.enemy[kind].radius; let p: Point | undefined;
    for (let i = 0; i < 100; i++) {
      const side = Math.floor(this.random() * 4), f = this.random() * 2 - 1;
      const q = side === 0 ? { x: -17.5, z: f * 12.5 } : side === 1 ? { x: 17.5, z: f * 12.5 } : side === 2 ? { x: f * 16, z: -13.5 } : { x: f * 16, z: 13.5 };
      if (this.targetPlayers().every(p=>distance(q,p) > (this.network ? 6 : 11)) && (!this.capture || distance(q, this.capture) > B.capture.radius + radius) && [...this.portals, ...this.enemies].every(e => distance(e, q) > 2.7) && this.walkable(q.x, q.z, radius)) { p = q; break; }
    }
    if (!p) return false;
    this.portals.push({ ...p, id: this.nextId++, remaining: C.waves.warning, kind });
    if (!forced) { this.remainingToSpawn = Math.max(0, this.remainingToSpawn - 1); this.spawnIndex++; } return true;
  }
  addHazard(e: Enemy, p: Point, radius: number, delay: number, damage: number, kind: Hazard['kind'] = 'circle', angle = 0, length = 0, blockedByCover = false) {
    if (this.hazards.length >= B.hazards) return;
    this.hazards.push({ ...p, id: this.nextId++, source: e.id, kind, radius, delay, damage, angle, length, life: 0.24, hit: false, blockedByCover });
    this.emit('warning', p, undefined, 'enemy', { source: e.id, weapon: e.kind });
  }
  steer(e: Enemy, goal: Point, dt: number, speed = C.enemy[e.kind].speed) {
    if(e.knockback)return;
    const r = C.enemy[e.kind].radius, len = distance(e, goal);
    if (len < 0.25) return;
    if (this.lineOfSight(e, goal, r + 0.05)) this.move(e, (goal.x - e.x) / len * Math.min(len, speed * dt), (goal.z - e.z) / len * Math.min(len, speed * dt), r);
    else { if (e.pathTimer <= 0) { e.path = this.findPath(e, goal, r + 0.05); e.pathTimer = 0.7 + (e.id % 3) * 0.08; } this.follow(e, e.path, speed, r, dt); }
  }
  updateEnemy(e: Enemy, dt: number) {
    const pushed=advanceKnockback(e,dt,C.enemy[e.kind].radius,(x,z,r)=>this.walkable(x,z,r));
    const available=this.targetPlayers().filter(p=>p.hp>0);
    const target=available.find(p=>p.id===e.targetId && (e.state==='windup'||e.state==='execute'||e.burst>0)) ?? available.sort((a,b)=>distance(e,a)-distance(e,b))[0];
    if(!target)return;
    const cfg = C.enemy[e.kind], tier = ENEMY_META[e.kind].tier, scaling = bossScale(this.wave);
    const damage = cfg.damage * (tier === 'regular' ? 1 : scaling.damage), interval = cfg.cooldown * (tier === 'regular' ? 1 / this.scale() : scaling.interval);
    e.cooldown -= dt; e.pathTimer -= dt; e.recoil = Math.max(0, e.recoil - dt * 7); e.shotDelay -= dt;
    const d = distance(e, target), sight = this.lineOfSight(e, target);
    if (tier === 'boss' && !e.enraged && e.hp <= e.maxHp / 2) { e.enraged = true; this.emit('phase', e, `${ENEMY_META[e.kind].name}: ВТОРАЯ ФАЗА`, 'enemy', { tier, weapon: e.kind }); }
    if (e.state === 'windup') {
      e.stateTime -= dt;
      if (e.stateTime > 0) return;
      e.state = 'execute'; e.stateTime = e.kind === 'drill' ? 0.65 : 0.5; e.attackHit = false; e.hitPlayers=[];
      if (e.kind === 'saw' || e.kind === 'drill') { this.emit('dash', e, undefined, 'enemy'); return; }
      if (e.kind === 'squall' || e.kind === 'barrier') for (const a of e.kind === 'squall' ? [-0.32, 0, 0.32] : [-0.14, 0.14]) this.shoot(e, 'enemy', damage, false, e.kind, e.angle + a);
      if (e.kind === 'factory') {
        for (let i = 0; i < (e.enraged ? 16 : 10); i++) this.shoot(e, 'enemy', damage, false, e.kind, i * Math.PI * 2 / (e.enraged ? 16 : 10));
        for (let i = 0; i < (e.enraged ? 3 : 2); i++) this.queueEnemy(i % 2 ? 'flanker' : 'light');
      }
      e.state = 'recover'; e.stateTime = 0.8; return;
    }
    if (e.state === 'execute') {
      e.stateTime -= dt;
      if(pushed){e.state='recover';e.stateTime=1.2;return;}
      const before = { x: e.x, z: e.z }, steps=Math.max(1,Math.ceil(18*dt/.15));
      for(let i=0;i<steps;i++){
        this.move(e,Math.sin(e.angle)*18*dt/steps,Math.cos(e.angle)*18*dt/steps,cfg.radius);
        const contacts=[...available,...this.enemies.filter(q=>q.id!==e.id),...(!this.network?[this.lev]:[])];
        for(const p of contacts){
          const radius=p===this.lev&&!this.network? .52:'kind' in p?C.enemy[(p as Enemy).kind].radius:C.player.radius;
          if(p.hp<=0||distance(e,p)>=cfg.radius+radius+.15||!this.lineOfSight(e,p,.05))continue;
          if(available.some(t=>t.id===p.id)&&!e.hitPlayers?.includes(p.id)){this.damageTank(p,damage,e.id,e.kind);e.attackHit=true;(e.hitPlayers??=[]).push(p.id);}
          this.pushTank(e,p,{x:Math.sin(e.angle),z:Math.cos(e.angle)},e.kind);
        }
      }
      if (e.stateTime <= 0 || distance(before, e) < 0.005) {
        if (e.kind === 'drill') this.addHazard(e, e, 3.2, 0.85, damage * 0.6);
        e.state = 'recover'; e.stateTime = 1.2;
        if (e.kind === 'drill' && e.enraged && e.attack % 2 === 1) e.cooldown = 0;
      } return;
    }
    if (e.state === 'recover') { e.stateTime -= dt; if (e.stateTime <= 0) e.state = 'move'; else return; }
    e.angle = Math.atan2(target.x - e.x, target.z - e.z);
    const goal = this.capture && e.id % 3 === 0 ? this.capture : target;
    if (e.kind === 'medic') {
      const ally = this.enemies.filter(q => q.id !== e.id && ENEMY_META[q.kind].tier === 'regular' && q.hp < q.maxHp).sort((a, b) => distance(e, a) - distance(e, b))[0];
      if (ally) { this.steer(e, ally, dt); if (distance(e, ally) < 5 && this.lineOfSight(e, ally) && e.cooldown <= 0) { ally.hp = Math.min(ally.maxHp, ally.hp + 15); e.cooldown = interval; this.emit('heal', ally, undefined, 'enemy', { source: e.id, target: ally.id }); } return; }
    }
    if ((e.kind === 'flanker' || e.kind === 'squall') && sight && d < 15) {
      const a = Math.atan2(e.x - goal.x, e.z - goal.z) + (e.id % 2 ? 0.55 : -0.55);
      this.steer(e, { x: goal.x + Math.sin(a) * 7, z: goal.z + Math.cos(a) * 7 }, dt);
    } else if (goal !== target || !sight || d > cfg.range - 1) this.steer(e, goal, dt);
    else if (['shooter', 'sniper', 'mortar', 'medic'].includes(e.kind) && d < 5) this.steer(e, { x: e.x + Math.sin(e.angle + Math.PI) * 2, z: e.z + Math.cos(e.angle + Math.PI) * 2 }, dt);
    if (e.burst > 0 && e.shotDelay <= 0) { if (sight) this.shoot(e, 'enemy', damage, false, e.kind); e.burst--; e.shotDelay = 0.18; }
    if (e.cooldown > 0 || d > cfg.range + 1 || (!sight && !['mortar', 'hail'].includes(e.kind))) return;
    e.cooldown = interval; e.target = { x: target.x, z: target.z }; e.attack++; e.targetId=target.id;
    if (['light', 'shooter', 'flanker', 'medic'].includes(e.kind)) { this.shoot(e, 'enemy', damage, false, e.kind); if (e.kind === 'shooter') { e.burst = 2; e.shotDelay = 0.18; } return; }
    e.state = 'windup'; e.stateTime = 0.9;
    if (e.kind === 'sniper') this.addHazard(e, e, 0.32, 0.9, damage, 'line', e.angle, 30, true);
    else if (e.kind === 'mortar') this.addHazard(e, e.target, 1.8, 1.2, damage);
    else if (e.kind === 'saw' || e.kind === 'drill') this.addHazard(e, e, cfg.radius, 0.9, 0, 'line', e.angle, e.kind === 'drill' ? 12 : 9);
    else if (e.kind === 'hail') {
      const salvos = e.enraged ? 2 : 1;
      for (let salvo = 0; salvo < salvos; salvo++) {
        if (e.attack % 2) for (let i = -1; i <= 1; i++) this.addHazard(e, { x: e.target.x + i * 3.4, z: e.target.z + salvo * 2 }, 1.8, 1.1 + salvo * 0.45, damage);
        else for (let i = -1; i <= 1; i++) this.addHazard(e, { x: Math.max(-16, Math.min(16, e.target.x + i * 4)), z: -14 }, 0.75, 1.2 + salvo * 0.5, damage, 'line', 0, 28);
      }
    } else this.emit('warning', e, undefined, 'enemy', { weapon: e.kind });
  }
  updateHazards(dt: number) {
    for (const h of this.hazards) {
      if (this.phase !== 'playing') break;
      h.delay -= dt; if (h.delay > 0) continue;
      h.life -= dt;
      if (!h.hit) { this.emit('explode', h, undefined, 'hazard', { tier: 'regular', weapon: h.kind }); h.hit = true; }
      for(const p of this.targetPlayers()) {
        const dx=p.x-h.x,dz=p.z-h.z,along=dx*Math.sin(h.angle)+dz*Math.cos(h.angle),side=Math.abs(dx*Math.cos(h.angle)-dz*Math.sin(h.angle));
        const inside=h.kind==='circle'?distance(h,p)<h.radius+C.player.radius:along>=0&&along<=h.length&&side<h.radius+C.player.radius;
        if(p.hp>0 && inside && h.damage>0 && !h.hitPlayers?.includes(p.id) && (!h.blockedByCover||this.lineOfSight(h,p))) { this.damageTank(p,h.damage,h.source,h.kind);(h.hitPlayers??=[]).push(p.id); }
      }
    }
    this.hazards = this.hazards.filter(h => h.delay > 0 || h.life > 0);
  }
  killEnemy(e: Enemy, owner: 'roma' | 'lev' = 'roma', source?: number) {
    if (this.phase !== 'playing' || !this.enemies.includes(e)) return;
    const tier = ENEMY_META[e.kind].tier;
    this.enemies = this.enemies.filter(q => q.id !== e.id); this.score += tier === 'boss' ? 1500 : tier === 'mini' ? 500 : 100;
    this.kills++; this.streak++; this.addCharge(C.power.kill + (hasModule(this.player,'capacitor')?3:0)); this.emit('explode', e, undefined, owner, { tier, target: e.id, weapon: e.kind });
    const threshold = ({ 7: 'steel', 15: 'unstoppable', 30: 'master', 67: 'legend' } as Record<number, Callout>)[this.streak]; if (threshold) this.announce(threshold);
    if (this.powerTime > 0 && ++this.powerKills === 6) this.announce('six');
    if (tier === 'boss') { this.announce('boss'); this.dropBossLoot(e, e.kind as BigBoss); }
    if (tier === 'mini') this.scatterRepair(e,this.lootParticipants().length,{reward:'mini'});
    if (tier === 'regular' && ++this.regularKills % 4 === 0)
      this.launchPickup(e, (['heal', 'charge', 'rapid'] as const)[this.dropIndex++ % 3]);
  }
  landingSpot(from:Point, radius:number, angle:number, occupied:Point[]=[]):Point {
    // Sweep the entire route as well as the footprint. The dead body/crate has
    // already been removed, so its origin is free and no arc cuts through cover.
    for(const separation of [2.7])for(let ring=0;ring<48;ring++)for(let i=0;i<64;i++){
      const a=angle+i*Math.PI*2/64, r=radius+ring*.45;
      const p={x:from.x+Math.sin(a)*r,z:from.z+Math.cos(a)*r};
      if(this.walkable(p.x,p.z,.8)&&this.lineOfSight(from,p,.55)&&occupied.every(q=>distance(q,p)>=separation))return p;
    }
    return {...from};
  }
  launchPickup(from:Point,kind:Pickup['kind'],options:{module?:ModuleId;batchId?:number;delay?:number;spot?:Point;life?:number;deliveryId?:number;reward?:Pickup['reward']}={}) {
    if(this.pickups.length>=B.pickupLimit){let index=this.pickups.findIndex(p=>p.kind!=='module'&&!p.reward&&!p.batchId);if(index<0)index=this.pickups.findIndex(p=>p.kind==='heal');if(index<0)return;this.pickups.splice(index,1);}
    const spot=options.spot??this.landingSpot(from,1+this.random(),this.random()*Math.PI*2);
    this.pickups.push({...spot,id:this.nextId++,kind,module:options.module,batchId:options.batchId,deliveryId:options.deliveryId,reward:options.reward,
      life:options.life??B.pickups.life,flight:{from:{x:from.x,z:from.z},remaining:.65,delay:options.delay??0}});
  }
  dropBossLoot(from:Point,boss:BigBoss) {
    this.pickups=this.pickups.filter(p=>!p.batchId);this.deliveries=this.deliveries.filter(d=>d.source!=='boss');
    const players=this.lootParticipants(), n=players.length, id=this.nextId++;
    this.lootBatch={id,eligible:players.map(p=>p.id),claimed:[]};
    const modules=chooseModules(boss,players,()=>this.random()), occupied:Point[]=[];
    const start=this.random()*Math.PI*2;
    // Reserve the outer choices first, leaving a separate inner ring for repairs.
    const spots=modules.map((_,i)=>{const p=this.landingSpot(from,4,start+i*Math.PI*2/Math.max(1,modules.length),occupied);occupied.push(p);return p;});
    modules.forEach((module,i)=>this.launchPickup(from,'module',{module,batchId:id,spot:spots[i],delay:i*.04,life:1e9}));
    this.scheduleDelivery('boss',2*n+1-modules.length,5,id);
  }
  scatterRepair(from:Point,count:number,options:{batchId?:number;deliveryId?:number;reward?:Pickup['reward']}={}) {
    const occupied:Point[]=this.pickups.filter(p=>p.kind==='module').map(p=>({x:p.x,z:p.z}));
    const start=this.random()*Math.PI*2;
    for(let i=0;i<count;i++){const spot=this.landingSpot(from,1.5,start+i*Math.PI*2/count,occupied);occupied.push(spot);this.launchPickup(from,'heal',{...options,spot,delay:i*.04,life:30});}
  }
  scheduleDelivery(source:Delivery['source'],count:number,delay=0,batchId?:number) {
    let spot:Point={x:0,z:0};
    if(!this.walkable(0,0,.8)){
      const free:Point[]=[];for(let z=-13;z<=13;z+=.5)for(let x=-17;x<=17;x+=.5)if(this.walkable(x,z,.8))free.push({x,z});
      free.sort((a,b)=>Math.hypot(a.x,a.z)-Math.hypot(b.x,b.z));if(!free.length)return;spot=free[0];
    }
    const startAt=Math.max(this.elapsed+delay,...this.deliveries.filter(d=>!d.landed).map(d=>d.startAt+3.01));
    const delivery:Delivery={...spot,id:this.nextId++,source,count,startAt,batchId,landed:false};this.deliveries.push(delivery);
    this.emit('supply',spot,source==='boss'?'Ремонт с воздуха через 5 с':'Экстренная помощь в пути');
  }
  checkEmergency() {
    if(this.phase!=='playing'||this.breakTime>0||this.elapsed<this.emergencyReadyAt)return;
    if(this.deliveries.some(d=>d.source==='boss'||!d.landed))return;
    if(this.targetPlayers().some(t=>t.hp>0&&t.hp/t.maxHp<=.2)){
      this.emergencyReadyAt=this.elapsed+90;this.scheduleDelivery('emergency',this.lootParticipants().length);
    }
  }
  advanceSupport(dt:number) {
    for(const d of this.deliveries)if(!d.landed&&this.elapsed>=d.startAt+3){
      d.landed=true;this.scatterRepair(d,d.count,{deliveryId:d.id,batchId:d.batchId,reward:d.source});this.emit('supplyLand',d);
    }
    this.deliveries=this.deliveries.filter(d=>!d.landed||this.pickups.some(p=>p.deliveryId===d.id));
    const zone=this.repairZone;if(!zone)return;
    const active=Math.max(0,Math.min(dt,zone.until-(this.elapsed-dt)));
    for(const t of this.targetPlayers()){
      const id=t.id,used=zone.healed[id]??0;
      if(t.hp>0&&distance(t,zone)<=B.capture.radius){
        const amount=Math.max(0,Math.min(2*active,20-used,t.maxHp-t.hp));t.hp+=amount;zone.healed[id]=used+amount;zone.pending[id]=(zone.pending[id]??0)+amount;
      }
      if((zone.pending[id]??0)>0&&(this.elapsed>=(zone.noticeAt[id]??zone.until-9)||this.elapsed>=zone.until)){
        this.emit('zoneRepair',t,`+${Math.round(zone.pending[id]*10)/10} К БРОНЕ`,'roma',{actorId:id,target:id,amount:zone.pending[id]});zone.pending[id]=0;zone.noticeAt[id]=this.elapsed+1;
      }
    }
    if(this.elapsed>=zone.until)this.repairZone=null;
  }
  advanceBreak(dt:number) {
    this.breakTime=Math.max(0,this.breakTime-dt);
    if(!this.bossWarned&&(this.wave+1)%5===0&&this.breakTime<=5){this.bossWarned=true;this.emit('line',this.lev,this.wave+1>30?'Два больших босса уже близко. Готовься!':'Большой босс уже близко. Готовься!');}
    if(this.breakTime<=1e-8)this.beginWave();
  }
  stopSupport(){this.deliveries=[];this.repairZone=null;for(const t of this.lootParticipants())t.adrenaline=false;}
  moduleBlock(p:Pickup,t:Tank):string {
    if(!p.module)return '';
    if(hasModule(t,p.module))return 'Уже установлен';
    if(this.lootBatch?.claimed.includes(t.id))return 'Модуль с этого босса получен';
    if(!this.lootBatch?.eligible.includes(t.id)||p.batchId!==this.lootBatch.id)return 'Со следующего босса';
    return '';
  }
  refreshLootRights() {
    const batch=this.lootBatch;if(!batch)return;
    const eligible=this.lootParticipants().filter(t=>batch.eligible.includes(t.id)&&!batch.claimed.includes(t.id));
    for(const p of this.pickups)if(p.kind==='module'&&p.module&&!eligible.some(t=>!hasModule(t,p.module!))){p.kind='heal';delete p.module;p.life=30;}
  }
  advanceLoot(dt:number) {
    this.refreshLootRights();
    for(const p of this.pickups){
      let rest=dt;
      if(p.flight){
        const delay=Math.min(rest,Math.max(0,p.flight.delay));p.flight.delay-=delay;rest-=delay;
        const flight=Math.min(rest,p.flight.remaining);p.flight.remaining-=flight;rest-=flight;
        if(p.flight.remaining<=1e-8){p.landedAt=this.elapsed-rest;delete p.flight;this.emit('landing',p);}
      }
      if(!p.flight&&p.kind!=='module')p.life-=rest;
    }
    this.pickups=this.pickups.filter(p=>p.life>0);
  }

  updateCapture(dt: number) {
    const c = this.capture; if (!c || c.status === 'complete') return;
    const old = c.status, contested = this.enemies.some(e => distance(e, c) < B.capture.radius + C.enemy[e.kind].radius);
    if (contested) c.status = 'contested'; else if (distance(this.player, c) > B.capture.radius) c.status = 'away';
    else if (c.progress < B.capture.capture) { c.status = 'capture'; c.progress = Math.min(B.capture.capture, c.progress + dt); }
    else { c.status = 'hold'; c.hold = Math.min(c.duration - B.capture.capture, c.hold + dt); }
    if (old !== c.status) this.emit('capture', c, c.status);
    if (c.progress + c.hold >= c.duration) { c.status = 'complete'; this.score += 500; if (this.wave === 2) this.addCharge(B.capture.firstChargeBonus); this.announce('point'); this.emit('capture', c, 'complete'); this.repairZone={x:c.x,z:c.z,until:this.elapsed+10,healed:{},pending:{},noticeAt:{}}; this.finishWave(); }
  }
  update(dt: number, input: Input) {
    if (this.phase === 'dying') { this.deathTime -= dt; if (this.deathTime <= 0) { this.phase = 'over'; this.emit('over'); } return; }
    if (this.phase === 'intro') {
      const old = this.introTime; this.introTime += dt; const p = Math.min(1, Math.max(0, (this.introTime - 1.6) / 3));
      this.player.z = 11.2 - p * 4.2; this.lev.z = 13 - Math.max(0, Math.min(1, (this.introTime - 2.4) / 3)) * 4;
      if (old < 2.6 && this.introTime >= 2.6) this.emit('line', this.lev, C.lines.hello);
      if (this.introTime >= 6.5) this.skipIntro(); return;
    }
    if (this.phase !== 'playing') return;
    this.elapsed += dt;this.advanceSupport(dt);
    this.updateControlled(dt,input);
    this.updateLev(dt);
    this.updatePickups(dt);
    if (this.breakTime > 0) { this.updateBullets(dt); this.advanceBreak(dt); return; }
    for (const e of this.enemies) { this.updateEnemy(e, dt); if (this.phase !== 'playing') return; }
    for (const e of this.enemies) for (const q of this.enemies) if (q.id < e.id) { const d = distance(e, q); if (d < C.enemy[e.kind].radius + C.enemy[q.kind].radius) this.move(e, (e.x - q.x || 0.1) / Math.max(d, 0.1) * dt * 2, (e.z - q.z) / Math.max(d, 0.1) * dt * 2, C.enemy[e.kind].radius); }
    this.updateBullets(dt); if (this.phase !== 'playing') return; this.updateHazards(dt); if (this.phase !== 'playing') return;
    this.updateCapture(dt); if (this.breakTime > 0) return;
    for (const p of this.portals) { p.remaining -= dt; if (p.remaining <= 0) this.enemies.push(this.createEnemy(p.kind, p, p.id)); }
    this.portals = this.portals.filter(p => p.remaining > 0); this.spawnTimer -= dt;
    if ((this.capture || this.remainingToSpawn > 0) && this.spawnTimer <= 0) { if (this.queueEnemy()) this.spawnTimer = this.capture ? this.pacing().captureInterval : this.pacing().spawnInterval; else this.spawnTimer = 0.3; }
    if (!this.capture && this.remainingToSpawn === 0 && this.enemies.length === 0 && this.portals.length === 0) this.finishWave();
    this.checkEmergency();
  }
  pushTank(source:Tank,target:Tank,direction:Point,weapon:string) {
    if(target.hp<=0||(target.knockback?.source===source.id&&target.knockback.remaining>=.12))return;
    const dx=target.x-source.x,dz=target.z-source.z,len=Math.max(.001,Math.hypot(dx,dz));
    const x=direction.x+dx/len*.55,z=direction.z+dz/len*.55,n=Math.hypot(x,z);
    if(n<.001)return;
    target.knockback={x:x/n*RAM_PUSH.speed,z:z/n*RAM_PUSH.speed,remaining:RAM_PUSH.duration,source:source.id};
    this.emit('knockback',target,undefined,undefined,{source:source.id,target:target.id,weapon});
  }
  updateControlled(dt: number,input: Input) {
    for (const key of ['powerTime', 'healTimer', 'dashTime', 'dashCooldown', 'rapidTime'] as const) this[key] = Math.max(0, this[key] - dt);
    if (input.power) this.activatePower(); if (input.dash) this.activateDash(input);
    const stats=tankStats(this.player);
    if(hasModule(this.player,'repair')&&this.player.hp>0&&this.elapsed-(this.player.lastDamageAt??0)>=5)this.player.hp=Math.min(this.player.maxHp,this.player.hp+2*dt);
    if(this.dashTime>0&&hasModule(this.player,'ram')){
      const contacts=[...this.enemies,...this.targetPlayers().filter(t=>t.id!==this.player.id),...(!this.network?[this.lev]:[])];
      for(const target of contacts){
        const enemy='kind' in target?target as Enemy:undefined;
        const radius=enemy?C.enemy[enemy.kind].radius:target===this.lev&&!this.network?.52:C.player.radius;
        const dx=target.x-this.player.x,dz=target.z-this.player.z,len=Math.hypot(dx,dz);
        if(target.hp<=0||len>=C.player.radius+radius+B.dash.speed*dt+.12||(dx*this.dashDirection.x+dz*this.dashDirection.z)/Math.max(.01,len)<=.35||!this.lineOfSight(this.player,target,.05))continue;
        if(enemy&&!(this.player.ramHits??=[]).includes(enemy.id)){
          this.player.ramHits.push(enemy.id);this.hurtEnemy(enemy,40*stats.damageMultiplier,this.player,'roma',this.player.id,'ram',false);
        }
        this.pushTank(this.player,target,this.dashDirection,'ram');
      }
    }
    const pushed=advanceKnockback(this.player,dt,C.player.radius,(x,z,r)=>this.walkable(x,z,r));
    const norm = Math.hypot(input.x, input.z), start = { x: this.player.x, z: this.player.z };
    if (!pushed && this.dashTime > 0) this.move(this.player, this.dashDirection.x * B.dash.speed * dt, this.dashDirection.z * B.dash.speed * dt, C.player.radius);
    else if (!pushed && norm) this.move(this.player, input.x / Math.max(1, norm) * stats.speed * dt, input.z / Math.max(1, norm) * stats.speed * dt, C.player.radius);
    this.moved += distance(start, this.player); this.player.angle = Math.atan2(input.aim.x - this.player.x, input.aim.z - this.player.z);
    this.player.cooldown -= dt; this.player.recoil = Math.max(0, this.player.recoil - dt * 7);
    if ((input.fire || input.firePressed) && this.player.cooldown <= 0) { const shots = this.shoot(this.player, 'roma', stats.damage, this.powerTime > 0, 'roma', this.player.angle, input.shotId); this.player.cooldown = stats.cooldown / (this.powerTime > 0 || this.rapidTime > 0 ? 2 : 1); if (shots) this.fired++; }
  }
  updatePickups(dt: number) {
    this.advanceLoot(dt);
    for (const p of this.pickups) {
      if(p.life<=0||p.flight||this.player.hp<=0)continue;
      if (distance(p, this.player) < (p.kind==='module'?B.pickups.radius:tankStats(this.player).pickupRadius)) {
        if(p.kind==='module'){
          if(!p.module||this.moduleBlock(p,this.player))continue;
          (this.player.modules??=[]).push(p.module);this.lootBatch!.claimed.push(this.player.id);
          this.player.maxHp=tankStats(this.player).maxHp;
          if(p.module==='armor')this.player.hp=Math.min(this.player.maxHp,this.player.hp+30);
          if(p.module==='repair')this.player.lastDamageAt=this.elapsed;
          p.life=0;this.emit('upgrade',this.player,`Установлено: ${MODULES[p.module].name}`,'roma',{target:this.player.id,module:p.module,pickupKind:'module'});continue;
        }
        if(p.kind==='heal'&&this.player.hp>=this.player.maxHp)continue;
        let amount = 0, text = '';
        if (p.kind === 'heal') { amount = Math.max(0, Math.min(20, this.player.maxHp - this.player.hp)); this.player.hp += amount; text = amount ? `+${Math.round(amount)} К БРОНЕ` : 'БРОНЯ ПОЛНА'; }
        else if (p.kind === 'charge') { const before = this.charge; this.addCharge(15); amount = this.charge - before; text = amount ? `+${amount} К ЗАРЯДУ` : this.powerTime > 0 ? 'SIX SEVEN · ЗАРЯД НЕ КОПИТСЯ' : 'ЗАРЯД ПОЛОН'; }
        else { this.rapidTime = B.pickups.rapidDuration; amount = B.pickups.rapidDuration; text = 'ОГОНЬ ×2 · 6 СЕК'; }
        p.life = 0; this.emit('pickup', this.player, text, 'roma', { pickupKind: p.kind, amount });
      }
    }
    this.pickups = this.pickups.filter(p => p.life > 0);
  }
  updateLev(dt: number) {
    this.levPathTimer -= dt; this.lev.cooldown -= dt; this.lev.recoil = Math.max(0, this.lev.recoil - dt * 7);
    const pushed=advanceKnockback(this.lev,dt,.52,(x,z,r)=>this.walkable(x,z,r));
    const followDistance = distance(this.lev, this.player);
    if (!pushed && followDistance > 2.8) {
      if (this.lineOfSight(this.lev, this.player, 0.55)) {
        this.move(this.lev, (this.player.x - this.lev.x) / followDistance * C.lev.speed * dt, (this.player.z - this.lev.z) / followDistance * C.lev.speed * dt, 0.52);
      } else { if (this.levPathTimer <= 0) { this.levPath = this.findPath(this.lev, this.player, 0.6); this.levPathTimer = 0.6; } this.follow(this.lev, this.levPath, C.lev.speed, 0.52, dt); }
    }
    const target = this.enemies.filter(e => distance(e, this.lev) < 12 && this.lineOfSight(this.lev, e)).sort((a, b) => distance(a, this.lev) - distance(b, this.lev))[0];
    if (target) { this.lev.angle = Math.atan2(target.x - this.lev.x, target.z - this.lev.z); if (this.lev.cooldown <= 0) { this.shoot(this.lev, 'lev', C.lev.damage); this.lev.cooldown = C.lev.cooldown; } }
    else this.lev.angle = this.player.angle;
    if (this.player.hp <= C.lev.healThreshold/C.player.hp*this.player.maxHp && this.healTimer === 0 && followDistance < 6) { this.player.hp = Math.min(this.player.maxHp, this.player.hp + C.lev.heal); this.healTimer = C.lev.healCooldown; this.emit('heal', this.player, C.lines.heal); }
  }
  dropCrateBonus(at: Point) {
    if(this.random()>=1/3)return;
    const kind=(['heal','charge','rapid'] as const)[Math.floor(this.random()*3)];
    this.launchPickup(at,kind);
  }
  hurtEnemy(e:Enemy,amount:number,from:Point,owner:'roma'|'lev',source:number|undefined,weapon:string|undefined,direct:boolean,b?:Bullet) {
    const dx=e.x-from.x,dz=e.z-from.z,len=Math.hypot(dx,dz);
    const front=b?(b.vx*Math.sin(e.angle)+b.vz*Math.cos(e.angle))/Math.hypot(b.vx,b.vz):(dx*Math.sin(e.angle)+dz*Math.cos(e.angle))/Math.max(.001,len);
    if(e.kind==='barrier'&&e.state!=='recover'&&front<-.45){this.emit('shield',e,undefined,'enemy');return false;}
    const damage=Math.min(e.hp,amount*(e.kind==='saw'&&e.state==='recover'?1.5:1));e.hp-=damage;
    if(direct&&b)this.creditHit(b,damage);else this.creditDamage(source,damage);
    this.emit('hit',e,undefined,owner,{source,target:e.id,damage,weapon});
    if(e.hp<=0)this.killEnemy(e,owner,source);return true;
  }
  burstBullet(b:Bullet) {
    if(!b.splash||b.owner==='enemy')return;
    this.emit('explode',b,undefined,'splash',{tier:'regular',source:b.source});
    for(const e of [...this.enemies])if(!b.hitIds?.includes(e.id)&&distance(b,e)<=1.5&&this.lineOfSight(b,e))this.hurtEnemy(e,b.splashDamage??12,b,b.owner,b.source,'splash',false);
  }

  updateBullets(dt: number) {
    const keep: Bullet[] = [];
    for (const b of this.bullets) {
      if (this.phase !== 'playing') break;
      b.life -= dt; let hit = false;
      const end={x:b.x+b.vx*dt,z:b.z+b.vz*dt};
      // Sweep the complete segment, choosing the nearest surface, not array order.
      // A piercing shot can continue through one tank; cover and shields always stop it.
      for(let pass=0;pass<2&&!hit;pass++) {
        const from={x:b.x,z:b.z};let time=1,found=false;
        let obstacle:Obstacle|undefined,enemy:Enemy|undefined,player:Tank|undefined;
        for(const o of this.obstacles){const t=coverHitTime(from,end,o);if(t!==undefined&&(!found||t<time)){time=t;found=true;obstacle=o;}}
        if(b.owner==='enemy')for(const p of this.targetPlayers()){
          if(p.hp<=0)continue;const t=segmentCircle(from,end,p,C.player.radius+PROJECTILE.radius);
          if(t!==undefined&&(!found||t<time)){time=t;found=true;player=p;obstacle=undefined;}
        }
        else for(const e of this.enemies){
          if(e.hp<=0||b.hitIds?.includes(e.id))continue;const t=enemyHitTime(from,end,e);
          if(t!==undefined&&(!found||t<time)){time=t;found=true;enemy=e;obstacle=undefined;}
        }
        b.x=from.x+(end.x-from.x)*time;b.z=from.z+(end.z-from.z)*time;
        if(!found)break;
        hit=true;
        if(obstacle){
          obstacle.hp-=b.damage;this.emit('hit',b);
          if(obstacle.hp<=0){this.obstacles=this.obstacles.filter(o=>o.id!==obstacle!.id);this.emit('crate',obstacle);this.dropCrateBonus(obstacle);}
          // Keep a splash on the near side of the surface.
          b.x=from.x+(end.x-from.x)*Math.max(0,time-1e-6);b.z=from.z+(end.z-from.z)*Math.max(0,time-1e-6);
        } else if(player)this.damageTank(player,b.damage,b.source,b.weapon);
        else if(enemy){
          const damaged=this.hurtEnemy(enemy,b.damage,b,b.owner as 'roma'|'lev',b.source,b.weapon,true,b);
          (b.hitIds??=[]).push(enemy.id);
          if(damaged&&b.pierce&&b.hitIds.length===1){hit=false;b.damage*=.5;}
        }
      }
      if(hit)this.burstBullet(b);
      if (!hit && b.life > 0 && Math.abs(b.x) < 22 && Math.abs(b.z) < 18) keep.push(b);
    }
    this.bullets = keep;
  }
}

export type SimulationCheckpoint = ReturnType<Simulation['exportCheckpoint']>;
