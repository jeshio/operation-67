import { makeModulePickup, makeModuleLock } from './module-pickup';
import * as THREE from 'three';
import type { Pickup } from './simulation';

const cube = new THREE.BoxGeometry(1, 1, 1), ground = new THREE.PlaneGeometry(2.3, 2.3);
function shape(points: number[][]) {
  const s = new THREE.Shape(); points.forEach(([x, y], i) => i ? s.lineTo(x, y) : s.moveTo(x, y)); s.closePath();
  return new THREE.ShapeGeometry(s);
}
const shield = shape([[-.42,.42],[.42,.42],[.37,-.14],[0,-.48],[-.37,-.14]]);
const plus = shape([[-.09,.26],[.09,.26],[.09,.07],[.27,.07],[.27,-.11],[.09,-.11],[.09,-.3],[-.09,-.3],[-.09,-.11],[-.27,-.11],[-.27,.07],[-.09,.07]]);
const bolt = shape([[.06,.46],[-.33,-.06],[-.05,-.06],[-.15,-.46],[.34,.11],[.07,.11],[.21,.46]]);
const bullet = shape([[-.1,-.36],[.1,-.36],[.1,.22],[0,.39],[-.1,.22]]);
const colors = { heal: 0x5d9c7b, charge: 0xc5a153, rapid: 0x8e7caa, module:0x899b9c };
const textColors = { heal: '#bfd9c9', charge: '#e7d4a4', rapid: '#d1c6e0', module:'#f1dfb7' };
const paint = Object.fromEntries(Object.entries(colors).map(([kind, color]) => [kind, new THREE.MeshStandardMaterial({color, roughness:.84, metalness:0})])) as Record<Pickup['kind'], THREE.MeshStandardMaterial>;
const metal = new THREE.MeshStandardMaterial({color:0x304551, roughness:.84});
const cream = new THREE.MeshStandardMaterial({color:0xe5e8d9, roughness:.84});

