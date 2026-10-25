'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const express = require('express');

const {createMinioDrRouter} = require('../minio-dr-api');

function report() {
  return {
    schema: 'skyhub-minio-dr-v1',
    runId: '20261022T032308',
    completedAt: '2026-10-22T03:25:17+02:00',
    checks: {
      archiveIntegrity: 'passed',
      fileIntegrity: 'passed',
      s3Read: 'passed',
      isolation: 'passed',
      iamReadOnly: 'passed'
    },
    metrics: {
      verifiedFiles: 54887,
      s3BucketsChecked: 5,
      s3ObjectsRead: 4
    },
    internalSecret: 'MUST_NOT_APPEAR'
  };
}

async function withServer(directory, callback) {
  const app = express();
  app.use('/api/dr/minio', createMinioDrRouter({directory}));

  const server = app.listen(0, '127.0.0.1');

  try {
    await new Promise((resolve, reject) => {
      if (server.listening) return resolve();
      server.once('listening', resolve);
      server.once('error', reject);
    });

    const address = server.address();
    const base = `http://127.0.0.1:${address.port}`;

    await callback(base);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test('status returns latest validated report', async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'skyhub-dr-api-')
  );

  try {
    await fs.writeFile(
      path.join(directory, 'minio-dr-test.json'),
      JSON.stringify(report())
    );

    await withServer(directory, async base => {
      const response = await fetch(`${base}/api/dr/minio/status`);
      const data = await response.json();

      assert.equal(response.status, 200);
      assert.equal(data.status, 'passed');
      assert.equal(data.readOnly, true);
      assert.equal(data.latest.metrics.verifiedFiles, 54887);
      assert.equal(data.latest.internalSecret, undefined);
    });
  } finally {
    await fs.rm(directory, {recursive: true, force: true});
  }
});

test('reports endpoint returns sanitized reports', async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'skyhub-dr-api-')
  );

  try {
    await fs.writeFile(
      path.join(directory, 'minio-dr-test.json'),
      JSON.stringify(report())
    );

    await withServer(directory, async base => {
      const response = await fetch(`${base}/api/dr/minio/reports`);
      const data = await response.json();

      assert.equal(response.status, 200);
      assert.equal(data.count, 1);
      assert.equal(data.reports[0].status, 'passed');
      assert.equal(
        JSON.stringify(data).includes('MUST_NOT_APPEAR'),
        false
      );
    });
  } finally {
    await fs.rm(directory, {recursive: true, force: true});
  }
});

test('empty report directory is unavailable', async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'skyhub-dr-api-')
  );

  try {
    await withServer(directory, async base => {
      const response = await fetch(`${base}/api/dr/minio/status`);
      const data = await response.json();

      assert.equal(response.status, 200);
      assert.equal(data.status, 'unavailable');
      assert.equal(data.latest, null);
    });
  } finally {
    await fs.rm(directory, {recursive: true, force: true});
  }
});

test('missing directory returns 503 without path disclosure', async () => {
  const directory = path.join(
    os.tmpdir(),
    'skyhub-dr-api-nonexistent-' + process.pid
  );

  await withServer(directory, async base => {
    const response = await fetch(`${base}/api/dr/minio/status`);
    const body = await response.text();

    assert.equal(response.status, 503);
    assert.equal(body.includes(directory), false);
  });
});

test('POST is not supported', async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'skyhub-dr-api-')
  );

  try {
    await withServer(directory, async base => {
      const response = await fetch(`${base}/api/dr/minio/status`, {
        method: 'POST'
      });

      assert.equal(response.status, 404);
    });
  } finally {
    await fs.rm(directory, {recursive: true, force: true});
  }
});
