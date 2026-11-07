'use strict';

// Real PostgreSQL integration only against loopback /skyhub_test.
// Uses a random schema and disposable NOLOGIN, NOSUPERUSER, NOBYPASSRLS role.
// Does not reach the Pi, production database, DJI broker or real media.
const test=require('node:test');
const assert=require('node:assert/strict');
const {Client,Pool}=require('pg');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {createFlighttaskWorkspaceTransactions}=require('../dji-flighttask-workspace-transaction');
const {createPolicyBoundFlighttaskRetention}=require('../dji-flighttask-retention-policy');

const url=process.env.SKYHUB_TEST_DATABASE_URL;
const A='11111111-2222-4333-8444-555555555555';
const B='99999999-8888-4777-8666-555555555555';
const day=86400000,now=1792750000000;
const actors={
  A:{id:'synthetic-admin-a',role:'admin',workspaceId:A},
  B:{id:'synthetic-admin-b',role:'admin',workspaceId:B}
};
const q=(name)=>'"'+name+'"'; // only generated names: hex + trusted prefix.

function guard(raw){
  const p=new URL(raw);
  assert.ok(['localhost','127.0.0.1','::1','[::1]'].includes(p.hostname));
  assert.equal(decodeURIComponent(p.pathname),'/skyhub_test');
  assert.ok(['postgres:','postgresql:'].includes(p.protocol));
}
async function open(){
  const c=new Client({connectionString:url,connectionTimeoutMillis:5000,
    query_timeout:10000,application_name:'skyhub_isolated_workspace_rls_ci'});
  await c.connect();
  assert.equal((await c.query('SELECT current_database() AS db')).rows[0].db,'skyhub_test');
  return c;
}

