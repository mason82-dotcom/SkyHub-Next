'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const {Client}=require('pg');
const {createWpmlRouteService}=require('../wpml-central-routes');
const TARGET=process.env.SKYHUB_TEST_DATABASE_URL;
const A='e3dea0f5-37f2-4d79-ae58-490af3228069';
const B='203cc94c-aef1-4e0e-a520-05a24be33a31';
const USER='69ecb38c-04f2-44d0-adc6-3441cb4f9449';
function plan(speed=5){return {name:'Isolated CI route',model:'matrice4t',speed,
  takeoffHeight:30,finishAction:'goHome',timestamp:1760000000000,
  waypoints:[{lat:49.12345,lon:8.56789,height:50,photo:false},
    {lat:49.12355,lon:8.56799,height:50,photo:false}]};}
test('isolated route transaction CAS, immutable snapshots, workspace boundary and rollback', {
  skip:!TARGET
}, async()=>{
  const uri=new URL(TARGET);
  assert.ok(['localhost','127.0.0.1','[::1]','::1'].includes(uri.hostname));
  assert.equal(decodeURIComponent(uri.pathname),'/skyhub_test');
  assert.ok(['postgres:','postgresql:'].includes(uri.protocol));
  const db=new Client({connectionString:TARGET,connectionTimeoutMillis:5000,
    query_timeout:10000});
  await db.connect();
  const schema='wpml_service_ci_'+crypto.randomBytes(5).toString('hex');
  const quoted='"'+schema+'"';
  let created=false;
  try{
    assert.equal((await db.query('SELECT current_database() AS name')).rows[0].name,
      'skyhub_test');
    await db.query('CREATE SCHEMA '+quoted);created=true;
    await db.query('SET search_path TO '+quoted+',public');
    const sql=fs.readFileSync(path.resolve(__dirname,
      '../db/migrations/003_wpml_route_library_draft.sql'),'utf8');
    await db.query(sql);
    const auditSql=fs.readFileSync(path.resolve(__dirname,
      '../db/migrations/004_wpml_route_audit_draft.sql'),'utf8');
    await db.query(auditSql);
    await db.query(auditSql); // draft remains idempotent in disposable schemas
    const auditSecurity=await db.query(
      "SELECT c.relrowsecurity,c.relforcerowsecurity FROM pg_class c "+
      "JOIN pg_namespace n ON n.oid=c.relnamespace "+
      "WHERE n.nspname=current_schema() AND c.relname='skyhub_wpml_route_audit'");
    assert.equal(auditSecurity.rowCount,1);
    assert.equal(auditSecurity.rows[0].relrowsecurity,true);
    assert.equal(auditSecurity.rows[0].relforcerowsecurity,true);
    const activePolicies=await db.query(
      "SELECT COUNT(*)::int AS n FROM pg_policies "+
      "WHERE schemaname=current_schema() AND tablename='skyhub_wpml_route_audit'");
    assert.equal(activePolicies.rows[0].n,0);
    // Runs only in disposable CI, using the DB administrator to verify SQL
    // transactions and trigger semantics; DOES NOT verify runtime RLS grants.
    const pool={connect:async()=>({query:(...args)=>db.query(...args),
      release(){}})};
    const operator={kind:'human',source:'independent-operator-auth',
      role:'operator',id:USER,workspaceId:A};
    const service=createWpmlRouteService({pool,authorize:async token=>
      token==='isolated-operator-session'?operator:null});
    const common={workspaceId:A,credential:'isolated-operator-session'};
    const createdRoute=await service.createRoute({...common,
      name:'Isolated CI route',plan:plan()});
    assert.equal(createdRoute.revision,1);
    assert.equal(createdRoute.flightReady,false);
    const listed=await service.listRoutes(common);
    assert.equal(listed.length,1);
    assert.equal(listed[0].routeId,createdRoute.routeId);
    assert.equal(listed[0].latestRevision,1);
    const original=await service.readRevision({...common,routeId:createdRoute.routeId,
      revision:1});
    assert.equal(original.plan.waypoints[0].lat,49.12345);
    assert.equal(original.flightReady,false);
    assert.equal(original.dispatchAllowed,false);
    assert.ok(original.previewOnly);
    const changed=await service.appendRevision({...common,routeId:createdRoute.routeId,
      expectedRevision:1,plan:plan(6)});
    assert.equal(changed.revision,2);
    assert.equal(changed.dispatchAllowed,false);
    await assert.rejects(service.appendRevision({...common,
      routeId:createdRoute.routeId,expectedRevision:1,plan:plan(7)}),
      {code:'conflict'});
    await assert.rejects(service.appendRevision({...common,
      routeId:createdRoute.routeId,expectedRevision:2,
      plan:{...plan(7),dispatchAllowed:true}}),{code:'invalid'});
    const versions=await db.query(
      'SELECT revision,flight_ready,dispatch_allowed FROM skyhub_wpml_route_revisions '+
      'WHERE workspace_id=$1 AND route_id=$2 ORDER BY revision',
      [A,createdRoute.routeId]);
    assert.deepEqual(versions.rows.map(r=>Number(r.revision)),[1,2]);
    assert.ok(versions.rows.every(r=>r.flight_ready===false&&
      r.dispatch_allowed===false));
    const auditRows=await db.query(
      'SELECT revision,event_type,actor_id FROM skyhub_wpml_route_audit '+
      'WHERE workspace_id=$1 AND route_id=$2 ORDER BY revision',
      [A,createdRoute.routeId]);
    assert.deepEqual(auditRows.rows.map(r=>r.event_type),
      ['created','revision_appended']);
    assert.deepEqual(auditRows.rows.map(r=>Number(r.revision)),[1,2]);
    assert.ok(auditRows.rows.every(r=>r.actor_id===USER));
    // Audit entries must be non-rewritable even under this privileged
    // disposable test connection.
    await assert.rejects(db.query(
      'DELETE FROM skyhub_wpml_route_audit WHERE workspace_id=$1',
      [A]),{code:'42501'});
    await assert.rejects(db.query('TRUNCATE skyhub_wpml_route_audit'),
      {code:'42501'});

    // Inject a deterministic failure at audit insertion.  The route CAS
    // update and immutable revision insertion must roll back together.
    const badPool={connect:async()=>({
      query:(statement,...args)=>{
        if(typeof statement==='string'&&
           statement.startsWith('INSERT INTO skyhub_wpml_route_audit'))
          throw Error('synthetic audit sink refusal');
        return db.query(statement,...args);
      },
      release(){}
    })};
    const badService=createWpmlRouteService({pool:badPool,
      authorize:async token=>token==='isolated-operator-session'?operator:null});
    await assert.rejects(badService.appendRevision({...common,
      routeId:createdRoute.routeId,expectedRevision:2,plan:plan(7)}),
      {code:'unavailable',message:'WPML route operation unavailable'});
    assert.equal((await db.query(
      'SELECT COUNT(*)::int AS n FROM skyhub_wpml_route_revisions '+
      'WHERE workspace_id=$1 AND route_id=$2',
      [A,createdRoute.routeId])).rows[0].n,2);
    assert.equal((await db.query(
      'SELECT COUNT(*)::int AS n FROM skyhub_wpml_route_audit '+
      'WHERE workspace_id=$1 AND route_id=$2',
      [A,createdRoute.routeId])).rows[0].n,2);

    const latest=await db.query(
      'SELECT latest_revision FROM skyhub_wpml_routes WHERE workspace_id=$1',
      [A]);
    assert.equal(Number(latest.rows[0].latest_revision),2);
    const reread=await service.readRevision({...common,
      routeId:createdRoute.routeId,revision:1});
    assert.equal(reread.plan.speed,5);
    assert.equal((await service.readRevision({...common,
      routeId:createdRoute.routeId,revision:2})).plan.speed,6);
    await assert.rejects(service.listRoutes({...common,workspaceId:B}),
      {code:'unauthorized'});
    await assert.rejects(service.readRevision({...common,routeId:B,revision:1}),
      {code:'not-found'});
    await assert.rejects(db.query(
      'UPDATE skyhub_wpml_route_revisions SET author_id=$1 '+
      'WHERE workspace_id=$2 AND route_id=$3',
      [B,A,createdRoute.routeId]),{code:'42501'});
  }finally{
    try{await db.query('ROLLBACK');}catch{}
    try{await db.query('SET search_path TO public');}catch{}
    if(created)await db.query('DROP SCHEMA '+quoted+' CASCADE');
    await db.end();
  }
});
