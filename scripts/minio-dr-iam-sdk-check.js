'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawnSync} = require('node:child_process');

const {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand
} = require('../backend/node_modules/@aws-sdk/client-s3');

const CONTAINER = 'skyhub-next-minio-1';
const BUCKET = 'dji-cloud';
const PREFIX = 'skyhub-dr-iam-test/';
const KEY = PREFIX + crypto.randomBytes(16).toString('hex') + '.txt';
const BODY = Buffer.from('SkyHub isolated IAM SDK acceptance\n');

function command(bin, args, options = {}) {
  return spawnSync(bin, args, {
    encoding: 'utf8',
    timeout: 15000,
    maxBuffer: 65536,
    ...options
  });
}

function assert(condition, code) {
  if (!condition) throw new Error(code);
}

const adminShell = String.raw`
set -eu
set +x
umask 077
tmp=$(mktemp -d)
trap 'rm -rf -- "$tmp"' EXIT
export MC_CONFIG_DIR="$tmp/mc"
mkdir -m 700 "$MC_CONFIG_DIR"

mc alias set admin http://127.0.0.1:9000 \
  "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" \
  >/dev/null 2>&1

case "$DR_IAM_ACTION" in
  create)
    printf 'SkyHub isolated IAM SDK acceptance\n' \
      > "$tmp/source"
    mc cp "$tmp/source" \
      "admin/dji-cloud/$DR_IAM_KEY" \
      >/dev/null 2>&1
    ;;
  cleanup)
    mc rm "admin/dji-cloud/$DR_IAM_KEY" \
      >/dev/null 2>&1
    if mc stat "admin/dji-cloud/$DR_IAM_KEY" \
      >/dev/null 2>&1; then
      exit 1
    fi
    ;;
  *)
    exit 2
    ;;
esac
`;

function admin(action) {
  const result = command('docker', [
    'exec', '-i',
    '-e', `DR_IAM_ACTION=${action}`,
    '-e', `DR_IAM_KEY=${KEY}`,
    CONTAINER, 'sh', '-s'
  ], {input: adminShell});

  return !result.error && result.status === 0;
}

