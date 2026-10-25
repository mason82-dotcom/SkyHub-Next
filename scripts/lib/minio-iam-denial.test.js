'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {classifyS3Denial} = require('./minio-iam-denial');

test('exact S3 AccessDenied is accepted', () => {
  assert.equal(
    classifyS3Denial([
      {status: 'error', error: {Code: 'AccessDenied'}}
    ]),
    'access_denied'
  );
});

test('progress record followed by AccessDenied', () => {
  assert.equal(
    classifyS3Denial([
      {status: 'success'},
      {
        status: 'error',
        error: {cause: {error: {Code: 'AccessDenied'}}}
      }
    ]),
    'access_denied'
  );
});

test('InternalError is not accepted', () => {
  assert.equal(
    classifyS3Denial([
      {status: 'error', error: {Code: 'InternalError'}}
    ]),
    'unverified'
  );
});

test('permission-related text alone is insufficient', () => {
  assert.equal(
    classifyS3Denial([
      {
        status: 'success'
      },
      {
        status: 'error',
        error: {
          cause: {
            message: 'Operation not authorized',
            error: {}
          }
        }
      }
    ]),
    'unverified'
  );
});

test('unexpected success is rejected', () => {
  assert.equal(
    classifyS3Denial([{status: 'success'}]),
    'invalid'
  );
});

test('extra records are rejected', () => {
  assert.equal(
    classifyS3Denial([
      {status: 'success'},
      {status: 'error', error: {Code: 'AccessDenied'}},
      {status: 'error', error: {Code: 'AccessDenied'}}
    ]),
    'invalid'
  );
});
