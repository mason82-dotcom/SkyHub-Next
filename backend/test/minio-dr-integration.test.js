'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const server = fs.readFileSync(
  path.join(__dirname, '..', 'server.js'),
  'utf8'
);

test('DR API is behind authentication middleware', () => {
  const authPosition = server.indexOf(
    "app.use('/api',auth);"
  );

  const drPosition = server.indexOf(
    "app.use('/api/dr/minio',createMinioDrRouter("
  );

  assert.ok(authPosition >= 0);
  assert.ok(drPosition > authPosition);
});

test('DR API is disabled by default', () => {
  assert.match(
    server,
    /process\.env\.SKYHUB_MINIO_DR_ENABLED==='true'/
  );
});

test('DR API requires configured report directory', () => {
  assert.match(
    server,
    /process\.env\.SKYHUB_MINIO_DR_REPORT_DIR/
  );

  assert.match(
    server,
    /path\.isAbsolute\(drDirectory\)/
  );
});

test('DR API is not in token-free LAN allowlist', () => {
  const httpAuth = fs.readFileSync(
    path.join(__dirname, '..', 'http-auth.js'),
    'utf8'
  );

  const start = httpAuth.indexOf(
    'const lanReadPaths=new Set('
  );

  const end = httpAuth.indexOf(
    'function createHttpAuth(',
    start
  );

  assert.ok(start >= 0);
  assert.ok(end > start);

  const allowlist = httpAuth.slice(start, end);

  assert.equal(
    allowlist.includes('/dr/minio'),
    false
  );
});

test('DR router exposes no write methods', () => {
  const router = fs.readFileSync(
    path.join(__dirname, '..', 'minio-dr-api.js'),
    'utf8'
  );

  assert.doesNotMatch(
    router,
    /router\.(post|put|patch|delete)\s*\(/
  );
});
