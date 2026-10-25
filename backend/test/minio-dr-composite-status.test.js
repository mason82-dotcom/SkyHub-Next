'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {getCompositeStatus} = require(
  '../minio-dr-composite-status'
);
const {createDrFixture} = require('./helpers/dr-fixture');

const fixture = createDrFixture();
test.after(() => fixture.cleanup());

test('composite status exposes verified evidence', () => {
  const status = getCompositeStatus(fixture.root);

  assert.equal(
    status.schema,
    'skyhub-minio-dr-composite-status-v1'
  );
  assert.equal(
    status.assessment,
    'supplemental-evidence-verified'
  );
  assert.equal(
    status.endToEndStatus,
    'not-established'
  );
  assert.equal(status.iamAttestation.status, 'passed');
  assert.equal(
    status.historicalRestore.metrics.verifiedFiles,
    54887
  );
});

test('composite status does not expose raw evidence', () => {
  const status = getCompositeStatus(fixture.root);
  const body = JSON.stringify(status);

  for (const forbidden of [
    'sdkScriptSha256',
    'sdkExitCode',
    'relatedHistoricalReport',
    'credentials',
    'password',
    'sha256',
    'runId'
  ]) {
    assert.equal(body.includes(forbidden), false);
  }
});

test('missing evidence fails closed', () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'skyhub-composite-missing-')
  );

  try {
    assert.throws(() => getCompositeStatus(root));
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
});
