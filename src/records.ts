import { GameStorage, compareRecords, hasRecord, readRecord, type RecordData } from './storage';
import type { Simulation } from './simulation';

/** Receives simulation checkpoints, never interpolated or predicted results. */
export class BattleRecords {
  private latest?: RecordData;
  private checkpoint = '';
  constructor(readonly storage: GameStorage) {}
  get isRecord() { return hasRecord(this.storage.record) && !!this.latest?.battleId && this.storage.record.battleId === this.latest.battleId; }
  observe(value: RecordData, phase: Simulation['phase']) {
    if (phase === 'menu' || phase === 'intro' || value.wave < 1 || !value.battleId) return;
    const result = readRecord(value); if (!result) return;
    if (this.latest && this.latest.battleId === result.battleId && (result.time < this.latest.time || compareRecords(result, this.latest) < 0)) return;
    if(this.latest && this.latest.battleId !== result.battleId)this.flush();
    const checkpoint = JSON.stringify([result.battleId, result.score, result.wave, result.team, phase]);
    this.latest = result;
    if (checkpoint !== this.checkpoint) { this.checkpoint = checkpoint; this.flush(); }
  }
  flush() { if (this.latest) this.storage.submit(this.latest); }
}
export function recordSummary(record: RecordData) {
  return hasRecord(record) ? `${Math.floor(record.score).toLocaleString('ru-RU')} очков · волна ${record.wave}` : 'Пока нет';
}
