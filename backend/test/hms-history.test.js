'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {normalize,transitions,createHmsHistory,MAX_EVENTS}=require('../hms-history');
const a=(code,level=2,componentIndex=0,sensorIndex=0)=>({code,level,componentIndex,sensorIndex});
test('P1 reconciles appearance, severity updates and resolution, not periodic duplicates',()=>{
  const first=a('0x16100066'),changed=a('0x16100066',1);
  assert.deepEqual(transitions([],[]),[]);
  assert.deepEqual(transitions([], [first]).map(x=>x.action),['appeared']);
  assert.deepEqual(transitions([first],[{...first}]),[]);
  assert.deepEqual(transitions([first],[changed]).map(x=>x.action),['updated']);
  assert.deepEqual(transitions([changed],[]).map(x=>x.action),['resolved']);
  assert.equal(MAX_EVENTS,3000);
});
test('P1 rejects ambiguous, malformed and oversized HMS lists',()=>{
  const one=a('0x16100066');
  assert.throws(()=>normalize([one,one]),/Ambiguous/);
  assert.throws(()=>normalize(Array(21).fill(one)),/Invalid/);
  assert.throws(()=>normalize([{...one,code:'0xDEADBEEF\u000a'}]),/Invalid/);
  assert.throws(()=>normalize([{...one,level:9}]),/Invalid/);
});
test('P1 DB transaction serializes device snapshots and does not write periodic repeats',async()=>{
  const log=[];
  const client={async query(sql,params=[]){
    log.push({sql,params});
    if(sql.startsWith('SELECT code,level'))return {rows:[]};
    return {rows:[]};
  },release(){}};
  const pool={async connect(){return client;},async query(){return {rows:[]};}};
  const store=createHmsHistory(pool);
  assert.equal(await store.observe('AIR01',[a('0x16100066')],1790000000000,true),1);
  assert.ok(log.some(q=>q.sql.includes('pg_advisory_xact_lock')));
  assert.ok(log.some(q=>q.sql.startsWith('INSERT INTO skyhub_hms_transitions')));
  assert.deepEqual(await store.list(null,25,0),[]);
  await assert.rejects(store.observe('bad/slash',[],1790000000000,true));
  await assert.rejects(store.list(null,1000,0));
});
