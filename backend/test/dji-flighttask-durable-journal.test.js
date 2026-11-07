'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createFlighttaskJournal,validateSnapshot}=require('../dji-flighttask-durable-journal');
const {summarizeFlighttaskObservation}=require('../dji-flighttask-observation');
const now=1792518001000;
const key={
  workspaceId:'33333333-4444-4555-8666-777777777777',
  observationId:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
};
const req={
  gatewaySn:'SYNTHETIC_RC',tid:'11111111-2222-4333-8444-555555555555',
  bid:'66666666-7777-4888-8999-000000000000',
  flightId:'SYNTHETIC_FLIGHT',method:'flighttask_execute',sentAt:now-10000
};
const serviceTopic='thing/product/SYNTHETIC_RC/services_reply';
const eventTopic='thing/product/SYNTHETIC_RC/events';
const service=()=>JSON.stringify({
  tid:req.tid,bid:req.bid,gateway:req.gatewaySn,timestamp:now-8000,
  method:req.method,data:{result:0}
});
const progress=(status='ok',ts=now-3000)=>JSON.stringify({
  tid:'EVENT_SYNTHETIC',bid:'EVENT_SYNTHETIC2',gateway:req.gatewaySn,
  timestamp:ts,method:'flighttask_progress',need_reply:1,
  data:{result:0,output:{
    status,ext:{flight_id:req.flightId,
      break_point:{latitude:49.1,longitude:8.4}},
    progress:{percent:100},device_secret:'PRIVATE_SYNTHETIC'}}
});

function jsonb(x){
  if(Array.isArray(x))return x.map(jsonb);
  if(x&&typeof x==='object')
    return Object.fromEntries(Object.keys(x).sort().map(k=>[k,jsonb(x[k])]));
  return x;
}
function fakePg(){
  const rows=new Map();let conflicts=0,broken=false;
  return {
    rows,
    failNextUpdate(){conflicts++;},
    disable(){broken=true;},
    async query(sql,params){
      if(broken)throw new Error('DATABASE_SECRET_URL');
      const dbKey=String(params?.[0])+':'+String(params?.[1]);
      if(sql.startsWith('SELECT revision,snapshot')){
        const stored=rows.get(dbKey);
        return {rows:stored?[{revision:String(stored.revision),snapshot:jsonb(stored.snapshot)}]:[]};
      }
      if(sql.startsWith('INSERT INTO dji_flighttask_observation_snapshots')){
        if(rows.has(dbKey))return {rows:[]};
        rows.set(dbKey,{revision:1,snapshot:jsonb(JSON.parse(params[2]))});
        return {rows:[{revision:'1'}]};
      }
      if(sql.startsWith('UPDATE dji_flighttask_observation_snapshots')){
        if(conflicts>0){conflicts--;return {rows:[]};}
        const current=rows.get(dbKey);
        if(!current||current.revision!==params[2])return {rows:[]};
        rows.set(dbKey,{revision:current.revision+1,snapshot:jsonb(JSON.parse(params[3]))});
        return {rows:[{revision:String(current.revision+1)}]};
      }
      throw new Error('Unexpected fake SQL');
    }
  };
}
function fixture(){const db=fakePg();return {db,j:createFlighttaskJournal(db)};}
const start=(j,request=req,k=key)=>j.start({...k,request});
const apply=(j,kind,payload,k=key,at=now)=>j.apply(k,kind,{
  now:at,topic:kind==='service_reply'?serviceTopic:eventTopic,payload
});

test('durably restores synthetic request after simulated process restart; JSONB key order independent',async()=>{
  const {db,j}=fixture();
  const created=await start(j);
  assert.equal(created.created,true);
  assert.equal(created.revision,1);
  assert.equal(created.state.phase,'awaiting_reply');
  const restarted=createFlighttaskJournal(db);
  const again=await start(restarted);
  assert.equal(again.created,false);
  assert.equal(again.revision,1);
  const restored=await restarted.read(key);
  assert.equal(restored.state.request.flightId,req.flightId);
  assert.equal(Object.isFrozen(restored.state),true);
  assert.equal(summarizeFlighttaskObservation(restored.state).flightReady,false);
});

test('after restart, service ACK remains distinct from completion until correlated event',async()=>{
  const {db,j}=fixture();await start(j);
  const ack=await apply(j,'service_reply',service());
  assert.equal(ack.applied,true);
  assert.equal(ack.revision,2);
  assert.equal(ack.state.phase,'reply_accepted');
  const restarted=createFlighttaskJournal(db);
  const loaded=await restarted.read(key);
  assert.equal(loaded.state.phase,'reply_accepted');
  assert.equal(summarizeFlighttaskObservation(loaded.state).missionReportedComplete,false);
  const done=await apply(restarted,'flighttask_progress',progress());
  assert.equal(done.applied,true);
  assert.equal(done.revision,3);
  assert.equal(done.state.phase,'reported_ok');
  assert.equal((await restarted.summary(key)).operationVerified,false);
});

