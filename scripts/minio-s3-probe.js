#!/usr/bin/env node
'use strict';
// Opt-in S3 SigV4 probe, dependency-free for Node.js 22+.
// Read-only by default. Never logs credentials or object payload.
const crypto = require('node:crypto');

const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();

function requireBucket(bucket) {
  if (typeof bucket !== 'string' ||
      !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket) ||
      bucket.includes('..') || /^\d+\.\d+\.\d+\.\d+$/.test(bucket)) {
    throw new Error('Invalid S3 bucket name');
  }
  return bucket;
}

function endpointUrl(endpoint) {
  const url = new URL(endpoint);
  if (!['http:', 'https:'].includes(url.protocol) ||
      url.username || url.password || url.pathname !== '/' ||
      url.search || url.hash) {
    throw new Error('S3 endpoint must be an origin URL without credentials');
  }
  return url;
}

function signS3({ method, endpoint, bucket, key = '', payload = Buffer.alloc(0),
                  accessKey, secretKey, region = 'us-east-1', at = new Date() }) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(region)) throw new Error('Invalid region');
  if (!accessKey || !secretKey) throw new Error('S3 credentials missing');
  requireBucket(bucket);
  const url = endpointUrl(endpoint);
  const encodedKey = key ? '/' + key.split('/').map(encodeURIComponent).join('/') : '';
  const uri = '/' + bucket + encodedKey;
  url.pathname = uri;
  const date = at.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = date.slice(0, 8);
  const digest = sha256(payload);
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
  const canonicalHeaders =
    'host:' + url.host + '\n' +
    'x-amz-content-sha256:' + digest + '\n' +
    'x-amz-date:' + date + '\n';
  const request = [
    method, uri, '', canonicalHeaders, signedHeaders, digest
  ].join('\n');
  const scope = day + '/' + region + '/s3/aws4_request';
  const toSign = [
    'AWS4-HMAC-SHA256', date, scope, sha256(Buffer.from(request))
  ].join('\n');
  let keyBytes = hmac('AWS4' + secretKey, day);
  for (const scopePart of [region, 's3', 'aws4_request']) {
    keyBytes = hmac(keyBytes, scopePart);
  }
  const signature = crypto.createHmac('sha256', keyBytes).update(toSign).digest('hex');
  return {
    url: url.toString(),
    headers: {
      'x-amz-date': date,
      'x-amz-content-sha256': digest,
      authorization: 'AWS4-HMAC-SHA256 Credential=' + accessKey + '/' + scope +
        ', SignedHeaders=' + signedHeaders + ', Signature=' + signature
    }
  };
}

async function runProbe({
  endpoint, bucket, accessKey, secretKey, region = 'us-east-1',
  write = false, allowWrite = false, fetchImpl = fetch
}) {
  if (write && !allowWrite) {
    throw new Error('Writing requires explicit SKYHUB_S3_WRITE_PROBE=1');
  }
  if (write && bucket !== 'skyhub-storage-smoke') {
    throw new Error('Write test restricted to dedicated skyhub-storage-smoke bucket');
  }
  // Read-only by default; requires s3:ListBucket for the named bucket.
  async function request(method, key = '', payload = Buffer.alloc(0)) {
    const signed = signS3({
      method, endpoint, bucket, key, payload, accessKey, secretKey, region
    });
    const res = await fetchImpl(signed.url, {
      method,
      headers: signed.headers,
      ...(method === 'PUT' ? { body: payload } : {}),
      signal: AbortSignal.timeout(12000)
    });
    return res;
  }
  const head = await request('HEAD');
  if (!head.ok) throw new Error('S3 HEAD bucket failed: HTTP ' + head.status);
  if (!write) return { mode: 'read-only', head: head.status };
  // Never touch business objects; only a fresh, unguessable smoke-test key.
  const key = '__skyhub_smoke__/' + crypto.randomUUID() + '.bin';
  const original = crypto.randomBytes(32);
  let created = false;
  try {
    const put = await request('PUT', key, original);
    if (!put.ok) throw new Error('S3 PUT failed: HTTP ' + put.status);
    created = true;
    const get = await request('GET', key);
    if (!get.ok) throw new Error('S3 GET failed: HTTP ' + get.status);
    const observed = Buffer.from(await get.arrayBuffer());
    if (!original.equals(observed)) throw new Error('S3 GET checksum mismatch');
  } finally {
    if (created) {
      const del = await request('DELETE', key);
      if (!del.ok) throw new Error('S3 smoke cleanup failed: HTTP ' + del.status);
    }
  }
  return { mode: 'read/write/delete', head: head.status };
}

async function main() {
  const flag = process.argv[2] || '--read';
  if (!['--read', '--write'].includes(flag) || process.argv.length > 3) {
    throw new Error('Usage: node minio-s3-probe.js [--read|--write]');
  }
  const write = flag === '--write';
  const result = await runProbe({
    endpoint: process.env.SKYHUB_S3_ENDPOINT || 'http://skyhub-minio:9000',
    bucket: process.env.SKYHUB_S3_BUCKET,
    accessKey: process.env.SKYHUB_S3_ACCESS_KEY,
    secretKey: process.env.SKYHUB_S3_SECRET_KEY,
    region: process.env.SKYHUB_S3_REGION || 'us-east-1',
    write, allowWrite: process.env.SKYHUB_S3_WRITE_PROBE === '1'
  });
  console.log('S3 probe successful: ' + result.mode + ' (HEAD HTTP ' + result.head + ')');
}

if (require.main === module) {
  main().catch(error => {
    // Only controlled errors; no Authorization headers or response bodies.
    console.error('S3 probe failed: ' + error.message);
    process.exitCode = 1;
  });
}
module.exports = { sha256, requireBucket, endpointUrl, signS3, runProbe };