test('real PostgreSQL: enforced RLS, forced role, local scope and policy-bound retention',
  {skip:!url},async()=>{
  guard(url);
  const suffix=crypto.randomBytes(7).toString('hex');
  const schema='dji_workspace_ci_'+suffix;
  const role='dji_rls_ci_'+suffix;
  const old=now-45*day;
  const records=[
    [A,'11111111-2222-4333-8444-555555555551','reported_ok',old],
    [A,'11111111-2222-4333-8444-555555555552','reply_accepted',old],
    [B,'11111111-2222-4333-8444-555555555553','reported_failed',old]
  ];
  let admin,pool,createdSchema=false,createdRole=false;
  try{
    admin=await open();
    await admin.query('CREATE SCHEMA '+q(schema));
    createdSchema=true;
    await admin.query('SET search_path TO '+q(schema)+',public');
    await admin.query(fs.readFileSync(path.resolve(__dirname,
      '../db/offline/dji-flighttask-observation.sql'),'utf8'));
    for(const [workspace,id,phase,updated] of records){
      await admin.query(
        'INSERT INTO dji_flighttask_observation_snapshots '+
        '(workspace_id,observation_id,snapshot,updated_at) '+
        'VALUES ($1,$2,$3::jsonb,to_timestamp($4::double precision / 1000))',
        [workspace,id,JSON.stringify({phase,flightReady:false}),updated]
      );
    }
    await admin.query(fs.readFileSync(path.resolve(__dirname,
      '../db/offline/dji-flighttask-workspace-rls.sql'),'utf8'));
    // Simulate another broad SELECT policy: a RESTRICTIVE tenant gate
    // must remain effective rather than being OR-ed away.
    await admin.query('CREATE POLICY skyhub_ci_extra_permissive '+
      'ON dji_flighttask_observation_snapshots AS PERMISSIVE FOR SELECT '+
      'TO PUBLIC USING (true)');
    await admin.query('CREATE ROLE '+q(role)+' NOLOGIN NOSUPERUSER NOBYPASSRLS');
    createdRole=true;
    await admin.query('GRANT USAGE ON SCHEMA '+q(schema)+' TO '+q(role));
    await admin.query(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON '+q(schema)+
      '.dji_flighttask_observation_snapshots TO '+q(role));
    const flags=await admin.query(
      'SELECT relrowsecurity,relforcerowsecurity FROM pg_class '+
      'WHERE oid=$1::regclass',[schema+'.dji_flighttask_observation_snapshots']);
    assert.equal(flags.rows[0].relrowsecurity,true);
    assert.equal(flags.rows[0].relforcerowsecurity,true);

    pool=new Pool({connectionString:url,max:1,connectionTimeoutMillis:5000,
      query_timeout:10000,application_name:'skyhub_isolated_workspace_pool_ci'});
    const authorize=async(p,w,action)=>
      (p===actors.A&&w===A||p===actors.B&&w===B)&&
      ['summary','observe','prune'].includes(action);
    const tx=createFlighttaskWorkspaceTransactions(pool,{authorize,dbRole:role});
    const withScope=(ws,p,action,fn)=>tx.run({workspaceId:ws,principal:p,action},
      async c=>{
        await c.query('SET LOCAL search_path TO '+q(schema)+',public');
        return fn(c);
      });

    // A nonowner without a local GUC must see no rows even with SELECT GRANT.
    await admin.query('BEGIN');
    await admin.query('SET LOCAL ROLE '+q(role));
    const invisible=await admin.query('SELECT COUNT(*)::integer AS n FROM '+
      q(schema)+'.dji_flighttask_observation_snapshots');
    assert.equal(invisible.rows[0].n,0);
    await admin.query('ROLLBACK');

    const visibleA=await withScope(A,actors.A,'summary',async c=>{
      const scope=await c.query("SELECT current_setting('skyhub.workspace_id',true) AS w");
      assert.equal(scope.rows[0].w,A);
      const r=await c.query('SELECT workspace_id::text AS workspace,COUNT(*)::integer AS n '+
        'FROM dji_flighttask_observation_snapshots GROUP BY workspace_id');
      return r.rows;
    });
    assert.deepEqual(visibleA,[{workspace:A,n:2}]);
    const visibleB=await withScope(B,actors.B,'summary',async c=>{
      const r=await c.query('SELECT COUNT(*)::integer AS n FROM dji_flighttask_observation_snapshots');
      return r.rows[0].n;
    });
    assert.equal(visibleB,1);

    const noDelete=await withScope(A,actors.A,'observe',async c=>{
      const r=await c.query('DELETE FROM dji_flighttask_observation_snapshots '+
        'WHERE workspace_id=$1 RETURNING observation_id',[B]);
      return r.rowCount;
    });
    assert.equal(noDelete,0);
    await assert.rejects(withScope(A,actors.A,'observe',async c=>{
      await c.query('INSERT INTO dji_flighttask_observation_snapshots '+
        '(workspace_id,observation_id,snapshot) VALUES ($1,$2,$3::jsonb)',
        [B,'11111111-2222-4333-8444-555555555558','{}']);
    }),/transaction unavailable/);

    await assert.rejects(withScope(A,actors.A,'observe',async c=>{
      await c.query('UPDATE dji_flighttask_observation_snapshots SET workspace_id=$1 '+
        'WHERE workspace_id=$2',[B,A]);
    }),/transaction unavailable/);

    // Strict policy, trusted server clock, dry-run default, explicit hold.
    const calls=[];
    // The policy gets the transaction factory itself (never a pool/client); the
    // wrapper only adds the test schema search_path before the DELETE runs.
    const scoped={run:(args,fn)=>tx.run(args,async c=>{
      await c.query('SET LOCAL search_path TO '+q(schema)+',public');
      return fn(c);
    })};
    const retention=held=>createPolicyBoundFlighttaskRetention(scoped,{
      authorize,clock:()=>now,
      resolvePolicy:async (p,ws)=>{
        calls.push(ws);
        return {enabled:true,legalHold:held,retentionDays:30,maxBatch:10};
      }
    });
    // A raw pool is refused outright instead of silently matching no rows.
    assert.throws(()=>createPolicyBoundFlighttaskRetention(pool,{
      authorize,resolvePolicy:async()=>({})}),/trusted dependencies/);
    const dryRun=await retention(false).run({workspaceId:A,principal:actors.A});
    assert.equal(dryRun.executed,false);
    await assert.rejects(retention(true).run({workspaceId:B,principal:actors.B,execute:true}),
      /not enabled/);
    const deleted=await retention(false).run({workspaceId:A,principal:actors.A,execute:true});
    assert.equal(deleted.deletedCount,1);
    assert.equal(deleted.executed,true);
    const stateA=await withScope(A,actors.A,'summary',async c=>{
      const r=await c.query("SELECT snapshot->>'phase' AS phase "+
        'FROM dji_flighttask_observation_snapshots');
      return r.rows.map(x=>x.phase);
    });
    assert.deepEqual(stateA,['reply_accepted']);
    assert.equal(await withScope(B,actors.B,'summary',async c=>{
      const r=await c.query('SELECT COUNT(*)::integer AS n FROM dji_flighttask_observation_snapshots');
      return r.rows[0].n;
    }),1);
    assert.ok(calls.includes(A)&&calls.includes(B));

    // The same pooled connection cannot accidentally reuse the prior GUC.
    const pooled=await pool.connect();
    try{
      const r=await pooled.query(
        "SELECT current_setting('skyhub.workspace_id',true) AS w, current_user AS u");
      assert.ok(!r.rows[0].w);
      assert.notEqual(r.rows[0].u,role);
    }finally{pooled.release();}
  }finally{
    if(pool)await pool.end();
    if(admin){await admin.end();admin=null;}
    if(createdSchema||createdRole){
      const cleanup=await open();
      try{
        if(createdSchema)await cleanup.query('DROP SCHEMA IF EXISTS '+q(schema)+' CASCADE');
        if(createdRole)await cleanup.query('DROP ROLE IF EXISTS '+q(role));
      }finally{await cleanup.end();}
    }
  }
});
