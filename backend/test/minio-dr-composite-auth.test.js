'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');

const {createMinioDrRouter} = require('../minio-dr-api');

const {createDrFixture} = require('./helpers/dr-fixture');

const fixture = createDrFixture();
const ROOT = fixture.root;
test.after(() => fixture.cleanup());
const TOKEN = 'isolated-composite-test-token';

test('composite API enforces authentication', async () => {
  const app = express();

  app.use('/api', (req, res, next) => {
    if (req.get('authorization') !== `Bearer ${TOKEN}`) {
      return res.status(401).json({
        error: 'unauthorized'
      });
    }
    next();
  });

  app.use('/api/dr/minio', createMinioDrRouter({
    directory: path.join(ROOT, 'dr-status'),
    compositeRoot: ROOT
  }));

  const server = app.listen(0, '127.0.0.1');

  try {
    if (!server.listening) {
      await new Promise((resolve, reject) => {
        server.once('listening', resolve);
        server.once('error', reject);
      });
    }

    const base =
      `http://127.0.0.1:${server.address().port}/api/dr/minio/composite`;

    const anonymous = await fetch(base);
    assert.equal(anonymous.status, 401);

    const invalid = await fetch(base, {
      headers: {authorization: 'Bearer invalid'}
    });
    assert.equal(invalid.status, 401);

    const headers = {
      authorization: `Bearer ${TOKEN}`
    };

    const valid = await fetch(base, {headers});
    assert.equal(valid.status, 200);

    const status = await valid.json();
    assert.equal(
      status.assessment,
      'supplemental-evidence-verified'
    );
    assert.equal(
      status.endToEndStatus,
      'not-established'
    );

    const post = await fetch(base, {
      method: 'POST',
      headers
    });
    assert.equal(post.status, 404);

    console.log('ANONYMOUS=401');
    console.log('INVALID_TOKEN=401');
    console.log('VALID_TOKEN=200');
    console.log('POST=404');
    console.log('END_TO_END=not-established');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
