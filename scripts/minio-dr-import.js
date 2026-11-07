'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  validateReport
} = require('../backend/minio-dr-report');

const DEFAULT_SOURCE = path.resolve(
  __dirname, '../dr-reports'
);

function readSmallFile(filename, limit = 65536) {
  const stat = fs.lstatSync(filename);

  if (!stat.isFile() || stat.size > limit) {
    throw new Error('Invalid evidence file');
  }

  return fs.readFileSync(filename, 'utf8');
}

function importReport(directory) {
  const report = readSmallFile(path.join(
    directory, 'minio-restore-20261022.txt'
  ));

  const integrity = readSmallFile(path.join(
    directory, 'minio-integrity-20261022.log'
  ));

  const exitCode = readSmallFile(path.join(
    directory, 'minio-integrity-20261022.exit'
  )).trim();

  const start = integrity.match(
    /^START (\S+)$/m
  );

  const end = integrity.match(
    /^END (\S+)$/m
  );

  const entries = integrity.match(
    /^Entries: (\d+)$/m
  );

  const reportStart = report.match(
    /^Start: (\S+)$/m
  );

  const reportEnd = report.match(
    /^Ende: (\S+)$/m
  );

  const reportEntries = report.match(
    /^Manifest-Einträge: (\d+)$/m
  );

  const validTime = value =>
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value));

  const timelineMatches =
    Boolean(start && end && reportStart && reportEnd) &&
    validTime(start[1]) &&
    validTime(end[1]) &&
    validTime(reportStart[1]) &&
    validTime(reportEnd[1]) &&
    Date.parse(end[1]) >= Date.parse(start[1]) &&
    start[1] === reportStart[1] &&
    end[1] === reportEnd[1];

  const entryCountMatches =
    Boolean(entries && reportEntries) &&
    entries[1] === reportEntries[1] &&
    Number.isSafeInteger(Number(entries[1])) &&
    Number(entries[1]) > 0;

  const integrityPassed =
    timelineMatches &&
    entryCountMatches &&
    exitCode === '0' &&
    /^EXIT_CODE=0$/m.test(integrity) &&
    /^RESTORE_INTEGRITY_PASS$/m.test(integrity) &&
    /^PASS: complete file set, SHA256, sizes, owners, modes and xattrs match\.$/m.test(integrity) &&
    Boolean(start && end && entries) &&
    /^Ergebnis: RESTORE_INTEGRITY_PASS$/m.test(report) &&
    /^Exit-Code: 0$/m.test(report);

  const archivePassed =
    /^Archivprüfung: PASS$/m.test(report) &&
    /^Restore-Extraktion: PASS$/m.test(report);

  const bucketMatch = report.match(
    /^Buckets: (\d+)\/(\d+) PASS$/m
  );

  const objectMatch = report.match(
    /^Objekt-Lesetests: (\d+)\/(\d+) PASS$/m
  );

  const bucketsPassed = Boolean(
    bucketMatch &&
    Number(bucketMatch[1]) > 0 &&
    bucketMatch[1] === bucketMatch[2]
  );

  const objectsPassed = Boolean(
    objectMatch &&
    Number(objectMatch[1]) > 0 &&
    objectMatch[1] === objectMatch[2] &&
    /^S3-Lesefehler: 0$/m.test(report)
  );

  const isolationPassed =
    /^Docker-Isolation: PASS$/m.test(report) &&
    /^MinIO-Start: PASS$/m.test(report) &&
    /^=== Testcontainer-Netzwerk ===$/m.test(report);

  const completedAt = end?.[1];

  if (!completedAt ||
      !Number.isFinite(Date.parse(completedAt))) {
    throw new Error('Missing completion timestamp');
  }

  const checks = {
    archiveIntegrity: archivePassed ? 'passed' : 'unknown',
    fileIntegrity: integrityPassed ? 'passed' : 'unknown',
    s3Read: bucketsPassed && objectsPassed
      ? 'passed' : 'unknown',
    isolation: isolationPassed ? 'passed' : 'unknown',
    iamReadOnly: 'unknown'
  };

  const metrics = {};

  if (integrityPassed) {
    metrics.verifiedFiles = Number(entries[1]);
  }

  if (bucketsPassed) {
    metrics.s3BucketsChecked = Number(bucketMatch[1]);
  }

  if (objectsPassed) {
    metrics.s3ObjectsRead = Number(objectMatch[1]);
  }

  return validateReport({
    schema: 'skyhub-minio-dr-v1',
    runId: '20261022T032308',
    completedAt,
    checks,
    metrics
  });
}

if (require.main === module) {
  try {
    if (process.argv.length > 3 ||
        (process.argv[2] &&
         process.argv[2] !== '--preview')) {
      throw new Error('Only --preview is supported');
    }

    const result = importReport(DEFAULT_SOURCE);
    process.stdout.write(
      JSON.stringify(result, null, 2) + '\n'
    );
  } catch (_err) {
    console.error('DR evidence import failed');
    process.exitCode = 1;
  }
}

module.exports = {importReport};
