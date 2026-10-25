'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const {buildComposite} = require('../../scripts/minio-dr-composite');
const {createDrFixture} = require('./helpers/dr-fixture');

function withEvidence(callback) {
  const fixture = createDrFixture();

  try {
    return callback({
      directory: fixture.root,
      historic: fixture.historic,
      iam: fixture.iam
    });
  } finally {
    fixture.cleanup();
  }
}

function mutateJson(filename, mutate) {
  const data = JSON.parse(fs.readFileSync(filename, 'utf8'));
  mutate(data);
  fs.writeFileSync(filename, JSON.stringify(data) + '\n', {
    mode: 0o600
  });
}

test('valid evidence is accepted', () => {
  withEvidence(({directory}) => {
    const result = buildComposite(directory);

    assert.equal(
      result.assessment,
      'supplemental-evidence-verified'
    );
    assert.equal(result.endToEndStatus, 'not-established');
    assert.equal(result.iamAttestation.status, 'passed');
  });
});

test('modified historical evidence is rejected', () => {
  withEvidence(({directory, historic}) => {
    mutateJson(historic, value => {
      value.metrics.verifiedFiles = 1;
    });
    assert.throws(() => buildComposite(directory));
  });
});

test('PUT HTTP 500 is rejected', () => {
  withEvidence(({directory, iam}) => {
    mutateJson(iam, value => {
      value.checks.put.httpStatus = 500;
    });
    assert.throws(() => buildComposite(directory));
  });
});

test('incorrect S3 error code is rejected', () => {
  withEvidence(({directory, iam}) => {
    mutateJson(iam, value => {
      value.checks.delete.s3Code = 'InternalError';
    });
    assert.throws(() => buildComposite(directory));
  });
});

test('missing cleanup is rejected', () => {
  withEvidence(({directory, iam}) => {
    mutateJson(iam, value => {
      delete value.checks.cleanup;
    });
    assert.throws(() => buildComposite(directory));
  });
});

test('invalid chronology is rejected', () => {
  withEvidence(({directory, iam}) => {
    mutateJson(iam, value => {
      value.startedAt = '2026-10-20T00:00:00Z';
    });
    assert.throws(() => buildComposite(directory));
  });
});

test('symlink evidence is rejected', () => {
  withEvidence(({directory, iam}) => {
    const copy = iam + '.copy';

    fs.copyFileSync(iam, copy);
    fs.unlinkSync(iam);
    fs.symlinkSync(copy, iam);

    assert.throws(() => buildComposite(directory));
  });
});

test('oversized evidence is rejected', () => {
  withEvidence(({directory, iam}) => {
    fs.appendFileSync(iam, 'x'.repeat(20000));
    assert.throws(() => buildComposite(directory));
  });
});

test('missing attestation is rejected', () => {
  withEvidence(({directory, iam}) => {
    fs.unlinkSync(iam);
    assert.throws(() => buildComposite(directory));
  });
});


test('unknown attestation field is rejected', () => {
  withEvidence(({directory, iam}) => {
    mutateJson(iam, value => {
      value.unexpected = true;
    });
    assert.throws(() => buildComposite(directory));
  });
});

test('additional IAM check is rejected', () => {
  withEvidence(({directory, iam}) => {
    mutateJson(iam, value => {
      value.checks.unexpected = true;
    });
    assert.throws(() => buildComposite(directory));
  });
});

test('invalid SDK fingerprint is rejected', () => {
  withEvidence(({directory, iam}) => {
    mutateJson(iam, value => {
      value.sdkScriptSha256 = 'invalid';
    });
    assert.throws(() => buildComposite(directory));
  });
});
