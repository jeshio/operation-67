import * as THREE from 'three';
import type { Point, Tank } from './simulation';
import { muzzles } from './weapons';
import type { Obstacle } from './config';

export const AIM_SECTOR = { length: 6.8, inner: 1.5, halfAngle: Math.PI / 14, steps: 20 } as const;

/** Visual clipping only. A guide must never suggest that shots pass through cover. */
export function sectorReach(origin: Point, angle: number, obstacles: Obstacle[], length: number = AIM_SECTOR.length): number {
  const dx = Math.sin(angle), dz = Math.cos(angle);
  let reach = length;
  for (const o of obstacles) {
    let near = 0, far = reach;
    for (const [start, direction, min, max] of [[origin.x, dx, o.x-o.w/2-.12, o.x+o.w/2+.12], [origin.z, dz, o.z-o.d/2-.12, o.z+o.d/2+.12]]) {
      if (Math.abs(direction) < 1e-9) { if (start < min || start > max) { near = Infinity; break; } }
      else { const a = (min-start)/direction, b = (max-start)/direction; near = Math.max(near, Math.min(a,b)); far = Math.min(far, Math.max(a,b)); }
    }
    if (near <= far) reach = Math.min(reach, Math.max(0, near - .03));
  }
  return reach;
}

/** Muzzle-height ribbons, with no ground decal or permanent endpoint. */
export class AimSector {
 readonly root=new THREE.Group();private age=1;private opacity=0;
 private geometry=new THREE.PlaneGeometry(.22,1).rotateX(Math.PI/2).translate(0,0,.5);
 private material=new THREE.ShaderMaterial({
  uniforms:{tint:{value:new THREE.Color(0x92e9db)},strength:{value:0}},
  vertexShader:`varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
  fragmentShader:`varying vec2 vUv;uniform vec3 tint;uniform float strength;
   void main(){float side=abs(vUv.x-.5)*2.0;float along=vUv.y;
    float soft=exp(-side*side*9.0);float fade=smoothstep(0.0,.06,along)*pow(1.0-along,1.25);
    gl_FragColor=vec4(tint,soft*fade*strength);}`,
  transparent:true,depthWrite:false,depthTest:true,side:THREE.DoubleSide,toneMapped:false
 });
 private dotMaterial=new THREE.MeshBasicMaterial({color:0xc2fff1,transparent:true,opacity:0,depthWrite:false,toneMapped:false});
 private dotGeometry=new THREE.SphereGeometry(.065,10,8);
 private beams=[new THREE.Mesh(this.geometry,this.material),new THREE.Mesh(this.geometry,this.material)];
 private dots=[new THREE.Mesh(this.dotGeometry,this.dotMaterial),new THREE.Mesh(this.dotGeometry,this.dotMaterial)];
 constructor(){this.beams.forEach((b,i)=>{b.name='laser-'+i;this.root.add(b);});this.dots.forEach((d,i)=>{d.name='contact-'+i;this.root.add(d);});this.root.visible=false;}
 pulse(){this.age=0;}
 reset(){this.age=1;this.opacity=0;this.material.uniforms.strength.value=0;this.root.visible=false;}
 update(pose:Point&{angle:number;recoil?:number},obstacles:Obstacle[],visible:boolean,powered:boolean,dt=0,reducedMotion=false,aiming=true){
  if(!visible){this.reset();return;}
  this.age=Math.min(1,this.age+dt);
  this.opacity=Math.max(0,Math.min(1,this.opacity+dt*(aiming?1/.1:-1/.35)));
  const pulse=Math.max(0,1-this.age/.12);
  this.material.uniforms.strength.value=this.opacity*(.5+.06*pulse);
  this.material.uniforms.tint.value.setHex(powered?0xffd38e:0x92e9db);
  this.dotMaterial.color.setHex(powered?0xffe2a5:0xc2fff1);this.dotMaterial.opacity=this.opacity*.55;
  this.root.visible=this.opacity>.001;
  const tips=muzzles({...pose,recoil:pose.recoil??0} as Tank,powered);
  this.root.position.set(pose.x,0,pose.z);
  for(let i=0;i<2;i++){
   const tip=tips[i],beam=this.beams[i],dot=this.dots[i];beam.visible=dot.visible=false;if(!tip)continue;
   const sx=Math.sin(pose.angle),sz=Math.cos(pose.angle);
   const forward=(tip.x-pose.x)*sx+(tip.z-pose.z)*sz;
   const base={x:tip.x-sx*forward,z:tip.z-sz*forward};
   if(sectorReach(base,pose.angle,obstacles,forward+.02)<forward)continue;
   const length=sectorReach(tip,pose.angle,obstacles,3.8);
   beam.visible=length>.02;beam.position.set(tip.x-pose.x,tip.y,tip.z-pose.z);beam.rotation.y=pose.angle;beam.scale.set(1,1,length);
   dot.visible=beam.visible&&length<3.79;dot.position.set(tip.x-pose.x+sx*length,tip.y,tip.z-pose.z+sz*length);
  }
 }
}
