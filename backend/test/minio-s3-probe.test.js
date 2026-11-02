'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {signS3, runProbe} = require('../../scripts/minio-s3-probe');

const cfg = {
  endpoint: 'http://skyhub-minio:9000',
  bucket: 'skyhub-storage-smoke',
  accessKey: 'TEST_ONLY_ACCESS',
  secretKey: 'TEST_ONLY_SECRET'
};

test('S3v4 signing emits canonical path, deterministic headers, no secret', () => {
  const r = signS3({
    ...cfg, method: 'PUT', key: 'sub dir/a+b.bin',
    payload: Buffer.from('hello'),
    at: new Date('2026-10-21T17:01:02Z')
  });
  assert.equal(r.url, 'http://skyhub-minio:9000/skyhub-storage-smoke/sub%20dir/a%2Bb.bin');
  assert.equal(r.headers['x-amz-date'], '20261021T170102Z');
  assert.equal(r.headers['x-amz-content-sha256'],
    '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  assert.match(r.headers.authorization, /^AWS4-HMAC-SHA256 Credential=TEST_ONLY_ACCESS\/20261021\/us-east-1\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[a-f0-9]{64}$/);
  assert.ok(!r.headers.authorization.includes('TEST_ONLY_SECRET'));
});

test('read-only S3 probe invokes only HEAD', async () => {
  const calls = [];
  const result = await runProbe({
    ...cfg,
    fetchImpl: async (url, init) => {
      calls.push({url, method:init.method});
      return {ok:true,status:200};
    }
  });
  assert.deepEqual(result, {mode:'read-only',head:200});
  assert.deepEqual(calls.map(c => c.method), ['HEAD']);
});

test('S3 write probe needs explicit opt-in and is always self-cleaning', async () => {
  await assert.rejects(runProbe({...cfg,write:true,fetchImpl:async()=>{throw Error('should not run')}}),
    /explicit SKYHUB_S3_WRITE_PROBE=1/);
  await assert.rejects(runProbe({
    ...cfg,bucket:'skyhub-media-raw',write:true,allowWrite:true,
    fetchImpl:async()=>{throw Error('should not run')}
  }),/restricted to dedicated skyhub-storage-smoke bucket/);
  const calls = [];
  let payload;
  const result = await runProbe({
    ...cfg, write:true, allowWrite:true,
    fetchImpl:async (url,init) => {
      const path = new URL(url).pathname;
      calls.push({path,method:init.method});
      if (init.method === 'PUT') payload = init.body;
      return {ok:true,status:200,arrayBuffer:async()=>payload};
    }
  });
  assert.deepEqual(calls.map(c=>c.method),['HEAD','PUT','GET','DELETE']);
  assert.match(calls[1].path,/\/__skyhub_smoke__\/[0-9a-f-]+\.bin$/);
  assert.equal(calls[1].path,calls[2].path);
  assert.equal(calls[1].path,calls[3].path);
  assert.deepEqual(result,{mode:'read/write/delete',head:200});
});

test('S3 write probe deletes temporary key after read failure', async () => {
  const calls = [];
  await assert.rejects(runProbe({
    ...cfg,write:true,allowWrite:true,
    fetchImpl:async(url,init)=>{
      calls.push(init.method);
      return {ok:init.method!=='GET',status:init.method==='GET'?403:200};
    }
  }),/S3 GET failed/);
  assert.deepEqual(calls,['HEAD','PUT','GET','DELETE']);
});

test('S3 probe rejects invalid bucket and endpoint without making requests', async () => {
  await assert.rejects(runProbe({
    ...cfg,bucket:'INVALID',fetchImpl:async()=>{throw Error('should not run')}
  }),/Invalid S3 bucket name/);
  assert.throws(()=>signS3({
    ...cfg,method:'HEAD',endpoint:'http://user:pass@localhost:9000'
  }),/origin URL/);
});
