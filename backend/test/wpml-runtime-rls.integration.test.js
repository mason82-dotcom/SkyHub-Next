'use strict';
/* CI-ONLY (ADR-001): applies 003+004+005 to a disposable schema in the localhost skyhub_test database, provisions two
 * workspace roles and drives the real route service as the non-superuser login role skyhub_wpml_app with
 * workspaceRoles:true. Never run against a production database: the target must be localhost/skyhub_test. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const {Client,Pool}=require('pg');
const {createWpmlRouteService,RouteError}=require('../wpml-central-routes');

const TARGET=process.env.SKYHUB_TEST_DATABASE_URL;
const A='e3dea0f5-37f2-4d79-ae58-490af3228069';
const B='203cc94c-aef1-4e0e-a520-05a24be33a31';
const HUMAN='69ecb38c-04f2-44d0-adc6-3441cb4f9449';
const ROLE_A='skyhub_wpml_ws_e3dea0f537f24d79ae58490af3228069';
const ROLE_B='skyhub_wpml_ws_203cc94caef14e0ea52005a24be33a31';
const plan=()=>({name:'RLS probe',model:'matrice4t',speed:5,takeoffHeight:30,finishAction:'goHome',
  waypoints:[{lat:49.1,lon:8.5,height:50,photo:false},{lat:49.2,lon:8.6,height:50,photo:false}]});

function safeTarget(raw){
  const u=new URL(raw);
  assert.ok(['localhost','127.0.0.1','[::1]','::1'].includes(u.hostname),'RLS test is restricted to localhost');
  assert.equal(decodeURIComponent(u.pathname),'/skyhub_test');
  return u;
}

test('ADR-001 runtime role: workspace roles isolate routes, the app role alone sees nothing', {
  skip:!TARGET,timeout:60000
},async()=>{
  const url=safeTarget(TARGET);
  const admin=new Client({connectionString:TARGET,connectionTimeoutMillis:5000,query_timeout:10000});
  await admin.connect();
  const schema='wpml_runtime_ci_'+crypto.randomBytes(5).toString('hex');
  const password=crypto.randomBytes(24).toString('hex');
  let pool;
  try{
    const su=await admin.query("SELECT current_database() AS db, current_setting('is_superuser') AS su");
    assert.equal(su.rows[0].db,'skyhub_test');
    assert.equal(su.rows[0].su,'on');
    await admin.query('CREATE SCHEMA "'+schema+'"');
    await admin.query('SET search_path TO "'+schema+'"');
    for(const file of ['003_wpml_route_library_draft.sql','004_wpml_route_audit_draft.sql',
      '005_wpml_runtime_rls_draft.sql'])
      await admin.query(fs.readFileSync(path.join(__dirname,'../db/migrations',file),'utf8'));
    // Idempotent: a second run must not fail.
    await admin.query(fs.readFileSync(path.join(__dirname,'../db/migrations/005_wpml_runtime_rls_draft.sql'),'utf8'));
    for(const ws of [A,B])await admin.query('SELECT skyhub_wpml_provision_workspace($1)',[ws]);
    await admin.query('GRANT USAGE ON SCHEMA "'+schema+'" TO skyhub_wpml_workspace');
    await admin.query("ALTER ROLE skyhub_wpml_app LOGIN PASSWORD '"+password+"'");

    const attrs=await admin.query("SELECT rolname,rolsuper,rolbypassrls,rolinherit,rolcanlogin FROM pg_roles "+
      "WHERE rolname IN ('skyhub_wpml_app','skyhub_wpml_workspace',$1,$2) ORDER BY rolname",[ROLE_A,ROLE_B]);
    for(const r of attrs.rows){assert.equal(r.rolsuper,false,r.rolname);assert.equal(r.rolbypassrls,false,r.rolname);}
    assert.equal(attrs.rows.find(r=>r.rolname==='skyhub_wpml_app').rolinherit,false);

    const appUrl=new URL(url.href);appUrl.username='skyhub_wpml_app';appUrl.password=password;
    pool=new Pool({connectionString:appUrl.href,max:2,options:'-c search_path="'+schema+'"'});
    const asActor=ws=>({kind:'human',source:'independent-operator-auth',role:'operator',id:HUMAN,workspaceId:ws});
    const service=ws=>createWpmlRouteService({pool,authorize:async()=>asActor(ws),workspaceRoles:true});

    const created=await service(A).createRoute({credential:'x',workspaceId:A,name:'Route A',plan:plan()});
    await service(A).appendRevision({credential:'x',workspaceId:A,routeId:created.routeId,
      expectedRevision:1,plan:plan()});
    const listA=await service(A).listRoutes({credential:'x',workspaceId:A});
    assert.deepEqual(listA.map(r=>[r.routeId,r.latestRevision]),[[created.routeId,2]]);
    assert.equal((await service(B).listRoutes({credential:'x',workspaceId:B})).length,0);

    const c=await pool.connect();
    try{
      // The login role alone has no table rights (NOINHERIT): nothing without SET ROLE.
      await assert.rejects(c.query('SELECT count(*) FROM skyhub_wpml_routes'),/permission denied|does not exist/);
      await c.query('BEGIN');
      await c.query('SET LOCAL ROLE "'+ROLE_B+'"');
      // Even an explicit filter on A's workspace returns nothing for B (forgotten-filter / SQL-bug case).
      const leak=await c.query('SELECT count(*)::int AS n FROM skyhub_wpml_routes WHERE workspace_id=$1',[A]);
      assert.equal(leak.rows[0].n,0);
      const leakRev=await c.query('SELECT count(*)::int AS n FROM skyhub_wpml_route_revisions');
      assert.equal(leakRev.rows[0].n,0);
      const mapping=await c.query('SELECT role_name FROM skyhub_wpml_workspace_role');
      assert.deepEqual(mapping.rows.map(r=>r.role_name),[ROLE_B]);
      await c.query('SAVEPOINT s1');
      // Writing into another workspace is rejected by WITH CHECK.
      await assert.rejects(c.query("INSERT INTO skyhub_wpml_routes(workspace_id,route_id,route_name,created_by) "+
        "VALUES ($1,$2,'evil',$3)",[A,crypto.randomUUID(),HUMAN]),/row-level security/);
      await c.query('ROLLBACK TO SAVEPOINT s1');
      await assert.rejects(c.query('DELETE FROM skyhub_wpml_routes'),/permission denied/);
      await c.query('ROLLBACK');
      // No SET LOCAL leftover on the pooled connection.
      await assert.rejects(c.query('SELECT 1 FROM skyhub_wpml_route_audit LIMIT 1'),/permission denied|does not exist/);
    }finally{c.release();}

    // Reading A's route through B's service is "not-found", never data.
    await assert.rejects(service(B).readRevision({credential:'x',workspaceId:B,routeId:created.routeId,revision:1}),
      e=>e instanceof RouteError);
  }finally{
    if(pool)await pool.end().catch(()=>{});
    await admin.query('SET search_path TO public').catch(()=>{});
    await admin.query('DROP SCHEMA IF EXISTS "'+schema+'" CASCADE').catch(()=>{});
    for(const r of [ROLE_A,ROLE_B,'skyhub_wpml_app','skyhub_wpml_workspace'])
      await admin.query('DROP ROLE IF EXISTS '+r).catch(()=>{});
    await admin.end();
  }
});
