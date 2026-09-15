import type { Input, Point } from './simulation';
import type { GameRenderer } from './render';
import { TouchState, type TouchAction } from './touch-state';

const gameKeys = ['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space','ShiftLeft','ShiftRight'];
export class Controls {
  private keys = new Set<string>(); private firing = false; private power = false; private dash = false;
  private mouseId: number | null = null; private mouseAimUntil=0;
  private pointer = { x: window.innerWidth * 0.5, y: window.innerHeight * 0.35 };
  private touch = new TouchState();
  private captures = new Map<number, HTMLElement>();
  private aimDirection?: Point;
  private surfaces: HTMLElement[];
  touchMode = false;
  constructor(canvas: HTMLCanvasElement, private renderer: GameRenderer, private active: () => boolean, pause: () => void, private modeChanged: () => void) {
    this.surfaces = [...document.querySelectorAll<HTMLElement>('[data-touch-action]')];
    window.addEventListener('keydown', e => {
      if (e.code === 'Escape') { e.preventDefault(); if (!e.repeat) pause(); return; }
      if (!this.active() || !gameKeys.includes(e.code)) return;
      this.setTouchMode(false); e.preventDefault(); this.keys.add(e.code);
      if (e.code === 'Space' && !e.repeat) this.power = true;
      if (e.code.startsWith('Shift') && !e.repeat) this.dash = true;
    });
    window.addEventListener('keyup', e => this.keys.delete(e.code));
    window.addEventListener('pointerdown', e => { if (e.pointerType === 'touch') this.setTouchMode(true); }, { capture: true });
    window.addEventListener('pointermove', e => {
      if (e.pointerType === 'touch' || this.touch.action(e.pointerId)) { this.moveTouch(e); return; }
      if (!this.touchMode) { if(this.active()&&e.target===canvas&&(Math.abs(e.clientX-this.pointer.x)+Math.abs(e.clientY-this.pointer.y)>.3))this.mouseAimUntil=performance.now()+250;this.pointer.x = e.clientX; this.pointer.y = e.clientY; }
    });
    canvas.addEventListener('pointerdown', e => {
      if (e.button !== 0 || !this.active()) return;
      if (e.pointerType === 'touch') {
        e.preventDefault();
        return;
      }
      this.setTouchMode(false); this.pointer = { x: e.clientX, y: e.clientY }; this.mouseId = e.pointerId; this.firing = true; this.capture(canvas, e.pointerId);
    });
    const end = (e: PointerEvent) => {
      this.touch.end(e.pointerId, e.type !== 'pointerup'); this.release(e.pointerId); this.paintSticks();
      if (e.pointerId === this.mouseId) { this.mouseId = null; this.firing = false; }
    };
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    canvas.addEventListener('lostpointercapture', end);
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    for (const surface of this.surfaces) {
      surface.addEventListener('pointerdown', e => {
        if (!this.touchMode || !this.active() || e.button !== 0) return;
        e.preventDefault(); e.stopPropagation();
        if (this.touch.begin(surface.dataset.touchAction as TouchAction, e.pointerId)) { this.capture(surface, e.pointerId); this.moveTouch(e); }
      });
      surface.addEventListener('lostpointercapture', end);
      surface.addEventListener('contextmenu', e => e.preventDefault());
    }
    this.setTouchMode(window.matchMedia('(pointer: coarse)').matches);
  }
  setTouchMode(enabled: boolean) {
    if (enabled === this.touchMode) return;
    this.clear(); this.touchMode = enabled;
    document.body.classList.toggle('touch-mode', enabled);
    this.renderer.setMobile(enabled); this.modeChanged();
  }
  get aiming(){return this.touchMode?this.touch.aiming:this.firing||performance.now()<this.mouseAimUntil;}
  get portrait() { return this.touchMode && window.innerHeight > window.innerWidth; }
  private capture(element: HTMLElement, id: number) {
    this.captures.set(id, element);
    // Synthetic QA events have no native pointer to capture.
    try { element.setPointerCapture(id); } catch { /* Pointer may already have ended. */ }
  }
  private release(id: number) {
    const element = this.captures.get(id); this.captures.delete(id);
    if (element?.hasPointerCapture(id)) element.releasePointerCapture(id);
  }
  private moveTouch(e: PointerEvent) {
    const element = this.captures.get(e.pointerId);
    if (!element || !this.active()) return;
    const r = element.getBoundingClientRect();
    this.touch.update(e.pointerId, e.clientX - r.left - r.width / 2, e.clientY - r.top - r.height / 2, r.width / 2);
    this.paintSticks();
  }
  private paintSticks() {
    for (const element of this.surfaces) {
      const action = element.dataset.touchAction;
      if (action !== 'move' && action !== 'aim') continue;
      const vector = this.touch[action];
      element.style.setProperty('--stick-x', `${vector.x * 35}px`); element.style.setProperty('--stick-y', `${vector.y * 35}px`);
      element.classList.toggle('engaged', Math.hypot(vector.x, vector.y) > 0);
    }
  }
  clear() {
    this.keys.clear(); this.mouseAimUntil=0; this.firing = this.power = this.dash = false; this.mouseId = null; this.touch.clear(); this.aimDirection = undefined;
    for (const id of [...this.captures.keys()]) this.release(id);
    this.paintSticks();
  }
  read(player: Point & { angle: number }): Input {
    const edges = this.touch.consume(), power = this.power || edges.power, dash = this.dash || edges.dash; this.power = this.dash = false;
    if (this.touchMode) {
      const { move, lastAim } = this.touch;
      const fire = this.touch.aiming;
      if (fire || edges.firePressed) this.aimDirection = this.renderer.stickDirection(lastAim);
      const direction = this.aimDirection ?? { x: Math.sin(player.angle), z: Math.cos(player.angle) };
      return { ...this.renderer.movement(move.x, -move.y), aim: { x: player.x + direction.x, z: player.z + direction.z }, fire, firePressed: edges.firePressed, power, dash };
    }
    const x = Number(this.keys.has('KeyD') || this.keys.has('ArrowRight')) - Number(this.keys.has('KeyA') || this.keys.has('ArrowLeft'));
    const y = Number(this.keys.has('KeyW') || this.keys.has('ArrowUp')) - Number(this.keys.has('KeyS') || this.keys.has('ArrowDown'));
    return { ...this.renderer.movement(x, y), aim: this.renderer.aim(this.pointer.x, this.pointer.y), fire: this.firing, power, dash };
  }
}
