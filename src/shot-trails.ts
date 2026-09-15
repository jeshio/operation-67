import * as THREE from 'three';
import type { Point } from './simulation';
import type { Obstacle } from './config';
import { sectorReach } from './aim-sector';
export interface TrailShot extends Point {id:number;y:number;vx:number;vz:number;power:boolean;}
interface Trail {id:number;mesh:THREE.Mesh<THREE.PlaneGeometry,THREE.ShaderMaterial>;x:number;z:number;travel:number;life:number;}
const LIMIT=32,FADE=.12;
const vertexShader='varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}';
const fragmentShader='varying vec2 vUv;uniform vec3 tint;uniform float strength;void main(){float side=abs(vUv.x-.5)*2.0;float tail=vUv.y;gl_FragColor=vec4(tint,exp(-side*side*7.0)*pow(tail,1.4)*strength);}';
/** Bounded short traces; a released projectile never follows the tank. */
export class ShotTrails {
 readonly root=new THREE.Group();private geometry=new THREE.PlaneGeometry(.3,1).rotateX(Math.PI/2).translate(0,0,.5);
 private active=new Map<number,Trail>();private pool:Trail[]=[];
 reset(){for(const t of this.active.values()){t.mesh.visible=false;this.pool.push(t);}this.active.clear();}
 update(shots:TrailShot[],obstacles:Obstacle[],dt:number,reducedMotion=false){
  const ids=new Set(shots.map(s=>s.id));
  for(const [id,t] of this.active)if(!ids.has(id)){
   t.life=reducedMotion?0:t.life-dt;t.mesh.material.uniforms.strength.value=.52*Math.max(0,t.life/FADE);
   if(t.life<=0){t.mesh.visible=false;this.active.delete(id);this.pool.push(t);}
  }
  for(const s of shots){
   let t=this.active.get(s.id);
   if(!t){
    if(this.active.size>=LIMIT)continue;
    t=this.pool.pop();
    if(!t){const material=new THREE.ShaderMaterial({uniforms:{tint:{value:new THREE.Color()},strength:{value:.52}},vertexShader,fragmentShader,transparent:true,depthWrite:false,depthTest:true,side:THREE.DoubleSide,toneMapped:false});t={id:s.id,mesh:new THREE.Mesh(this.geometry,material),x:s.x,z:s.z,travel:0,life:FADE};this.root.add(t.mesh);}
    t.id=s.id;t.x=s.x;t.z=s.z;t.travel=0;this.active.set(s.id,t);
   }
   const moved=Math.hypot(s.x-t.x,s.z-t.z);
   t.travel=moved>4?0:Math.min(1.4,t.travel+moved);t.x=s.x;t.z=s.z;t.life=FADE;
   const angle=Math.atan2(s.vx,s.vz),length=sectorReach(s,angle+Math.PI,obstacles,Math.min(reducedMotion?.65:1.4,t.travel));
   t.mesh.visible=length>.025;t.mesh.position.set(s.x-Math.sin(angle)*length,s.y,s.z-Math.cos(angle)*length);t.mesh.rotation.y=angle;t.mesh.scale.set(1,1,length);
   t.mesh.material.uniforms.tint.value.setHex(s.power?0xffd38e:0x8eefdd);t.mesh.material.uniforms.strength.value=.52;
  }
 }
 stats(){return{active:this.active.size,allocated:this.root.children.length};}
}
