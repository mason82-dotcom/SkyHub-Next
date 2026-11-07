'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  validateReport,
  readReports
} = require('../minio-dr-report');

function sample(overrides = {}) {
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
    ...overrides
  };
}

test('complete successful report', () => {
  const result = validateReport(sample());

  assert.equal(result.status, 'passed');
  assert.equal(result.metrics.verifiedFiles, 54887);
});

test('missing check is unknown, not passed', () => {
  const report = sample({
    checks: {
      fileIntegrity: 'passed'
    }
  });

  const result = validateReport(report);

  assert.equal(result.status, 'incomplete');
  assert.equal(result.checks.s3Read, 'unknown');
});

test('failed check makes report failed', () => {
  const report = sample({
    checks: {
      archiveIntegrity: 'passed',
      fileIntegrity: 'failed',
      s3Read: 'passed',
      isolation: 'passed',
      iamReadOnly: 'passed'
    }
  });

  assert.equal(validateReport(report).status, 'failed');
});

test('invalid check state is rejected', () => {
  const report = sample({
    checks: {
      archiveIntegrity: 'SUCCESS'
    }
  });

  assert.throws(() => validateReport(report));
});

test('negative metrics are rejected', () => {
  const report = sample({
    metrics: {
      verifiedFiles: -1
    }
  });

  assert.throws(() => validateReport(report));
});

test('extra fields are never exposed', () => {
  const report = sample({
    password: 'SECRET_VALUE',
    internalPath: '/private/location'
  });

  const result = validateReport(report);

  assert.equal(result.password, undefined);
  assert.equal(result.internalPath, undefined);
});

test('invalid run identifiers are rejected', () => {
  assert.throws(() =>
    validateReport(sample({
      runId: '../private'
    }))
  );
});

test('valid JSON report can be read', async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'skyhub-dr-test-')
  );

  try {
    await fs.writeFile(
      path.join(directory, 'minio-dr-test.json'),
      JSON.stringify(sample())
    );

    const reports = await readReports(directory);

    assert.equal(reports.length, 1);
    assert.equal(reports[0].status, 'passed');
  } finally {
    await fs.rm(directory, {
      recursive: true,
      force: true
    });
  }
});

test('symlink reports are ignored', async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'skyhub-dr-test-')
  );

  try {
    const source = path.join(directory, 'source.json');

    await fs.writeFile(
      source,
      JSON.stringify(sample())
    );

    await fs.symlink(
      source,
      path.join(directory, 'minio-dr-link.json')
    );

    const reports = await readReports(directory);

    assert.equal(reports.length, 0);
  } finally {
    await fs.rm(directory, {
      recursive: true,
      force: true
    });
  }
});

test('oversized reports are ignored', async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'skyhub-dr-test-')
  );

  try {
    await fs.writeFile(
      path.join(directory, 'minio-dr-large.json'),
      'x'.repeat(20000)
    );

    const reports = await readReports(directory);

    assert.equal(reports.length, 0);
  } finally {
    await fs.rm(directory, {
      recursive: true,
      force: true
    });
  }
});