async function main() {
  const credentialsPath = path.resolve(
    __dirname, '../dr-status/iam/dr-test-credentials.json'
  );
  const stat = fs.lstatSync(credentialsPath);

  assert(
    stat.isFile() &&
    !stat.isSymbolicLink() &&
    (stat.mode & 0o077) === 0 &&
    stat.size <= 4096,
    'CREDENTIALS_UNSAFE'
  );

  const credentials = JSON.parse(
    fs.readFileSync(credentialsPath, 'utf8')
  );

  assert(
    /^skyhub-dr-test-[a-f0-9]{8}$/.test(credentials.username) &&
    typeof credentials.password === 'string' &&
    credentials.password.length >= 32 &&
    credentials.policy === 'skyhub-dr-readonly',
    'CREDENTIALS_INVALID'
  );

  const nvme = fs.readFileSync(
    '/sys/class/nvme/nvme0/state', 'utf8'
  ).trim();

  assert(nvme === 'live', 'NVME_NOT_LIVE');

  const mount = command('findmnt', [
    '-rn', '-M', '/mnt/hc4backup', '-o', 'SOURCE'
  ]);

  assert(
    mount.status === 0 &&
    mount.stdout.trim() === '/dev/nvme0n1p1',
    'DATA_MOUNT_INVALID'
  );

  const inspect = command('docker', [
    'inspect', CONTAINER
  ]);

  assert(inspect.status === 0, 'MINIO_INSPECT_FAILED');

  const container = JSON.parse(inspect.stdout)[0];

  assert(
    container.State.Running === true &&
    container.HostConfig.RestartPolicy.Name === 'no',
    'MINIO_PRECHECK_FAILED'
  );

  const networks = Object.entries(
    container.NetworkSettings.Networks || {}
  );

  const matching = networks.filter(
    ([name]) => name.startsWith('skyhub-next_')
  );

  assert(matching.length === 1, 'MINIO_NETWORK_AMBIGUOUS');

  const ip = matching[0][1].IPAddress;

  assert(
    typeof ip === 'string' &&
    /^172\.(1[6-9]|2[0-9]|3[01])\.\d{1,3}\.\d{1,3}$/.test(ip),
    'MINIO_ENDPOINT_INVALID'
  );

  const client = new S3Client({
    endpoint: `http://${ip}:9000`,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: {
      accessKeyId: credentials.username,
      secretAccessKey: credentials.password
    },
    maxAttempts: 1
  });

  const output = {
    schema: 'skyhub-minio-dr-iam-sdk-v1',
    status: 'failed',
    checks: {}
  };

  let creationAttempted = false;
  let cleanupOk = false;

  const args = {Bucket: BUCKET, Key: KEY};

  async function verifyGet(label) {
    const response = await client.send(
      new GetObjectCommand(args),
      {abortSignal: AbortSignal.timeout(10000)}
    );

    const bytes = Buffer.from(
      await response.Body.transformToByteArray()
    );

    const ok = bytes.equals(BODY);
    output.checks[label] = ok;
    return ok;
  }

  async function verifyDenied(label, operation) {
    let result = {
      denied: false,
      httpStatus: null,
      s3Code: 'NONE'
    };

    try {
      await client.send(
        operation,
        {abortSignal: AbortSignal.timeout(10000)}
      );
    } catch (error) {
      const status = error?.$metadata?.httpStatusCode;
      const code = error?.name;

      result = {
        denied: status === 403 && code === 'AccessDenied',
        httpStatus: Number.isInteger(status) ? status : null,
        s3Code: code === 'AccessDenied'
          ? 'AccessDenied' : 'OTHER'
      };
    }

    output.checks[label] = result;
    return result.denied;
  }

  try {
    creationAttempted = true;
    assert(admin('create'), 'ADMIN_CREATE_FAILED');
    output.checks.adminCreate = true;

    assert(await verifyGet('get'), 'GET_FAILED');

    const putDenied = await verifyDenied(
      'put',
      new PutObjectCommand({
        ...args,
        Body: Buffer.from('Unauthorized replacement\n')
      })
    );

    assert(putDenied, 'PUT_NOT_PROVEN_DENIED');
    assert(
      await verifyGet('preservedAfterPut'),
      'OBJECT_CHANGED_AFTER_PUT'
    );

    const deleteDenied = await verifyDenied(
      'delete',
      new DeleteObjectCommand(args)
    );

    assert(deleteDenied, 'DELETE_NOT_PROVEN_DENIED');
    assert(
      await verifyGet('preservedAfterDelete'),
      'OBJECT_CHANGED_AFTER_DELETE'
    );

    output.status = 'passed';
  } catch (error) {
    output.failureReason = [
      'ADMIN_CREATE_FAILED',
      'GET_FAILED',
      'PUT_NOT_PROVEN_DENIED',
      'OBJECT_CHANGED_AFTER_PUT',
      'DELETE_NOT_PROVEN_DENIED',
      'OBJECT_CHANGED_AFTER_DELETE'
    ].includes(error.message)
      ? error.message
      : 'CHECK_FAILED';
  } finally {
    if (creationAttempted) {
      cleanupOk = admin('cleanup');
    }

    output.checks.cleanup = cleanupOk;

    if (!cleanupOk) {
      output.status = 'failed';
      output.failureReason = 'CLEANUP_NOT_VERIFIED';
    }

    client.destroy();
    console.log(JSON.stringify(output, null, 2));
    if (output.status !== 'passed') process.exitCode = 1;
  }
}

main().catch(() => {
  console.error('IAM_SDK_PRECHECK_FAILED');
  process.exitCode = 1;
});
