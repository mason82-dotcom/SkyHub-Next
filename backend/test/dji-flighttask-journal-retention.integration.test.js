'use strict';
// Dedicated loopback PostgreSQL test only. No Pi or production migrations.
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const {Client}=require('pg');
const {createFlighttaskRetention}=require('../dji-flighttask-journal-retention');

const url=process.env.SKYHUB_TEST_DATABASE_URL;
const NOW=1792750000000;
const DAY=86400000;
const A='33333333-4444-4555-8666-777777777777';
const B='99999999-8888-4777-8666-555555555555';
function localOnly(u){
  const p=new URL(u);
  assert.ok(['127.0.0.1','localhost','::1','[::1]'].includes(p.hostname));
  assert.equal(decodeURIComponent(p.pathname),'/skyhub_test');
  assert.ok(['postgres:','postgresql:'].includes(p.protocol));
}
async function connect(){
  const c=new Client({connectionString:url,connectionTimeoutMillis:5000,
    query_timeout:10000,application_name:'skyhub_isolated_dji_retention_ci'});
  await c.connect();
  assert.equal((await c.query('SELECT current_database() AS db')).rows[0].db,'skyhub_test');
  return c;
}
test('PostgreSQL retains active/new/foreign workspaces; prunes only old terminal snapshots',
  {skip:!url},async()=>{
  localOnly(url);
  const schema='dji_retention_ci_'+crypto.randomBytes(8).toString('hex');
  const actor={id:'synthetic-admin',workspaceId:A};
  let client,created=false;
  try{
    client=await connect();
    await client.query('CREATE SCHEMA "'+schema+'"');
    created=true;
    await client.query('SET search_path TO "'+schema+'",public');
    const sql=fs.readFileSync(path.resolve(__dirname,
      '../db/offline/dji-flighttask-observation.sql'),'utf8');
    await client.query(sql);
    const samples=[
      [A,'11111111-2222-4333-8444-555555555551','reported_ok',45],
      [A,'11111111-2222-4333-8444-555555555552','reported_failed',45],
      [A,'11111111-2222-4333-8444-555555555553','reply_accepted',45],
      [A,'11111111-2222-4333-8444-555555555554','awaiting_reply',45],
      [A,'11111111-2222-4333-8444-555555555555','expired_unverified',45],
      [A,'11111111-2222-4333-8444-555555555556','reported_ok',5],
      [B,'11111111-2222-4333-8444-555555555557','reported_ok',45]
    ];
    for(const [ws,id,phase,daysAgo] of samples){
      await client.query(
        'INSERT INTO dji_flighttask_observation_snapshots '+
        '(workspace_id,observation_id,snapshot,updated_at) '+
        'VALUES ($1,$2,$3::jsonb,to_timestamp($4::double precision/1000))',
        [ws,id,JSON.stringify({phase,flightReady:false,
          secret_should_not_be_returned:'synthetic'}),NOW-daysAgo*DAY]);
    }
    const journal=createFlighttaskRetention(client,{
      authorize:async(user,workspaceId)=>user===actor&&workspaceId===A
    });
    await assert.rejects(journal.prune({
      workspaceId:B,principal:actor,now:NOW}),/access denied/);
    const first=await journal.prune({
      workspaceId:A,principal:actor,now:NOW,retentionDays:30,maxRows:1});
    assert.equal(first.deletedCount,1);
    assert.equal(first.limited,true);
    const next=await journal.prune({
      workspaceId:A,principal:actor,now:NOW,retentionDays:30,maxRows:10});
    assert.equal(next.deletedCount,2);
    assert.equal(next.limited,false);
    const remaining=await client.query(
      "SELECT workspace_id::text AS workspace, snapshot->>'phase' AS phase "+
      'FROM dji_flighttask_observation_snapshots ORDER BY workspace_id,observation_id');
    assert.equal(remaining.rowCount,4);
    const remainingA=remaining.rows.filter(x=>x.workspace===A).map(x=>x.phase).sort();
    assert.deepEqual(remainingA,['awaiting_reply','reply_accepted','reported_ok']);
    assert.equal(remaining.rows.filter(x=>x.workspace===B).length,1);
    assert.doesNotMatch(JSON.stringify(first)+JSON.stringify(next),
      /synthetic|11111111|33333333/);
  }finally{
    if(client){await client.end();client=null;}
    if(created){
      const cleanup=await connect();
      try{await cleanup.query('DROP SCHEMA IF EXISTS "'+schema+'" CASCADE');}
      finally{await cleanup.end();}
    }
  }
});
