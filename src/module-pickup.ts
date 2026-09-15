import * as THREE from 'three';
import { MODULES, type ModuleId } from './modules';

const cube=new THREE.BoxGeometry(1,1,1),tube=new THREE.CylinderGeometry(1,1,1,12),cone=new THREE.ConeGeometry(1,1,12);
const magnetGeometry=new THREE.TorusGeometry(.48,.19,6,16,Math.PI);
const steel=new THREE.MeshStandardMaterial({color:0xa5b6b8,roughness:.8,metalness:.25});
const dark=new THREE.MeshStandardMaterial({color:0x263f4d,roughness:.85});
const cream=new THREE.MeshStandardMaterial({color:0xffdf99,roughness:.82});
const paints=Object.fromEntries(Object.entries(MODULES).map(([id,m])=>[id,new THREE.MeshStandardMaterial({color:m.color,roughness:.82,metalness:.1})])) as Record<ModuleId,THREE.MeshStandardMaterial>;

/** Reusable low-poly hardware, matching the silhouettes of the installed parts. */
export function makeModulePickup(id:ModuleId):THREE.Group {
  const g=new THREE.Group();g.name=`hardware-${id}`;const paint=paints[id];
  const part=(geometry:THREE.BufferGeometry,w:number,h:number,d:number,x:number,y:number,z:number,material:THREE.Material=paint)=>{
    const m=new THREE.Mesh(geometry,material);m.scale.set(w,h,d);m.position.set(x,y,z);m.castShadow=m.receiveShadow=true;g.add(m);return m;
  };
  const box=(w:number,h:number,d:number,x:number,y:number,z:number,m:THREE.Material=paint)=>part(cube,w,h,d,x,y,z,m);
  const pipe=(r:number,length:number,x:number,y:number,z:number,m:THREE.Material=paint)=>{const p=part(tube,r,length,r,x,y,z,m);p.rotation.x=Math.PI/2;return p;};
  // Low mechanical mounting foot, not a storage case; also makes narrow parts readable in rotation.
  part(tube,.86,.12,.86,0,-.45,0,dark);
  for(const x of [-.57,.57])box(.12,.08,.12,x,-.35,0,steel);
  if(id==='armor')for(let i=-1;i<=1;i++){
    const plate=box(.45,.84,1.05,i*.43,.05,0);plate.rotation.z=-i*.18;
    for(const z of [-.35,.35])box(.11,.08,.12,i*.43,.5,z,steel);
  }
  if(id==='cannon'){
    box(.7,.5,.65,0,0,-.48,dark);pipe(.29,1.45,0,.19,.2,steel);pipe(.36,.28,0,.19,.91);pipe(.21,.015,0,.19,1.058,dark);
    for(const x of [-.52,.52])box(.18,.37,.72,x,-.22,-.15);
  }
  if(id==='turbo')for(const x of [-.44,.44]){
    pipe(.32,1.05,x,.04,0);pipe(.36,.12,x,.04,.6,steel);pipe(.26,.018,x,.04,.67,dark);
    for(let i=0;i<3;i++){const blade=box(.055,.44,.04,x,.04,.69,cream);blade.rotation.z=i*Math.PI/3;}
  }
  if(id==='ram'){
    for(const x of [-.55,.55])box(.15,.26,.86,x,-.15,-.12,steel);
    const blade=box(1.65,.82,.18,0,.12,.36);blade.rotation.x=-.35;
    for(const x of [-.6,0,.6])box(.18,.2,.28,x,-.19,.59,steel);
  }
  if(id==='loader'){
    box(.83,.68,.7,-.25,0,0,dark);box(.93,.12,.78,-.25,.4,0);
    for(let i=0;i<5;i++){const x=-.55+i*.28,y=.1+(i>2?(i-2)*.12:0);pipe(.105,.65,x,y,.47,cream);box(.13,.16,.14,x,y,-.03,steel);}
  }
  if(id==='splash'){
    part(tube,.34,.8,.34,0,.08,0);part(cone,.34,.32,.34,0,.64,0,cream);
    for(let i=0;i<6;i++){const a=i*Math.PI/3;box(.18,.23,.18,Math.sin(a)*.65,.1,Math.cos(a)*.65,steel);}
    part(tube,.39,.12,.39,0,-.26,0,dark);
  }
  if(id==='pierce'){
    part(tube,.22,.8,.22,0,.15,0,steel);part(cone,.22,.6,.22,0,.85,0,cream);
    for(const y of [-.15,.08,.3])part(tube,.3,.1,.3,0,y,0);
    for(const x of [-.48,.48]){const fin=box(.16,.55,.7,x,-.05,0,dark);fin.rotation.z=-Math.sign(x)*.3;}
  }
  if(id==='ballistics'){
    box(1.25,.33,.72,0,-.1,0);box(.5,.45,.65,0,.2,0,dark);pipe(.22,.86,0,.35,.1,steel);pipe(.15,.025,0,.35,.545,cream);
    box(.06,.7,.06,-.52,.39,-.12,steel);box(.36,.06,.06,-.52,.71,-.12,cream);
  }
  if(id==='repair'){
    part(tube,.43,.3,.43,0,-.22,0);const arm=box(.2,.75,.22,-.25,.25,0,steel);arm.rotation.z=-.6;
    const elbow=box(.73,.19,.22,.24,.61,0);elbow.rotation.z=-.22;
    for(const z of [-.16,.16]){const claw=box(.34,.12,.09,.66,.37,z,steel);claw.rotation.z=.55;}
    part(tube,.16,.29,.16,-.42,-.03,0,dark).rotation.x=Math.PI/2;
  }
  if(id==='capacitor')for(const x of [-.4,0,.4]){
    part(tube,.18,.81,.18,x,.06,0);part(tube,.09,.13,.09,x,.53,0,cream);box(.23,.12,.43,x,-.27,0,dark);
  }
  if(id==='magnet'){
    const u=new THREE.Mesh(magnetGeometry,paint);u.rotation.z=Math.PI;u.position.y=.28;u.castShadow=true;g.add(u);
    for(const x of [-.48,.48]){box(.38,.48,.38,x,.46,0);box(.4,.18,.4,x,.78,0,cream);}
  }
  if(id==='tracks')for(const x of [-.45,.45]){
    box(.44,.48,1.42,x,-.02,0,dark);
    for(const z of [-.57,-.19,.19,.57])box(.51,.14,.19,x,.27,z);
    for(const z of [-.44,0,.44]){const wheel=part(tube,.19,.47,.19,x,-.02,z,steel);wheel.rotation.z=Math.PI/2;}
  }
  g.userData.module=id;return g;
}

const lockGeometry=new THREE.TorusGeometry(.16,.045,5,10,Math.PI);
export function makeModuleLock(){
  const g=new THREE.Group();g.name='pickup-lock';const body=new THREE.Mesh(cube,dark);body.scale.set(.38,.3,.18);g.add(body);
  const loop=new THREE.Mesh(lockGeometry,steel);loop.position.y=.16;g.add(loop);g.position.set(.75,.5,0);g.visible=false;return g;
}
