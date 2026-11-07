'use strict';

const fs = require('node:fs/promises');
const {constants} = require('node:fs');
const path = require('node:path');

const SCHEMA = 'skyhub-minio-dr-v1';
const MAX_REPORT_BYTES = 16384;
const MAX_REPORTS = 50;

const CHECK_NAMES = [
  'archiveIntegrity',
  'fileIntegrity',
  's3Read',
  'isolation',
  'iamReadOnly'
];

const CHECK_STATES = new Set([
  'passed', 'failed', 'unknown', 'skipped'
]);

function validateReport(value) {
  if (!value || typeof value !== 'object' ||
      Array.isArray(value)) {
    throw new Error('Invalid DR report');
  }

  if (value.schema !== SCHEMA ||
      typeof value.runId !== 'string' ||
      !/^[A-Za-z0-9_-]{1,64}$/.test(value.runId) ||
      typeof value.completedAt !== 'string' ||
      !Number.isFinite(Date.parse(value.completedAt))) {
    throw new Error('Invalid DR report metadata');
  }

  const checks = {};

  for (const name of CHECK_NAMES) {
    const state = value.checks?.[name] ?? 'unknown';

    if (!CHECK_STATES.has(state)) {
      throw new Error('Invalid DR check state');
    }

    checks[name] = state;
  }

  const states = Object.values(checks);

  // A report passes only if every required check passed.
  const status = states.includes('failed')
    ? 'failed'
    : states.every(state => state === 'passed')
      ? 'passed'
      : 'incomplete';

  const metrics = {};
  const allowedMetrics = [
    'verifiedFiles',
    's3BucketsChecked',
    's3ObjectsRead'
  ];

  for (const name of allowedMetrics) {
    const number = value.metrics?.[name];

    if (number === undefined) continue;

    if (!Number.isSafeInteger(number) || number < 0) {
      throw new Error('Invalid DR metric');
    }

    metrics[name] = number;
  }

  return {
    schema: SCHEMA,
    runId: value.runId,
    completedAt: value.completedAt,
    status,
    checks,
    metrics
  };
}

async function readReports(directory) {
  if (typeof directory !== 'string' ||
      !path.isAbsolute(directory)) {
    throw new Error('Invalid DR report directory');
  }

  const entries = await fs.readdir(directory, {
    withFileTypes: true
  });

  const names = entries
    .filter(entry =>
      entry.isFile() &&
      /^minio-dr-[A-Za-z0-9_-]+\.json$/.test(entry.name)
    )
    .map(entry => entry.name)
    .sort()
    .reverse()
    .slice(0, MAX_REPORTS);

  const reports = [];

  for (const name of names) {
    const filename = path.join(directory, name);
    let handle;

    try {
      handle = await fs.open(
        filename,
        constants.O_RDONLY | constants.O_NOFOLLOW |
        constants.O_NONBLOCK
      );

      const stat = await handle.stat();

      if (!stat.isFile() ||
          stat.size > MAX_REPORT_BYTES ||
          stat.size === 0) {
        continue;
      }

      const buffer = Buffer.alloc(MAX_REPORT_BYTES + 1);
      let total = 0;

      while (total < buffer.length) {
        const {bytesRead} = await handle.read(
          buffer,
          total,
          buffer.length - total,
          total
        );

        if (bytesRead === 0) break;
        total += bytesRead;
      }

      if (total > MAX_REPORT_BYTES) continue;

      const content = buffer.toString('utf8', 0, total);
      const report = validateReport(JSON.parse(content));

      reports.push(report);
    } catch (_error) {
      // Unreadable, replaced or malformed reports are ignored.
      continue;
    } finally {
      if (handle) await handle.close();
    }
  }

  return reports.sort((a, b) =>
    Date.parse(b.completedAt) - Date.parse(a.completedAt)
  );
}

module.exports = {
  SCHEMA,
  CHECK_NAMES,
  validateReport,
  readReports
};
