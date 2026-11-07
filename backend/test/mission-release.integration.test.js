'use strict';
// Mission release against real PostgreSQL (CI service): schema, one active release per route family, revoke, expiry.
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {Pool}=require('pg');
const {createReleaseStore}=require('../mission-release');
const TEST_DATABASE_URL=process.env.SKYHUB_TEST_DATABASE_URL;

function safeUrl(raw){
  const url=new URL(raw);
  assert.ok(['127.0.0.1','localhost','[::1]','::1'].includes(url.hostname));
  assert.equal(decodeURIComponent(url.pathname),'/skyhub_test');
}
const uuid=()=>crypto.randomUUID();
const sha=()=>crypto.randomBytes(32).toString('hex');

test('release table: unique active release per family, superseding, revoke and expiry',{skip:!TEST_DATABASE_URL},async()=>{
  safeUrl(TEST_DATABASE_URL);
  const schema='mr_'+crypto.randomBytes(4).toString('hex');
  const admin=new Pool({connectionString:TEST_DATABASE_URL,max:1});
  await admin.query('CREATE SCHEMA '+schema);
  const pool=new Pool({connectionString:TEST_DATABASE_URL,max:3,options:'-c search_path='+schema});
  try{
    let clock=new Date('2026-11-04T12:00:00Z');
    const store=createReleaseStore(pool,{now:()=>clock});
    const root=uuid(),a=uuid(),b=uuid();
    const base={rootId:root,name:'Feld',droneModelKey:'0-77-2',payloadModelKeys:['1-68-0'],envelope:{maxHeightAboveTakeoffM:50},
      acknowledged:{warnings:[]},from:'192.168.178.20'};
    const exp=h=>new Date(clock.getTime()+h*3600e3);
    const r1=await store.release({...base,waylineId:a,sha256:sha(),releasedAt:clock,expiresAt:exp(72)});
    assert.equal(r1.waylineId,a);
    assert.deepEqual((await store.active()).map(r=>r.waylineId),[a]);
    await store.release({...base,waylineId:b,sha256:sha(),releasedAt:clock,expiresAt:exp(72)});
    assert.deepEqual((await store.active()).map(r=>r.waylineId),[b],'superseded');
    const hist=await store.history([a,b]);
    assert.equal(hist.find(r=>r.waylineId===a).revokeReason,'ersetzt durch neue Freigabe');
    // The partial unique index refuses a second active row for the family even outside the store.
    await assert.rejects(pool.query(`INSERT INTO wpml_mission_release(wayline_id,root_id,sha256,name,drone_model_key,payload_model_keys,
      envelope,acknowledged,expires_at) VALUES ($1,$2,$3,'x','0-77-2','{}','{}','{}',now()+interval '1 hour')`,[uuid(),root,sha()]),/unique/i);
    await assert.rejects(pool.query(`INSERT INTO wpml_mission_release(wayline_id,root_id,sha256,name,drone_model_key,payload_model_keys,
      envelope,acknowledged,expires_at) VALUES ($1,$2,'kaputt','x','0-77-2','{}','{}','{}',now()+interval '1 hour')`,[uuid(),uuid()]),/check/i);
    clock=new Date(clock.getTime()+73*3600e3);
    assert.deepEqual(await store.active(),[],'expired');
    const revoked=await store.revoke(b,{from:'192.168.178.20',reason:'Wetter'});
    assert.equal(revoked.length,1);
    assert.equal((await store.revoke(b,{from:'x',reason:'y'})).length,0);
  }finally{
    await pool.end();
    await admin.query('DROP SCHEMA '+schema+' CASCADE');
    await admin.end();
  }
});
