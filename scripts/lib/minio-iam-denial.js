'use strict';

function classifyS3Denial(records) {
  if (!Array.isArray(records) ||
      records.length < 1 ||
      records.length > 2) {
    return 'invalid';
  }

  if (records.length === 2 &&
      (records[0]?.status !== 'success' ||
       Object.keys(records[0]).length !== 1)) {
    return 'invalid';
  }

  const last = records[records.length - 1];

  if (!last ||
      last.status !== 'error' ||
      !last.error ||
      typeof last.error !== 'object' ||
      Array.isArray(last.error)) {
    return 'invalid';
  }

  const error = last.error;

  const code =
    error.Code ??
    error.code ??
    error.cause?.Code ??
    error.cause?.code ??
    error.cause?.error?.Code ??
    error.cause?.error?.code;

  if (code === 'AccessDenied') {
    return 'access_denied';
  }

  return 'unverified';
}

module.exports = {classifyS3Denial};
