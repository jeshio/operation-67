export interface ScreenPoint { x: number; y: number; }
export interface Insets { top: number; right: number; bottom: number; left: number; }
export interface ViewRect { left: number; top: number; right: number; bottom: number; }
export interface ArenaLayout { width: number; height: number; portrait: boolean; insets: Insets; free: ViewRect; anchor: ScreenPoint; }
export const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
export function calculateLayout(width: number, height: number, touch: boolean, insets: Insets = { top: 8, right: 16, bottom: 14, left: 16 }): ArenaLayout {
  width = Math.max(1, width); height = Math.max(1, height);
  const portrait = touch && height > width;
  const top = portrait ? insets.top + 132 : 0;
  const free = portrait ? { left: insets.left + 20, right: width - insets.right - 20, top, bottom: Math.max(top + 48, height - insets.bottom - 220) } : { left: 0, top: 0, right: width, bottom: height };
  return { width, height, portrait, insets, free, anchor: { x: width / 2, y: portrait ? clamp(height * .45, free.top + 24, free.bottom - 24) : height / 2 } };
}
export function inside(point: ScreenPoint, rect: ViewRect) { return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom; }
export function edgePoint(target: ScreenPoint, origin: ScreenPoint, rect: ViewRect): ScreenPoint {
  const x = clamp(origin.x, rect.left + 1, rect.right - 1), y = clamp(origin.y, rect.top + 1, rect.bottom - 1);
  const dx = target.x - x, dy = target.y - y;
  if (!dx && !dy) return { x, y: rect.top };
  const tx = dx ? ((dx > 0 ? rect.right : rect.left) - x) / dx : Infinity;
  const ty = dy ? ((dy > 0 ? rect.bottom : rect.top) - y) / dy : Infinity;
  const t = Math.min(tx, ty);
  return { x: x + dx * t, y: y + dy * t };
}
export interface Threat extends ScreenPoint { id: number; boss: boolean; attacking: boolean; portal: boolean; }
export interface EdgeMarker extends ScreenPoint { sector: number; angle: number; count: number; boss: boolean; attacking: boolean; portal: boolean; }
export function groupThreats(threats: Threat[], origin: ScreenPoint, rect: ViewRect): EdgeMarker[] {
  const groups = new Map<number, { marker: EdgeMarker; priority: number; distance: number }>();
  for (const threat of threats) {
    if (inside(threat, rect)) continue;
    const dx = threat.x-origin.x, dy = threat.y-origin.y, angle = Math.atan2(dy,dx);
    const sector = (Math.round(angle/(Math.PI/4))+8)%8;
    const priority = Number(threat.attacking)*4 + Number(threat.boss)*2 + Number(threat.portal), distance = Math.hypot(dx,dy);
    const old = groups.get(sector), count = (old?.marker.count ?? 0)+1;
    if (!old || priority > old.priority || (priority === old.priority && distance < old.distance)) {
      groups.set(sector,{priority,distance,marker:{...edgePoint(threat,origin,rect),sector,angle,count,boss:threat.boss || !!old?.marker.boss,attacking:threat.attacking || !!old?.marker.attacking,portal:threat.portal}});
    } else { old.marker.count=count; old.marker.boss ||= threat.boss; old.marker.attacking ||= threat.attacking; }
  }
  return [...groups.values()].map(g=>g.marker);
}

/** Actual HUD occupancy replaces estimates after layout; bounds stay valid on short screens. */
export function fitHud(layout:ArenaLayout,top:number,bottom:number):ArenaLayout {
  const hi=clamp(bottom,64,layout.height-8),lo=clamp(top,0,hi-48);
  const free={...layout.free,top:lo,bottom:hi};
  return {...layout,free,anchor:{...layout.anchor,y:layout.portrait?clamp(layout.height*.45,lo+24,hi-24):layout.anchor.y}};
}
export interface NameTag extends ScreenPoint {id:number;width:number;height:number;}
/** Keep neighbouring tank names apart, never inside the HUD or on a nearby hull. */
export function placeNames(tags:NameTag[],free:ViewRect){
  const placed:{id:number;x:number;y:number;width:number;height:number}[]=[];
  for(const tag of tags){
    const width=Math.min(tag.width,free.right-free.left),x=clamp(tag.x-width/2,free.left,free.right-width);
    for(let step=0;step<2;step++){
      const y=tag.y-38-tag.height-step*(tag.height+3);
      if(y<free.top||y+tag.height>free.bottom)break;
      if(placed.some(p=>x<p.x+p.width+3&&x+width+3>p.x&&y<p.y+p.height+3&&y+tag.height+3>p.y))continue;
      if(tags.some(t=>x<t.x+24&&x+width>t.x-24&&y<t.y+20&&y+tag.height>t.y-20))continue;
      placed.push({id:tag.id,x,y,width,height:tag.height});break;
    }
  }
  return placed;
}
