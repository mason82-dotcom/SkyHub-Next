'use strict';

// Validates the broker endpoint before opening an MQTT connection.
// Pi Compose supports only explicitly paired EMQX/1884 or Mosquitto/1883 profiles.
function validateBrokerConfig(rawUrl, requiredPortRaw = '', brokerKindRaw = '') {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
    throw new Error('MQTT_BROKER_URL is required');
  }
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('MQTT_BROKER_URL must be a valid URL');
  }
  if (!['mqtt:', 'mqtts:'].includes(url.protocol) || !url.hostname) {
    throw new Error('MQTT_BROKER_URL must use mqtt:// or mqtts:// with a broker hostname');
  }
  // Credentials must be supplied through MQTT_USER and MQTT_PASSWORD, not in URLs.
  if (url.username || url.password) {
    throw new Error('Put broker credentials in MQTT_USER and MQTT_PASSWORD');
  }
  const port = url.port ? Number(url.port) : (url.protocol === 'mqtts:' ? 8883 : 1883);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Invalid MQTT broker port');
  }
  const required = String(requiredPortRaw ?? '').trim();
  if (required) {
    if (!/^\d+$/.test(required) || Number(required) < 1 || Number(required) > 65535) {
      throw new Error('SKYHUB_MQTT_REQUIRED_PORT must be a TCP port (1-65535)');
    }
    if (port !== Number(required)) {
      throw new Error('MQTT broker port ' + port + ' rejected: Raspberry Pi requires port ' + required);
    }
  }
  const kind = String(brokerKindRaw ?? '').trim();
  if (kind) {
    const expectedPorts = Object.freeze({emqx:1884, mosquitto:1883, 'mosquitto-dedicated':1884});
    if (!Object.hasOwn(expectedPorts, kind)) {
      throw new Error('SKYHUB_MQTT_BROKER_KIND must be emqx, mosquitto or mosquitto-dedicated');
    }
    if (!required || Number(required) !== expectedPorts[kind]) {
      throw new Error('MQTT broker kind ' + kind + ' requires SKYHUB_MQTT_REQUIRED_PORT=' + expectedPorts[kind]);
    }
  }
  return Object.freeze({url: rawUrl, host: url.hostname, port, secure: url.protocol === 'mqtts:'});
}
module.exports = {validateBrokerConfig};
