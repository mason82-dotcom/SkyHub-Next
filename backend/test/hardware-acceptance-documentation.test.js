'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {fieldDefinitions} = require('../dji-properties');

const readDoc = name => fs.readFileSync(
  path.resolve(__dirname, '../../docs', name), 'utf8');

test('RC Plus 2/M4T hardware runbook matches the actual parser catalogue', () => {
  const rc = fieldDefinitions({domain:'2', type:174, subType:0});
  const m4t = fieldDefinitions({domain:'0', type:99, subType:1});
  assert.equal(rc.fields.length, 54);
  assert.equal(m4t.fields.length, 202);
  assert.equal(m4t.dynamicPayload.fields.length, 9);
  assert.match(m4t.confidence, /unverified/);

  const runbook = readDoc('hardware-rc-plus2-m4t.md');
  assert.match(runbook, /\| Properties \| RC Plus 2: \*\*54\*\*.*M4T: \*\*202 vorläufige\*\*.*\*\*9\*\*/);
  assert.doesNotMatch(runbook, /M4T:\s*199\b/);
  assert.match(runbook, /gerätespezifische.*Vollständigkeitserklärung/);
});

test('hardware runbook uses the current code without deploying to Pi', () => {
  const runbook = readDoc('hardware-rc-plus2-m4t.md');
  assert.match(runbook, /origin\/main/);
  assert.doesNotMatch(runbook, /origin\/feature\/hardware-diagnostics-current-main-20261023/);
  assert.match(runbook, /NICHT PRÜFBAR/);
  assert.match(runbook, /kein read-only Hardwarecheck/i);
  assert.match(runbook, /Mosquitto/);
  assert.match(runbook, /EMQX/);
});

test('dated acceptance matrix does not promote synthetic checks to hardware validation', () => {
  const status = readDoc('hardware-acceptance-status-2026-10-24.md');
  const index = readDoc('index.md');
  assert.match(status, /\*\*Kein dokumentierter Live-Hardwaretest\.\*\*/);
  assert.match(status, /M3M.*CaptureUUID/);
  assert.match(status, /flightReady:false/);
  assert.match(status, /dispatchAllowed:false/);
  assert.match(status, /kein.*Live-DJI-Testergebnis/i);
  assert.match(index, /hardware-acceptance-status-2026-10-24\.md/);
});
