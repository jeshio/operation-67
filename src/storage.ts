export interface RecordData { score: number; wave: number; time: number; battleId?: string; team?: string[]; }
const KEY = 'roma-operation-67-v1';
export const compareRecords = (a: RecordData, b: RecordData) => a.score - b.score || a.wave - b.wave;
export const hasRecord = (record: RecordData) => record.score > 0 || record.wave > 0;
export function readRecord(value: unknown): RecordData | undefined {
  if (!value || typeof value !== 'object') return;
  const r = value as RecordData;
  if (![r.score, r.wave, r.time].every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0)) return;
  return { score: r.score, wave: r.wave, time: r.time,
    ...(typeof r.battleId === 'string' ? { battleId: r.battleId.slice(0, 120) } : {}),
    ...(Array.isArray(r.team) ? { team: r.team.filter(n => typeof n === 'string').slice(0, 4).map(n => n.slice(0, 32)) } : {}) };
}
export class GameStorage {
  record: RecordData = { score: 0, wave: 0, time: 0 }; muted = false; musicMuted = false; narratorMuted = false; seenIntro = false;
  constructor(private backend: Pick<Storage, 'getItem' | 'setItem'> | null, private key = KEY) {
    try {
      const saved = JSON.parse(backend?.getItem(this.key) ?? 'null');
      if (saved && typeof saved === 'object') {
        this.record = readRecord(saved.record) ?? this.record;
        this.muted = saved.muted === true; this.musicMuted = typeof saved.musicMuted === 'boolean' ? saved.musicMuted : this.muted; this.narratorMuted = typeof saved.narratorMuted === 'boolean' ? saved.narratorMuted : this.muted; this.seenIntro = saved.seenIntro === true;
      }
    } catch { /* Browser storage is optional. */ }
  }
  save() { try { this.backend?.setItem(this.key, JSON.stringify({ record: this.record, muted: this.muted, musicMuted: this.musicMuted, narratorMuted: this.narratorMuted, seenIntro: this.seenIntro })); } catch { /* Keep the in-memory result. */ } }
  submit(value: RecordData) {
    const result = readRecord(value); if (!result) return false;
    const order = compareRecords(result, this.record), best = order > 0;
    // An improving run owns its record. Later checkpoints may refresh its metadata,
    // but another tied run must not steal the record or the celebration.
    const sameBattle = !!result.battleId && result.battleId === this.record.battleId;
    if (best || (sameBattle && order === 0 && result.time >= this.record.time)) {
      const next = { ...result, ...(sameBattle ? { time: Math.max(result.time, this.record.time) } : {}) };
      if (JSON.stringify(next) !== JSON.stringify(this.record)) { this.record = next; this.save(); }
    }
    return best;
  }
}
