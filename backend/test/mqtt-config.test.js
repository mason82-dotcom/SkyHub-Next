'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {validateBrokerConfig} = require('../mqtt-config');

test('Pi host gateway connects to the existing MQTT service on TCP 1884', () => {
  const config = validateBrokerConfig('mqtt://host.docker.internal:1884', '1884');
  assert.deepEqual(config, {
    url:'mqtt://host.docker.internal:1884',
    host:'host.docker.internal',port:1884,secure:false
  });
});
test('Pi LAN broker on port 1884 is accepted', () => {
  assert.equal(validateBrokerConfig('mqtt://192.168.178.50:1884', '1884').port,1884);
});
test('Pi deployment fails fast on 1883 (including the implicit MQTT default)', () => {
  assert.throws(()=>validateBrokerConfig('mqtt://host.docker.internal:1883', '1884'),/requires port 1884/);
  assert.throws(()=>validateBrokerConfig('mqtt://host.docker.internal', '1884'),/requires port 1884/);
});
test('An external non-Pi installation can use its own port', () => {
  assert.equal(validateBrokerConfig('mqtts://broker.example.org:8883').port,8883);
});
test('Rejects missing, malformed, non-TCP and credential-bearing URLs', () => {
  assert.throws(()=>validateBrokerConfig('', '1884'),/required/);
  assert.throws(()=>validateBrokerConfig('not a URL','1884'),/valid URL/);
  assert.throws(()=>validateBrokerConfig('http://host:1884','1884'),/mqtt/);
  assert.throws(()=>validateBrokerConfig('mqtt://user:secret@host:1884','1884'),/credentials/);
  assert.throws(()=>validateBrokerConfig('mqtt://host:1884','eighty'),/TCP port/);
});

test('opt-in Mosquitto/1883 profile is accepted only when the URL, pin and kind agree', () => {
  const c=validateBrokerConfig('mqtt://host.docker.internal:1883','1883','mosquitto');
  assert.equal(c.port,1883);
  assert.equal(c.host,'host.docker.internal');
  for (const [url,pin,kind] of [
    ['mqtt://host.docker.internal:1883','1884','mosquitto'],
    ['mqtt://host.docker.internal:1884','1884','mosquitto'],
    ['mqtt://host.docker.internal:1883','1883','emqx'],
    ['mqtt://host.docker.internal:1883','','mosquitto'],
    ['mqtt://host.docker.internal:1883','1883','other']
  ]) {
    assert.throws(()=>validateBrokerConfig(url,pin,kind),/requires port|requires SKYHUB_MQTT_REQUIRED_PORT|BROKER_KIND/);
  }
});
test('legacy EMQX pairing remains strict when broker kind is provided', () => {
  assert.equal(validateBrokerConfig('mqtt://host.docker.internal:1884','1884','emqx').port,1884);
  assert.throws(()=>validateBrokerConfig('mqtt://host.docker.internal:1883','1884','emqx'),/requires port 1884/);
});

test('dedicated authenticated Mosquitto profile is bound to port 1884 and its own kind', () => {
  const c=validateBrokerConfig('mqtt://host.docker.internal:1884','1884','mosquitto-dedicated');
  assert.equal(c.port,1884);
  for (const [url,pin,kind] of [
    ['mqtt://host.docker.internal:1883','1883','mosquitto-dedicated'],
    ['mqtt://host.docker.internal:1883','1884','mosquitto-dedicated'],
    ['mqtt://host.docker.internal:1884','1883','mosquitto-dedicated'],
    ['mqtt://host.docker.internal:1884','','mosquitto-dedicated']
  ]) {
    assert.throws(()=>validateBrokerConfig(url,pin,kind),/requires port|requires SKYHUB_MQTT_REQUIRED_PORT/);
  }
});
