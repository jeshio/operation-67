import { Tutorial, type Lesson } from './tutorial';
import type { GameRenderer } from './render';
import type { Simulation, GameEvent } from './simulation';

const hand = '<path d="M21 40V17c0-6 8-6 8 0v12-6c0-5 7-5 7 0v7-4c0-5 7-5 7 0v6-2c0-5 7-5 7 0v14c0 13-6 18-15 18-8 0-13-5-17-11L9 39c-3-5 3-9 7-5l5 6Z" fill="#f6e7c7" stroke="#19394b" stroke-width="2.5"/>';
export class GuideView {
  readonly lesson: Tutorial;
  private card: HTMLElement;
  private finger: HTMLElement;
  private line: SVGSVGElement;
  private last?: Lesson;
  private ready = { dash: false, power: false };
  constructor(root: HTMLElement, storage: Storage | null, key: string) {
    this.lesson = new Tutorial(storage, key);
    root.insertAdjacentHTML('beforeend', `<svg id="guide-line" aria-hidden="true"><path/></svg><div id="guide-finger" aria-hidden="true"><svg viewBox="0 0 64 72">${hand}</svg></div><aside id="guide" role="status" hidden><svg viewBox="0 0 160 60" aria-hidden="true"><g class="guide-tank"><path d="M25 15h50v32H25Z" fill="#399dcc"/><path d="M22 12v39M78 12v39" stroke="#9ad6e5" stroke-width="8"/><path d="M50 25V3" stroke="#ffe1a0" stroke-width="7"/><path class="guide-dual" d="M35 25V3m30 22V3" stroke="#ffd085" stroke-width="7"/></g><path class="guide-trail" d="M14 20H1m13 12H-8m22 12H1" stroke="#9cffe3" stroke-width="3"/><path class="guide-shield" d="m120 8 20 8v16c0 10-20 20-20 20s-20-10-20-20V16Z" fill="#94f5dd22" stroke="#94f5dd" stroke-width="3"/><path class="guide-target" d="M100 30h40m-20-20v40" stroke="#ffd085" stroke-width="2"/><circle class="guide-target" cx="120" cy="30" r="13" fill="none" stroke="#ffd085" stroke-width="2"/></svg><b></b><small></small></aside>`);
    this.card = root.querySelector('#guide')!; this.finger = root.querySelector('#guide-finger')!; this.line = root.querySelector('#guide-line')!;

  }
  repeat() { this.lesson.repeat(); }
  reset() { this.lesson.restart(); this.ready = { dash: false, power: false }; this.hide(); }
  private hide() { this.card.hidden = this.finger.hidden = true; this.line.style.display = 'none'; document.querySelectorAll('.teaching').forEach(e => e.classList.remove('teaching')); this.last = undefined; }
  handle(events: GameEvent[], sim: Simulation) { const touch=document.body.classList.contains('touch-mode');if(touch!==this.lesson.touch){this.lesson.touch=touch;this.reset();} this.lesson.confirm(events, sim.localId, sim.network); }
  update(sim: Simulation, dt: number, renderer: GameRenderer, active: boolean) {
    const touch = document.body.classList.contains('touch-mode');
    if (touch !== this.lesson.touch) { this.lesson.touch = touch; this.reset(); }
    const available = { dash: sim.dashCooldown <= 0, power: sim.charge >= 67 && sim.powerTime <= 0 };
    for (const key of ['dash','power'] as const) {
      const button = document.querySelector<HTMLElement>(touch ? `#touch-${key}` : key === 'power' ? '#power-panel' : '.dash-status')!;
      if (active && available[key] && !this.ready[key] && this.lesson.knows(key)) { button.classList.remove('ready-pulse'); void button.offsetWidth; button.classList.add('ready-pulse'); }
    }
    if (active) this.ready = available;
    const next = this.lesson.update(dt, active, available.dash, available.power);
    if (!next) { this.hide(); return; }
    if (next !== this.last) { this.hide(); this.last = next; this.card.dataset.lesson = next; }
    const r = renderer.layout, player = renderer.screen(sim.player);
    const button = next === 'fire' ? document.querySelector<HTMLElement>('#aim-stick') : document.querySelector<HTMLElement>(touch ? `#touch-${next}` : next === 'power' ? '#power-panel' : '.dash-status');
    const rect = button?.getBoundingClientRect();
    const target = rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : { x: Math.min(r.free.right - 24, player.x + 70), y: Math.max(r.free.top + 128, Math.min(r.free.bottom - 50, player.y - 70)) };
    button?.classList.add('teaching'); this.card.hidden = false;
    this.card.querySelector('b')!.textContent = next === 'fire' ? 'Отклони — стреляй' : next === 'dash' ? 'Рывок + защита' : 'Две пушки + щит · 7 с';
    this.card.querySelector('small')!.textContent = touch ? '' : next === 'dash' ? 'SHIFT' : 'ПРОБЕЛ';
    const width = Math.min(240, r.width - 32);
    this.card.style.width = `${width}px`;
    this.card.style.left = `${Math.max(16, Math.min(r.width - width - 16, target.x - width / 2))}px`;
    this.card.style.top = `${next === 'fire' ? r.free.top + 4 : Math.max(r.free.top + 4, Math.min(target.y - 154, r.free.bottom - 112))}px`;
    this.finger.dataset.lesson = next; this.finger.hidden = !touch; this.finger.style.left = `${target.x - 20}px`; this.finger.style.top = `${target.y - 16}px`;
    this.line.style.display = 'none';
    this.line.setAttribute('viewBox', `0 0 ${r.width} ${r.height}`);
    this.line.querySelector('path')!.setAttribute('d', `M${player.x} ${player.y - 12}L${target.x} ${target.y}`);
  }
}
