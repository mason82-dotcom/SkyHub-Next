'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');

const {
  createMinioDrRouter
} = require('../minio-dr-api');

const {createDrFixture} = require('./helpers/dr-fixture');

const fixture = createDrFixture();
const directory = fixture.status;
test.after(() => fixture.cleanup());

test('DR report is protected and readable via HTTP', async () => {
  const token = crypto.randomBytes(32).toString('hex');

  const app = express();

  app.use('/api', (req, res, next) => {
    const authorization = req.get('authorization');

    if (authorization !== `Bearer ${token}`) {
      return res.status(401).json({
        error: 'Unauthorized'
      });
    }

    next();
  });

  app.use(
    '/api/dr/minio',
    createMinioDrRouter({directory})
  );

  const server = await new Promise((resolve, reject) => {
    const instance = app.listen(0, '127.0.0.1', () => {
      resolve(instance);
    });

    instance.once('error', reject);
  });

  try {
    const address = server.address();
    const base = `http://127.0.0.1:${address.port}`;

    const unauthorized = await fetch(
      `${base}/api/dr/minio/status`
    );

    assert.equal(unauthorized.status, 401);

    const headers = {
      Authorization: `Bearer ${token}`
    };

    const statusResponse = await fetch(
      `${base}/api/dr/minio/status`,
      {headers}
    );

    assert.equal(statusResponse.status, 200);

    const status = await statusResponse.json();

    assert.equal(status.status, 'incomplete');
    assert.equal(status.readOnly, true);
    assert.equal(
      status.latest.checks.iamReadOnly,
      'unknown'
    );
    assert.equal(
      status.latest.metrics.verifiedFiles,
      54887
    );

    const reportsResponse = await fetch(
      `${base}/api/dr/minio/reports`,
      {headers}
    );

    assert.equal(reportsResponse.status, 200);

    const reports = await reportsResponse.json();

    assert.equal(reports.count, 1);
    assert.equal(reports.reports[0].status, 'incomplete');

    const writeResponse = await fetch(
      `${base}/api/dr/minio/status`,
      {
        method: 'POST',
        headers
      }
    );

    assert.equal(writeResponse.status, 404);

    console.log('HTTP 401: unauthorized access rejected');
    console.log('HTTP 200: validated DR status returned');
    console.log('HTTP 200: DR report history returned');
    console.log('HTTP 404: write method rejected');
  } finally {
    await new Promise((resolve, reject) => {
      server.close(error => {
        if (error) reject(error);
        else resolve();
      });

      server.closeIdleConnections?.();
    });
  }
});
