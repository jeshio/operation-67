import * as THREE from 'three';
import { clamp, type ArenaLayout, type ScreenPoint } from './view';
import type { Point, Phase } from './simulation';

export function projectPoint(camera: THREE.OrthographicCamera, layout: ArenaLayout, point: Point): ScreenPoint {
  const p=new THREE.Vector3(point.x,.75,point.z).project(camera);
  return {x:(p.x+1)*layout.width/2,y:(1-p.y)*layout.height/2};
}
export function groundPoint(camera: THREE.OrthographicCamera, layout: ArenaLayout, point: ScreenPoint): Point {
  const ray=new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2(point.x/layout.width*2-1,1-point.y/layout.height*2),camera);
  const out=new THREE.Vector3(); ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0,1,0),-.75),out);
  return {x:out.x,z:out.z};
}
/** Convert a stick direction through the actual projection, independent of camera panning. */
export function stickDirection(camera: THREE.OrthographicCamera, layout: ArenaLayout, stick: ScreenPoint): Point {
  const center = { x: layout.width / 2, y: layout.height / 2 };
  const a = groundPoint(camera, layout, center), b = groundPoint(camera, layout, { x: center.x + stick.x * 80, y: center.y + stick.y * 80 });
  const length = Math.hypot(b.x - a.x, b.z - a.z);
  return length ? { x: (b.x - a.x) / length * 20, z: (b.z - a.z) / length * 20 } : { x: 0, z: 0 };
}
export class ArenaCamera {
  private focus: Point | undefined;
  private dirty=true;
  private layout!: ArenaLayout;
  constructor(readonly camera: THREE.OrthographicCamera) {}
  configure(layout: ArenaLayout) { this.layout=layout;this.dirty=true; }
  reset() {this.focus=undefined;this.dirty=true;}
  update(player: Point, phase: Phase, dt: number, reducedMotion=false, previousPhase?: Phase) {
    const l=this.layout;
    if (!l) return;
    if (!this.dirty && (phase==='paused'||phase==='over')) return;
    if (!l.portrait) {
      const halfH=Math.max(20.5,29/(l.width/l.height));
      this.camera.left=-halfH*l.width/l.height;this.camera.right=-this.camera.left;this.camera.top=halfH;this.camera.bottom=-halfH;
      this.camera.position.set(29,43,34);this.camera.lookAt(0,0,0);this.finish();this.focus=undefined;return;
    }
    const effective=phase==='paused'?previousPhase:phase;
    const target=effective==='menu'||effective==='intro'?{x:0,z:12}:{x:clamp(player.x,-13,13),z:clamp(player.z,-9,9)};
    if (!this.focus || reducedMotion) this.focus={...target};
    else {const a=1-Math.exp(-dt/.15);this.focus.x+=(target.x-this.focus.x)*a;this.focus.z+=(target.z-this.focus.z)*a;}
    this.camera.position.set(29+this.focus.x,43.75,34+this.focus.z);this.camera.lookAt(this.focus.x,.75,this.focus.z);
    const halfW=12, halfH=halfW*l.height/l.width, shift=(l.anchor.y/l.height-.5)*2*halfH;
    this.camera.left=-halfW;this.camera.right=halfW;this.camera.top=halfH+shift;this.camera.bottom=-halfH+shift;this.finish();
    // Pan the projection only as far as necessary to keep the hull clear of HUD and fingers.
    if (effective!=='menu' && effective!=='intro' && phase!=='over') {
      const p=projectPoint(this.camera,l,player), r=l.free, units=24/l.width;
      const dx=(p.x-clamp(p.x,r.left+24,r.right-24))*units, dy=(clamp(p.y,r.top+24,r.bottom-24)-p.y)*units;
      this.camera.left+=dx;this.camera.right+=dx;this.camera.top+=dy;this.camera.bottom+=dy;this.finish();
    }
  }
  private finish(){this.camera.updateProjectionMatrix();this.camera.updateMatrixWorld(true);this.dirty=false;}
}
