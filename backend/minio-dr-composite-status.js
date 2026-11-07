'use strict';

const path = require('node:path');
const {buildComposite} = require(
  '../scripts/minio-dr-composite'
);

const DEFAULT_ROOT = path.resolve(__dirname, '..');

function getCompositeStatus(baseDirectory = DEFAULT_ROOT) {
  const report = buildComposite(baseDirectory);

  if (
    report.schema !== 'skyhub-minio-dr-composite-v1' ||
    report.assessment !== 'supplemental-evidence-verified' ||
    report.endToEndStatus !== 'not-established'
  ) {
    throw new Error('INVALID_COMPOSITE_STATUS');
  }

  const h = report.historicalRestore;
  const a = report.iamAttestation;

  if (!h || !a ||
      h.status !== 'incomplete' ||
      a.status !== 'passed') {
    throw new Error('INVALID_COMPOSITE_EVIDENCE');
  }

  return {
    schema: 'skyhub-minio-dr-composite-status-v1',
    assessment: 'supplemental-evidence-verified',
    endToEndStatus: 'not-established',
    historicalRestore: {
      completedAt: h.completedAt,
      status: h.status,
      checks: {
        archiveIntegrity: h.checks.archiveIntegrity,
        fileIntegrity: h.checks.fileIntegrity,
        s3Read: h.checks.s3Read,
        isolation: h.checks.isolation,
        iamReadOnly: h.checks.iamReadOnly
      },
      metrics: {
        verifiedFiles: h.metrics.verifiedFiles,
        s3BucketsChecked: h.metrics.s3BucketsChecked,
        s3ObjectsRead: h.metrics.s3ObjectsRead
      }
    },
    iamAttestation: {
      completedAt: a.completedAt,
      status: a.status,
      putDenied: a.putDenied,
      deleteDenied: a.deleteDenied,
      cleanupPassed: a.cleanupPassed
    }
  };
}

module.exports = {getCompositeStatus};
