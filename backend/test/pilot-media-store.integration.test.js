'use strict';

// Live SQL syntax, uniqueness and workspace constraints in a disposable CI DB.
// The test runs inside a rolled-back transaction in a private schema.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {Client}=require('pg');
const {createPilotMediaStore,createRegisteredStsIssuer}=require('../pilot-media-store');

const url=process.env.SKYHUB_TEST_DATABASE_URL;
const WS='e3dea0f5-37f2-4d79-ae58-490af3228069';
const OTHER='203cc94c-aef1-4e0e-a520-05a24be33a31';
const NOW=Date.parse('2026-10-22T15:00:00Z');
const PFX=WS+'/media/'+'a'.repeat(32);
const KEY=PFX+'/DJI_0001.JPG';
const G={provider:'minio',bucket:'dji-cloud',objectKeyPrefix:PFX,
  credentials:{accessKeyId:'HIDDEN',accessKeySecret:'PRIVATE',securityToken:'SECRET',expire:900}};
const callback={result:0,name:'DJI_0001.JPG',object_key:KEY,
  fingerprint:'DJI_FULL_1',ext:{tinny_fingerprint:'DJI_TINY_1',file_group_id:'m3m_01'},
  metadata:{shoot_position:{lat:49.1,lng:8.4},relative_altitude:17}};
const headObject=async()=>({size:2755,etag:'"valid-etag"',lastModified:new Date(NOW+3000)});

test('real PostgreSQL migration, durable grant, verified media, uniqueness and rollback',
  {skip:!url},async()=>{
    const target=new URL(url);
    assert.ok(['127.0.0.1','localhost','::1','[::1]'].includes(target.hostname));
    assert.equal(decodeURIComponent(target.pathname),'/skyhub_test');
    assert.ok(['postgres:','postgresql:'].includes(target.protocol));
    const db=new Client({connectionString:url,connectionTimeoutMillis:5000,
      query_timeout:12000,application_name:'skyhub_ci_media_registration'});
    await db.connect();
    let transaction=false;
    try{
      const name=await db.query('SELECT current_database() AS db');
      assert.equal(name.rows[0].db,'skyhub_test');
      await db.query('BEGIN');
      transaction=true;
      const schema='media_ci_'+crypto.randomBytes(8).toString('hex');
      await db.query('CREATE SCHEMA "'+schema+'"');
      await db.query('SET LOCAL search_path TO "'+schema+'",public');
      const migration=fs.readFileSync(path.resolve(__dirname,
        '../db/migrations/003_dji_pilot_media_verified.sql'),'utf8');
      await db.query(migration);
      await db.query(migration); // idempotent additive migration
      const store=createPilotMediaStore(db,{clock:()=>NOW+2000});
      const registered=createRegisteredStsIssuer({store,issueGrant:async()=>G});
      const issued=await registered({workspace:WS,
        principal:{role:'pilot',workspaceId:WS},maxSeconds:900});
      assert.equal(issued,G);
      const grantRow=await db.query('SELECT * FROM dji_pilot_media_grants');
      assert.equal(grantRow.rows.length,1);
      assert.doesNotMatch(JSON.stringify(grantRow.rows),/HIDDEN|PRIVATE|SECRET/);

      // Object must have been put after the STS grant was issued.
      const invalid=await store.verifyCallback({workspace:WS,callback,
        headObject:async()=>({size:200,etag:'"x"',lastModified:new Date(NOW-60000)})});
      assert.deepEqual(invalid,{status:'unverified'});
      assert.deepEqual(await store.verifyCallback({workspace:WS,callback,headObject}),
        {status:'verified'});
      assert.deepEqual(await store.verifyCallback({workspace:WS,callback,headObject}),
        {status:'duplicate'});
      assert.deepEqual(await store.verifiedFingerprint({workspace:WS,
        body:{fingerprint:'DJI_FULL_1'}}),{exists:true});
      assert.deepEqual(await store.verifiedFingerprint({workspace:OTHER,
        body:{fingerprint:'DJI_FULL_1'}}),{exists:false});
      assert.deepEqual(await store.existingTinyFingerprints({workspace:WS,
        body:{tiny_fingerprints:['DJI_TINY_1','other']}}),['DJI_TINY_1']);
      assert.deepEqual(await store.existingTinyFingerprints({workspace:OTHER,
        body:{tiny_fingerprints:['DJI_TINY_1']}}),[]);

      assert.deepEqual(await store.verifyCallback({workspace:WS,
        callback:{...callback,object_key:PFX+'/DJI_0002.JPG'},headObject}),
        {status:'conflict'});
      assert.deepEqual(await store.verifyCallback({workspace:OTHER,callback,headObject}),
        {status:'unregistered'});
      const rows=await db.query('SELECT * FROM dji_pilot_media_verified');
      assert.equal(rows.rows.length,1);
      assert.equal(rows.rows[0].size_bytes,'2755');
      assert.equal(rows.rows[0].object_key,KEY);

      // SQL CHECK rejects a key outside the stated grant scope before FK.
      await db.query('SAVEPOINT before_path_check');
      await assert.rejects(db.query(
        'INSERT INTO dji_pilot_media_verified '+
        '(workspace_id,object_key,grant_prefix,file_name,size_bytes,etag,object_last_modified) '+
        'VALUES ($1,$2,$3,$4,$5,$6,$7)',[
          OTHER,OTHER+'/media/'+'a'.repeat(32)+'/x',
          PFX,'bad.jpg',1,'etag',new Date(NOW)
        ]),{code:'23514'});
      await db.query('ROLLBACK TO SAVEPOINT before_path_check');

      // Even when key and grant prefix agree, the composite workspace FK
      // refuses to attach another workspace's object to our registered grant.
      await db.query('SAVEPOINT before_fk');
      await assert.rejects(db.query(
        'INSERT INTO dji_pilot_media_verified '+
        '(workspace_id,object_key,grant_prefix,file_name,size_bytes,etag,object_last_modified) '+
        'VALUES ($1,$2,$3,$4,$5,$6,$7)',[
          OTHER,PFX+'/foreign-test.jpg',
          PFX,'bad.jpg',1,'etag',new Date(NOW)
        ]),{code:'23503'});
      await db.query('ROLLBACK TO SAVEPOINT before_fk');
    }finally{
      if(transaction)await db.query('ROLLBACK');
      await db.end();
    }
});
