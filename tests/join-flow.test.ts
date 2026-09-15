import test from 'node:test';
import assert from 'node:assert/strict';
import { GameProfile, validName } from '../src/profile';
import { JoinFlow } from '../src/join-flow';
import type { JoinRequest } from '../src/protocol';

test('new profile requires confirmation even after paint selection; old valid names migrate',()=>{
 const data=new Map<string,string>(),storage={getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{data.set(k,v);}};
 const fresh=new GameProfile(storage);assert.equal(fresh.nameConfirmed,false);fresh.select(4);
 const reloaded=new GameProfile(storage);assert.equal(reloaded.skin,4);assert.equal(reloaded.nameConfirmed,false);
 assert(reloaded.rename('  Лев  '));assert.equal(new GameProfile(storage).nameConfirmed,true);assert.equal(new GameProfile(storage).name,'Лев');
 data.set('roma-online-profile',JSON.stringify({name:'Рома',skin:2}));assert.equal(new GameProfile(storage).nameConfirmed,true);
 data.set('roma-online-profile',JSON.stringify({name:'!!!',skin:2}));assert.equal(new GameProfile(storage).nameConfirmed,false);
 const blocked=new GameProfile({getItem(){throw Error();},setItem(){throw Error();}});blocked.rename('Боец');blocked.select(5);assert.equal(blocked.nameConfirmed,true);assert.equal(blocked.name,'Боец');
 for(const name of ['','   ','x'.repeat(17),'Лев!','<script>'])assert.equal(validName(name),false);
 assert(validName('Лев-02'));assert(validName('e\u0301'));assert.equal(blocked.rename('!'),false);assert.equal(blocked.name,'Боец');
});
test('all entry modes gate the first name and preserve intent, code and skin; rapid presses join once',()=>{
 for(const mode of ['quick','private','public','code'] as const){
  const profile=new GameProfile(null),sent:JoinRequest[]=[];profile.select(3);const flow=new JoinFlow(profile,r=>sent.push(r),()=>{});
  flow.request({mode,code:mode==='code'?'ABCDEF':undefined});assert.equal(flow.stage,'name');assert.equal(sent.length,0);
  flow.confirm('!');assert.equal(flow.stage,'name');assert(flow.error);flow.confirm('Лев');assert.equal(flow.stage,'connecting');
  flow.request({mode:'quick'});flow.confirm('Другой');assert.equal(sent.length,1);assert.equal(sent[0].mode,mode);assert.equal(sent[0].name,'Лев');assert.equal(sent[0].skin,3);
  if(mode==='code')assert.equal(sent[0].code,'ABCDEF');
  flow.observe({code:'ABCDEF'},'');assert.equal(flow.stage,'friends');
 }
});
test('confirmed name joins directly; explicit retry uses current profile, timeout aborts once and back preserves invite',()=>{
 const profile=new GameProfile(null);profile.rename('Лев');let now=0,aborts=0;const sent:JoinRequest[]=[];
 const flow=new JoinFlow(profile,r=>sent.push(r),()=>aborts++,()=>now);flow.request({mode:'code',code:'ABCDEF'});
 now=12001;flow.observe(undefined,'');assert.equal(flow.stage,'error');assert.equal(aborts,1);flow.observe(undefined,'');assert.equal(aborts,1);
 profile.rename('Рома');profile.select(4);flow.retry();assert.equal(sent.length,2);assert.equal(sent[1].code,'ABCDEF');assert.equal(sent[1].name,'Рома');assert.equal(sent[1].skin,4);
 flow.observe(undefined,'Комната не найдена');assert.equal(flow.error,'Комната не найдена');assert.equal(flow.stage,'error');flow.back();assert.equal(flow.stage,'friends');assert.equal(flow.intent?.code,'ABCDEF');
});
