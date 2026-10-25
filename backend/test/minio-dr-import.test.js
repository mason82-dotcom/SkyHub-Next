'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  importReport
} = require('../../scripts/minio-dr-import');

const {createImportEvidence} = require('./helpers/dr-fixture');

// Synthetic logs; the real dr-reports/ directory is git-ignored.
const fixture = createImportEvidence();
const SOURCE = fixture.directory;
test.after(() => fixture.cleanup());

const FILES = [
  'minio-restore-20261022.txt',
  'minio-integrity-20261022.log',
  'minio-integrity-20261022.exit'
];

function withEvidence(callback) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'skyhub-dr-import-')
  );

  try {
    for (const name of FILES) {
      fs.copyFileSync(
        path.join(SOURCE, name),
        path.join(directory, name)
      );
    }

    return callback(directory);
  } finally {
    fs.rmSync(directory, {
      recursive: true,
      force: true
    });
  }
}

function replaceEvidence(directory, filename, before, after) {
  const file = path.join(directory, filename);
  const original = fs.readFileSync(file, 'utf8');

  assert.ok(
    original.includes(before),
    `Expected evidence marker missing: ${filename}`
  );

  fs.writeFileSync(
    file,
    original.replace(before, after)
  );
}

test('DR evidence remains incomplete without IAM', () => {
  const result = importReport(SOURCE);

  assert.equal(result.status, 'incomplete');
  assert.equal(result.checks.fileIntegrity, 'passed');
  assert.equal(result.checks.iamReadOnly, 'unknown');
  assert.equal(result.metrics.verifiedFiles, 54887);
});

test('nonzero process exit code invalidates integrity', () => {
  withEvidence(directory => {
    fs.writeFileSync(
      path.join(directory, FILES[2]),
      '1\n'
    );

    const result = importReport(directory);

    assert.equal(result.checks.fileIntegrity, 'unknown');
    assert.equal(result.status, 'incomplete');
    assert.equal(result.metrics.verifiedFiles, undefined);
  });
});

test('missing integrity success marker is not accepted', () => {
  withEvidence(directory => {
    replaceEvidence(
      directory,
      FILES[1],
      'RESTORE_INTEGRITY_PASS',
      'RESTORE_INTEGRITY_UNKNOWN'
    );

    const result = importReport(directory);

    assert.equal(result.checks.fileIntegrity, 'unknown');
  });
});

test('failed S3 object read is not accepted', () => {
  withEvidence(directory => {
    replaceEvidence(
      directory,
      FILES[0],
      'Objekt-Lesetests: 4/4 PASS',
      'Objekt-Lesetests: 3/4 FAIL'
    );

    const result = importReport(directory);

    assert.equal(result.checks.s3Read, 'unknown');
    assert.equal(result.metrics.s3ObjectsRead, undefined);
  });
});

test('missing isolation marker is not accepted', () => {
  withEvidence(directory => {
    replaceEvidence(
      directory,
      FILES[0],
      'Docker-Isolation: PASS',
      'Docker-Isolation: UNBEKANNT'
    );

    const result = importReport(directory);

    assert.equal(result.checks.isolation, 'unknown');
  });
});

test('invalid completion timestamp is rejected', () => {
  withEvidence(directory => {
    replaceEvidence(
      directory,
      FILES[1],
      'END 2026-10-22T03:25:17+02:00',
      'END invalid'
    );

    assert.throws(() => importReport(directory));
  });
});

test('missing evidence file is rejected', () => {
  withEvidence(directory => {
    fs.unlinkSync(path.join(directory, FILES[2]));

    assert.throws(() => importReport(directory));
  });
});

test('mismatched manifest entry count invalidates integrity', () => {
  withEvidence(directory => {
    replaceEvidence(
      directory,
      FILES[0],
      'Manifest-Einträge: 54887',
      'Manifest-Einträge: 54886'
    );

    const result = importReport(directory);

    assert.equal(result.checks.fileIntegrity, 'unknown');
    assert.equal(result.metrics.verifiedFiles, undefined);
    assert.equal(result.status, 'incomplete');
  });
});

test('mismatched start timestamp invalidates integrity', () => {
  withEvidence(directory => {
    replaceEvidence(
      directory,
      FILES[0],
      'Start: 2026-10-22T03:23:08+02:00',
      'Start: 2026-10-22T03:23:09+02:00'
    );

    const result = importReport(directory);

    assert.equal(result.checks.fileIntegrity, 'unknown');
    assert.equal(result.metrics.verifiedFiles, undefined);
  });
});

test('mismatched completion timestamp invalidates integrity', () => {
  withEvidence(directory => {
    replaceEvidence(
      directory,
      FILES[0],
      'Ende: 2026-10-22T03:25:17+02:00',
      'Ende: 2026-10-22T03:25:18+02:00'
    );

    const result = importReport(directory);

    assert.equal(result.checks.fileIntegrity, 'unknown');
    assert.equal(result.metrics.verifiedFiles, undefined);
  });
});

test('completion before start invalidates integrity', () => {
  withEvidence(directory => {
    for (const filename of [FILES[0], FILES[1]]) {
      replaceEvidence(
        directory,
        filename,
        '2026-10-22T03:25:17+02:00',
        '2026-10-22T03:20:00+02:00'
      );
    }

    const result = importReport(directory);

    assert.equal(result.checks.fileIntegrity, 'unknown');
    assert.equal(result.metrics.verifiedFiles, undefined);
  });
});

test('missing manifest count invalidates integrity', () => {
  withEvidence(directory => {
    replaceEvidence(
      directory,
      FILES[0],
      'Manifest-Einträge: 54887',
      'Manifest-Einträge: UNBEKANNT'
    );

    const result = importReport(directory);

    assert.equal(result.checks.fileIntegrity, 'unknown');
  });
});