test('replayed service and progress after crash are idempotent and do not increment revision',async()=>{
  const {db,j}=fixture();await start(j);
  await apply(j,'service_reply',service());
  const newProcess=createFlighttaskJournal(db);
  const replayAck=await apply(newProcess,'service_reply',service());
  assert.equal(replayAck.applied,false);
  assert.equal(replayAck.reason,'duplicate-reply');
  assert.equal(replayAck.revision,2);
  await apply(newProcess,'flighttask_progress',progress());
  const restartAgain=createFlighttaskJournal(db);
  const replayEvent=await apply(restartAgain,'flighttask_progress',progress());
  assert.equal(replayEvent.applied,false);
  assert.equal(replayEvent.reason,'duplicate-event');
  assert.equal(replayEvent.revision,3);
});

test('CAS collisions retry against fresh stored snapshots, never overwrite another revision',async()=>{
  const {db,j}=fixture();await start(j);
  db.failNextUpdate();
  const updated=await apply(j,'service_reply',service());
  assert.equal(updated.applied,true);
  assert.equal(updated.revision,2);
  assert.equal((await j.read(key)).state.phase,'reply_accepted');
});

test('workspace and observation IDs form the composite key; no cross-workspace reads',async()=>{
  const {j}=fixture();await start(j);
  const other={...key,workspaceId:'99999999-8888-4777-8666-555555555555'};
  assert.equal(await j.read(other),null);
  await start(j,{...req,flightId:'SYNTHETIC_SECOND'},other);
  assert.equal((await j.read(other)).state.request.flightId,'SYNTHETIC_SECOND');
  assert.equal((await j.read(key)).state.request.flightId,req.flightId);
});

test('different request with same workspace/observation key is a collision, not replacement',async()=>{
  const {j}=fixture();await start(j);
  await assert.rejects(start(j,{...req,flightId:'OTHER_FLIGHT'}),/identity collision/);
  assert.equal((await j.read(key)).revision,1);
});

test('a reboot past TTL transitions to unknown, never failed flight or confirmed state',async()=>{
  const {db,j}=fixture();await start(j);
  await apply(j,'service_reply',service());
  const restarted=createFlighttaskJournal(db);
  const recovered=await restarted.recover(key,{now:req.sentAt+900001});
  assert.equal(recovered.recovered,true);
  assert.equal(recovered.applied,true);
  assert.equal(recovered.state.phase,'expired_unverified');
  assert.equal(recovered.summary.missionReportedComplete,false);
  assert.equal(recovered.summary.hardwareVerified,false);
  assert.equal(recovered.summary.flightReady,false);
  assert.equal(recovered.revision,3);
});

test('restoring an already terminal reported result cannot inflate freshness',async()=>{
  const {db,j}=fixture();await start(j);
  await apply(j,'service_reply',service());
  await apply(j,'flighttask_progress',progress());
  const recovered=await createFlighttaskJournal(db).recover(key,{now:req.sentAt+900001});
  assert.equal(recovered.applied,false);
  assert.equal(recovered.reason,'terminal-report-recorded');
  assert.equal(recovered.summary.operationVerified,false);
  assert.equal(recovered.summary.missionReportedComplete,true);
  assert.equal(recovered.summary.flightReady,false);
});

test('tampered stored snapshot, unexpected keys and forged readiness fail closed',async()=>{
  const {db,j}=fixture();await start(j);
  const entry=[...db.rows.values()][0];
  const bad=JSON.parse(JSON.stringify(entry.snapshot));
  bad.flightReady=true;
  assert.equal(validateSnapshot(bad),false);
  entry.snapshot=bad;
  await assert.rejects(j.read(key),/stored snapshot invalid/);
  await assert.rejects(j.recover(key,{now}),/stored snapshot invalid/);
  bad.flightReady=false;bad.device_secret='PRIVATE_SYNTHETIC';
  assert.equal(validateSnapshot(bad),false);
});

test('invalid keys, missing observation and storage failures are redacted',async()=>{
  const {db,j}=fixture();
  await assert.rejects(j.read({...key,workspaceId:'../../etc'}),/Invalid flighttask journal key/);
  await assert.rejects(j.apply(key,'unknown',{now}),/Unsupported/);
  await assert.rejects(j.apply(key,'clock',{now}),/observation absent/);
  await start(j);
  db.disable();
  await assert.rejects(j.read(key),err=>{
    assert.equal(err.message,'Flighttask journal storage unavailable');
    assert.doesNotMatch(err.message,/SECRET_URL/);
    return true;
  });
});

