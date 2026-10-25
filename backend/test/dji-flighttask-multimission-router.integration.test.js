'use strict';
// Opt-in *real* PostgreSQL test. No production schema or DJI broker is touched.
// The test creates a unique schema only within loopback skyhub_test and drops it.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {Client}=require('pg');
const {createFlighttaskJournal}=require('../dji-flighttask-durable-journal');
const {createScopedFlighttaskJournal}=require('../dji-flighttask-journal-access');
const {createFlighttaskMessageRouter}=require('../dji-flighttask-multimission-router');

const url=process.env.SKYHUB_TEST_DATABASE_URL;
const now=1792518001000;
const A='11111111-2222-4333-8444-555555555555';
const B='99999999-8888-4777-8666-555555555555';
const O1='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const O2='cccccccc-dddd-4eee-8fff-aaaaaaaaaaaa';
const O3='44444444-3333-4222-8111-777777777777';
const t1='66666666-7777-4888-8999-000000000000';
const t2='44444444-3333-4222-8111-999999999999';
const bid='33333333-4444-4555-8666-777777777777';
const gatewaySn='SYNTHETIC_RC';
const actorA={id:'synthetic-operator-a',role:'operator',workspaceId:A};
const actorB={id:'synthetic-operator-b',role:'operator',workspaceId:B};
const req=(tid=t1)=>({
  gatewaySn,tid,bid,flightId:'SYNTHETIC_FLIGHT',
  method:'flighttask_execute',sentAt:now-10000
});
const topicReply='thing/product/SYNTHETIC_RC/services_reply';
const topicEvent='thing/product/SYNTHETIC_RC/events';
const reply=()=>JSON.stringify({gateway:gatewaySn,
  method:'flighttask_execute',tid:t1,bid,timestamp:now-6000,data:{result:0}});
const progress=()=>JSON.stringify({gateway:gatewaySn,
  method:'flighttask_progress',timestamp:now-2000,tid:'independent-event',bid:'independent-event-bid',
  need_reply:1,data:{result:0,output:{
    status:'ok',ext:{flight_id:'SYNTHETIC_FLIGHT',
      break_point:{latitude:49.1,longitude:8.4}},
    secret:'PRIVATE_DO_NOT_STORE'}}});
function guard(raw){
  const t=new URL(raw);
  assert.ok(['127.0.0.1','localhost','::1','[::1]'].includes(t.hostname));
  assert.equal(t.pathname,'/skyhub_test');
  assert.ok(['postgres:','postgresql:'].includes(t.protocol));
}
async function connect(schema){
  const c=new Client({connectionString:url,connectionTimeoutMillis:5000,
    query_timeout:10000,application_name:'skyhub_synthetic_multimission_ci'});
  await c.connect();
  assert.equal((await c.query('SELECT current_database() AS db')).rows[0].db,'skyhub_test');
  if(schema)await c.query('SET search_path TO "'+schema+'",public');
  return c;
}
function create(db){
  const authorize=async(p,w,action)=>
    (p===actorA&&w===A||p===actorB&&w===B)&&
    ['create','observe','read_internal','summary','route_observation'].includes(action);
  const journal=createFlighttaskJournal(db);
  const scoped=createScopedFlighttaskJournal(journal,{authorize});
  return {journal,scoped,router:createFlighttaskMessageRouter(db,scoped,{authorize})};
}
const frame=(workspaceId,principal,kind,payload)=>({
  workspaceId,principal,kind,now,
  topic:kind==='service_reply'?topicReply:topicEvent,payload
});

test('real PostgreSQL: concurrent workspaces, duplicate replay and ambiguous flight ID fail closed',
  {skip:!url},async()=>{
  guard(url);
  const schema='dji_router_ci_'+crypto.randomBytes(8).toString('hex');
  let c,created=false;
  try{
    c=await connect();
    await c.query('CREATE SCHEMA "'+schema+'"');
    created=true;
    await c.query('SET search_path TO "'+schema+'",public');
    await c.query(fs.readFileSync(path.resolve(__dirname,
      '../db/offline/dji-flighttask-observation.sql'),'utf8'));
    const {scoped,router}=create(c);
    assert.equal((await scoped.start({
      workspaceId:A,observationId:O1,principal:actorA,request:req()
    })).revision,1);
    assert.equal((await scoped.start({
      workspaceId:B,observationId:O2,principal:actorB,request:req()
    })).revision,1);
    const ack=await router.route(frame(A,actorA,'service_reply',reply()));
    assert.equal(ack.applied,true);
    assert.equal(ack.revision,2);
    assert.equal((await scoped.read({
      workspaceId:A,observationId:O1,principal:actorA
    })).state.phase,'reply_accepted');
    assert.equal((await scoped.read({
      workspaceId:B,observationId:O2,principal:actorB
    })).state.phase,'awaiting_reply');
    await c.end();c=null;

    // New connection & new journal objects must not cause a duplicate ACK.
    c=await connect(schema);
    const again=create(c);
    const duplicate=await again.router.route(frame(A,actorA,'service_reply',reply()));
    assert.equal(duplicate.applied,false);
    assert.equal(duplicate.reason,'duplicate-reply');
    assert.equal(duplicate.revision,2);
    const completed=await again.router.route(frame(A,actorA,'flighttask_progress',progress()));
    assert.equal(completed.applied,true);
    assert.equal(completed.revision,3);
    assert.equal((await again.scoped.summary({
      workspaceId:A,observationId:O1,principal:actorA
    })).missionReportedComplete,true);
    assert.equal((await again.scoped.summary({
      workspaceId:B,observationId:O2,principal:actorB
    })).missionReportedComplete,false);

    // A second concurrent flight_id with another tid is ambiguous for events.
    await again.scoped.start({
      workspaceId:A,observationId:O3,principal:actorA,request:req(t2)
    });
    const ambiguous=await again.router.route(frame(A,actorA,'flighttask_progress',progress()));
    assert.deepEqual(ambiguous,{
      matched:false,applied:false,reason:'ambiguous-observation'
    });
    const notAdvanced=await again.scoped.read({
      workspaceId:A,observationId:O3,principal:actorA
    });
    assert.equal(notAdvanced.revision,1);
    assert.equal(notAdvanced.state.phase,'awaiting_reply');
    const counts=await c.query(
      'SELECT workspace_id,COUNT(*)::integer AS n FROM dji_flighttask_observation_snapshots '+
      'GROUP BY workspace_id ORDER BY workspace_id');
    assert.deepEqual(counts.rows.map(x=>x.n).sort(),[1,2]);
    const all=await c.query('SELECT snapshot FROM dji_flighttask_observation_snapshots');
    assert.doesNotMatch(JSON.stringify(all.rows),/PRIVATE_DO_NOT_STORE|latitude|longitude|break_point/);
    assert.equal((await again.scoped.summary({
      workspaceId:A,observationId:O1,principal:actorA
    })).flightReady,false);
  }finally{
    if(c)await c.end();
    if(created){
      const cleanup=await connect();
      try{await cleanup.query('DROP SCHEMA IF EXISTS "'+schema+'" CASCADE');}
      finally{await cleanup.end();}
    }
  }
});
