'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {Pool}=require('pg');
const {createPilotMediaMutationTransaction}=require('../pilot-media-mutation');
const {createPilotMediaStore}=require('../pilot-media-store');

const url=process.env.SKYHUB_TEST_DATABASE_URL;
const WS='e3dea0f5-37f2-4d79-ae58-490af3228069';
const NOW=Date.parse('2026-10-22T15:00:00Z');
const PFX=WS+'/media/'+'a'.repeat(32);
const callback={result:0,name:'DJI_0001.JPG',object_key:PFX+'/DJI_0001.JPG',
  fingerprint:'DJI_FULL_01',ext:{file_group_id:'mission-group-01'}};
const grant={provider:'minio',bucket:'dji-cloud',objectKeyPrefix:PFX,
  credentials:{expire:900}};

test('media callback and audit commit together or roll back together',
  {skip:!url},async()=>{
    const target=new URL(url);
    assert.equal(target.protocol,'postgresql:');
    assert.ok(['127.0.0.1','localhost','::1','[::1]'].includes(target.hostname));
    assert.equal(decodeURIComponent(target.pathname),'/skyhub_test');
    const name='pilot_media_atomic_ci_'+crypto.randomBytes(8).toString('hex');
    const pool=new Pool({connectionString:url,max:2,connectionTimeoutMillis:5000,
      query_timeout:12000,application_name:'skyhub_ci_pilot_media_atomic'});
    try{
      assert.equal((await pool.query('SELECT current_database() AS db')).rows[0].db,
        'skyhub_test');
      await pool.query('CREATE SCHEMA "'+name+'"');
      const scoped=new Pool({connectionString:url,max:2,connectionTimeoutMillis:5000,
        query_timeout:12000,options:'-c search_path='+name+',public'});
      try{
        for(const script of ['003_dji_pilot_media_verified.sql',
          '004_dji_pilot_media_http.sql']){
          const sql=fs.readFileSync(path.resolve(__dirname,'../db/migrations/'+script),'utf8');
          await scoped.query(sql);
        }
        await createPilotMediaStore(scoped,{clock:()=>NOW}).registerGrant({workspace:WS,grant});
        const transaction=createPilotMediaMutationTransaction(scoped,{clock:()=>NOW+1000});
        const work=async({store,audit})=>{
          const result=await store.verifyCallback({workspace:WS,callback,
            headObject:async()=>({size:5463,etag:'"valid"',lastModified:new Date(NOW+2000)})});
          await audit({workspace:WS,operation:'upload_callback',outcome:'ok'});
          return result;
        };
        await scoped.query(`CREATE FUNCTION reject_media_audit() RETURNS trigger
          LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit unavailable'; END $$`);
        await scoped.query(`CREATE TRIGGER reject_media_audit BEFORE INSERT ON
          dji_pilot_media_http_audit FOR EACH ROW EXECUTE FUNCTION reject_media_audit()`);
        await assert.rejects(transaction(work),/audit unavailable/);
        assert.equal((await scoped.query('SELECT count(*)::int AS n FROM dji_pilot_media_verified')).rows[0].n,0);
        await scoped.query('DROP TRIGGER reject_media_audit ON dji_pilot_media_http_audit');
        assert.deepEqual(await transaction(work),{status:'verified'});
        assert.deepEqual(await transaction(work),{status:'duplicate'});
        assert.equal((await scoped.query('SELECT count(*)::int AS n FROM dji_pilot_media_verified')).rows[0].n,1);
        assert.equal((await scoped.query('SELECT count(*)::int AS n FROM dji_pilot_media_http_audit')).rows[0].n,2);
      }finally{await scoped.end();}
    }finally{
      await pool.query('DROP SCHEMA IF EXISTS "'+name+'" CASCADE');
      await pool.end();
    }
  });