test('journal never stores the raw service/event message or GPS in its snapshot',async()=>{
  const {db,j}=fixture();await start(j);
  await apply(j,'service_reply',service());
  await apply(j,'flighttask_progress',progress());
  const databaseData=JSON.stringify([...db.rows.values()]);
  assert.doesNotMatch(databaseData,/latitude|longitude|break_point|device_secret|PRIVATE_SYNTHETIC/);
  const status=JSON.stringify(await j.summary(key));
  assert.doesNotMatch(status,/SYNTHETIC_RC|SYNTHETIC_FLIGHT|11111111|66666666/);
});

test('duplicate or invalid input never mutates durable snapshot revision',async()=>{
  const {j}=fixture();await start(j);
  const first=await apply(j,'flighttask_progress',progress());
  assert.equal(first.applied,false);
  assert.equal((await j.read(key)).revision,1);
  const second=await apply(j,'service_reply','{broken json');
  assert.equal(second.applied,false);
  assert.equal((await j.read(key)).revision,1);
  await assert.rejects(j.apply(key,'clock',{now:NaN}),/Invalid flighttask journal clock/);
});


test('JSONB snapshots reject array-coerced IDs instead of treating them as strings',async()=>{
  const {db,j}=fixture();await start(j);
  const entry=[...db.rows.values()][0];
  const original=JSON.parse(JSON.stringify(entry.snapshot));
  const samples=[
    ['gatewaySn',[req.gatewaySn]],['tid',[req.tid]],
    ['bid',[req.bid]],['flightId',[req.flightId]],
    ['gatewaySn',{toString:req.gatewaySn}],['tid',null],['bid',42]
  ];
  for(const [field,value] of samples){
    entry.snapshot=JSON.parse(JSON.stringify(original));
    entry.snapshot.request[field]=value;
    assert.equal(validateSnapshot(entry.snapshot),false,field);
    await assert.rejects(j.read(key),/stored snapshot invalid/,field);
  }
  entry.snapshot=original;
  assert.equal((await j.read(key)).revision,1);
});

test('restored ACK and progress times must be within request temporal window',async()=>{
  const {db,j}=fixture();await start(j);
  await apply(j,'service_reply',service());
  await apply(j,'flighttask_progress',progress());
  const entry=[...db.rows.values()][0];
  const original=JSON.parse(JSON.stringify(entry.snapshot));
  for(const [field,value] of [
    ['reply',req.sentAt-1],
    ['reply',original.request.expiresAt+30001],
    ['progress',req.sentAt-1],
    ['progress',original.request.expiresAt+30001]
  ]){
    entry.snapshot=JSON.parse(JSON.stringify(original));
    entry.snapshot[field].timestamp=value;
    assert.equal(validateSnapshot(entry.snapshot),false,field);
    await assert.rejects(j.read(key),/stored snapshot invalid/,field);
  }
  entry.snapshot=original;
  assert.equal((await j.read(key)).revision,3);
});

test('malformed SELECT responses fail closed with one fixed diagnostic',async()=>{
  for(const response of [null,{}, {rows:null},{rows:{}},
    {rows:[{},{}]}, {rows:[] ,rowCount:999,secret:'PRIVATE'}]){
    const db={query:async()=>response};
    const j=createFlighttaskJournal(db);
    if(response?.rows?.length===0){
      assert.equal(await j.read(key),null);
    }else{
      await assert.rejects(j.read(key),err=>{
        assert.equal(err.message,'Flighttask journal invalid storage response');
        return true;
      });
    }
  }
});

test('corrupted or noncanonical PostgreSQL revisions cannot be restored',async()=>{
  const {db,j}=fixture();await start(j);
  const entry=[...db.rows.values()][0];
  for(const v of ['01','1.0','1e0','-1','0','9007199254740992','SECRET',NaN,0,-1]){
    entry.revision=v;
    await assert.rejects(j.read(key),/stored snapshot invalid/,String(v));
  }
  entry.revision=1;
  assert.equal((await j.read(key)).revision,1);
});

test('INSERT without canonical revision 1 is never reported as created',async()=>{
  for(const rows of [null,{},[{revision:'2'}],[{revision:'01'}],[{}],
    [{revision:'1'},{revision:'1'}]]){
    const j=createFlighttaskJournal({query:async()=>({rows})});
    await assert.rejects(start(j),/invalid storage response/);
  }
});

test('CAS UPDATE revision must advance by exactly one',async()=>{
  for(const rows of [null,{},[{revision:'3'}],[{revision:'01'}],[{}],
    [{revision:'2'},{revision:'2'}]]){
    const db=fakePg();
    const j=createFlighttaskJournal({
      query:async(sql,params)=>{
        if(sql.startsWith('UPDATE dji_flighttask_observation_snapshots'))
          return {rows};
        return db.query(sql,params);
      }
    });
    await start(j);
    await assert.rejects(apply(j,'service_reply',service()),/invalid storage response/);
    assert.equal((await j.read(key)).revision,1);
    assert.equal((await j.read(key)).state.phase,'awaiting_reply');
  }
});
