import * as THREE from 'three';
import { damageStage } from './support';
import type { Tank } from './simulation';
const cube=new THREE.BoxGeometry(1,1,1),flame=new THREE.ConeGeometry(1,1,5),cloud=new THREE.IcosahedronGeometry(1,0);
const hot=new THREE.Color(0xec5933);
const scar=new THREE.MeshStandardMaterial({color:0x263737,roughness:1}),fire=new THREE.MeshBasicMaterial({color:0xffaa48,toneMapped:false}),core=new THREE.MeshBasicMaterial({color:0xffe1a4,toneMapped:false}),smoke=new THREE.MeshBasicMaterial({color:0x4b5558,transparent:true,opacity:.45,depthWrite:false});
/** Clone only mutable paint once per tank. Accent/name materials keep their identity. */
export class TankCondition {
 private paints:{material:THREE.MeshStandardMaterial;base:THREE.Color;emissive:THREE.Color;intensity:number;module:boolean}[]=[];
 private scars=new THREE.Group();private fire=new THREE.Group();private smoke=new THREE.Group();
 constructor(root:THREE.Group,body:THREE.Group,turret:THREE.Group){
  const clones=new Map<THREE.Material,THREE.MeshStandardMaterial>(),moduleClones=new Map<THREE.Material,THREE.MeshStandardMaterial>();
  for(const g of [body,turret])g.traverse(o=>{if(!(o instanceof THREE.Mesh)||!(o.material instanceof THREE.MeshStandardMaterial))return;
   // Glass, identifying accents and module inserts stay legible over hot metal.
   if(o.userData.identity)return;
   if(o.material.emissiveIntensity>.1&&o.material.emissive.getHex()!==0)return;
   const cache=o.userData.moduleId?moduleClones:clones;let copy=cache.get(o.material);if(!copy){copy=o.material.clone();cache.set(o.material,copy);this.paints.push({material:copy,base:copy.color.clone(),emissive:copy.emissive.clone(),intensity:copy.emissiveIntensity,module:!!o.userData.moduleId});}o.material=copy;
  });root.userData.ownedMaterials=[...(root.userData.ownedMaterials??[]),...clones.values(),...moduleClones.values()];
  const add=(g:THREE.Group,geom:THREE.BufferGeometry,m:THREE.Material,x:number,y:number,z:number,sx:number,sy:number,sz:number)=>{const q=new THREE.Mesh(geom,m);q.position.set(x,y,z);q.scale.set(sx,sy,sz);g.add(q);return q;};
  for(const x of [-.63,.63]){add(this.scars,cube,scar,x,.6,-.28,.018,.24,.68);add(this.scars,cube,scar,x,.9,-.5,.14,.018,.55);}
  for(const x of [-.32,.3]){add(this.fire,flame,fire,x,1.18,-.83,.2,.8,.2);add(this.fire,flame,core,x,1.1,-.78,.11,.52,.11);}
  add(this.smoke,cloud,smoke,-.18,1.6,-.95,.3,.34,.3);add(this.smoke,cloud,smoke,.12,1.98,-1.05,.36,.27,.32);
  this.scars.visible=this.fire.visible=this.smoke.visible=false;body.add(this.scars,this.fire,this.smoke);
 }
 update(t:Tank,time:number,reduced:boolean,flash=false){
  const stage=damageStage(t.hp,t.maxHp);this.scars.visible=stage>=1;this.smoke.visible=stage>=2;this.fire.visible=stage>=3;
  const heat=!!t.adrenaline&&t.hp>0;
  for(const p of this.paints){p.material.color.copy(p.base);p.material.emissive.copy(p.emissive);p.material.emissiveIntensity=p.intensity;
   if(heat){p.material.color.lerp(hot,.66);p.material.emissive.setHex(0x9d2307);p.material.emissiveIntensity=.4;}
   if(flash&&p.module){p.material.emissive.copy(p.base);p.material.emissiveIntensity=.8;}
  }
  this.fire.scale.y=reduced?1:1+Math.sin(time*13+t.id)*.1;this.smoke.position.y=reduced?0:Math.sin(time*2+t.id)*.04;
 }
}
