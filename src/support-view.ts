import * as THREE from 'three';
import type { Simulation } from './simulation';
const cube=new THREE.BoxGeometry(1,1,1), sphere=new THREE.SphereGeometry(1,12,6,0,Math.PI*2,0,Math.PI/2),ring=new THREE.RingGeometry(.94,1,40),disc=new THREE.CircleGeometry(1,40);
const paint=new THREE.MeshStandardMaterial({color:0x526d70,roughness:.86}),wood=new THREE.MeshStandardMaterial({color:0x927349,roughness:.92}),metal=new THREE.MeshStandardMaterial({color:0x283c47,roughness:.8}),cloth=new THREE.MeshStandardMaterial({color:0xd7ddc1,side:THREE.DoubleSide,roughness:1}),green=new THREE.MeshBasicMaterial({color:0x90e5b8,toneMapped:false}),white=new THREE.MeshBasicMaterial({color:0xe7f7e7}),shade=new THREE.MeshBasicMaterial({color:0x59bb93,transparent:true,opacity:.12,depthWrite:false,side:THREE.DoubleSide});
function box(g:THREE.Group,w:number,h:number,d:number,x:number,y:number,z:number,m:THREE.Material){const q=new THREE.Mesh(cube,m);q.scale.set(w,h,d);q.position.set(x,y,z);q.castShadow=true;g.add(q);return q;}
function ground(g:THREE.Group,r:number){const fill=new THREE.Mesh(disc,shade),edge=new THREE.Mesh(ring,green);for(const q of [fill,edge]){q.rotation.x=-Math.PI/2;q.scale.setScalar(r);g.add(q);}return g;}
function mark(g:THREE.Group){box(g,.9,.025,.23,0,.025,0,green);box(g,.23,.025,.9,0,.03,0,green);}
function makeDelivery(){
 const root=new THREE.Group(),plane=new THREE.Group(),crate=new THREE.Group(),parachute=new THREE.Group(),target=ground(new THREE.Group(),1.4);target.position.y=.09;mark(target);root.add(plane,crate,target);
 box(plane,.85,.7,4.2,0,0,0,paint);box(plane,6,.16,1.05,0,0,.3,paint);box(plane,2.8,.12,.65,0,.25,-1.65,paint);box(plane,.12,.95,.7,0,.6,-1.65,paint);box(plane,.65,.26,.65,0,.42,1.15,metal);
 for(const x of [-1.7,1.7]){box(plane,.48,.48,1.4,x,-.15,.6,metal);box(plane,.95,.065,.09,x,-.15,1.34,white);}box(plane,.95,.025,.15,0,.38,-.1,white);plane.rotation.y=Math.PI/2;
 box(crate,1.2,1.05,1.2,0,0,0,wood);for(const x of [-.45,.45])box(crate,.1,1.08,1.23,x,0,0,metal);box(crate,.68,.025,.2,0,.54,0,white);box(crate,.2,.025,.68,0,.55,0,white);
 const canopy=new THREE.Mesh(sphere,cloth);canopy.scale.set(1.9,.8,1.9);canopy.position.y=2.2;parachute.add(canopy);
 for(const x of [-.7,.7])for(const z of [-.7,.7]){const cord=box(parachute,.025,2,.025,x,1.2,z,cloth);cord.rotation.z=-x*.2;cord.rotation.x=z*.2;}crate.add(parachute);
 return {root,plane,crate,target};
}
/** Persistent geometry and absolute game time make reconnects show only the current stage. */
export class SupportView {
 readonly root=new THREE.Group();private flights=new Map<number,ReturnType<typeof makeDelivery>>();private time=0;private zone=ground(new THREE.Group(),2.6);
 constructor(){mark(this.zone);this.zone.position.y=.13;this.root.add(this.zone);this.zone.visible=false;}
 reset(){this.time=0;for(const v of this.flights.values())this.root.remove(v.root);this.flights.clear();this.zone.visible=false;}
 update(sim:Simulation,reduced:boolean,dt=0){
  this.time=Math.max(sim.elapsed,Math.min(sim.elapsed+.05,this.time+dt));
  const active=sim.phase==='playing'||sim.phase==='paused';this.root.visible=active;
  const ids=new Set(sim.deliveries.map(d=>d.id));for(const [id,v] of this.flights)if(!ids.has(id)){this.root.remove(v.root);this.flights.delete(id);}
  for(const d of sim.deliveries){let v=this.flights.get(d.id);if(!v){v=makeDelivery();this.flights.set(d.id,v);this.root.add(v.root);}v.root.position.set(d.x,0,d.z);
   const age=this.time-d.startAt;v.plane.visible=!reduced&&age>=0&&age<2;v.crate.visible=!reduced&&age>=1&&age<3;
   v.plane.position.set(-27+age*27,8,0);v.crate.position.set(0,.6+Math.max(0,3-age)*3,0);v.target.visible=true;
  }
  this.zone.visible=!!sim.repairZone;if(sim.repairZone)this.zone.position.set(sim.repairZone.x,.13,sim.repairZone.z);
 }
}
