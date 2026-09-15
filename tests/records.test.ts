import test from 'node:test';
import assert from 'node:assert/strict';
import { GameStorage } from '../src/storage';
import { BattleRecords, recordSummary } from '../src/records';
const memory = () => {
  const values=new Map<string,string>();let writes=0;
  return {values,get writes(){return writes;},getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{writes++;values.set(k,v);}};
};
const point=(score=100,wave=1,time=10,battleId='ABC123:1',team=['Рома','Лев'])=>({score,wave,time,battleId,team});
test('separate legacy records migrate intact with audio preferences and optional metadata validation',()=>{
  const m=memory();m.setItem('roma-operation-67-v1',JSON.stringify({record:{score:650,wave:3,time:66},muted:true}));
  m.setItem('roma-online-v1',JSON.stringify({record:{score:2500,wave:6,time:220}}));
  const solo=new GameStorage(m),online=new GameStorage(m,'roma-online-v1');
  assert.deepEqual(solo.record,{score:650,wave:3,time:66});assert.equal(online.record.score,2500);assert(solo.muted&&solo.musicMuted&&solo.narratorMuted);
  online.submit(point(2600,6,230));assert.equal(new GameStorage(m).record.score,650);assert.deepEqual(new GameStorage(m,'roma-online-v1').record.team,['Рома','Лев']);
  assert.equal(recordSummary(new GameStorage(null).record),'Пока нет');assert.match(recordSummary(online.record),/волна 6/);
});
test('score wins, wave breaks a tie, a tied different battle cannot claim the record',()=>{
  const storage=new GameStorage(null);storage.submit(point(1000,3));
  assert(!storage.submit(point(900,50,100,'different')));assert(!storage.submit(point(1000,3,100,'different')));
  assert.equal(storage.record.battleId,'ABC123:1');assert(storage.submit(point(1000,4,100,'different')));
  assert(storage.submit(point(1100,1,101,'third')));assert.equal(storage.record.wave,1);
  assert(!storage.submit(point(NaN)));assert(!storage.submit(point(Infinity)));assert(!storage.submit(point(-1)));
});
test('live checkpoints preserve the celebration through final results and reload, without writing every frame',()=>{
  const m=memory(),storage=new GameStorage(m),records=new BattleRecords(storage);
  records.observe(point(0,0,0),'menu');records.observe(point(0,1,0),'intro');assert.equal(m.writes,0);
  records.observe(point(100),'playing');assert(records.isRecord);const writes=m.writes;
  for(let frame=0;frame<120;frame++)records.observe(point(100,1,10+frame/60),'playing');
  assert.equal(m.writes,writes);records.flush();assert.equal(m.writes,writes+1);assert(storage.record.time>11);
  const restored=new BattleRecords(new GameStorage(m));restored.observe(point(100,1,12),'playing');assert(restored.isRecord);
  restored.observe(point(300,2,30),'over');assert(restored.isRecord);assert.equal(new GameStorage(m).record.score,300);
  const finalWrites=m.writes;for(let n=0;n<30;n++)restored.observe(point(300,2,30),'over');assert.equal(m.writes,finalWrites);
  restored.observe(point(0,1,0,'ABC123:2'),'playing');assert(!restored.isRecord);
  restored.observe(point(300,2,30,'ABC123:2'),'over');assert(!restored.isRecord);
  restored.observe(point(300,3,40,'ABC123:2'),'over');assert(restored.isRecord);
});
test('background, exit and next run flush last confirmed time; stale result cannot change metadata',()=>{
  const m=memory(),r=new BattleRecords(new GameStorage(m));
  r.observe(point(100,2,20),'playing');r.observe(point(100,2,24),'playing');r.flush();
  assert.equal(new GameStorage(m).record.time,24);
  r.observe(point(9999,9,5),'playing');r.observe(point(0,1,25),'playing');assert.equal(r.storage.record.score,100);
  r.observe(point(100,2,26,'ABC123:1',['Рома','Новый друг']),'playing');assert.deepEqual(r.storage.record.team,['Рома','Новый друг']);
  r.observe(point(100,2,28),'playing');r.observe(point(0,1,0,'next'),'playing');assert.equal(new GameStorage(m).record.time,28);assert(!r.isRecord);
});
test('unavailable and malformed storage remain playable; two record categories never merge',()=>{
  const broken={getItem(){throw Error();},setItem(){throw Error();}};
  const s=new GameStorage(broken),r=new BattleRecords(s);r.observe(point(650,2,30),'over');assert.equal(s.record.score,650);assert(r.isRecord);
  const m=memory();m.setItem('roma-operation-67-v1','{oops');assert.equal(new GameStorage(m).record.score,0);
  m.setItem('roma-operation-67-v1',JSON.stringify({record:{score:-20,wave:2,time:2}}));assert.equal(new GameStorage(m).record.score,0);
});
