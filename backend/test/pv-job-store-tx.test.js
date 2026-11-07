'use strict';
// Review #81: an unusable pooled client must never leak a pool connection.
const test=require('node:test');
const assert=require('node:assert/strict');
const {createPvJobStore}=require('../experimental/pv_job_store.cjs');

const WS='e3dea0f5-37f2-4d79-ae58-490af3228069';
const ASSET='69ecb38c-04f2-44d0-adc6-3441cb4f9449';
const KEY='4d8779ac-4573-444d-ab9c-23ac0814f8b1';
const principal={role:'operator',workspaceId:WS,subject:'operator-1'};

test('client without query() is released and the request fails closed',async()=>{
  let released=0;
  const db={connect:async()=>({release(){released++;}})};
  const store=createPvJobStore({db,authorize:async()=>true,auditDenied:async()=>{}});
  await assert.rejects(store.request({workspaceId:WS,assetId:ASSET,idempotencyKey:KEY,principal}));
  assert.equal(released,1);
});

test('a failing query rolls back and releases exactly once',async()=>{
  const sql=[];let released=0;
  const db={connect:async()=>({
    async query(text){sql.push(text);if(text.startsWith('INSERT INTO skyhub_pv_jobs'))throw new Error('boom');return {rows:[]};},
    release(){released++;}
  })};
  const store=createPvJobStore({db,authorize:async()=>true,auditDenied:async()=>{}});
  await assert.rejects(store.request({workspaceId:WS,assetId:ASSET,idempotencyKey:KEY,principal}));
  assert.deepEqual([sql[0],sql.at(-1)],['BEGIN','ROLLBACK']);
  assert.equal(released,1);
});
