'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {Client}=require('pg');
const TEST_DATABASE_URL=process.env.SKYHUB_TEST_DATABASE_URL;
function safeUrl(raw){
  const url=new URL(raw);
  assert.ok(['127.0.0.1','localhost','[::1]','::1'].includes(url.hostname));
  assert.equal(decodeURIComponent(url.pathname),'/skyhub_test');
  assert.ok(['postgres:','postgresql:'].includes(url.protocol));
}
test('draft WPML route schema: workspace FKs, immutable revisions, no dispatch and default-deny RLS',
  {skip:!TEST_DATABASE_URL},async()=>{
  safeUrl(TEST_DATABASE_URL);
  const c=new Client({connectionString:TEST_DATABASE_URL,connectionTimeoutMillis:5000,
    query_timeout:10000});
  await c.connect();
  const schema='wpml_route_ci_'+crypto.randomBytes(5).toString('hex');
  const q='"'+schema+'"';
  const A='e3dea0f5-37f2-4d79-ae58-490af3228069';
  const B='203cc94c-aef1-4e0e-a520-05a24be33a31';
  const route='69ecb38c-04f2-44d0-adc6-3441cb4f9449';
  const folder='4d8779ac-4573-444d-ab9c-23ac0814f8b1';
  const snapshot='8b18b97a-715c-4492-929a-11245bd3045b';
  let created=false;
  try{
    assert.equal((await c.query('SELECT current_database() AS db')).rows[0].db,'skyhub_test');
    await c.query('CREATE SCHEMA '+q);created=true;
    await c.query('SET search_path TO '+q+',public');
    const migration=fs.readFileSync(path.resolve(__dirname,
      '../db/migrations/003_wpml_route_library_draft.sql'),'utf8');
    await c.query(migration);
    await c.query(migration);
    const policy=await c.query(
      "SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity FROM pg_class c "+
      "JOIN pg_namespace n ON n.oid=c.relnamespace "+
      "WHERE n.nspname=current_schema() AND c.relname LIKE 'skyhub_wpml_%' "+
      "AND c.relkind='r' ORDER BY c.relname");
    assert.equal(policy.rows.length,4);
    assert.ok(policy.rows.every(r=>r.relrowsecurity===true&&r.relforcerowsecurity===true));
    const granted=await c.query(
      "SELECT c.relname,c.relacl::text AS acl FROM pg_class c "+
      "JOIN pg_namespace n ON n.oid=c.relnamespace "+
      "WHERE n.nspname=current_schema() AND "+
      "c.relname='skyhub_wpml_route_revisions'");
    assert.doesNotMatch(granted.rows[0].acl||'',/PUBLIC=/);

    await c.query(
      'INSERT INTO skyhub_wpml_folders(workspace_id,folder_id,folder_name,created_by) '+
      'VALUES ($1,$2,$3,$4)',[A,folder,'Private Test',A]);
    await c.query(
      'INSERT INTO skyhub_wpml_routes(workspace_id,route_id,folder_id,route_name,created_by) '+
      'VALUES ($1,$2,$3,$4,$5)',[A,route,folder,'Private route',A]);
    const plan={name:'Private',model:'matrice4t',speed:5,
      waypoints:[{lat:49.1234,lon:8.5678,height:50},{lat:49.2,lon:8.6,height:50}]};
    const sha=crypto.createHash('sha256').update(JSON.stringify(plan)).digest();
    const values=[A,route,1,JSON.stringify(plan),sha,A];
    await c.query(
      'INSERT INTO skyhub_wpml_route_revisions '+
      '(workspace_id,route_id,revision,plan,plan_sha256,author_id) '+
      'VALUES ($1,$2,$3,$4::jsonb,$5,$6)',values);
    await assert.rejects(c.query(
      'INSERT INTO skyhub_wpml_route_revisions '+
      '(workspace_id,route_id,revision,plan,plan_sha256,author_id) '+
      'VALUES ($1,$2,$3,$4::jsonb,$5,$6)',[B,route,2,JSON.stringify(plan),sha,B]),
      {code:'23503'});
    await assert.rejects(c.query(
      'UPDATE skyhub_wpml_route_revisions SET revision=9 WHERE workspace_id=$1',
      [A]),{code:'42501'});
    await assert.rejects(c.query(
      'DELETE FROM skyhub_wpml_route_revisions WHERE workspace_id=$1',[A]),{code:'42501'});
    // PostgreSQL first blocks a parent-only TRUNCATE because task snapshots
    // reference it; CASCADE must also fail at the append-only trigger.
    await assert.rejects(c.query(
      'TRUNCATE skyhub_wpml_route_revisions'),{code:'0A000'});
    await assert.rejects(c.query(
      'TRUNCATE skyhub_wpml_route_revisions CASCADE'),{code:'42501'});
    await assert.rejects(c.query(
      'INSERT INTO skyhub_wpml_route_revisions '+
      '(workspace_id,route_id,revision,plan,plan_sha256,author_id,flight_ready) '+
      'VALUES ($1,$2,2,$3::jsonb,$4,$5,true)',[A,route,JSON.stringify(plan),sha,A]),
      {code:'23514'});
    await c.query(
      'INSERT INTO skyhub_wpml_task_snapshots '+
      '(workspace_id,snapshot_id,route_id,revision,snapshot_json,created_by) '+
      'VALUES ($1,$2,$3,1,$4::jsonb,$5)',
      [A,snapshot,route,JSON.stringify({referenceOnly:true,flightReady:false}),A]);
    await assert.rejects(c.query(
      'UPDATE skyhub_wpml_task_snapshots SET created_by=$1 WHERE snapshot_id=$2',
      [B,snapshot]),{code:'42501'});
    await assert.rejects(c.query('TRUNCATE skyhub_wpml_task_snapshots'),{code:'42501'});
    await assert.rejects(c.query(
      'DELETE FROM skyhub_wpml_routes WHERE route_id=$1',[route]),{code:'23503'});
    const valuesAfter=await c.query(
      'SELECT revision,flight_ready,dispatch_allowed FROM skyhub_wpml_route_revisions '+
      'WHERE workspace_id=$1 AND route_id=$2',[A,route]);
    assert.equal(valuesAfter.rows.length,1);
    assert.equal(valuesAfter.rows[0].flight_ready,false);
    assert.equal(valuesAfter.rows[0].dispatch_allowed,false);
  }finally{
    try{await c.query('ROLLBACK');}catch{}
    try{await c.query('SET search_path TO public');}catch{}
    if(created)await c.query('DROP SCHEMA '+q+' CASCADE');
    await c.end();
  }
});
