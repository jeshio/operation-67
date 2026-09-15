import * as THREE from 'three';
import { MODULES, type ModuleId } from './modules';
const cube=new THREE.BoxGeometry(1,1,1), tube=new THREE.CylinderGeometry(1,1,1,8), ring=new THREE.TorusGeometry(.23,.055,5,12);
const steel=new THREE.MeshStandardMaterial({color:0x657b84,roughness:.84}),dark=new THREE.MeshStandardMaterial({color:0x30454d,roughness:.88}),accent=new THREE.MeshStandardMaterial({color:0xc4ab72,roughness:.84}),green=new THREE.MeshStandardMaterial({color:0x7aa795,roughness:.84});
const inserts=Object.fromEntries(Object.entries(MODULES).map(([id,m])=>[id,new THREE.MeshStandardMaterial({color:m.color,emissive:m.color,emissiveIntensity:.16,roughness:.8})])) as Record<ModuleId,THREE.MeshStandardMaterial>;
// These attachments never extend the physical muzzle. All barrel pieces move with recoil.
export function addModuleParts(ids:ModuleId[],body:THREE.Group,turret:THREE.Group,gun:THREE.Group,power:THREE.Group){
  const box=(parent:THREE.Group,w:number,h:number,d:number,x:number,y:number,z:number,m=steel)=>{const q=new THREE.Mesh(cube,m);q.scale.set(w,h,d);q.position.set(x,y,z);q.castShadow=true;parent.add(q);return q;};
  const pipe=(parent:THREE.Group,r:number,h:number,x:number,y:number,z:number)=>{const q=new THREE.Mesh(tube,steel);q.scale.set(r,h,r);q.position.set(x,y,z);q.rotation.x=Math.PI/2;q.castShadow=true;parent.add(q);};
  for(const id of ids){
    const beforeGun=gun.children.length,beforePower=power.children.length;
    const b=new THREE.Group(),t=new THREE.Group();b.name=t.name=`module-${id}`;body.add(b);turret.add(t);
    if(id==='armor')for(const x of [-1.04,1.04])for(const z of [-.63,0,.63])box(b,.14,.42,.52,x,.75,z);
    if(id==='cannon'){pipe(gun,.185,.9,0,.15,.98);for(const x of [-.7,.7])box(power,.55,.12,.85,x,.43,.85);}
    if(id==='turbo')for(const x of [-.4,.4]){pipe(b,.22,.6,x,.78,-1.2);box(b,.19,.18,.035,x,.78,-1.51,dark);}
    if(id==='ram'){const blade=box(b,1.8,.48,.19,0,.45,1.15);blade.rotation.x=-.3;for(const x of [-.7,0,.7])box(b,.13,.23,.24,x,.3,1.3,accent);}
    if(id==='loader'){box(t,.44,.45,.74,-.77,.36,-.18,dark);for(let i=0;i<3;i++)box(t,.12,.13,.42,-.94+i*.14,.62,-.16,accent);}
    if(id==='splash'){box(gun,.49,.34,.3,0,.15,1.5);for(const x of [-.7,.7])box(power,.64,.53,.2,x,.15,1.49);}
    if(id==='pierce')for(const z of [.67,.94,1.21]){pipe(gun,.225,.09,0,.15,z);for(const x of [-.7,.7])box(power,.57,.5,.07,x,.15,z,accent);}
    if(id==='ballistics'){box(t,.28,.25,.54,.28,.55,.18,dark);box(t,.19,.12,.025,.28,.55,.465,green);}
    if(id==='repair'){box(b,.36,.3,.36,-.45,1.02,-.72,green);const arm=box(b,.1,.65,.1,-.5,1.44,-.73);arm.rotation.z=-.4;box(b,.4,.1,.1,-.37,1.76,-.73);}
    if(id==='capacitor')for(const x of [.15,.43]){box(b,.22,.43,.5,x,1.07,-.64,accent);box(b,.09,.09,.12,x,1.32,-.64,dark);}
    if(id==='magnet'){const q=new THREE.Mesh(ring,accent);q.position.set(.83,1.11,-.35);b.add(q);box(b,.15,.37,.4,.83,.87,-.35,dark);}
    if(id==='tracks')for(const x of [-.79,.79])for(const z of [-.95,-.56,-.17,.22,.61,1])box(b,.55,.13,.18,x,.1,z,accent);
    b.scale.setScalar(1.35);t.scale.setScalar(1.35);
    for(const g of [b,t]){g.traverse(q=>q.userData.moduleId=id);if(g.children.length){const first=g.children[0];box(g,.18,.075,.24,first.position.x,first.position.y+.2,first.position.z,inserts[id]).userData.moduleId=id;}}
    for(const q of [...gun.children.slice(beforeGun),...power.children.slice(beforePower)]){q.scale.x*=1.35;if(Math.abs(q.rotation.x)>1)q.scale.z*=1.35;else q.scale.y*=1.35;q.userData.moduleId=id;}
  }
}
