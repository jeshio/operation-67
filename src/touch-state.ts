export type TouchAction = 'move' | 'aim' | 'dash' | 'power';
export interface StickVector { x: number; y: number; }
export const STICK_DEAD_ZONE = 0.18;

/** Screen coordinates: right and down are positive. */
export function stickVector(x: number, y: number, radius: number): StickVector {
  const length = Math.hypot(x, y);
  if (!length || radius <= 0 || length / radius <= STICK_DEAD_ZONE) return { x: 0, y: 0 };
  const strength = (Math.min(1, length / radius) - STICK_DEAD_ZONE) / (1 - STICK_DEAD_ZONE);
  return { x: x / length * strength, y: y / length * strength };
}

/** One owner per control; releasing a finger never releases another control. */
export class TouchState {
  private owners = new Map<TouchAction, number>();
  move: StickVector = { x: 0, y: 0 };
  aim: StickVector = { x: 0, y: 0 };
  lastAim: StickVector = { x: 0, y: 0 };
  private firePressed = false;
  get aiming() { return Math.hypot(this.aim.x, this.aim.y) > 0; }
  private power = false;
  private dash = false;
  begin(action: TouchAction, pointer: number): boolean {
    if (this.owners.has(action) || [...this.owners.values()].includes(pointer)) return false;
    this.owners.set(action, pointer);
    if (action === 'power') this.power = true;
    if (action === 'dash') this.dash = true;
    return true;
  }
  action(pointer: number) { return [...this.owners].find(([, owner]) => owner === pointer)?.[0]; }
  update(pointer: number, x: number, y: number, radius: number) {
    const action = this.action(pointer);
    if (action === 'move' || action === 'aim') {
      const vector = stickVector(x, y, radius);
      if (action === 'aim' && Math.hypot(vector.x, vector.y) > 0) {
        if (!this.aiming) this.firePressed = true;
        this.lastAim = vector;
      }
      this[action] = vector;
    }
  }
  end(pointer: number, cancelled = false) {
    const action = this.action(pointer);
    if (!action) return;
    this.owners.delete(action);
    if (cancelled && action === 'aim') this.firePressed = false;
    if (cancelled && action === 'power') this.power = false;
    if (cancelled && action === 'dash') this.dash = false;
    if (action === 'move' || action === 'aim') this[action] = { x: 0, y: 0 };
  }
  consume() { const result = { power: this.power, dash: this.dash, firePressed: this.firePressed }; this.power = this.dash = this.firePressed = false; return result; }
  clear() { this.lastAim = { x: 0, y: 0 }; this.firePressed = false; this.owners.clear(); this.move = { x: 0, y: 0 }; this.aim = { x: 0, y: 0 }; this.power = this.dash = false; }
}
