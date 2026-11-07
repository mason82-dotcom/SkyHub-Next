'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawnSync} = require('node:child_process');
const {
  classifyS3Denial
} = require('./lib/minio-iam-denial');

const root = path.resolve(__dirname, '..');
const credentialsPath = path.join(
  root, 'dr-status/iam/dr-test-credentials.json'
);

function fail(message) {
  throw new Error(message);
}

function runCheck() {
  const stat = fs.lstatSync(credentialsPath);

  if (!stat.isFile() || stat.isSymbolicLink() ||
      (stat.mode & 0o077) !== 0 ||
      stat.size > 4096) {
    fail('Unsafe credentials file');
  }

  const credentials = JSON.parse(
    fs.readFileSync(credentialsPath, 'utf8')
  );

  if (!/^skyhub-dr-test-[a-f0-9]{8}$/.test(
    credentials.username
  ) ||
      typeof credentials.password !== 'string' ||
      credentials.password.length < 32 ||
      credentials.policy !== 'skyhub-dr-readonly') {
    fail('Invalid test credentials');
  }

  const key = 'skyhub-dr-iam-test/' +
    crypto.randomBytes(16).toString('hex') + '.txt';

  const shell = String.raw`
set -eu
set +x
umask 077

tmp=$(mktemp -d)
export MC_CONFIG_DIR="$tmp/mc"
mkdir -m 700 "$MC_CONFIG_DIR"

created=0
cleanup_failed=0

cleanup() {
  if [ "$created" = 1 ]; then
    if ! mc rm --force \
      "admin/dji-cloud/$DR_TEST_KEY" \
      >/dev/null 2>&1; then
      cleanup_failed=1
    fi

    if mc stat "admin/dji-cloud/$DR_TEST_KEY" \
      >/dev/null 2>&1; then
      cleanup_failed=1
    fi
  fi

  rm -rf "$tmp"

  if [ "$cleanup_failed" = 1 ]; then
    echo "CLEANUP_FAILED"
    exit 1
  elif [ "$created" = 1 ]; then
    echo "CLEANUP_PASS"
  fi
}
trap cleanup EXIT

mc alias set admin http://127.0.0.1:9000 \
  "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" \
  >/dev/null 2>&1

mc alias set test http://127.0.0.1:9000 \
  "$DR_TEST_USER" "$DR_TEST_PASSWORD" \
  >/dev/null 2>&1

mc admin user info admin "$DR_TEST_USER" \
  --json > "$tmp/user.json"

echo "POLICY_INFO_BEGIN"
cat "$tmp/user.json"
echo "POLICY_INFO_END"


if mc stat "admin/dji-cloud/$DR_TEST_KEY" \
  >/dev/null 2>&1; then
  echo "KEY_COLLISION"
  exit 1
fi

printf 'SkyHub isolated IAM acceptance test\n' \
  > "$tmp/source"

echo "ADMIN_UPLOAD_BEGIN"

if ! mc cp "$tmp/source" \
  "admin/dji-cloud/$DR_TEST_KEY" \
  >/dev/null 2>&1; then
  echo "ADMIN_UPLOAD_FAILED"
  exit 1
fi

created=1
echo "ADMIN_UPLOAD_PASS"

if ! mc cp "test/dji-cloud/$DR_TEST_KEY" \
  "$tmp/received" >/dev/null 2>&1; then
  echo "GET_FAILED"
  exit 1
fi

cmp -s "$tmp/source" "$tmp/received" || {
  echo "CONTENT_MISMATCH"
  exit 1
}

echo "GET_PASS"

if mc --json cp "$tmp/source" \
  "test/dji-cloud/$DR_TEST_KEY" \
  >"$tmp/put.out" 2>&1; then
  echo "PUT_UNEXPECTED_SUCCESS"
  exit 1
fi

if ! grep -qi 'Access Denied\|AccessDenied' \
  "$tmp/put.out"; then
  echo "PUT_ERROR_NOT_ACCESS_DENIED"
  echo "PUT_JSON_B64_BEGIN"
  base64 "$tmp/put.out" | tr -d '\n'
  echo
  echo "PUT_JSON_B64_END"
  if grep -Eqi 'permission|not authorized|not allowed' "$tmp/put.out"; then
    echo "PUT_DIAG_PERMISSION_RELATED"
  elif grep -Eqi 'timeout|connection refused|network' "$tmp/put.out"; then
    echo "PUT_DIAG_TRANSPORT"
  elif grep -Eqi 'invalid|malformed|unsupported' "$tmp/put.out"; then
    echo "PUT_DIAG_CLIENT_OR_REQUEST"
  else
    echo "PUT_DIAG_UNKNOWN"
  fi
  exit 1
fi

echo "PUT_DENIED_PASS"

if mc rm --json \
  "test/dji-cloud/$DR_TEST_KEY" \
  >"$tmp/delete.out" 2>&1; then
  echo "DELETE_UNEXPECTED_SUCCESS"
  exit 1
fi

if ! grep -qi 'Access Denied\|AccessDenied' \
  "$tmp/delete.out"; then
  echo "DELETE_ERROR_NOT_ACCESS_DENIED"
  exit 1
fi

echo "DELETE_DENIED_PASS"

if ! mc stat "admin/dji-cloud/$DR_TEST_KEY" \
  >/dev/null 2>&1; then
  echo "TEST_OBJECT_MISSING"
  exit 1
fi

echo "OBJECT_PRESERVED_PASS"
`;

  const result = spawnSync(
    'docker',
    [
      'exec', '-i',
      '-e', `DR_TEST_USER=${credentials.username}`,
      '-e', 'DR_TEST_PASSWORD',
      '-e', `DR_TEST_KEY=${key}`,
      'skyhub-next-minio-1',
      'sh', '-s'
    ],
    {
      input: shell,
      env: {
        ...process.env,
        DR_TEST_PASSWORD: credentials.password
      },
      encoding: 'utf8',
      timeout: 60000,
      maxBuffer: 65536
    }
  );

  const output = result.stdout || '';

  // Require exactly one complete IAM response.
  const matches = [...output.matchAll(
    /^POLICY_INFO_BEGIN\r?\n([^\r\n]+)\r?\nPOLICY_INFO_END$/gm
  )];

  let policyValid = false;

  if (matches.length === 1) {
    try {
      const info = JSON.parse(matches[0][1]);

      const policies =
        typeof info.policyName === 'string'
          ? info.policyName
              .split(',')
              .map(value => value.trim())
              .filter(Boolean)
          : [];

      policyValid =
        info !== null &&
        typeof info === 'object' &&
        !Array.isArray(info) &&
        info.status === 'success' &&
        info.accessKey === credentials.username &&
        info.userStatus === 'enabled' &&
        policies.length === 1 &&
        policies[0] === 'skyhub-dr-readonly';

    } catch {
      policyValid = false;
    }
  }

  // Decode diagnostics on the host, never in the MinIO container.
  // Do not expose the original error message.
  let putJsonShape = 'NOT_PRESENT';

  const beginCount =
    (output.match(/^PUT_JSON_B64_BEGIN$/gm) || []).length;
  const endCount =
    (output.match(/^PUT_JSON_B64_END$/gm) || []).length;

  const blocks = [...output.matchAll(
    /^PUT_JSON_B64_BEGIN\r?\n([A-Za-z0-9+/=]+)\r?\nPUT_JSON_B64_END$/gm
  )];

  if (beginCount !== 0 || endCount !== 0) {
    if (beginCount !== 1 || endCount !== 1) {
      putJsonShape = 'MARKER_COUNT_INVALID';
    } else if (blocks.length !== 1) {
      putJsonShape = 'BASE64_BLOCK_INVALID';
    } else if (blocks[0][1].length > 16384) {
      putJsonShape = 'BASE64_TOO_LARGE';
    } else {
      try {
        const encoded = blocks[0][1];
        const decoded = Buffer.from(encoded, 'base64');

        if (decoded.toString('base64') !== encoded) {
          putJsonShape = 'BASE64_INVALID';
        } else {
          const raw = decoded.toString('utf8');
          const lines = raw.split(/\r?\n/).filter(Boolean);

          if (lines.length !== 1) {
            putJsonShape = 'JSON_RECORD_COUNT_INVALID';
          } else {
            try {
              const data = JSON.parse(lines[0]);

              if (!data || typeof data !== 'object' ||
                  Array.isArray(data)) {
                putJsonShape = 'JSON_OBJECT_INVALID';
              } else {
                const errorType =
                  typeof data.error === 'string'
                    ? 'STRING'
                    : data.error &&
                      typeof data.error === 'object' &&
                      !Array.isArray(data.error)
                        ? 'OBJECT'
                        : 'OTHER';

                const statusType = typeof data.status;

                putJsonShape =
                  'JSON_VALID_ERROR_' + errorType +
                  '_STATUS_' + statusType.toUpperCase();
              }
            } catch {
              putJsonShape = 'JSON_PARSE_FAILED';
            }
          }
        }
      } catch {
        putJsonShape = 'BASE64_DECODE_FAILED';
      }
    }
  }

  // Diagnostic only: inspect JSONL structure without raw values.
  let putJsonRecords = null;

  if (blocks.length === 1 &&
      blocks[0][1].length <= 16384) {
    try {
      const encoded = blocks[0][1];
      const decoded = Buffer.from(encoded, 'base64');

      if (decoded.toString('base64') === encoded) {
        const lines = decoded.toString('utf8')
          .split(/\r?\n/)
          .filter(line => line.trim().length > 0);

        if (lines.length <= 32) {
          const parsed = lines.map(line => {
            try {
              const obj = JSON.parse(line);

              if (!obj || typeof obj !== 'object' ||
                  Array.isArray(obj)) {
                return {kind: 'non_object'};
              }

              const error = obj.error;
              const nested =
                error && typeof error === 'object' &&
                !Array.isArray(error) ? error : null;

              return {
                kind: 'object',
                statusError: obj.status === 'error',
                statusSuccess: obj.status === 'success',
                errorType:
                  typeof error === 'string' ? 'string' :
                  nested ? 'object' : 'other',
                nestedCodeAccessDenied:
                  nested?.Code === 'AccessDenied' ||
                  nested?.code === 'AccessDenied',
                topCodeAccessDenied:
                  obj.Code === 'AccessDenied' ||
                  obj.code === 'AccessDenied'
              };
            } catch {
              return {kind: 'invalid_json'};
            }
          });

          putJsonRecords = {
            count: parsed.length,
            invalid: parsed.filter(
              item => item.kind !== 'object'
            ).length,
            errors: parsed.filter(
              item => item.statusError
            ).length,
            successes: parsed.filter(
              item => item.statusSuccess
            ).length,
            errorStrings: parsed.filter(
              item => item.errorType === 'string'
            ).length,
            errorObjects: parsed.filter(
              item => item.errorType === 'object'
            ).length,
            exactAccessDenied: parsed.filter(
              item => item.nestedCodeAccessDenied ||
                      item.topCodeAccessDenied
            ).length
          };
        }
      }
    } catch {
      // Fail closed: diagnostic remains unavailable.
    }
  }


  let putRecordTypes = null;

  if (blocks.length === 1 &&
      blocks[0][1].length <= 16384) {
    try {
      const encoded = blocks[0][1];
      const decoded = Buffer.from(encoded, 'base64');

      if (decoded.toString('base64') === encoded) {
        const lines = decoded.toString('utf8')
          .split(/\r?\n/)
          .filter(line => line.trim());

        if (lines.length === 2) {
          const allowedKeys = new Set([
            'status', 'error', 'code', 'Code',
            'type', 'message', 'Message',
            'cause', 'Cause'
          ]);

          putRecordTypes = lines.map(line => {
            const obj = JSON.parse(line);

            if (!obj || typeof obj !== 'object' ||
                Array.isArray(obj)) {
              return {validObject: false};
            }

            const err =
              obj.error && typeof obj.error === 'object' &&
              !Array.isArray(obj.error)
                ? obj.error : null;

            const codeKeys = ['Code', 'code'];
            const hasDenied = value =>
              codeKeys.some(key =>
                value?.[key] === 'AccessDenied'
              );

            return {
              validObject: true,
              status:
                obj.status === 'success' ? 'success' :
                obj.status === 'error' ? 'error' :
                'other',
              fields: Object.keys(obj)
                .filter(key => allowedKeys.has(key))
                .sort(),
              errorFields: err
                ? Object.keys(err)
                    .filter(key => allowedKeys.has(key))
                    .sort()
                : [],
              exactDenied:
                hasDenied(obj) || hasDenied(err)
            };
          });
        }
      }
    } catch {
      putRecordTypes = null;
    }
  }


  let putCauseDiagnostic = null;

  if (blocks.length === 1 &&
      blocks[0][1].length <= 16384) {
    try {
      const raw = Buffer.from(
        blocks[0][1], 'base64'
      ).toString('utf8');

      const records = raw.split(/\r?\n/)
        .filter(Boolean)
        .map(line => JSON.parse(line));

      const errors = records.filter(
        record => record?.status === 'error'
      );

      if (errors.length === 1) {
        const error = errors[0].error;
        const cause = error?.cause;

        const safeKeys = value =>
          value && typeof value === 'object' &&
          !Array.isArray(value)
            ? Object.keys(value)
                .filter(k =>
                  /^(message|error|type|code|Code|cause|Cause)$/.test(k)
                )
                .sort()
            : [];

        const exactDenied = value =>
          value && typeof value === 'object' &&
          (value.Code === 'AccessDenied' ||
           value.code === 'AccessDenied');

        putCauseDiagnostic = {
          causeType:
            cause === null ? 'null' : typeof cause,
          causeFields: safeKeys(cause),
          nestedErrorFields: safeKeys(cause?.error),
          exactAccessDenied:
            !!(exactDenied(error) ||
               exactDenied(cause) ||
               exactDenied(cause?.error)),
          causePermissionHint:
            typeof cause?.message === 'string' &&
            /access.denied|permission.denied|not.authorized/i
              .test(cause.message)
        };
      }
    } catch {
      putCauseDiagnostic = null;
    }
  }


  let putDenialEvidence = null;

  if (blocks.length === 1 &&
      blocks[0][1].length <= 16384) {
    try {
      const encoded = blocks[0][1];
      const decoded = Buffer.from(encoded, 'base64');

      if (decoded.toString('base64') === encoded) {
        const records = decoded.toString('utf8')
          .split(/\r?\n/)
          .filter(Boolean)
          .map(line => JSON.parse(line));

        if (records.length === 2 &&
            records[0]?.status === 'success' &&
            records[1]?.status === 'error') {

          const error = records[1].error;
          const cause = error?.cause;

          const isDenied = value =>
            typeof value === 'string' &&
            /^(AccessDenied|Access Denied)$/i.test(value.trim());

          const containsDenied = value =>
            typeof value === 'string' &&
            /\bAccessDenied\b|\bAccess Denied\b/i.test(value);

          const inner = cause?.error;
          const classify = value => {
            if (typeof value !== 'string') return 'ABSENT';
            if (/\\bAccessDenied\\b|Access Denied/i.test(value))
              return 'ACCESS_DENIED_TEXT';
            if (/\\bdenied\\b|\\bforbidden\\b|\\bunauthorized\\b/i.test(value))
              return 'DENIAL_RELATED_TEXT';
            if (/permission|not allowed|not authorized/i.test(value))
              return 'PERMISSION_RELATED_TEXT';
            return 'OTHER_TEXT';
          };
          putDenialEvidence = {
            causeErrorType: typeof inner,
            causeErrorObjectKeys:
              inner && typeof inner === 'object'
                ? Object.keys(inner).filter(key =>
                    /^(name|message|code|Code|status|statusCode)$/.test(key)
                  ).sort()
                : [],
            causeErrorNameClass: classify(inner?.name),
            causeErrorMessageClass: classify(inner?.message),
            causeErrorCodeClass: classify(inner?.code ?? inner?.Code),
            causeMessageClass: classify(cause?.message),
            errorMessageClass: classify(error?.message),
            causeErrorExactDenied:
              isDenied(cause?.error),
            causeErrorContainsDenied:
              containsDenied(cause?.error),
            causeMessageContainsDenied:
              containsDenied(cause?.message),
            errorMessageContainsDenied:
              containsDenied(error?.message),
            errorTypeExactDenied:
              isDenied(error?.type)
          };
        }
      }
    } catch {
      putDenialEvidence = null;
    }
  }

  // Independent classification of the captured PUT JSONL.
  // Diagnostic only until the live S3 response is verified.
  let putS3DenialClassification = 'not_present';
  if (blocks.length === 1 &&
      blocks[0][1].length <= 16384) {
    try {
      const encoded = blocks[0][1];
      const decoded = Buffer.from(encoded, 'base64');
      if (decoded.toString('base64') === encoded) {
        const records = decoded.toString('utf8')
          .split(/\r?\n/)
          .filter(Boolean)
          .map(line => JSON.parse(line));
        putS3DenialClassification =
          classifyS3Denial(records);
      } else {
        putS3DenialClassification = 'invalid';
      }
    } catch {
      putS3DenialClassification = 'invalid';
    }
  }
  const markers = new Set(output.split(/\r?\n/));

  // Never trust a marker supplied by subprocess output.
  markers.delete('POLICY_CHECK_PASS');

  if (policyValid) {
    markers.add('POLICY_CHECK_PASS');
  }

  const required = [
    'POLICY_CHECK_PASS',
    'GET_PASS',
    'PUT_DENIED_PASS',
    'DELETE_DENIED_PASS',
    'OBJECT_PRESERVED_PASS',
    'CLEANUP_PASS'
  ];

  const failureCodes = [
    'KEY_COLLISION',
    'ADMIN_UPLOAD_FAILED',

    'GET_FAILED',
    'CONTENT_MISMATCH',
    'PUT_UNEXPECTED_SUCCESS',
    'PUT_ERROR_NOT_ACCESS_DENIED',
    'PUT_DIAG_PERMISSION_RELATED',
    'PUT_DIAG_TRANSPORT',
    'PUT_DIAG_CLIENT_OR_REQUEST',
    'PUT_DIAG_UNKNOWN',
    'DELETE_UNEXPECTED_SUCCESS',
    'DELETE_ERROR_NOT_ACCESS_DENIED',
    'TEST_OBJECT_MISSING',
    'CLEANUP_FAILED'
  ];

  const failureReason =
    failureCodes.find(code => markers.has(code)) ||
    (result.error ? 'PROCESS_ERROR' :
      result.status !== 0 ? 'UNCLASSIFIED_FAILURE' :
      'MISSING_EVIDENCE');

  const putDiagnosticCodes = [
    'PUT_DIAG_PERMISSION_RELATED',
    'PUT_DIAG_TRANSPORT',
    'PUT_DIAG_CLIENT_OR_REQUEST',
    'PUT_DIAG_UNKNOWN'
  ];

  const putDiagnostic =
    putDiagnosticCodes.find(code => markers.has(code)) || null;

  const passed = result.status === 0 &&
    !result.error &&
    required.every(marker => markers.has(marker)) &&
    !markers.has('CLEANUP_FAILED');

  return {
    schema: 'skyhub-minio-dr-iam-check-v1',
    status: passed ? 'passed' : 'failed',
    failureReason: passed ? null : failureReason,
    putDiagnostic,
    putJsonShape,
    putJsonRecords,
    putRecordTypes,
    putCauseDiagnostic,
    putDenialEvidence,
    putS3DenialClassification,
    checks: Object.fromEntries(
      required.map(marker => [
        marker,
        markers.has(marker)
      ])
    )
  };
}

if (require.main === module) {
  try {
    const result = runCheck();
    console.log(JSON.stringify(result, null, 2));
    if (result.status !== 'passed') {
      process.exitCode = 1;
    }
  } catch (_) {
    console.error('IAM_CHECK_FAILED');
    process.exitCode = 1;
  }
}

module.exports = {runCheck};