const leaderGeometry=new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(),new THREE.Vector3(0,1,0)]),leaderMaterial=new THREE.LineBasicMaterial({color:0xaac1c4,transparent:true,opacity:.6,depthTest:false,depthWrite:false});
export function makePickup(p: Pickup, label: (text:string,color:string,bg:string,width:number,height:number)=>THREE.Sprite) {
  const root = new THREE.Group(), body = new THREE.Group(); body.name = 'pickup-body'; root.add(body);
  const box = (w:number,h:number,d:number,x:number,y:number,z:number,m:THREE.Material=paint[p.kind]) => {
    const mesh = new THREE.Mesh(cube,m); mesh.scale.set(w,h,d); mesh.position.set(x,y,z); mesh.receiveShadow=true; body.add(mesh);
  };
  if(p.kind==='module'&&p.module){body.add(makeModulePickup(p.module));root.add(makeModuleLock());}
  else {
  // Square footprint keeps the pickup legible even when a narrow side turns to the camera.
  box(1.4,.9,1.4,0,0,0);
  box(1.5,.13,1.5,0,.515,0); box(1.5,.1,1.5,0,-.5,0,metal);
  for(const x of [-.66,.66])for(const z of [-.66,.66])box(.15,.9,.15,x,0,z,metal);
  // Embossed marks sit clear of the case and each other, with no blended body surfaces.
  const emblem = () => {
    const g=new THREE.Group();
    if(p.kind==='heal'){
      g.add(new THREE.Mesh(shield,metal));const cross=new THREE.Mesh(plus,cream);cross.position.z=.018;g.add(cross);
    }else if(p.kind==='charge')g.add(new THREE.Mesh(bolt,cream));
    else for(const x of [-.19,.19]){const b=new THREE.Mesh(bullet,cream);b.position.x=x;g.add(b);}
    return g;
  };
  const top=emblem();top.rotation.x=-Math.PI/2;top.position.y=.595;body.add(top);
  for(let side=0;side<4;side++){
    const e=emblem(),angle=side*Math.PI/2;e.rotation.y=angle;e.scale.setScalar(.85);e.position.set(Math.sin(angle)*.717,0,Math.cos(angle)*.717);body.add(e);
  }
  }
  const shadowMaterial = new THREE.ShaderMaterial({transparent:true,depthWrite:false,uniforms:{opacity:{value:.22}},
    vertexShader:'varying vec2 v;void main(){v=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader:'varying vec2 v;uniform float opacity;void main(){float d=length(v-.5)*2.;gl_FragColor=vec4(.06,.12,.15,pow(max(0.,1.-d),1.4)*opacity);}'});
  const shadow=new THREE.Mesh(ground,shadowMaterial);shadow.name='pickup-shadow';shadow.rotation.x=-Math.PI/2;shadow.position.y=.035;root.add(shadow);
  if(p.kind!=='module'){
    const text=p.kind==='heal'?'+20 брони':p.kind==='charge'?'+15 заряда':'Огонь ×2 · 6 с';
    const tag=label(text,textColors[p.kind],'#263e4be6',3.6,.68);tag.name='pickup-label';tag.material.depthWrite=false;root.add(tag);
    const leader=new THREE.Line(leaderGeometry,leaderMaterial);leader.name='pickup-leader';leader.renderOrder=4;root.add(leader);
  }
  root.userData.ownedMaterials=[shadowMaterial];root.userData.pickupKey=`${p.kind}:${p.module}`;return root;
}
export function updatePickup(root:THREE.Group,p:Pickup,time:number,unitsPerPixel:number,mobile:boolean,reducedMotion:boolean,gameTime=time){
  const tagReset=root.getObjectByName('pickup-label');if(tagReset)tagReset.position.x=tagReset.position.z=0;
  const size=mobile?Math.max(1,(p.kind==='module'?36:28)*unitsPerPixel/1.4):1;
  const body=root.getObjectByName('pickup-body')!,tag=root.getObjectByName('pickup-label') as THREE.Sprite,shadow=root.getObjectByName('pickup-shadow') as THREE.Mesh<THREE.PlaneGeometry,THREE.ShaderMaterial>;
  const end=Math.max(0,Math.min(1,1-p.life/.5)),sink=reducedMotion?0:end*end*(3-2*end)*1.65*size;
  // Extrapolate only the fraction between snapshots; the server owns collection and lifetime.
  const remaining=p.flight?p.flight.remaining+p.flight.delay:0;
  if(root.userData.flightSample!==remaining){root.userData.flightSample=remaining;root.userData.flightClock=time;}
  const extra=Math.min(.05,Math.max(0,time-(root.userData.flightClock??time)));
  const progress=p.flight?Math.max(0,Math.min(1,(.65-remaining+extra)/.65)):1;
  root.visible=!p.flight||p.flight.delay<=extra||reducedMotion;
  const lift=reducedMotion?0:p.flight?4*2*progress*(1-progress)+(1-progress)*.8:p.landedAt!==undefined?Math.max(0,Math.sin(Math.min(1,(gameTime-p.landedAt)/.22)*Math.PI))*.22:0;
  root.position.set(p.flight&&!reducedMotion?p.flight.from.x+(p.x-p.flight.from.x)*progress:p.x,lift,p.flight&&!reducedMotion?p.flight.from.z+(p.z-p.flight.from.z)*progress:p.z);body.scale.setScalar(size);body.position.y=.76*size+(reducedMotion?0:Math.sin(time*2+p.id)*.07)-sink;
  body.rotation.y=reducedMotion?0:time*Math.PI/4+p.id;
  const fade=Math.max(0,Math.min(1,p.life/3));
  if(tag){
  const labelHeight=Math.max(.68*size,(mobile?24:22)*unitsPerPixel);
  tag.position.y=.76*size+.75*size+labelHeight*.6;tag.scale.set(labelHeight*4,labelHeight,1);
  tag.material.opacity=fade;
  }
  shadow.position.y=.035-lift;shadow.scale.setScalar(size);shadow.material.uniforms.opacity.value=.22*fade;
}
