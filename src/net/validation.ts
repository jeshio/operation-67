import { ENEMY_META } from '../config';
import { MODULES } from '../modules';
import { matches, type BattleCheckpoint, type Envelope, type WorldSnapshot } from '../protocol';
import { NET } from './config';
type Data=Record<string,any>;
const obj=(v:unknown):v is Data=>!!v&&typeof v==='object'&&!Array.isArray(v);
const finite=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=1e12;
const integer=(v:unknown)=>Number.isSafeInteger(v)&&Math.abs(v as number)<=1e12;
const nums=(v:Data,keys:string)=>keys.split(' ').every(k=>finite(v[k]));
const list=(v:unknown,check:(x:any)=>boolean,max=4096):boolean=>Array.isArray(v)&&v.length<=max&&v.every(check);
const point=(v:unknown):v is Data=>obj(v)&&nums(v,'x z');
const kind=(v:unknown)=>typeof v==='string'&&Object.hasOwn(ENEMY_META,v);
const phase=(v:unknown)=>['menu','intro','playing','paused','dying','over'].includes(v as string);
const ids=(v:unknown)=>list(v,integer,NET.maxIdentities);
const optional=(v:unknown,check:(x:any)=>boolean)=>v===undefined||check(v);
const record=(v:unknown,check:(x:any)=>boolean)=>obj(v)&&Object.keys(v).length<=NET.maxIdentities&&Object.entries(v).every(([k,x])=>/^-\d+$/.test(k)&&check(x));
function tank(v:unknown):boolean {
 return point(v)&&nums(v,'id angle bodyAngle hp maxHp cooldown recoil')&&integer(v.id)
  &&optional(v.controlEpoch,n=>integer(n)&&n>=0)&&optional(v.modules,m=>list(m,k=>typeof k==='string'&&Object.hasOwn(MODULES,k),12))
  &&optional(v.knockback,k=>point(k)&&nums(k,'remaining source'))&&optional(v.ramHits,ids);
}
function member(v:unknown):boolean {
 return obj(v)&&integer(v.id)&&v.id<0&&typeof v.name==='string'&&v.name.length<=24&&integer(v.skin)&&v.skin>=0&&v.skin<6&&tank(v.tank)&&v.tank.id===v.id
  &&typeof v.present==='boolean'&&typeof v.connected==='boolean'&&nums(v,'charge powerTime dashTime dashCooldown rapidTime streak powerKills moved fired shield kills damage bestStreak deadWave')&&point(v.dashDirection);
}
function world(v:unknown,players:unknown):boolean {
 if(!obj(v)||!phase(v.phase)||!nums(v,'score wave elapsed breakTime')||v.wave<0||v.elapsed<0||v.score<0||!list(players,member,NET.maxIdentities))return false;
 if(new Set((players as Data[]).map(p=>p.id)).size!==(players as Data[]).length)return false;
 return list(v.enemies,e=>tank(e)&&kind(e.kind)&&point(e.target)&&list(e.path,point,1024)&&nums(e,'shotDelay pathTimer stateTime attack burst')&&['move','windup','execute','recover'].includes(e.state))
  &&list(v.bullets,b=>point(b)&&nums(b,'id vx vz damage life')&&['roma','lev','enemy'].includes(b.owner)&&typeof b.power==='boolean')
  &&list(v.portals,p=>point(p)&&nums(p,'id remaining')&&kind(p.kind))
  &&list(v.obstacles,o=>point(o)&&nums(o,'id w d')&&(finite(o.hp)||o.hp===Infinity)&&['cover','crate'].includes(o.kind))
  &&list(v.hazards,h=>point(h)&&nums(h,'id source angle radius length delay life damage')&&['circle','line'].includes(h.kind)&&optional(h.hitPlayers,ids))
  &&list(v.pickups,p=>point(p)&&nums(p,'id life')&&['heal','charge','rapid','module'].includes(p.kind)&&(p.kind!=='module'||Object.hasOwn(MODULES,p.module))&&optional(p.flight,f=>obj(f)&&point(f.from)&&nums(f,'remaining delay')))
  &&optional(v.deliveries,d=>list(d,p=>point(p)&&nums(p,'id count startAt')&&['boss','emergency'].includes(p.source)&&typeof p.landed==='boolean',128))
  &&(v.capture===null||point(v.capture)&&nums(v.capture,'progress hold duration')&&['capture','hold','contested','away','complete'].includes(v.capture.status))
  &&optional(v.lootBatch,b=>b===null||obj(b)&&integer(b.id)&&ids(b.eligible)&&ids(b.claimed))
  &&optional(v.repairZone,z=>z===null||point(z)&&finite(z.until)&&record(z.healed,finite)&&record(z.pending,finite)&&record(z.noticeAt,finite));
}
const events=(v:unknown)=>list(v,e=>point(e)&&typeof e.type==='string'&&optional(e.eventId,integer)&&optional(e.muzzles,m=>list(m,x=>point(x)&&nums(x,'y bulletId vx vz'),2)),NET.maxEvents);
export function validCheckpoint(cp:unknown,context:Envelope):cp is BattleCheckpoint {
 if(!obj(cp)||cp.version!==1||!matches(cp as BattleCheckpoint,context)||!integer(cp.tick)||cp.tick<0||!integer(cp.eventCursor)||!record(cp.ack,integer)||!record(cp.actions,a=>list(a,integer,128)))return false;
 const c=cp.simulation?.core,p=cp.simulation?.coop;
 if(cp.simulation?.version!==1||!obj(c)||!obj(p)||!world(c,p.members)||!tank(c.player)||!tank(c.lev)||!events(c.events))return false;
 if(!nums(c,'charge powerTime healTimer spawnTimer remainingToSpawn spawnIndex introTime dashTime dashCooldown rapidTime deathTime streak powerKills regularKills dropIndex moved fired kills nextId seed levPathTimer emergencyReadyAt')||!point(c.dashDirection)||!list(c.levPath,point,1024)||typeof c.bossWarned!=='boolean'||!['intro','playing','dying'].includes(c.previousPhase))return false;
 const w=c.wavePlan;
 return obj(w)&&nums(w,'wave cycle count')&&(w.captureIndex===null||integer(w.captureIndex))&&list(w.bosses,kind,64)&&list(w.roster,kind,64)
  &&nums(p,'peak lastStandWave tick eventSequence')&&ids(p.roster)&&ids(p.deaths);
}
export function validSnapshot(s:unknown,context:Envelope):s is WorldSnapshot {
 return obj(s)&&s.kind==='snapshot'&&matches(s as WorldSnapshot,context)&&integer(s.tick)&&s.tick>=0&&integer(s.eventCursor)&&record(s.ack,integer)&&world(s.state,s.state?.players)&&events(s.events);
}
