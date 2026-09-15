import { fitHud } from './view';
import { HULL, PROJECTILE, enemyModelScale } from './tank-shape';
import { ShotTrails, type TrailShot } from './shot-trails';
import { SupportView } from './support-view';
import { TankCondition } from './tank-condition';
import { MODULES } from './modules';
import { placeLootLabels, type LootLabel } from './loot-labels';
import { addModuleParts } from './module-view';
import { hitFeedback } from './feedback';
import { makePickup, updatePickup } from './pickup-view';
import { GUN } from './weapons';
import { AimSector } from './aim-sector';
import * as THREE from 'three';
import { ArenaCamera, projectPoint, groundPoint, stickDirection } from './camera';
import { calculateLayout, type ArenaLayout } from './view';
import { SKINS } from './coop';
import { MotionFrames } from './motion';
import { CONFIG as C, BALANCE as B, ENEMY_META, type EnemyKind } from './config';
import type { Simulation, Tank, Enemy, GameEvent, Point } from './simulation';

const mat = (color: number, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.84, ...extra });
const skinPaint=SKINS.map(s=>mat(s.color));
const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
const cylinderGeometry = new THREE.CylinderGeometry(1, 1, 1, 10);
const sphereGeometry = new THREE.IcosahedronGeometry(1, 0);
const ringGeometry = new THREE.RingGeometry(0.9, 1, 40);
const flagGeometry = new THREE.PlaneGeometry(1.9, 1.2, 10, 2);
const discGeometry = new THREE.CircleGeometry(1, 40);
const shieldGeometry = new THREE.SphereGeometry(1.55, 16, 10);
const shieldMaterial = new THREE.MeshBasicMaterial({ color: 0x79ffe9, wireframe: true, transparent: true, opacity: 0.19, depthWrite: false });
const materials = {
  snow: mat(0xd9e9ec), edge: mat(0x71969e), concrete: mat(0x617783), metal: mat(0x273d49), black: mat(0x142730),
  wood: mat(0x96734d), stripe: mat(0xf4b65e), white: mat(0xe9f5ed), blue: mat(C.player.color), yellow: mat(C.lev.color), red: mat(0xc85650),
  glass: mat(0x83f3ed, { emissive: 0x65ded9, emissiveIntensity: 0.5 }),
};
const enemyPaint = Object.fromEntries(Object.entries(ENEMY_META).map(([k, v]) => [k, mat(v.color)])) as Record<string, THREE.Material>;
function box(w: number, h: number, d: number, material: THREE.Material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(boxGeometry, material); m.scale.set(w, h, d); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; return m;
}
function cylinder(r: number, h: number, material: THREE.Material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(cylinderGeometry, material); m.scale.set(r, h, r); m.position.set(x, y, z); m.castShadow = true; return m;
}
function label(text: string, color = '#f0f8ef', bg = '#152735', width = 3.2, height = 0.75) {
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = bg; ctx.beginPath(); ctx.roundRect(3, 3, 506, 122, 20); ctx.fill();
  ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.globalAlpha = 0.5; ctx.stroke(); ctx.globalAlpha = 1;
  ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const lines=text.split('\n');lines.forEach((line,i)=>{const size=lines.length>1?43:61;ctx.font=`800 ${size}px Arial`;const measured=ctx.measureText(line).width;if(measured>470)ctx.font=`800 ${Math.floor(size*470/measured)}px Arial`;ctx.fillText(line,256,lines.length>1?38+i*53:69);});
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true })); sprite.scale.set(width, height, 1); sprite.renderOrder = 5; return sprite;
}
function decal(text: string, w: number, d: number, color = '#728e96') {
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 128;
  const ctx = canvas.getContext('2d')!; ctx.fillStyle = color; ctx.font = '900 95px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, 256, 67);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false })); mesh.rotation.x = -Math.PI / 2; mesh.position.y = 0.018; return mesh;
}
interface TankView { condition:TankCondition; root: THREE.Group; body: THREE.Group; turret: THREE.Group; gun: THREE.Group; powerGuns: THREE.Group; shield: THREE.Mesh; health: THREE.Mesh; warning: THREE.Mesh; label?: THREE.Sprite; appearance?:string; }
interface PickupNotice { sprite: THREE.Sprite; life: number; baseY: number; }
interface Particle { mesh: THREE.Mesh; vx: number; vy: number; vz: number; life: number; max: number; size: number; mode: 'spark' | 'smoke' | 'fire' | 'ring' | 'debris'; }

