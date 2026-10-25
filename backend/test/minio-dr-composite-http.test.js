'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');

const {createMinioDrRouter} = require('../minio-dr-api');

const {createDrFixture} = require('./helpers/dr-fixture');

const fixture = createDrFixture();
const ROOT = fixture.root;
test.after(() => fixture.cleanup());

async function serve(options, callback) {
  const app = express();
  app.use('/api/dr/minio', createMinioDrRouter(options));

  const server = app.listen(0, '127.0.0.1');
  try {
    if (!server.listening) {
      await new Promise((resolve, reject) => {
        server.once('listening', resolve);
        server.once('error', reject);
      });
    }

    const base = 'http://127.0.0.1:' + server.address().port;
    await callback(base);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test('composite endpoint is disabled by default', async () => {
  await serve({
    directory: path.join(ROOT, 'dr-status')
  }, async base => {
    const response = await fetch(base + '/api/dr/minio/composite');
    assert.equal(response.status, 404);
  });
});

test('composite GET returns sanitized status', async () => {
  await serve({
    directory: path.join(ROOT, 'dr-status'),
    compositeRoot: ROOT
  }, async base => {
    const response = await fetch(base + '/api/dr/minio/composite');
    const data = await response.json();

    assert.equal(response.status, 200);
    assert.equal(data.readOnly, true);
    assert.equal(
      data.assessment,
      'supplemental-evidence-verified'
    );
    assert.equal(data.endToEndStatus, 'not-established');
    assert.equal(data.iamAttestation.status, 'passed');

    const body = JSON.stringify(data);
    for (const forbidden of [
      'sdkScriptSha256',
      'relatedHistoricalReport',
      'sdkExitCode',
      'credentials',
      'password',
      'sha256'
    ]) {
      assert.equal(body.includes(forbidden), false);
    }
  });
});

test('composite POST is not supported', async () => {
  await serve({
    directory: path.join(ROOT, 'dr-status'),
    compositeRoot: ROOT
  }, async base => {
    const response = await fetch(base + '/api/dr/minio/composite', {
      method: 'POST'
    });
    assert.equal(response.status, 404);
  });
});

test('invalid composite evidence returns sanitized 503', async () => {
  const empty = fs.mkdtempSync(
    path.join(os.tmpdir(), 'skyhub-composite-http-')
  );

  try {
    await serve({
      directory: path.join(ROOT, 'dr-status'),
      compositeRoot: empty
    }, async base => {
      const response = await fetch(base + '/api/dr/minio/composite');
      const body = await response.text();

      assert.equal(response.status, 503);
      assert.equal(body.includes(empty), false);
      assert.equal(body.includes('Error:'), false);
    });
  } finally {
    fs.rmSync(empty, {recursive: true, force: true});
  }
});
