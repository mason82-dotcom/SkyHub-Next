'use strict';
// Real isolated PostgreSQL integration. The private test schema and records
// are rolled back, and target validation precedes the connection.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {Client}=require('pg');
const {createPilotMediaStore}=require('../pilot-media-store');
const {createPilotMediaLibrary,createLibraryAudit}=require('../pilot-media-library');

const url=process.env.SKYHUB_TEST_DATABASE_URL;
const WS='e3dea0f5-37f2-4d79-ae58-490af3228069';
const OTHER='203cc94c-aef1-4e0e-a520-05a24be33a31';
const NOW=Date.parse('2026-10-22T15:00:00Z');
const PFX=WS+'/media/'+'a'.repeat(32);
const G={provider:'minio',bucket:'dji-cloud',objectKeyPrefix:PFX,
  credentials:{accessKeyId:'NO_STORE',accessKeySecret:'NO_SECRET',securityToken:'PRIVATE_TOKEN',expire:900}};
const PREFIX2=WS+'/media/'+'b'.repeat(32);
const G2={...G,objectKeyPrefix:PREFIX2};
const NAME1='DJI_20261022150000_0001_MS_R.TIF';
const NAME2='DJI_20261022150000_0001_MS_NIR.TIF';

test('real library migration, signed microsecond paging, immutable read audit and rollback',
  {skip:!url},async()=>{
    const target=new URL(url);
    assert.ok(['127.0.0.1','localhost','::1','[::1]'].includes(target.hostname));
    assert.ok(['postgres:','postgresql:'].includes(target.protocol));
    assert.equal(decodeURIComponent(target.pathname),'/skyhub_test');
    const db=new Client({connectionString:url,connectionTimeoutMillis:5000,
      query_timeout:12000,application_name:'skyhub_ci_pilot_library'});
    await db.connect();
    let opened=false;
    try{
      assert.equal((await db.query('SELECT current_database() AS db')).rows[0].db,'skyhub_test');
      await db.query('BEGIN');opened=true;
      const schema='pilot_library_ci_'+crypto.randomBytes(8).toString('hex');
      await db.query('CREATE SCHEMA "'+schema+'"');
      await db.query('SET LOCAL search_path TO "'+schema+'",public');
      for(const file of ['003_dji_pilot_media_verified.sql',
        '004_dji_pilot_media_http.sql','005_dji_pilot_media_library.sql']){
        const sql=fs.readFileSync(path.resolve(__dirname,'../db/migrations/'+file),'utf8');
        await db.query(sql);
        await db.query(sql);
      }
      const store=createPilotMediaStore(db,{clock:()=>NOW});
      await store.registerGrant({workspace:WS,grant:G});
      await store.registerGrant({workspace:WS,grant:G2});
      for(const [prefix,name,etag] of [[PFX,NAME1,'"etag-one"'],
        [PREFIX2,NAME2,'"etag-two"']]){
        assert.deepEqual(await store.verifyCallback({workspace:WS,callback:{
          result:0,name,object_key:prefix+'/'+name,fingerprint:name.replace('.TIF',''),
          ext:{file_group_id:'group-001',tinny_fingerprint:name.slice(-12)}
        },headObject:async()=>({size:285000,etag,
          lastModified:new Date(NOW+1200)})}),{status:'verified'});
      }

      // Microsecond accuracy must be preserved by the keyset cursor; both
      // records intentionally fall within the same Javascript millisecond.
      const inserted=await db.query('SELECT asset_id FROM dji_pilot_media_verified '+
        'WHERE workspace_id=$1 ORDER BY asset_id ASC',[WS]);
      assert.equal(inserted.rows.length,2);
      assert.notEqual(inserted.rows[0].asset_id,inserted.rows[1].asset_id);
      await db.query(
        "UPDATE dji_pilot_media_verified SET verified_at='2026-10-22T15:02:30.123456Z' "+
        "WHERE asset_id=$1",[inserted.rows[0].asset_id]);
      await db.query(
        "UPDATE dji_pilot_media_verified SET verified_at='2026-10-22T15:02:30.123123Z' "+
        "WHERE asset_id=$1",[inserted.rows[1].asset_id]);
      await db.query("UPDATE dji_pilot_media_verified SET "+
        "pilot_metadata='{\"relative_altitude\":22,\"notApproved\":\"NO_SECRET\"}'::jsonb");
      const lib=createPilotMediaLibrary(db,{cursorSecret:Buffer.alloc(32,2)});
      const page=await lib.list({workspace:WS,limit:1});
      assert.equal(page.items.length,1);
      assert.ok(page.nextCursor);
      assert.equal(page.items[0].pilotMetadata.fields.relative_altitude,22);
      assert.doesNotMatch(JSON.stringify(page),/NO_SECRET|notApproved|PRIVATE_TOKEN/);
      const page2=await lib.list({workspace:WS,limit:1,cursor:page.nextCursor});
      assert.equal(page2.items.length,1);
      assert.equal(page2.nextCursor,null);
      assert.notEqual(page.items[0].id,page2.items[0].id);
      assert.deepEqual((await lib.list({workspace:OTHER})).items,[]);
      await assert.rejects(()=>lib.list({workspace:OTHER,cursor:page.nextCursor}));
      const headObject=async({bucket,key})=>{
        assert.equal(bucket,'dji-cloud');
        assert.ok(key.startsWith(WS+'/media/'));
        return {size:285000,
          etag:key.startsWith(PFX+'/')?'"etag-one"':'"etag-two"',
          lastModified:new Date(NOW+1200)};
      };
      const current=await lib.detail({workspace:WS,id:page.items[0].id,headObject});
      assert.equal(current.status,'ok');
      assert.equal(current.item.objectEvidence.status,'head-rechecked');
      assert.equal(current.item.imageInspection.rtk,'not-extracted');
      assert.equal(current.item.imageInspection.ndviReady,false);
      assert.deepEqual(await lib.detail({workspace:OTHER,id:page.items[0].id,
        headObject:async()=>{throw Error('Foreign workspace accessed storage');}}),
      {status:'not-found'});
      assert.deepEqual(await lib.detail({workspace:WS,id:page.items[0].id,
        headObject:async()=>({size:1,etag:'"changed"',
          lastModified:new Date(NOW+1200)})}),{status:'changed'});
      const summary=await lib.m3mGroup({workspace:WS,groupId:'group-001'});
      assert.equal(summary.status,'ok');
      assert.equal(summary.report.examined,2);
      assert.equal(summary.report.sessionPartitions,2);
      assert.equal(summary.report.spectralSets,0);
      assert.equal(summary.report.captureUuidVerified,false);
      assert.doesNotMatch(JSON.stringify(summary),/20261022150000|\/media\//);

      const audit=createLibraryAudit(db);
      await audit({workspace:WS,action:'list',outcome:'ok'});
      await audit({workspace:WS,action:'detail',outcome:'ok'});
      await audit({workspace:OTHER,action:'m3m_group',outcome:'pending'});
      assert.equal((await db.query('SELECT count(*)::int AS n FROM '+
        'dji_pilot_media_library_audit')).rows[0].n,3);
      for(const query of [
        "UPDATE dji_pilot_media_library_audit SET outcome='denied'",
        'DELETE FROM dji_pilot_media_library_audit',
        'TRUNCATE TABLE dji_pilot_media_library_audit'
      ]){
        await db.query('SAVEPOINT before_mutation');
        await assert.rejects(db.query(query),{code:'42501'});
        await db.query('ROLLBACK TO SAVEPOINT before_mutation');
      }
    }finally{
      if(opened)await db.query('ROLLBACK');
      await db.end();
    }
  });
