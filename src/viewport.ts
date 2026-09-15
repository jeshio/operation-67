export interface ViewportMetrics { width: number; height: number; }
export interface VisualMetrics extends ViewportMetrics { scale: number; }

/** Zoom changes the visual viewport, not the logical orientation or game resolution. */
export function measureViewport(width: number, height: number, visual?: VisualMetrics | null, previous?: ViewportMetrics): ViewportMetrics {
  if (visual && Math.abs(visual.scale-1)>.02) return previous ?? {width,height};
  return {width:Math.max(1,Math.round(width)),height:Math.max(1,Math.round(visual ? Math.min(height,visual.height) : height))};
}

/** Pointer Events own the controls; these listeners only suppress Safari's competing gestures. */
export function guardGameGestures(root: HTMLElement, active: () => boolean) {
  const cancel = (event: Event) => { if (active() && event.cancelable) event.preventDefault(); };
  root.addEventListener('gesturestart',cancel,{passive:false});
  root.addEventListener('gesturechange',cancel,{passive:false});
  root.addEventListener('gestureend',cancel,{passive:false});
  root.addEventListener('touchstart',event => {
    if (event.touches.length>1 || (event.target instanceof Element && event.target.closest('[data-touch-action],canvas'))) cancel(event);
  },{passive:false});
  root.addEventListener('touchmove',cancel,{passive:false});
  root.addEventListener('touchend',event => {
    if (event.target instanceof Element && event.target.closest('[data-touch-action],canvas')) cancel(event);
  },{passive:false});
  root.addEventListener('dblclick',event => {
    if (!(event.target instanceof Element) || !event.target.closest('button')) cancel(event);
  });
}
