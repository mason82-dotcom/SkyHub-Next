'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const {importReport} = require('./minio-dr-import');
const {validateReport} = require('../backend/minio-dr-report');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'dr-reports');
const destination = path.join(root, 'dr-status');

function saveReport() {
  const report = validateReport(importReport(source));

  const name = `minio-dr-${report.runId}.json`;
  const target = path.join(destination, name);

  fs.mkdirSync(destination, {
    recursive: true,
    mode: 0o700
  });

  const directoryStat = fs.lstatSync(destination);

  if (!directoryStat.isDirectory() ||
      directoryStat.isSymbolicLink()) {
    throw new Error('Invalid DR report directory');
  }

  fs.chmodSync(destination, 0o700);

  const content = JSON.stringify(report, null, 2) + '\n';

  const temporary = path.join(
    destination,
    `.minio-dr-${crypto.randomUUID()}.tmp`
  );

  let temporaryExists = false;

  try {
    fs.writeFileSync(temporary, content, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx'
    });

    temporaryExists = true;

    // Hard-link publication refuses to replace an existing report.
    fs.linkSync(temporary, target);
    fs.unlinkSync(temporary);
    temporaryExists = false;

    return {
      filename: name,
      status: report.status,
      checks: report.checks
    };
  } finally {
    if (temporaryExists) {
      try {
        fs.unlinkSync(temporary);
      } catch (_) {
        // Preserve original error.
      }
    }
  }
}

if (require.main === module) {
  try {
    console.log(JSON.stringify(saveReport(), null, 2));
  } catch (error) {
    if (error.code === 'EEXIST') {
      console.error('DR report already exists; not overwritten.');
    } else {
      console.error('DR report save failed:', error.message);
    }
    process.exitCode = 1;
  }
}

module.exports = {saveReport};
