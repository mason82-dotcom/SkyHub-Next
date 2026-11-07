'use strict';

// Isolated PostgreSQL tests. Only runs on loopback /skyhub_test and always
// rolls back the schema and records created in the test transaction.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {Client}=require('pg');
const {createPilotMediaStore}=require('../pilot-media-store');
const {createPilotMediaGroupStore}=require('../pilot-media-groups');
const {createPilotMediaHttpAudit}=require('../pilot-media-http-audit');

const url=process.env.SKYHUB_TEST_DATABASE_URL;
const WS='e3dea0f5-37f2-4d79-ae58-490af3228069';
const OTHER='203cc94c-aef1-4e0e-a520-05a24be33a31';
const NOW=Date.parse('2026-10-22T15:00:00Z');
const PFX=WS+'/media/'+'a'.repeat(32);
const callback={result:0,name:'DJI_0001.JPG',
  object_key:PFX+'/DJI_0001.JPG',fingerprint:'DJI_FULL_01',
  ext:{file_group_id:'mission-group-01',tinny_fingerprint:'tiny-01'}};
const grant={provider:'minio',bucket:'dji-cloud',objectKeyPrefix:PFX,
  credentials:{accessKeyId:'DO_NOT_STORE',accessKeySecret:'NO_SQL_SECRET',
    securityToken:'NO_SQL_TOKEN',expire:900}};
const evidence=async()=>({size:5463,etag:'"valid"',lastModified:new Date(NOW+2000)});

test('real group verification, append-only audit, workspace isolation and rollback',
  {skip:!url},async()=>{
    const target=new URL(url);
    assert.equal(target.protocol,'postgresql:');
    assert.ok(['127.0.0.1','localhost','::1','[::1]'].includes(target.hostname));
    assert.equal(decodeURIComponent(target.pathname),'/skyhub_test');
    const client=new Client({connectionString:url,connectionTimeoutMillis:5000,
      query_timeout:12000,application_name:'skyhub_ci_pilot_media_http'});
    await client.connect();
    let open=false;
    try{
      assert.equal((await client.query('SELECT current_database() AS db')).rows[0].db,
        'skyhub_test');
      await client.query('BEGIN');
      open=true;
      const name='pilot_media_http_ci_'+crypto.randomBytes(8).toString('hex');
      await client.query('CREATE SCHEMA "'+name+'"');
      await client.query('SET LOCAL search_path TO "'+name+'",public');
      for(const script of [
        '003_dji_pilot_media_verified.sql','004_dji_pilot_media_http.sql'
      ]){
        const sql=fs.readFileSync(path.resolve(__dirname,'../db/migrations/'+script),'utf8');
        await client.query(sql);
        await client.query(sql);
      }
      const store=createPilotMediaStore(client,{clock:()=>NOW+1000});
      const groups=createPilotMediaGroupStore(client);
      const audit=createPilotMediaHttpAudit(client);
      await store.registerGrant({workspace:WS,grant});
      const group={file_group_id:'mission-group-01',file_count:2,file_uploaded_count:1};

      assert.deepEqual(await groups.report({workspace:WS,body:group}),
        {status:'pending'});
      assert.equal((await client.query('SELECT count(*)::int AS n FROM dji_pilot_media_group_reports'))
        .rows[0].n,0);

      assert.deepEqual(await store.verifyCallback({workspace:WS,
        callback,headObject:evidence}),{status:'verified'});
      assert.deepEqual(await groups.report({workspace:WS,body:group}),
        {status:'recorded'});
      assert.deepEqual(await groups.report({workspace:WS,body:group}),
        {status:'duplicate'});
      assert.deepEqual(await groups.report({workspace:WS,body:{...group,file_count:3}}),
        {status:'conflict'});
      assert.deepEqual(await groups.report({workspace:OTHER,body:group}),
        {status:'pending'});
      assert.deepEqual(await groups.report({workspace:WS,body:{
        ...group,file_group_id:'another-group'}}),{status:'pending'});
      const reports=await client.query('SELECT workspace_id,file_group_id,verified_count '+
        'FROM dji_pilot_media_group_reports');
      assert.equal(reports.rows.length,1);
      assert.equal(reports.rows[0].workspace_id,WS);
      assert.equal(reports.rows[0].file_group_id,'mission-group-01');
      assert.equal(reports.rows[0].verified_count,1);

      await audit({workspace:WS,operation:'upload_callback',outcome:'ok'});
      await audit({workspace:WS,operation:'group_upload_callback',outcome:'ok'});
      await audit({workspace:OTHER,operation:'tiny_fingerprints',outcome:'pending'});
      const audited=await client.query('SELECT workspace_id,operation,outcome FROM '+
        'dji_pilot_media_http_audit ORDER BY audit_id');
      assert.deepEqual(audited.rows,[
        {workspace_id:WS,operation:'upload_callback',outcome:'ok'},
        {workspace_id:WS,operation:'group_upload_callback',outcome:'ok'},
        {workspace_id:OTHER,operation:'tiny_fingerprints',outcome:'pending'}
      ]);
      assert.doesNotMatch(JSON.stringify(audited.rows),
        /DO_NOT_STORE|NO_SQL_SECRET|NO_SQL_TOKEN|DJI_0001.JPG|tiny-01/);
      for(const sql of [
        "UPDATE dji_pilot_media_http_audit SET outcome='denied'",
        'DELETE FROM dji_pilot_media_http_audit',
        'TRUNCATE dji_pilot_media_http_audit'
      ]){
        await client.query('SAVEPOINT before_immutable_check');
        await assert.rejects(client.query(sql),{code:'42501'});
        await client.query('ROLLBACK TO SAVEPOINT before_immutable_check');
      }
      const remains=await client.query('SELECT count(*)::int AS n FROM dji_pilot_media_http_audit');
      assert.equal(remains.rows[0].n,3);

      // SQL check constraint independently rejects a logically invalid group.
      await client.query('SAVEPOINT before_count_check');
      await assert.rejects(client.query(
        'INSERT INTO dji_pilot_media_group_reports '+
        '(workspace_id,file_group_id,file_count,file_uploaded_count,verified_count) '+
        'VALUES ($1,$2,1,2,2)',[WS,'forge-group']),{code:'23514'});
      await client.query('ROLLBACK TO SAVEPOINT before_count_check');
    }finally{
      if(open)await client.query('ROLLBACK');
      await client.end();
    }
  });