export class GameRenderer {
  renderer: THREE.WebGLRenderer; scene = new THREE.Scene(); camera: THREE.OrthographicCamera;
  private tanks = new Map<number, TankView>(); private bulletViews = new Map<number, THREE.Mesh>(); private portalViews = new Map<number, THREE.Group>();
  private supportView=new SupportView();private installFlash=new Map<number,number>();
  private aimSector = new AimSector(); private shotTrails=new ShotTrails(); aiming=false; aimAllowed=false;
  private preview?:TankView;private previewSkin=-1;private previewRect?:{left:number;top:number;width:number;height:number};
  private ownShotMaterial = new THREE.MeshBasicMaterial({ color: 0x89fff1, toneMapped: false });
  private obstacleViews = new Map<number, THREE.Group>(); private obstacleSignature = '';
  private particles: Particle[] = []; private particleMat = mat(0xffb349, { emissive: 0xff9529, emissiveIntensity: 0.4 });
  private shotMaterial = new THREE.MeshBasicMaterial({ color: 0xffe5a4 }); private enemyShotMaterial = new THREE.MeshBasicMaterial({ color: 0xff594e }); private powerShotMaterial = new THREE.MeshBasicMaterial({ color: 0x91fff5 });
  private trackMesh: THREE.InstancedMesh; private trackIndex = 0; private trackTimer = 0; private lastPlayer = { x: 0, z: 0 }; private lastLev = { x: 0, z: 0 };
  private scratch = new THREE.Object3D(); private snow: THREE.InstancedMesh; private flakes: THREE.Vector3[] = []; private auroras: THREE.Mesh[] = [];
  private doorLeft: THREE.Mesh; private doorRight: THREE.Mesh; private clock = 0;
  private particlePool: THREE.Mesh[] = [];
  private smokeMat = new THREE.MeshBasicMaterial({ color: 0x50616a, transparent: true, opacity: 0.36, depthWrite: false });
  private fireMat = new THREE.MeshBasicMaterial({ color: 0xffd66e, transparent: true, opacity: 0.85, depthWrite: false });
  private ringMat = new THREE.MeshBasicMaterial({ color: 0xffa951, transparent: true, opacity: 0.65, side: THREE.DoubleSide, depthWrite: false });
  private warningMat = new THREE.MeshBasicMaterial({ color: 0xff4947, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false });
  private zoneMat = new THREE.MeshBasicMaterial({ color: 0x55efd7, transparent: true, opacity: 0.2, side: THREE.DoubleSide, depthWrite: false });
  private zoneRingMat = new THREE.MeshBasicMaterial({ color: 0x9bffe7, side: THREE.DoubleSide, depthWrite: false });
  private hazardViews = new Map<number, THREE.Group>(); private pickupViews = new Map<number, THREE.Group>();
  private flag?: THREE.Mesh; private flagCloth = this.makeFlagMaterial(); private pickupNotices: PickupNotice[] = [];
  private zone?: THREE.Group; private zoneName = ''; private shake = 0;
  private delayedBlasts: { at: Point; delay: number }[] = [];
  private reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  private mobile = window.matchMedia('(pointer: coarse)').matches;
  private sunlight!: THREE.DirectionalLight;
  private cameraRig!: ArenaCamera;
  private motion = new MotionFrames();
  private insetProbe: HTMLDivElement;
  layout: ArenaLayout = calculateLayout(1,1,false);
  constructor(private host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, this.mobile ? 1.25 : 1.75)); this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.15;
    this.renderer.domElement.setAttribute('aria-label', 'Снежная танковая арена. Управление: два стика или WASD, мышь и пробел.');
    host.append(this.renderer.domElement);this.scene.add(this.supportView.root);
    this.insetProbe=document.createElement('div'); this.insetProbe.setAttribute('aria-hidden','true');
    this.insetProbe.style.cssText='position:absolute;visibility:hidden;pointer-events:none;padding:max(8px,env(safe-area-inset-top)) max(16px,env(safe-area-inset-right)) max(14px,env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left))';host.append(this.insetProbe);
    this.camera = new THREE.OrthographicCamera(-35, 35, 20, -20, 0.1, 180); this.camera.position.set(29, 43, 34); this.camera.lookAt(0, 0, 0); this.cameraRig = new ArenaCamera(this.camera);
    this.scene.add(new THREE.HemisphereLight(0xccefff, 0x678493, 2.4));
    const light = new THREE.DirectionalLight(0xffedd3, 3.1); light.position.set(-15, 28, 9); light.castShadow = true;
    this.sunlight = light; light.shadow.mapSize.set(this.mobile ? 1024 : 2048, this.mobile ? 1024 : 2048); light.shadow.camera.left = -30; light.shadow.camera.right = 30; light.shadow.camera.top = 25; light.shadow.camera.bottom = -25; light.shadow.normalBias = 0.035; light.shadow.bias = -0.0002; this.scene.add(light);
    this.scene.fog = new THREE.FogExp2(0x5a7e91, 0.004);
    this.buildWorld();
    this.scene.add(this.aimSector.root,this.shotTrails.root);
    const hangar = new THREE.Group(); hangar.position.set(0, 0, 13.6);
    hangar.add(box(6.8, 2.8, 1, materials.concrete, 0, 1.4, 0.7), box(0.45, 3.2, 3, materials.concrete, -3.3, 1.6), box(0.45, 3.2, 3, materials.concrete, 3.3, 1.6));
    hangar.add(box(7.3, 0.4, 3.5, materials.snow, 0, 3.3));
    this.doorLeft = box(2.9, 2.8, 0.2, materials.metal, -1.48, 1.4, -1.5); this.doorRight = box(2.9, 2.8, 0.2, materials.metal, 1.48, 1.4, -1.5); hangar.add(this.doorLeft, this.doorRight);
    const sign = label('АНГАР 67', '#ffca77', '#1a3441', 4.2, 0.8); sign.position.set(0, 4.05, 0); hangar.add(sign); this.scene.add(hangar);
    this.trackMesh = new THREE.InstancedMesh(boxGeometry, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45 }), C.limits.tracks);
    this.trackMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.trackMesh.frustumCulled = false; this.clearTracks(); this.scene.add(this.trackMesh);
    this.snow = new THREE.InstancedMesh(sphereGeometry, new THREE.MeshBasicMaterial({ color: 0xe1f7ff, transparent: true, opacity: 0.55 }), 120); this.snow.frustumCulled = false;
    for (let i = 0; i < 120; i++) this.flakes.push(new THREE.Vector3(Math.random() * 54 - 27, Math.random() * 18 + 1, Math.random() * 44 - 22)); this.scene.add(this.snow);
    this.resize();
  }
  clearTracks() { for (let i = 0; i < C.limits.tracks; i++) { this.scratch.position.set(0, -10, 0); this.scratch.scale.set(0, 0, 0); this.scratch.updateMatrix(); this.trackMesh.setMatrixAt(i, this.scratch.matrix); } this.trackMesh.instanceMatrix.needsUpdate = true; this.trackIndex = 0; }
  private buildWorld() {
    this.scene.add(box(39.4, 1, 31.4, materials.edge, 0, -0.7), box(39.1, 0.35, 31.1, materials.snow, 0, -0.2));
    const frost = new THREE.Mesh(new THREE.PlaneGeometry(70, 60), mat(0x628a98)); frost.rotation.x = -Math.PI / 2; frost.position.y = -1.24; frost.receiveShadow = true; this.scene.add(frost);
    const sector = decal('СЕКТОР 67', 8, 1.5); sector.position.set(-0.5, 0.015, 2.9); this.scene.add(sector);
    const arrow = decal('▲  ▲  ▲', 4, 0.6, '#ab9270'); arrow.position.set(0, 0.022, 9.5); this.scene.add(arrow);
    for (let x = -18; x <= 18; x += 3) for (const z of [-15.1, 15.1]) {
      if (z > 0 && Math.abs(x) < 5) continue;
      this.scene.add(box(0.15, 0.8, 0.15, materials.metal, x, 0.4, z), box(2.8, 0.08, 0.08, materials.metal, x + 1.4, 0.65, z));
    }
    for (let z = -13.5; z < 15; z += 3) for (const x of [-19.1, 19.1]) this.scene.add(box(0.15, 0.8, 0.15, materials.metal, x, 0.4, z), box(0.08, 0.08, 2.8, materials.metal, x, 0.65, z + 1.4));
    for (const [x, z, scale] of [[-23,-13,1.4],[-22,-8,1],[-24,1,1.2],[-22,9,1.1],[-18,-20,1.4],[-12,-21,1],[-4,-22,1.3],[4,-21,1.2],[15,-20,1.5],[23,-12,1.25],[24,-3,1],[23,6,1.3],[-13,19,1],[13,19,1.1]]) this.tree(x, z, scale);
    for (let i = 0; i < 11; i++) {
      const mountain = new THREE.Mesh(new THREE.ConeGeometry(6 + i % 3, 7 + i % 4 * 2, 5), mat(i % 2 ? 0x507380 : 0x7898a2));
      mountain.position.set(-44 + i * 8, 0.5, -37 - i % 3 * 2); mountain.rotation.y = i; this.scene.add(mountain);
      const cap = new THREE.Mesh(new THREE.ConeGeometry(2.8, 3.4, 5), materials.snow); cap.position.copy(mountain.position); cap.position.y += 3.5 + i % 4; cap.rotation.y = i; this.scene.add(cap);
    }
    for (let j = 0; j < 3; j++) {
      const positions: number[] = [], indices: number[] = [];
      for (let i = 0; i <= 40; i++) { const s = -40 + i * 2, x = -14 + s * 0.761 - j, z = -17 - s * 0.649 - j, y = 0.5 + Math.sin(i * 0.19 + j) * 1.2 + j * 1.2; positions.push(x, y, z, x, y + 2.6, z); if (i < 40) { const n = i * 2; indices.push(n, n + 1, n + 2, n + 1, n + 3, n + 2); } }
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geo.setIndex(indices);
      const ribbon = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: [0x61e4bb, 0x75c3ef, 0xac94e4][j], transparent: true, opacity: 0.14, side: THREE.DoubleSide, depthWrite: false })); this.auroras.push(ribbon); this.scene.add(ribbon);
    }
    for (const x of [-17, 17]) for (const z of [-12.5, 12.5]) {
      this.scene.add(cylinder(0.12, 4.5, materials.metal, x, 2.25, z), box(0.75, 0.22, 0.4, materials.glass, x, 4.5, z));
    }
  }
  private tree(x: number, z: number, scale: number) {
    const g = new THREE.Group(); g.position.set(x, -0.4, z); g.scale.setScalar(scale); g.add(cylinder(0.18, 1.5, materials.wood, 0, 0.5));
    for (let i = 0; i < 3; i++) { const mesh = new THREE.Mesh(new THREE.ConeGeometry(1.4 - i * 0.3, 2.2 - i * 0.3, 6), mat(0x3b6468)); mesh.position.y = 1.5 + i * 0.8; mesh.castShadow = true; g.add(mesh); const snow = new THREE.Mesh(new THREE.ConeGeometry(1.23 - i * 0.3, 1.8 - i * 0.3, 6), materials.snow); snow.position.y = mesh.position.y + 0.3; g.add(snow); }
    this.scene.add(g);
  }
  private makeTank(id: number, kind: EnemyKind = 'light', info?:Tank,register=true): TankView {
    const root = new THREE.Group(), body = new THREE.Group(), turret = new THREE.Group(), gun = new THREE.Group(), powerGuns = new THREE.Group();
    const friendly = id < 2, paint = info?.skin!==undefined ? skinPaint[info.skin] : id === 0 ? materials.blue : id === 1 ? materials.yellow : enemyPaint[kind];
    root.add(body, turret); body.add(box(HULL.width, 0.45, HULL.length, paint, 0, 0.58), box(1.1, 0.12, 1.6, paint, 0, 0.86));
    for (const x of [-HULL.trackX, HULL.trackX]) {
      body.add(box(HULL.trackWidth, 0.6, HULL.trackLength, materials.black, x, 0.4));
      for (let z = -0.8; z < 1; z += 0.38) body.add(box(0.45, 0.08, 0.13, materials.metal, x, 0.72, z));
      for (const z of [-0.7, 0, 0.7]) { const wheel = cylinder(0.23, 0.08, materials.concrete, x + Math.sign(x) * 0.23, 0.34, z); wheel.rotation.z = Math.PI / 2; body.add(wheel); }
    }
    body.add(box(0.3, 0.16, 0.15, materials.glass, -0.48, 0.73, 0.96), box(0.3, 0.16, 0.15, materials.glass, 0.48, 0.73, 0.96));
    turret.position.y = GUN.turretY; turret.add(box(1.13, 0.5, 1.05, paint, 0, 0.1), cylinder(0.27, 0.1, materials.metal, 0, 0.4, -0.15));
    turret.add(box(0.18, 0.025, 0.8, friendly ? materials.stripe : materials.white, -0.37, 0.37));
    const barrel = cylinder(0.12, 1.35, materials.metal, 0, GUN.y, 0.98); barrel.rotation.x = Math.PI / 2;
    gun.add(barrel, box(0.32, 0.25, 0.25, friendly ? materials.stripe : materials.metal, 0, GUN.y, GUN.normalTip - GUN.muzzleDepth / 2)); turret.add(gun);
    for (const x of [-GUN.spread, GUN.spread]) { powerGuns.add(box(0.46, 0.42, 1.7, materials.blue, x, GUN.y, 0.78), box(0.51, 0.46, 0.25, materials.glass, x, GUN.y, GUN.powerTip - GUN.muzzleDepth / 2)); }
    powerGuns.visible = false; turret.add(powerGuns);
    const antenna = cylinder(0.025, 0.9, materials.black, 0.48, 0.8, -0.35); turret.add(antenna); turret.add(box(0.16, 0.1, 0.08, friendly ? materials.stripe : materials.red, 0.48, 1.25, -0.35));
    const shield = new THREE.Mesh(shieldGeometry, shieldMaterial); shield.position.y = 0.7; shield.visible = false; root.add(shield);
    const health = box(1.3, 0.08, 0.08, materials.red, 0, 2.1, 0); health.visible = false; root.add(health);
    const warning = new THREE.Mesh(ringGeometry, this.ringMat); warning.rotation.x = -Math.PI/2; warning.position.y = 0.1; warning.scale.setScalar(1.5); warning.visible = false; root.add(warning);
    let tag: THREE.Sprite | undefined;
    if (friendly && !info?.displayName) { tag = label(id === 0 ? C.player.name : C.lev.name, id === 0 ? '#b9f5ff' : '#ffdb83', '#173242', id === 0 ? 2.5 : 2.75, 0.58); tag.position.y = 2.25; root.add(tag); }
    if(info?.skin!==undefined){for(let i=0;i<=info.skin%3;i++)body.add(box(.17,.18,.6,materials.glass,-.4+i*.4,.95,-.5));if(info.skin>=3)turret.add(box(1.4,.12,.2,materials.metal,0,.6,-.3));}
    if (id === 1) root.scale.setScalar(GUN.levScale);
    else if (!friendly) {
      root.scale.setScalar(enemyModelScale(kind));
      if (kind === 'flanker') { body.scale.z = HULL.flankerStretch; body.add(box(1.5, 0.18, 0.4, materials.stripe, 0, 0.8, -1)); }
      if (kind === 'sniper') { gun.scale.z = 1.8; turret.add(box(0.25, 0.25, 0.6, materials.glass, 0, 0.6)); }
      if (kind === 'shooter' || kind === 'squall') { gun.position.x = -0.25; const twin = gun.clone(); twin.position.x = 0.25; turret.add(twin); }
      if (kind === 'mortar') { gun.rotation.x = -0.65; gun.scale.set(1.7, 1.7, 0.75); }
      if (kind === 'medic') { turret.add(box(0.85, 0.08, 0.25, materials.white, 0, 0.5), box(0.25, 0.08, 0.85, materials.white, 0, 0.51)); }
      if (kind === 'saw' || kind === 'drill') for (const x of [-0.6, 0, 0.6]) { const tooth = new THREE.Mesh(sphereGeometry, materials.stripe); tooth.scale.set(0.28, 0.35, HULL.ramLength/2); tooth.position.set(x, 0.6, HULL.ramZ); body.add(tooth); }
      if (kind === 'barrier') turret.add(box(HULL.shieldWidth, 0.9, HULL.shieldLength, materials.glass, 0, 0.3, HULL.shieldZ));
      if (kind === 'hail') for (const x of [-0.65, 0.65]) { turret.add(box(0.65, 0.65, 1.4, paint, x, 0.5)); for (const a of [-0.15, 0.15]) turret.add(box(0.16, 0.16, 0.05, materials.black, x + a, 0.55, 0.73)); }
      if (kind === 'factory') { body.add(box(HULL.factoryWidth, 1.1, HULL.factoryLength, paint, 0, 1, HULL.factoryZ)); for (const x of [-0.55, 0.55]) body.add(cylinder(0.17, 1.8, materials.metal, x, 1.5, -0.9)); }
    }
    if(friendly){for(const x of [-.78,.78]){const stripe=box(.43,.08,.65,paint,x,.79,.5);stripe.userData.identity=true;body.add(stripe);}}
    if(friendly&&info?.modules?.length)addModuleParts(info.modules,body,turret,gun,powerGuns);
    this.scene.add(root); const view = { condition:new TankCondition(root,body,turret), root, body, turret, gun, powerGuns, shield, health, warning, label: tag,appearance:`${info?.skin}:${info?.displayName}:${info?.modules?.join(',')??''}` }; if(register)this.tanks.set(id, view); return view;
  }
  hangar(skin:number,rect?:{left:number;top:number;width:number;height:number}){
    this.previewRect=rect;
    if(rect&&skin!==this.previewSkin){if(this.preview)this.disposeGroup(this.preview.root);this.preview=this.makeTank(0,'light',{skin,displayName:'preview'} as Tank,false);this.previewSkin=skin;}
    if(this.preview)this.preview.root.visible=!!rect;
  }
  private previewCamera(){
    const r=this.previewRect!,l=this.layout,halfW=Math.max(4.1*l.width/Math.max(1,r.width),2.5*l.width/Math.max(1,r.height)),halfH=halfW*l.height/l.width;
    const sx=(.5-(r.left+r.width/2)/l.width)*halfW*2,sy=((r.top+r.height/2)/l.height-.5)*halfH*2;
    this.camera.position.set(13,15,-10);this.camera.lookAt(0,.6,8.5);
    this.camera.left=-halfW+sx;this.camera.right=halfW+sx;this.camera.top=halfH+sy;this.camera.bottom=-halfH+sy;
    this.camera.updateProjectionMatrix();this.camera.updateMatrixWorld(true);
    const v=this.preview!;v.root.position.set(0,GUN.rootY,8.5);v.root.scale.setScalar(1.55);v.body.rotation.y=2.65;v.turret.rotation.y=2.65;
  }
  setMobile(enabled: boolean) {
    if (this.mobile === enabled) return;
    this.mobile = enabled;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, enabled ? 1.25 : 1.75));
    this.sunlight.shadow.mapSize.set(enabled ? 1024 : 2048, enabled ? 1024 : 2048);
    this.sunlight.shadow.map?.dispose(); this.sunlight.shadow.map = null;
    while (this.particles.length > (enabled ? 140 : C.limits.particles)) { const p = this.particles.pop()!; this.scene.remove(p.mesh); this.particlePool.push(p.mesh); }
    this.resize();
  }
  aimDirection(player: Point, screenDirection: { x: number; y: number }): Point {
    const center = projectPoint(this.camera,this.layout,player), rect = this.renderer.domElement.getBoundingClientRect();
    const target = this.aim(rect.left + center.x + screenDirection.x * 100, rect.top + center.y + screenDirection.y * 100);
    const x = target.x - player.x, z = target.z - player.z, length = Math.hypot(x, z) || 1;
    return { x: x / length, z: z / length };
  }
  resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight, style=getComputedStyle(this.insetProbe);
    const layout=calculateLayout(w,h,this.mobile,{top:parseFloat(style.paddingTop)||8,right:parseFloat(style.paddingRight)||16,bottom:parseFloat(style.paddingBottom)||14,left:parseFloat(style.paddingLeft)||16});

    if (JSON.stringify(layout)===JSON.stringify(this.layout)) return;
    this.layout=layout;
    document.body.classList.toggle('portrait-mode',this.layout.portrait);
    document.body.style.setProperty('--view-top',`${this.layout.free.top}px`);document.body.style.setProperty('--view-bottom',`${this.layout.free.bottom}px`);
    this.renderer.setSize(w,h);this.cameraRig.configure(this.layout);
  }
  aim(clientX: number, clientY: number): Point {
    const rect=this.renderer.domElement.getBoundingClientRect();
    return groundPoint(this.camera,this.layout,{x:clientX-rect.left,y:clientY-rect.top});
  }
  setHudBounds(top:number,bottom:number){
    const next=fitHud(this.layout,Math.round(top),Math.round(bottom));
    if(next.free.top===this.layout.free.top&&next.free.bottom===this.layout.free.bottom)return;
    this.layout=next;this.cameraRig.configure(next);
    document.body.style.setProperty('--view-top',`${this.layout.free.top}px`);document.body.style.setProperty('--view-bottom',`${this.layout.free.bottom}px`);
  }
  screen(point: Point) { return projectPoint(this.camera,this.layout,this.motion.point(point)); }
  stickDirection(stick: { x: number; y: number }) { return stickDirection(this.camera, this.layout, stick); }
  captureMotion(sim: Simulation) { this.motion.capture([...(sim.allies??[sim.player,sim.lev]),...sim.enemies,...sim.bullets]); }
  movement(x: number, y: number): Point { const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0); const up = new THREE.Vector3(-right.z, 0, right.x); return { x: right.x * x - up.x * y, z: right.z * x - up.z * y }; }
  reset() {
    this.aimSector.reset();this.shotTrails.reset();this.aiming=this.aimAllowed=false;this.supportView.reset();this.installFlash.clear();
    this.cameraRig.reset();
    this.motion.reset();
    for (const v of this.tanks.values()) this.disposeGroup(v.root); this.tanks.clear();
    for (const v of this.bulletViews.values()) this.scene.remove(v); this.bulletViews.clear();
    for (const v of this.portalViews.values()) { this.disposeGroup(v); v.traverse(o => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); if (o.material instanceof THREE.Material) o.material.dispose(); } }); } this.portalViews.clear();
    for (const p of this.particles) { this.scene.remove(p.mesh); this.particlePool.push(p.mesh); } this.particles = [];
    for (const g of this.hazardViews.values()) this.scene.remove(g); this.hazardViews.clear();
    for (const g of this.pickupViews.values()) this.disposeGroup(g); this.pickupViews.clear();
    if (this.zone) this.disposeGroup(this.zone); this.zone = undefined; this.flag = undefined; for (const n of this.pickupNotices) this.disposeGroup(n.sprite); this.pickupNotices = []; this.zoneName = ''; this.shake = 0; this.delayedBlasts = [];
    this.clock=0;this.trackTimer=0;this.clearTracks(); this.obstacleSignature = 'reset'; this.lastPlayer = { x: 0, z: 7 }; this.lastLev = { x: 2.2, z: 9 };
  }
  private disposeGroup(g: THREE.Object3D) { for(const m of g.userData.ownedMaterials??[])m.dispose();g.traverse(o => { if (o instanceof THREE.Sprite) { o.material.map?.dispose(); o.material.dispose(); } }); this.scene.remove(g); }
  private makeFlagMaterial() {
    const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 160;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#188fc0'; ctx.fillRect(0, 0, 256, 160); ctx.fillStyle = '#ffbd58'; ctx.fillRect(0, 0, 25, 160);
    ctx.fillStyle = '#fffbe8'; ctx.font = '900 110px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('67', 144, 88);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    return mat(0xffffff, { map: texture, side: THREE.DoubleSide, roughness: 0.9, emissive: 0x164a60, emissiveIntensity: 0.2 });
  }
  private pickupNotice(e: GameEvent) {
    if (this.pickupNotices.length >= 5) this.disposeGroup(this.pickupNotices.shift()!.sprite);
    // Stack simultaneous drops so each effect stays readable.
    for (const n of this.pickupNotices) n.baseY += 1.6;
    const color = e.pickupKind === 'heal' ? '#a7ffe0' : e.pickupKind === 'charge' ? '#ffda8b' : '#e4c3ff';
    const sprite = label(e.text ?? '', color, e.module?MODULES[e.module].labelBg:'#142c3c', 8, 1.5); sprite.position.set(e.x, 3.4, e.z); this.scene.add(sprite);
    this.pickupNotices.push({ sprite, life: 2, baseY: 3.4 }); this.particle(e, 'ring', 0.75, 0.5, e.pickupKind === 'heal');
  }
  private particle(at: Point & { y?: number }, mode: Particle['mode'], size: number, life: number, blue = false) {
    if (this.particles.length >= (this.mobile ? 140 : C.limits.particles)) { const old = this.particles.shift()!; this.scene.remove(old.mesh); this.particlePool.push(old.mesh); }
    const mesh = this.particlePool.pop() ?? new THREE.Mesh();
    mesh.geometry = mode === 'ring' ? ringGeometry : mode === 'debris' ? boxGeometry : sphereGeometry;
    mesh.material = blue ? materials.glass : mode === 'smoke' ? this.smokeMat : mode === 'fire' ? this.fireMat : mode === 'ring' ? this.ringMat : mode === 'debris' ? materials.metal : this.particleMat;
    mesh.rotation.set(mode === 'ring' ? -Math.PI / 2 : 0, 0, 0); mesh.scale.setScalar(size); mesh.position.set(at.x, at.y ?? (mode === 'ring' ? 0.08 : 0.8), at.z); this.scene.add(mesh);
    const airborne = mode === 'spark' || mode === 'debris';
    this.particles.push({ mesh, mode, size, life, max: life, vx: airborne ? (Math.random() - 0.5) * 9 : 0, vz: airborne ? (Math.random() - 0.5) * 9 : 0, vy: airborne ? 3 + Math.random() * 6 : mode === 'smoke' ? 1.8 : 0 });
  }
  private blast(at: Point, scale: number) {
    this.particle(at, 'fire', scale * 0.8, 0.3); this.particle(at, 'ring', scale, 0.65);
    for (let i = 0; i < 7; i++) this.particle(at, 'debris', scale * (0.08 + Math.random() * 0.16), 0.8 + Math.random() * 0.5);
    for (let i = 0; i < 5; i++) this.particle({ x: at.x + (Math.random() - 0.5) * scale, z: at.z + (Math.random() - 0.5) * scale }, 'smoke', scale * 0.4, 1 + Math.random());
  }
  handle(events: GameEvent[], sim?:Simulation) {
    for (const e of events) {
      if(e.type==='shot'&&e.owner==='roma'&&(!sim?.network||e.source===sim.localId))this.aimSector.pulse();
      if (e.type === 'shot') for(const tip of e.muzzles ?? []) this.particle(tip,'fire',e.owner==='roma'&&(!sim?.network||e.source===sim.localId)?.24:.19,.075,e.muzzles!.length===2);
      if(e.type==='upgrade')this.installFlash.set(e.actorId??0,this.clock+1);
      if(e.type==='knockback'&&!this.reducedMotion){for(let i=0;i<4;i++)this.particle(e,'smoke',.22,.4);}
      if(e.type==='zoneRepair'&&(!sim?.network||e.actorId===sim.localId))this.pickupNotice({...e,pickupKind:'heal'});
      if(e.type==='supplyLand'){for(let i=0;i<8;i++){this.particle(e,'debris',.16,.7);this.particles.at(-1)!.mesh.material=materials.wood;}for(let i=0;i<5;i++)this.particle(e,'smoke',.3,.5);}
      if (e.type === 'pickup' && (!sim?.network || e.actorId===sim.localId)) this.pickupNotice(e);
      if(e.type==='upgrade')this.particle(e,'ring',.85,.55,true);
      if(e.type==='landing'&&!this.reducedMotion){for(let i=0;i<3;i++)this.particle(e,'smoke',.18,.3);}
      if (e.type === 'hit' && e.target === 0) { const impact=hitFeedback(e,sim?.player.hp,sim?.player.maxHp);this.shake=Math.max(this.shake,impact.shake);this.particle({...e,y:1},'fire',impact.blast,impact.duration);for(let i=0;i<impact.sparks;i++)this.particle({...e,y:1},'spark',.1,impact.duration); }
      if (e.type === 'explode' || e.type === 'crate') {
        this.blast(e, e.tier === 'boss' ? 2.2 : e.tier === 'mini' ? 1.4 : e.owner === 'hazard' ? 0.65 : 0.9);
        if (e.tier === 'boss') { this.shake = .28; for (let i = 1; i <= 4; i++) this.delayedBlasts.push({ at: { x: e.x + (Math.random() - 0.5) * 3, z: e.z + (Math.random() - 0.5) * 3 }, delay: i * 0.16 }); }
      }
      const count = e.type === 'power' ? 30 : e.type === 'heal' || e.type === 'pickup' ? 12 : e.type === 'hit' ? 4 : e.type === 'shield' || e.type === 'dash' ? 10 : 0;
      for (let i = 0; i < count; i++) this.particle(e, 'spark', 0.07 + Math.random() * 0.07, 0.4 + Math.random() * 0.6, ['power', 'heal', 'shield', 'dash'].includes(e.type));
      if (e.type === 'phase') { this.particle(e, 'ring', 2.5, 0.9); this.particle(e, 'fire', 1.5, 0.25); }
      if (e.type === 'capture' && e.text === 'complete') this.particle(e, 'ring', 3, 1, true);
    }
  }
  private objectives(sim: Simulation) {
    const c = sim.capture??(sim.repairZone?{...sim.repairZone,name:'Ремонтная зона',status:'complete',progress:1,hold:0,duration:1}:null);
    if (c?.name !== this.zoneName) {
      if (this.zone) this.disposeGroup(this.zone); this.zone = undefined; this.flag = undefined; this.zoneName = c?.name ?? '';
      if (c) {
        this.zone = new THREE.Group(); this.zone.position.set(c.x, 0.05, c.z);
        const disc = new THREE.Mesh(discGeometry, this.zoneMat), ring = new THREE.Mesh(ringGeometry, this.zoneRingMat);
        for (const m of [disc, ring]) { m.rotation.x = -Math.PI / 2; m.scale.setScalar(B.capture.radius); this.zone.add(m); }
        const mast = new THREE.Group(); mast.position.set(-B.capture.radius + 0.3, 0, 0);
        mast.add(cylinder(0.32, 0.18, materials.metal, 0, 0.12), cylinder(0.075, 3.9, materials.white, 0, 1.95), cylinder(0.12, 0.18, materials.stripe, 0, 3.98));
        this.flag = new THREE.Mesh(flagGeometry, this.flagCloth); this.flag.rotation.y = 0.7; this.flag.position.set(Math.cos(0.7) * 0.95, 0.85, -Math.sin(0.7) * 0.95); this.flag.castShadow = true; mast.add(this.flag); this.zone.add(mast);
        this.scene.add(this.zone);
      }
    }
    if (this.zone && c && this.flag) {
      this.zone.visible = true;
      const progress = Math.min(1, (c.progress + c.hold) / c.duration);
      this.flag.position.y = 0.85 + progress * 2.5;
      this.flagCloth.color.setHex(c.status === 'contested' ? 0xffb79d : progress > 0 ? 0xffffff : 0x87949b);
      const vertices = flagGeometry.attributes.position;
      for (let i = 0; i < vertices.count; i++) { const x = vertices.getX(i); vertices.setZ(i, this.reducedMotion ? 0 : Math.sin((x + 0.95) * 5 - this.clock * 5) * (x + 0.95) * 0.11); }
      vertices.needsUpdate = true; flagGeometry.computeVertexNormals();
      (this.zone.children[0] as THREE.Mesh).material = c.status === 'contested' ? this.warningMat : this.zoneMat;
    }
    const hazardIds = new Set(sim.hazards.map(h => h.id));
    for (const [id, g] of this.hazardViews) if (!hazardIds.has(id)) { this.scene.remove(g); this.hazardViews.delete(id); }
    for (const h of sim.hazards) {
      let g = this.hazardViews.get(h.id);
      if (!g) {
        g = new THREE.Group(); const fill = new THREE.Mesh(h.kind === 'circle' ? discGeometry : boxGeometry, this.warningMat);
        if (h.kind === 'circle') { fill.rotation.x = -Math.PI / 2; fill.scale.setScalar(h.radius); const edge = new THREE.Mesh(ringGeometry, this.ringMat); edge.rotation.x = -Math.PI / 2; edge.scale.setScalar(h.radius); g.add(edge); }
        else { fill.scale.set(h.radius * 2, 0.03, h.length); fill.position.z = h.length / 2; }
        g.add(fill); g.position.set(h.x, 0.11, h.z); g.rotation.y = h.angle; this.scene.add(g); this.hazardViews.set(h.id, g);
      }
      (g.children[g.children.length - 1] as THREE.Mesh).material = h.delay > 0 ? this.warningMat : this.fireMat;
    }
    const ids = new Set(sim.pickups.map(p => p.id));
    for (const [id, g] of this.pickupViews) if (!ids.has(id)) { this.disposeGroup(g); this.pickupViews.delete(id); }
    for (const p of sim.pickups) {
      let g = this.pickupViews.get(p.id);
      const block=p.kind==='module'&&Math.hypot(p.x-sim.player.x,p.z-sim.player.z)<3?sim.moduleBlock(p,sim.player):'';
      const key=`${p.kind}:${p.module}`;
      if(g&&g.userData.displayKey!==key){this.disposeGroup(g);this.pickupViews.delete(p.id);g=undefined;}
      if(!g){g=makePickup(p,label);g.userData.displayKey=key;this.scene.add(g);this.pickupViews.set(p.id,g);}
      const lock=g.getObjectByName('pickup-lock');if(lock)lock.visible=!!block;
      updatePickup(g,p,this.clock,(this.camera.right-this.camera.left)/this.layout.width,this.mobile,this.reducedMotion,sim.elapsed);
    }
    const upp=(this.camera.right-this.camera.left)/this.layout.width, labels:LootLabel[]=[];
    for(const p of sim.pickups){
      const g=this.pickupViews.get(p.id)!,tag=g.getObjectByName('pickup-label');if(!tag)continue;g.updateMatrixWorld(true);
      const q=tag.getWorldPosition(new THREE.Vector3()).project(this.camera);
      const x=(q.x+1)*this.layout.width/2,y=(1-q.y)*this.layout.height/2;
      tag.visible=g.visible&&x>-50&&x<this.layout.width+50&&y>30&&y<this.layout.height-60;
      if(tag.visible)labels.push({id:p.id,x,y,width:tag.scale.x/upp,height:tag.scale.y/upp,module:p.kind==='module'});
    }
    const own=this.screen(sim.player);
    const labelTop=this.layout.free.top;
    const labelBottom=this.layout.portrait?this.layout.free.bottom:this.layout.height-(this.mobile?160:70);
    const reserved=sim.player.hp>0?[{left:own.x-32,top:own.y-55,width:64,height:80}]:[];
    for(const p of sim.pickups)if(p.kind==='module'){
      const root=this.pickupViews.get(p.id)!,body=root.getObjectByName('pickup-body')!;if(!root.visible)continue;
      const center=body.getWorldPosition(new THREE.Vector3()).project(this.camera),x=(center.x+1)*this.layout.width/2,y=(1-center.y)*this.layout.height/2;
      const radius=1.4*body.scale.x/upp;reserved.push({left:x-radius,top:y-radius,width:radius*2,height:radius*2});
    }
    if(this.mobile&&!this.layout.portrait)reserved.push({left:this.layout.width-this.layout.insets.right-154,top:this.layout.height-this.layout.insets.bottom-196,width:160,height:95});
    const packed=placeLootLabels(labels,this.layout.width,labelTop,labelBottom,reserved);
    for(const p of sim.pickups){
      const g=this.pickupViews.get(p.id)!,tag=g.getObjectByName('pickup-label'),line=g.getObjectByName('pickup-leader');if(!tag||!line)continue;
      const rect=packed.get(p.id);tag.visible=!!rect;line.visible=!!rect&&g.visible;
      if(!rect)continue;
      tag.scale.x=rect.width*upp;
      const ndc=tag.getWorldPosition(new THREE.Vector3()).project(this.camera);
      ndc.x=(rect.left+rect.width/2)/this.layout.width*2-1;ndc.y=1-(rect.top+rect.height/2)/this.layout.height*2;
      const world=ndc.unproject(this.camera);tag.position.copy(world.sub(g.position));
      const start=new THREE.Vector3(0,g.getObjectByName('pickup-body')!.position.y+.4,0);
      const direction=tag.position.clone().sub(start);line.position.copy(start);line.scale.set(1,direction.length(),1);line.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),direction.normalize());
    }
  }
  render(sim: Simulation, dt: number, alpha=1) {
    const moving = sim.phase !== 'paused' && sim.phase !== 'over'; const delta = moving ? dt : 0; this.clock += delta;
    for(const t of sim.allies??[])this.motion.sample(t,alpha,!moving);
    const playerPose=this.motion.sample(sim.player,alpha,!moving);
    this.cameraRig.update(sim.focus?this.motion.point(sim.focus):playerPose,sim.phase,delta,this.reducedMotion,sim.previousPhase);
    if(this.previewRect&&this.preview)this.previewCamera();
    const signature = sim.obstacles.map(o => o.id).join(',');
    if (signature !== this.obstacleSignature) {
      for (const [id, group] of this.obstacleViews) if (!sim.obstacles.some(o => o.id === id)) { this.scene.remove(group); this.obstacleViews.delete(id); }
      for (const o of sim.obstacles) if (!this.obstacleViews.has(o.id)) {
        const group = new THREE.Group(); group.position.set(o.x, 0, o.z);
        if (o.kind === 'cover') { group.add(box(o.w, 1.1, o.d, materials.concrete, 0, 0.55), box(o.w + 0.12, 0.18, o.d + 0.12, materials.snow, 0, 1.18)); for (let x = -o.w / 2 + 0.3; x < o.w / 2; x += 0.65) { const stripe = box(0.28, 0.25, 0.02, materials.stripe, x, 0.7, o.d / 2 + 0.01); stripe.rotation.z = -0.45; group.add(stripe); } }
        else { group.add(box(o.w, 1.05, o.d, materials.wood, 0, 0.53), box(o.w + 0.08, 0.13, o.d + 0.08, materials.snow, 0, 1.1)); for (const x of [-0.42, 0.42]) group.add(box(0.1, 1.08, o.d + 0.03, materials.metal, x, 0.55)); }
        this.scene.add(group); this.obstacleViews.set(o.id, group);
      }
      this.obstacleSignature = signature;
    }
    const friends=sim.allies??[sim.player,sim.lev];
    const present = new Set([...friends.map(t=>t.id), ...sim.enemies.map(e => e.id)]);
    for (const [id, view] of this.tanks) if (!present.has(id)) { this.disposeGroup(view.root); this.tanks.delete(id); }
    const updateTank = (t: Tank, kind: EnemyKind = 'light') => {
      const pose=this.motion.sample(t,alpha,!moving);
      const cached=this.tanks.get(t.id);if(cached&&cached.appearance!==`${t.skin}:${t.displayName}:${t.modules?.join(',')??''}`){this.disposeGroup(cached.root);this.tanks.delete(t.id);}
      const v = this.tanks.get(t.id) ?? this.makeTank(t.id, kind,t); v.root.position.set(pose.x, GUN.rootY, pose.z);
      v.condition.update(t,this.clock,this.reducedMotion,(this.installFlash.get(t.id)??0)>this.clock);
      v.body.rotation.y = t.id > 1 ? pose.bodyAngle! : this.angleLerp(v.body.rotation.y, pose.bodyAngle!, 1-Math.exp(-delta/.065)); v.turret.rotation.y = pose.angle!;
      v.gun.position.z = -t.recoil * GUN.normalRecoil; v.powerGuns.position.z = -t.recoil * GUN.powerRecoil;
      const powered = sim.network ? (t.netPower??0)>0 : t.id === 0 && sim.powerTime > 0; v.powerGuns.visible = powered; v.gun.visible = !powered; v.shield.visible = powered || (sim.network?(t.netShield??0)>0:t.id === 0 && sim.dashTime > 0); v.root.visible = t.hp > 0; v.warning.visible = t.id > 1 && (t as Enemy).state === 'windup'; v.warning.scale.setScalar(1.4 + Math.sin(this.clock*16)*0.08);
      v.shield.rotation.y = this.clock * 0.5; v.health.visible = t.id > 1 && t.hp < t.maxHp; v.health.scale.x = 1.3 * t.hp / t.maxHp;
    };
    friends.forEach(t=>updateTank(t)); sim.enemies.forEach(e => updateTank(e, e.kind));
    this.aimSector.update({ ...playerPose, recoil:sim.player.recoil, angle: playerPose.angle ?? sim.player.angle }, sim.obstacles, this.aimAllowed && sim.player.hp > 0 && sim.phase === 'playing', sim.powerTime > 0,delta,this.reducedMotion,this.aiming);
    if(this.previewRect)for(const v of this.tanks.values())v.root.visible=false;
    const open = sim.phase === 'menu' ? 0.85 : sim.phase === 'intro' || (sim.phase === 'paused' && sim.previousPhase === 'intro') ? Math.min(1, sim.introTime / 1.5) : 1;
    this.doorLeft.position.x = -1.48 - open * 2.4; this.doorRight.position.x = 1.48 + open * 2.4;
    const bulletIds = new Set(sim.bullets.map(b => b.id));
    for (const [id, mesh] of this.bulletViews) if (!bulletIds.has(id)) { this.scene.remove(mesh); this.bulletViews.delete(id); }
    const ownTraces:TrailShot[]=[];
    for (const b of sim.bullets) {
      let mesh = this.bulletViews.get(b.id); if (!mesh) { mesh = box(b.power ? 0.2 : 0.12, 0.12, b.owner === 'enemy' ? 0.55 : 0.85, b.owner === 'enemy' ? this.enemyShotMaterial : b.power ? this.powerShotMaterial : this.shotMaterial); mesh.castShadow = false; this.scene.add(mesh); this.bulletViews.set(b.id, mesh); }
      const own = b.owner === 'roma' && (!sim.network || b.source === sim.localId);
      mesh.scale.set(own ? .24 : b.power ? .2 : .12, own ? .17 : .12, own ? .7 : b.owner === 'enemy' ? .55 : .85);
      mesh.material = own ? this.ownShotMaterial : b.owner === 'enemy' ? this.enemyShotMaterial : b.power ? this.powerShotMaterial : this.shotMaterial;
      const pose=this.motion.sample(b,alpha,!moving); const speed=Math.hypot(b.vx,b.vz)||1, behind=mesh.scale.z/2-PROJECTILE.radius;
      mesh.position.set(pose.x-b.vx/speed*behind, b.y ?? .75, pose.z-b.vz/speed*behind); mesh.rotation.y = Math.atan2(b.vx, b.vz);
      if(own)ownTraces.push({id:b.id,x:pose.x,z:pose.z,y:b.y??.75,vx:b.vx,vz:b.vz,power:b.power});
    }
    this.shotTrails.update(ownTraces,sim.obstacles,delta,this.reducedMotion);
    const portalIds = new Set(sim.portals.map(p => p.id));
    for (const [id, group] of this.portalViews) if (!portalIds.has(id)) { this.disposeGroup(group); group.traverse(o => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); if (o.material instanceof THREE.Material) o.material.dispose(); } }); this.portalViews.delete(id); }
    for (const p of sim.portals) {
      let group = this.portalViews.get(p.id);
      if (!group) { group = new THREE.Group(); const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.03, 24), new THREE.MeshBasicMaterial({ color: 0xf87657, side: THREE.DoubleSide, transparent: true, opacity: 0.85 })); ring.rotation.x = -Math.PI / 2; group.add(ring); const tag = label('!', '#ffb693', '#5d3432', 0.65, 0.65); tag.position.y = 1.4; group.add(tag); this.scene.add(group); this.portalViews.set(p.id, group); }
      group.position.set(p.x, 0.04, p.z); group.scale.setScalar(1 + Math.sin(this.clock * 12) * 0.08);
    }
    this.objectives(sim);this.supportView.update(sim,this.reducedMotion,delta);
    for(const [id,until] of this.installFlash)if(until<=this.clock)this.installFlash.delete(id);
    for (const n of this.pickupNotices) {
      n.life -= delta; const age = 2 - n.life, pop = this.reducedMotion ? 1 : Math.min(1, 0.7 + age * 3);
      n.sprite.position.y = n.baseY + (this.reducedMotion ? 0 : age * 0.75); n.sprite.scale.set(8 * pop, 1.5 * pop, 1); n.sprite.material.opacity = Math.min(1, Math.max(0, n.life / 0.6));
      const projected=n.sprite.position.clone().project(this.camera),y=(1-projected.y)*this.layout.height/2; n.sprite.visible=y>this.layout.free.top+20&&y<this.layout.free.bottom;
      if (n.life <= 0) this.disposeGroup(n.sprite);
    }
    this.pickupNotices = this.pickupNotices.filter(n => n.life > 0);
    for (const b of this.delayedBlasts) { b.delay -= delta; if (b.delay <= 0) this.blast(b.at, 1.5); }
    this.delayedBlasts = this.delayedBlasts.filter(b => b.delay > 0);
    for (const p of this.particles) {
      p.life -= delta; const progress = 1 - Math.max(0, p.life) / p.max;
      if (p.mode === 'spark' || p.mode === 'debris') { p.vy -= delta * 12; p.mesh.rotation.x += delta * 5; p.mesh.rotation.z += delta * 3; }
      p.mesh.position.x += p.vx * delta; p.mesh.position.y += p.vy * delta; p.mesh.position.z += p.vz * delta;
      if (p.mesh.position.y < 0.1 && p.mode !== 'ring') { p.mesh.position.y = 0.1; p.vy *= -0.3; }
      p.mesh.scale.setScalar(p.size * (p.mode === 'ring' ? 0.3 + progress * 3 : p.mode === 'smoke' ? (0.3 + progress * 2) * Math.min(1, (1 - progress) * 4) : p.mode === 'fire' ? 1 - progress : Math.min(1, (1 - progress) * 4)));
      if (p.life <= 0) { this.scene.remove(p.mesh); this.particlePool.push(p.mesh); }
    }
    this.particles = this.particles.filter(p => p.life > 0);
    this.trackTimer += delta;
    if (this.trackTimer > 0.07 && sim.phase === 'playing') {
      this.trackTimer = 0;
      for (const [t, prev] of [[sim.player, this.lastPlayer], [sim.lev, this.lastLev]] as const) {
        if (Math.hypot(t.x - prev.x, t.z - prev.z) > 0.2) {
          for (const offset of [-0.64, 0.64]) { this.scratch.position.set(t.x + Math.cos(t.bodyAngle) * offset, 0.009, t.z - Math.sin(t.bodyAngle) * offset); this.scratch.rotation.set(0, t.bodyAngle, 0); this.scratch.scale.set(0.27, 0.008, 0.35); this.scratch.updateMatrix(); const index = this.trackIndex++ % C.limits.tracks; this.trackMesh.setMatrixAt(index, this.scratch.matrix); this.trackMesh.setColorAt(index, new THREE.Color(t.id === 0 && sim.powerTime > 0 ? 0x46eaca : 0x829ca2)); }
          prev.x = t.x; prev.z = t.z;
        }
      }
      this.trackMesh.instanceMatrix.needsUpdate = true;
      if (this.trackMesh.instanceColor) this.trackMesh.instanceColor.needsUpdate = true;
    }
    for (let i = 0; i < this.flakes.length; i++) { const p = this.flakes[i]; if (!this.reducedMotion) { p.y -= delta * (0.5 + i % 4 * 0.1); p.x += delta * 0.15; if (p.y < 0) p.y = 18; } this.scratch.position.copy(p); this.scratch.scale.setScalar(0.035 + i % 3 * 0.015); this.scratch.updateMatrix(); this.snow.setMatrixAt(i, this.scratch.matrix); } this.snow.instanceMatrix.needsUpdate = true;
    this.auroras.forEach((a, i) => { a.position.y = this.reducedMotion ? 0 : Math.sin(this.clock * 0.2 + i) * 0.5; });
    this.shake = Math.max(0, this.shake - delta * 1.2);
    const sx = !this.reducedMotion && moving ? Math.sin(this.clock * 101) * this.shake : 0, sy = !this.reducedMotion && moving ? Math.cos(this.clock * 83) * this.shake * 0.6 : 0;
    this.camera.position.x += sx; this.camera.position.y += sy; this.renderer.render(this.scene, this.camera); this.camera.position.x -= sx; this.camera.position.y -= sy; this.camera.updateMatrixWorld();
  }
  private angleLerp(a: number, b: number, t: number) { const d = Math.atan2(Math.sin(b - a), Math.cos(b - a)); return a + d * t; }
  stats() { return { friendlySkins:[...this.tanks.entries()].filter(([id])=>id<2).map(([id,v])=>({id,appearance:v.appearance,color:((v.body.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial).color.getHexString()})),drawCalls: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles, geometries: this.renderer.info.memory.geometries, textures: this.renderer.info.memory.textures, trails:this.shotTrails.stats(),laser:this.aimSector.root.visible,particles: this.particles.length, tanks: this.tanks.size, bullets: this.bulletViews.size, portals: this.portalViews.size, hazards: this.hazardViews.size, pickups: this.pickupViews.size, particlePool: this.particlePool.length, pickupNotices: this.pickupNotices.length }; }
}
