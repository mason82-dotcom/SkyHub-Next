'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

const file = path.resolve(__dirname, '../../scripts/m3m-offline-verify.sh');
function run(filePath, extraEnv) {
  return spawnSync('bash', [filePath], {
    encoding: 'utf8',
    timeout: 15000,
    env: {...process.env, SKYHUB_M3M_OFFLINE_LAB: '', ...extraEnv}
  });
}

test('M3M offline script parses without invoking any services', () => {
  const result = spawnSync('bash', ['-n', file], {encoding:'utf8', timeout:15000});
  assert.equal(result.status, 0, result.stderr);
});

test('M3M offline script refuses absent explicit opt-in', () => {
  const result = run(file);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /M3M LAB REFUSED/);
  assert.doesNotMatch(result.stdout, /PASS/);
});

test('opt-in cannot run from a non-worktree directory', t => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'm3m-script-guard-'));
  t.after(() => fs.rmSync(base, {recursive:true, force:true}));
  const scripts = path.join(base, 'scripts');
  fs.mkdirSync(scripts);
  const copied = path.join(scripts, 'm3m-offline-verify.sh');
  fs.copyFileSync(file, copied);
  const result = run(copied, {SKYHUB_M3M_OFFLINE_LAB: '1'});
  assert.equal(result.status, 2);
  assert.match(result.stderr, /separate linked Git worktree/);
});

test('script requires isolated Python, local Node dependencies and safe metadata flags', () => {
  const source = fs.readFileSync(file, 'utf8');
  assert.match(source, /sys\.prefix != sys\.base_prefix/);
  assert.match(source, /node_modules/);
  assert.match(source, /test_m3m_\*\.py/);
  assert.match(source, /smart-farming-catalog-http\.test\.js/);
  assert.match(source, /operationalUseAllowed prescriptionExportAllowed flightMissionAllowed/);
  assert.doesNotMatch(source, /^\s*(?:curl|wget|sudo|docker|git\s+pull|pip\s+install|npm\s+install|npm\s+ci)\b/m);
});
