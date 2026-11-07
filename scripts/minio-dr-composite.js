'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {validateReport} = require('../backend/minio-dr-report');

const {validateIamAttestation} = require(
  './lib/minio-dr-iam-attestation'
);

const ROOT = path.resolve(__dirname, '..');

const HISTORIC = 'minio-dr-20261022T032308.json';
const ATTESTATION = 'sdk-iam-20261022T044017-d23f34fb.json';

function requireEvidence(filename) {
  const flags = fs.constants.O_RDONLY |
    fs.constants.O_NOFOLLOW |
    fs.constants.O_NONBLOCK;

  const fd = fs.openSync(filename, flags);

  try {
    const stat = fs.fstatSync(fd);

    if (!stat.isFile() ||
        stat.size < 1 ||
        stat.size > 16384 ||
        (stat.mode & 0o022) !== 0) {
      throw new Error('INVALID_EVIDENCE_FILE');
    }

    const bytes = Buffer.alloc(stat.size);
    let position = 0;

    while (position < bytes.length) {
      const count = fs.readSync(
        fd,
        bytes,
        position,
        bytes.length - position,
        position
      );

      if (count === 0) {
        throw new Error('INCOMPLETE_EVIDENCE_READ');
      }

      position += count;
    }

    const probe = Buffer.alloc(1);
    if (fs.readSync(fd, probe, 0, 1, position) !== 0) {
      throw new Error('EVIDENCE_SIZE_CHANGED');
    }

    const after = fs.fstatSync(fd);
    if (after.size !== stat.size ||
        after.mtimeMs !== stat.mtimeMs ||
        after.ctimeMs !== stat.ctimeMs) {
      throw new Error('EVIDENCE_CHANGED_DURING_READ');
    }

    return {
      data: JSON.parse(bytes.toString('utf8')),
      sha256: crypto.createHash('sha256')
        .update(bytes).digest('hex')
    };
  } finally {
    fs.closeSync(fd);
  }
}

function assert(condition) {
  if (!condition) {
    throw new Error('EVIDENCE_VERIFICATION_FAILED');
  }
}

function buildComposite(baseDirectory = ROOT) {
  const historical = requireEvidence(
    path.join(baseDirectory, 'dr-status', HISTORIC)
  );

  const iam = requireEvidence(
    path.join(baseDirectory, 'dr-status', 'iam', ATTESTATION)
  );

  const h = historical.data;
  const a = iam.data;
  validateIamAttestation(a);
  const c = a.checks;

  const validated = validateReport(h);

  assert(
    validated.runId === '20261022T032308' &&
    validated.status === 'incomplete' &&
    validated.checks.archiveIntegrity === 'passed' &&
    validated.checks.fileIntegrity === 'passed' &&
    validated.checks.s3Read === 'passed' &&
    validated.checks.isolation === 'passed' &&
    validated.checks.iamReadOnly === 'unknown'
  );

  const denied = value =>
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    value.denied === true &&
    value.httpStatus === 403 &&
    value.s3Code === 'AccessDenied';

  assert(
    a.schema === 'skyhub-minio-dr-iam-attestation-v1' &&
    a.status === 'passed' &&
    a.sdkExitCode === 0 &&
    c &&
    c.adminCreate === true &&
    c.get === true &&
    denied(c.put) &&
    denied(c.delete) &&
    c.preservedAfterPut === true &&
    c.preservedAfterDelete === true &&
    c.cleanup === true &&
    a.relatedHistoricalReport?.runId === validated.runId &&
    a.relatedHistoricalReport?.sha256 === historical.sha256 &&
    a.relatedHistoricalReport?.relationship ===
      'historical-reference-only'
  );

  const start = Date.parse(a.startedAt);
  const end = Date.parse(a.completedAt);
  const historicEnd = Date.parse(validated.completedAt);

  assert(
    Number.isFinite(start) &&
    Number.isFinite(end) &&
    Number.isFinite(historicEnd) &&
    start >= historicEnd &&
    end >= start &&
    end <= Date.now() + 60000
  );

  return {
    schema: 'skyhub-minio-dr-composite-v1',
    createdAt: new Date().toISOString(),
    assessment: 'supplemental-evidence-verified',
    endToEndStatus: 'not-established',
    historicalRestore: {
      runId: validated.runId,
      completedAt: validated.completedAt,
      status: validated.status,
      checks: validated.checks,
      metrics: validated.metrics,
      sha256: historical.sha256
    },
    iamAttestation: {
      runId: a.runId,
      startedAt: a.startedAt,
      completedAt: a.completedAt,
      status: a.status,
      sha256: iam.sha256,
      putDenied: true,
      deleteDenied: true,
      cleanupPassed: true
    }
  };
}

function saveComposite(report) {
  const directory = path.join(ROOT, 'dr-status', 'composite');

  fs.mkdirSync(directory, {
    recursive: true,
    mode: 0o700
  });

  const stat = fs.lstatSync(directory);

  assert(
    stat.isDirectory() &&
    !stat.isSymbolicLink() &&
    (stat.mode & 0o077) === 0
  );

  const name = 'minio-dr-composite-' +
    Date.now() + '-' +
    crypto.randomBytes(4).toString('hex') + '.json';

  const target = path.join(directory, name);

  fs.writeFileSync(
    target,
    JSON.stringify(report, null, 2) + '\n',
    {flag: 'wx', mode: 0o600}
  );

  return name;
}

if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    assert(
      args.length === 1 &&
      ['--preview', '--save'].includes(args[0])
    );

    const report = buildComposite();

    if (args[0] === '--preview') {
      console.log(JSON.stringify(report, null, 2));
    } else {
      const filename = saveComposite(report);
      console.log('COMPOSITE_SAVED=' + filename);
      console.log('ASSESSMENT=' + report.assessment);
      console.log('END_TO_END=' + report.endToEndStatus);
    }
  } catch (_) {
    console.error('DR_COMPOSITE_VERIFICATION_FAILED');
    process.exitCode = 1;
  }
}

module.exports = {buildComposite};
