'use strict';

// Opt-in integration, commits ONLY into unique schema of the dedicated local
// skyhub_test database, then reconnects and drops test schema at the end.
// No Pi DB connection, no DJI broker, no real device identifiers.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {Client}=require('pg');
const {createFlighttaskJournal}=require('../dji-flighttask-durable-journal');

const url=process.env.SKYHUB_TEST_DATABASE_URL;
const now=1792518001000;
const workspace='33333333-4444-4555-8666-777777777777';
const observation='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const key={workspaceId:workspace,observationId:observation};
const request={
  gatewaySn:'SYNTHETIC_GATEWAY',tid:'11111111-2222-4333-8444-555555555555',
  bid:'66666666-7777-4888-8999-000000000000',
  flightId:'SYNTHETIC_FLIGHT',method:'flighttask_execute',sentAt:now-10000
};
const service=JSON.stringify({
  tid:request.tid,bid:request.bid,gateway:request.gatewaySn,
  timestamp:now-8000,method:'flighttask_execute',data:{result:0}
});
const event=JSON.stringify({
  tid:'EVENT-OTHER',bid:'EVENT-BID',timestamp:now-3000,
  gateway:request.gatewaySn,method:'flighttask_progress',need_reply:1,
  data:{result:0,output:{
    status:'ok',ext:{flight_id:request.flightId,
      break_point:{latitude:49.1,longitude:8.4}},
    progress:{percent:100},device_secret:'PRIVATE_NEVER_STORE'}}
});
function guardDatabase(raw){
  const parsed=new URL(raw);
  assert.ok(['127.0.0.1','localhost','::1','[::1]'].includes(parsed.hostname),
    'Only isolated loopback PostgreSQL is permitted');
  assert.equal(decodeURIComponent(parsed.pathname),'/skyhub_test');
  assert.ok(['postgres:','postgresql:'].includes(parsed.protocol));
}
async function open(schema){
  const c=new Client({connectionString:url,connectionTimeoutMillis:5000,
    query_timeout:10000,application_name:'skyhub_synthetic_dji_journal_ci'});
  await c.connect();
  assert.equal((await c.query('SELECT current_database() AS db')).rows[0].db,'skyhub_test');
  if(schema)await c.query('SET search_path TO "'+schema+'",public');
  return c;
}
test('real PostgreSQL CAS journal survives reconnect with no replay and no raw payload',
  {skip:!url},async()=>{
  guardDatabase(url);
  const schema='dji_journal_ci_'+crypto.randomBytes(7).toString('hex');
  let c;
  let created=false;
  try{
    c=await open();
    await c.query('CREATE SCHEMA "'+schema+'"');
    created=true;
    await c.query('SET search_path TO "'+schema+'",public');
    const sql=fs.readFileSync(path.join(__dirname,
      '../db/offline/dji-flighttask-observation.sql'),'utf8');
    await c.query(sql);
    await c.query(sql); // idempotent offline schema.
    const journal=createFlighttaskJournal(c);
    const first=await journal.start({...key,request});
    assert.equal(first.created,true);
    assert.equal(first.revision,1);
    const ack=await journal.apply(key,'service_reply',{
      topic:'thing/product/SYNTHETIC_GATEWAY/services_reply',payload:service,now});
    assert.equal(ack.applied,true);
    assert.equal(ack.state.phase,'reply_accepted');
    assert.equal(ack.revision,2);
    await c.end();
    c=null;

    // A separate PostgreSQL connection sees committed state.
    c=await open(schema);
    const reloaded=createFlighttaskJournal(c);
    const recovered=await reloaded.read(key);
    assert.equal(recovered.revision,2);
    assert.equal(recovered.state.phase,'reply_accepted');
    assert.equal((await reloaded.start({...key,request})).created,false);
    const duplicate=await reloaded.apply(key,'service_reply',{
      topic:'thing/product/SYNTHETIC_GATEWAY/services_reply',payload:service,now});
    assert.equal(duplicate.applied,false);
    assert.equal(duplicate.revision,2);
    const done=await reloaded.apply(key,'flighttask_progress',{
      topic:'thing/product/SYNTHETIC_GATEWAY/events',payload:event,now});
    assert.equal(done.state.phase,'reported_ok');
    assert.equal(done.revision,3);
    const duplicateEvent=await reloaded.apply(key,'flighttask_progress',{
      topic:'thing/product/SYNTHETIC_GATEWAY/events',payload:event,now});
    assert.equal(duplicateEvent.applied,false);
    assert.equal(duplicateEvent.revision,3);
    const staleCAS=await c.query(
      'UPDATE dji_flighttask_observation_snapshots SET revision=revision+1 '+
      'WHERE workspace_id=$1 AND observation_id=$2 AND revision=1 RETURNING revision',
      [workspace,observation]);
    assert.equal(staleCAS.rowCount,0);
    const stored=await c.query(
      'SELECT revision,snapshot FROM dji_flighttask_observation_snapshots '+
      'WHERE workspace_id=$1 AND observation_id=$2',[workspace,observation]);
    assert.equal(Number(stored.rows[0].revision),3);
    const snapshotText=JSON.stringify(stored.rows[0].snapshot);
    assert.doesNotMatch(snapshotText,/PRIVATE_NEVER_STORE|latitude|longitude|break_point|percent/);
    const summary=await reloaded.summary(key);
    assert.equal(summary.missionReportedComplete,true);
    assert.equal(summary.operationVerified,false);
    assert.equal(summary.hardwareVerified,false);
    assert.equal(summary.flightReady,false);
    assert.doesNotMatch(JSON.stringify(summary),/SYNTHETIC_GATEWAY|SYNTHETIC_FLIGHT/);
    assert.equal(await reloaded.read({
      workspaceId:'99999999-8888-4777-8666-555555555555',observationId:observation
    }),null);

    // Schema exists ONLY in the isolated CI test DB. No production migrations.
  }finally{
    try{
      if(c){await c.end();c=null;}
      if(created){
        const cleanup=await open();
        try{await cleanup.query('DROP SCHEMA IF EXISTS "'+schema+'" CASCADE');}
        finally{await cleanup.end();}
      }
    }catch(e){throw new Error('Isolated DJI journal test cleanup failed');}
  }
});
