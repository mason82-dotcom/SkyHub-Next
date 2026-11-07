'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ref = require('../../frontend/public/fh2-reference-contract');

const expected = {
  routeCreation: ['loadWaylineCreation', 'destroyWaylineCreation'],
  routeEditor: ['loadWayline', 'destroyWayline'],
  projectMap: ['loadProject', 'destroyProject'],
  flightPath: ['loadFlightPath', 'destroyFlightPath'],
  virtualCockpit: ['loadCockpit', 'destroyCockpit']
};

test('DJI component inventory exposes the documented methods without loading them', () => {
  assert.deepEqual(Object.keys(ref.components).sort(), Object.keys(expected).sort());
  for (const [key, [load, destroy]] of Object.entries(expected)) {
    const c = ref.describeComponent(key);
    assert.equal(c.djiLoad, load);
    assert.equal(c.djiDestroy, destroy);
    assert.equal(Object.isFrozen(c), true);
    assert.match(c.demo, /^demo\/en\/[a-z_-]+\.html$/);
  }
  assert.equal(ref.describeComponent('__proto__'), null);
  assert.equal(ref.describeComponent('toString'), null);
  assert.equal(ref.describeComponent('constructor'), null);
  assert.equal(ref.describeComponent(null), null);
});

test('reference-only status is permanently disabled, independent of supplied options', () => {
  const a = ref.integrationStatus();
  const b = ref.integrationStatus({ enabled: true, operatorApproved: true });
  assert.deepEqual(a, b);
  assert.deepEqual(a, {
    mode: 'reference-only',
    runtimeLoaded: false,
    integrationEnabled: false,
    tokenHandlingApproved: false,
    flightControlEnabled: false,
    routesWritable: false,
    backendMounted: false,
    hardwareVerified: false
  });
  assert.equal(Object.isFrozen(a), true);
  assert.throws(() => { a.integrationEnabled = true; }, TypeError);
});

test('virtual cockpit requires stricter distinct gates than read-only flight record', () => {
  const cockpit = ref.reviewGates('virtualCockpit');
  const flightPath = ref.reviewGates('flightPath');
  const editor = ref.reviewGates('routeEditor');
  const map = ref.reviewGates('projectMap');
  assert.ok(cockpit.includes('separate-pilot-command-authorization'));
  assert.ok(cockpit.includes('hardware-and-firmware-e2e-validation'));
  assert.ok(cockpit.includes('supported-device-model-confirmed-by-dji'));
  assert.ok(flightPath.includes('supported-device-model-confirmed-by-dji'));
  assert.ok(cockpit.includes('organization-key-browser-exposure-blocked-or-explicitly-resolved'));
  assert.ok(!flightPath.includes('separate-pilot-command-authorization'));
  assert.ok(!flightPath.includes('separate-route-write-authorization'));
  assert.ok(editor.includes('separate-route-write-authorization'));
  assert.ok(map.includes('separate-route-write-authorization'));
  assert.equal(Object.isFrozen(cockpit), true);
  assert.equal(ref.reviewGates('unknown'), null);
  assert.throws(() => { cockpit.push('skip-security'); }, TypeError);
});

test('external events are untrusted labels and discard every payload', () => {
  const names = [
    'wayline-save', 'wayline-cancel', 'wayline-back',
    'wayline-creation-saved', 'wayline-creation-cancel',
    'cesium-viewer-change', 'flight-path-back'
  ];
  for (const name of names) {
    const payload = {
      projectToken: 'DO-NOT-ECHO',
      droneSn: 'DO-NOT-ECHO',
      wayline_id: 'DO-NOT-ECHO',
      coords: [1, 2]
    };
    const result = ref.classifyEvent(name, payload);
    assert.equal(result.eventName, name);
    assert.equal(result.source, 'untrusted-flightHub2-ui');
    assert.equal(result.externalPayloadForwarded, false);
    assert.equal(result.skyHubWriteAuthorized, false);
    assert.equal(result.flightCommandAuthorized, false);
    assert.equal(JSON.stringify(result).includes('DO-NOT-ECHO'), false);
    assert.equal(Object.isFrozen(result), true);
  }
  for (const unknown of ['prototype', '__proto__', 'toString', 'flight-takeoff', null, {}]) {
    assert.equal(ref.classifyEvent(unknown), null);
  }
});

test('offline reference contains no script loader, network client, or flight execution path', () => {
  const filename = path.resolve(__dirname, '../../frontend/public/fh2-reference-contract.js');
  const source = fs.readFileSync(filename, 'utf8');
  for (const pattern of [
    /<script/i, /(?:window\.)?FH2\.initConfig\s*\(/,
    /(?:window\.)?FH2\.loadCockpit\s*\(/,
    /\bfetch\s*\(/, /\bWebSocket\s*\(/,
    /\bXMLHttpRequest\b/, /\bimport\s*\(/,
    /\bpostMessage\s*\(/, /\bMQTT\b/i
  ]) {
    assert.doesNotMatch(source, pattern);
  }
});
