'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {normalizeProxyIp,parseTrustedProxyIps,isTrustedProxyIp}=require('../proxy-trust');

test('only loopback peers are implicitly trusted',()=>{
  const trusted=parseTrustedProxyIps();
  assert.deepEqual([...trusted].sort(),['127.0.0.1','::1'].sort());
  assert.equal(isTrustedProxyIp('::ffff:127.0.0.1',trusted),true);
  assert.equal(isTrustedProxyIp('172.18.0.1',trusted),false);
  assert.equal(isTrustedProxyIp('172.18.0.2',trusted),false);
  assert.equal(isTrustedProxyIp('192.168.178.63',trusted),false);
});
test('explicit gateway allowlist is exact, not a Docker CIDR exemption',()=>{
  const trusted=parseTrustedProxyIps('172.18.0.1, 192.168.178.63');
  assert.equal(isTrustedProxyIp('172.18.0.1',trusted),true);
  assert.equal(isTrustedProxyIp('::ffff:172.18.0.1',trusted),true);
  assert.equal(isTrustedProxyIp('172.18.0.2',trusted),false);
  assert.equal(isTrustedProxyIp('172.19.0.1',trusted),false);
  assert.equal(isTrustedProxyIp('192.168.178.70',trusted),false);
  assert.equal(normalizeProxyIp('192.168.178.063'),null);
});
test('invalid or public proxy addresses fail startup validation',()=>{
  for(const input of ['8.8.8.8','0.0.0.0','127.0.0.2','172.18.0.0/16',
    '192.168.178.0/24','::','::ffff:8.8.8.8','fe80::1',
    '10.0.0.1,','192.168.001.2','1.2.3.4',
    '10.0.0.1,'.repeat(9),'x'.repeat(513)]){
    assert.throws(()=>parseTrustedProxyIps(input),undefined,input);
  }
  assert.deepEqual([...parseTrustedProxyIps('')].sort(),['127.0.0.1','::1'].sort());
});
