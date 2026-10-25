'use strict';

function exactKeys(value, keys) {
  return value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every(key =>
      Object.prototype.hasOwnProperty.call(value, key)
    );
}

function validateIamAttestation(a) {
  const required = [
    'schema', 'runId', 'startedAt', 'completedAt',
    'status', 'sdkExitCode', 'checks',
    'sdkScriptSha256', 'relatedHistoricalReport'
  ];

  const checkNames = [
    'adminCreate', 'get', 'put', 'preservedAfterPut',
    'delete', 'preservedAfterDelete', 'cleanup'
  ];

  const hash = value =>
    typeof value === 'string' &&
    /^[0-9a-f]{64}$/.test(value);

  const denied = value =>
    exactKeys(value, [
      'denied', 'httpStatus', 's3Code'
    ]) &&
    value.denied === true &&
    value.httpStatus === 403 &&
    value.s3Code === 'AccessDenied';

  const timestamp = value =>
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value));

  if (!exactKeys(a, required) ||
      a.schema !== 'skyhub-minio-dr-iam-attestation-v1' ||
      typeof a.runId !== 'string' ||
      !/^[A-Za-z0-9_-]{1,64}$/.test(a.runId) ||
      a.status !== 'passed' ||
      a.sdkExitCode !== 0 ||
      !hash(a.sdkScriptSha256) ||
      !timestamp(a.startedAt) ||
      !timestamp(a.completedAt) ||
      !exactKeys(a.checks, checkNames) ||
      !exactKeys(a.relatedHistoricalReport, [
        'runId', 'sha256', 'relationship'
      ])) {
    throw new Error('INVALID_IAM_ATTESTATION');
  }

  const c = a.checks;

  if (c.adminCreate !== true ||
      c.get !== true ||
      !denied(c.put) ||
      c.preservedAfterPut !== true ||
      !denied(c.delete) ||
      c.preservedAfterDelete !== true ||
      c.cleanup !== true ||
      !hash(a.relatedHistoricalReport.sha256) ||
      a.relatedHistoricalReport.relationship !==
        'historical-reference-only' ||
      a.relatedHistoricalReport.runId !==
        '20261022T032308' ||
      Date.parse(a.completedAt) < Date.parse(a.startedAt)) {
    throw new Error('INVALID_IAM_ATTESTATION_CHECKS');
  }

  return true;
}

module.exports = {validateIamAttestation};
