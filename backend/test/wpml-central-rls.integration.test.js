'use strict';
/* CI-ONLY role/RLS test. NEVER create roles or apply allow policies outside
 * disposable skyhub_test. This file is not a deployment migration. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const {Client}=require('pg');

const TARGET=process.env.SKYHUB_TEST_DATABASE_URL;
const A='e3dea0f5-37f2-4d79-ae58-490af3228069';
const B='203cc94c-aef1-4e0e-a520-05a24be33a31';
const ROUTEA='69ecb38c-04f2-44d0-adc6-3441cb4f9449';
const ROUTEB='4d8779ac-4573-444d-ab9c-23ac0814f8b1';
const TABLES=['skyhub_wpml_folders','skyhub_wpml_routes',
  'skyhub_wpml_route_revisions','skyhub_wpml_task_snapshots',
  'skyhub_wpml_route_audit'];
function safeTarget(raw){
  const u=new URL(raw);
  assert.ok(['localhost','127.0.0.1','[::1]','::1'].includes(u.hostname),
    'RLS test is restricted to a localhost database');
  assert.equal(decodeURIComponent(u.pathname),'/skyhub_test');
  assert.ok(['postgres:','postgresql:'].includes(u.protocol));
}
function quote(s){
  if(!/^[a-z][a-z0-9_]*$/.test(s))throw new TypeError('Invalid CI identifier');
  return '"'+s+'"';
}
test('WPML database RLS enforces workspace separation for non-BYPASSRLS roles', {
  skip:!TARGET,timeout:30000
},async()=>{
  safeTarget(TARGET);
  const db=new Client({connectionString:TARGET,connectionTimeoutMillis:5000,
    query_timeout:10000});
  await db.connect();
  const suffix=crypto.randomBytes(5).toString('hex');
  const schema='wpml_rls_ci_'+suffix;
  const roles=['wpml_ci_a_'+suffix,'wpml_ci_b_'+suffix,'wpml_ci_none_'+suffix];
  let created=false;
  const createdRoles=[];
  let asRole=false;
  try{
    const actual=await db.query(
      'SELECT current_database() AS db, current_setting(\'is_superuser\') AS su');
    assert.equal(actual.rows[0].db,'skyhub_test');
    // Dedicated disposable CI database is administered by a superuser;
    // production must NEVER use this connection or CREATE ROLE path.
    assert.equal(actual.rows[0].su,'on');
    await db.query('CREATE SCHEMA '+quote(schema));created=true;
    await db.query('SET search_path TO '+quote(schema)+',public');
    for(const file of ['003_wpml_route_library_draft.sql',
      '004_wpml_route_audit_draft.sql']){
      const sql=fs.readFileSync(path.join(__dirname,'../db/migrations',file),'utf8');
      await db.query(sql);
    }
    const plan={name:'Sensitive 49.12345',model:'matrice4t',speed:5,
      waypoints:[{lat:49.12345,lon:8.56789,height:50},
        {lat:49.12445,lon:8.56889,height:50}]};
    const hash=crypto.createHash('sha256').update(JSON.stringify(plan)).digest();
    for(const [workspace,route] of [[A,ROUTEA],[B,ROUTEB]]){
      await db.query(
        'INSERT INTO skyhub_wpml_routes '+
        '(workspace_id,route_id,route_name,created_by,latest_revision) '+
        'VALUES ($1,$2,$3,$4,1)',
        [workspace,route,'Confidential GPS 49.12345',workspace]);
      await db.query(
        'INSERT INTO skyhub_wpml_route_revisions '+
        '(workspace_id,route_id,revision,plan,plan_sha256,author_id) '+
        'VALUES ($1,$2,1,$3::jsonb,$4,$5)',
        [workspace,route,JSON.stringify(plan),hash,workspace]);
      await db.query(
        'INSERT INTO skyhub_wpml_route_audit '+
        "(workspace_id,route_id,revision,actor_id,event_type) "+
        "VALUES ($1,$2,1,$3,'created')",
        [workspace,route,workspace]);
    }
    for(const role of roles){
      await db.query('CREATE ROLE '+quote(role)+
        ' NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS');
      createdRoles.push(role);
      await db.query('GRANT USAGE ON SCHEMA '+quote(schema)+' TO '+quote(role));
      await db.query('GRANT SELECT ON '+TABLES.map(quote).join(',')+
        ' TO '+quote(role));
    }
    const roleFlags=await db.query(
      'SELECT rolname,rolsuper,rolbypassrls,rolcanlogin FROM pg_roles '+
      'WHERE rolname=ANY($1::text[])',[roles]);
    assert.equal(roleFlags.rowCount,3);
    assert.ok(roleFlags.rows.every(r=>!r.rolsuper&&!r.rolbypassrls&&!r.rolcanlogin));
    async function within(role,callback){
      await db.query('SET ROLE '+quote(role));asRole=true;
      try{return await callback();}
      finally{await db.query('RESET ROLE');asRole=false;}
    }
    // Even with schema and SELECT grants, default-deny RLS returns no rows.
    for(const role of roles){
      await within(role,async()=>{
        for(const table of TABLES){
          const r=await db.query('SELECT COUNT(*)::int AS n FROM '+quote(table));
          assert.equal(r.rows[0].n,0,role+' must be denied '+table);
        }
      });
    }
    // The following policies are only fixtures inside the ephemeral schema.
    // Identity is represented by fixed test SQL roles, NEVER by request-supplied
    // role fields or spoofable custom session GUCs.
    for(let i=0;i<2;i++){
      const role=roles[i],workspace=[A,B][i];
      for(const table of ['skyhub_wpml_routes',
        'skyhub_wpml_route_revisions','skyhub_wpml_route_audit']){
        await db.query('CREATE POLICY '+quote('ci_'+i+'_'+table.replace('skyhub_wpml_',''))+
          ' ON '+quote(table)+' FOR SELECT TO '+quote(role)+
          ' USING (workspace_id='+ "'"+workspace+"'"+')');
      }
    }
    for(let i=0;i<2;i++){
      await within(roles[i],async()=>{
        const own=[A,B][i],foreign=[B,A][i];
        for(const table of ['skyhub_wpml_routes',
          'skyhub_wpml_route_revisions','skyhub_wpml_route_audit']){
          const visible=await db.query('SELECT workspace_id FROM '+quote(table));
          assert.equal(visible.rowCount,1);
          assert.equal(visible.rows[0].workspace_id,own);
          const hidden=await db.query('SELECT * FROM '+quote(table)+
            ' WHERE workspace_id=$1',[foreign]);
          assert.equal(hidden.rowCount,0);
        }
        // Unconfigured tables remain default-deny.
        assert.equal((await db.query('SELECT * FROM skyhub_wpml_task_snapshots'))
          .rowCount,0);
      });
    }
    // Even with a table-level INSERT grant, absence of a FOR INSERT policy
    // means Row Level Security itself refuses writes.
    await db.query('GRANT INSERT ON skyhub_wpml_routes TO '+quote(roles[0]));
    await within(roles[0],async()=>{
      await assert.rejects(db.query('INSERT INTO skyhub_wpml_routes '+
        '(workspace_id,route_id,route_name,created_by) VALUES ($1,$2,$3,$4)',
        [A,crypto.randomUUID(),'Forbidden',A]),{code:'42501'});
    });
    await within(roles[2],async()=>{
      for(const table of ['skyhub_wpml_routes',
        'skyhub_wpml_route_revisions','skyhub_wpml_route_audit']){
        assert.equal((await db.query('SELECT * FROM '+quote(table))).rowCount,0);
      }
    });
    const final=await db.query('SELECT COUNT(*)::int AS n FROM skyhub_wpml_routes');
    assert.equal(final.rows[0].n,2);
  }finally{
    if(asRole){try{await db.query('RESET ROLE');}catch{}}
    try{await db.query('ROLLBACK');}catch{}
    try{await db.query('RESET ROLE');}catch{}
    try{await db.query('SET search_path TO public');}catch{}
    if(created){try{await db.query('DROP SCHEMA '+quote(schema)+' CASCADE');}catch{}}
    for(const role of createdRoles.reverse()){
      // Role cleanup is required so no privileges survive this CI-only test.
      try{await db.query('DROP ROLE '+quote(role));}catch{}
    }
    await db.end();
  }
});
