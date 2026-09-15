import type { GameEvent } from './simulation';
/** Same per-hit envelope drives the HUD, particles, camera and metal impact. */
export function hitFeedback(e: Pick<GameEvent,'damage'|'hpAfter'|'maxHp'>, fallbackHp=100, fallbackMax=100){
  const hp=Math.max(0,e.hpAfter??fallbackHp),max=Math.max(1,e.maxHp??fallbackMax);
  const intensity=1+1.3*(1-Math.min(1,hp/max));
  const force=Math.min(1,Math.max(0,e.damage??0)/25);
  return {intensity,opacity:Math.min(.75,(.2+force*.2)*intensity),duration:Math.min(.5,(.16+force*.09)*intensity),shake:Math.min(.28,(.035+force*.07)*intensity),sparks:Math.ceil((3+force*3)*intensity),blast:(.28+force*.15)*intensity,volume:Math.min(1,.38*intensity+force*.1)};
}
