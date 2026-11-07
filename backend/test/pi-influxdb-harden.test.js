'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {parseArgs,validateBind,dropInText,parseDropIn,classifyPeer}=require('../../scripts/pi-influxdb-harden');

test('apply needs --auth and/or a valid --bind, nothing else is accepted',()=>{
  assert.throws(()=>parseArgs(['apply']),/--auth und\/oder --bind/);
  assert.throws(()=>parseArgs(['apply','--bind','999.1.1.1:8086']),/IPv4:Port/);
  assert.throws(()=>parseArgs(['apply','--bind','127.0.0.1']),/IPv4:Port/);
  assert.throws(()=>parseArgs(['apply','--bind','127.0.0.1:0']),/IPv4:Port/);
  assert.throws(()=>parseArgs(['apply','--auth','--admin-user','x;DROP']),/ungültiger Name/);
  assert.throws(()=>parseArgs(['plan','--unknown']),/Unbekanntes Argument/);
  const opts=parseArgs(['apply','--auth','--bind','127.0.0.1:8086','--admin-user','boss']);
  assert.deepEqual([opts.auth,opts.bind,opts.adminUser],[true,{host:'127.0.0.1',port:8086},'boss']);
  assert.equal(parseArgs(['rollback','--drop-user']).dropUser,true);
  assert.equal(parseArgs(['clients','9999']).seconds,600);
  assert.equal(parseArgs(['clients','1']).seconds,5);
});

test('the drop-in only carries the requested overrides and round-trips',()=>{
  assert.equal(validateBind('192.168.178.63:8086').host,'192.168.178.63');
  for(const wanted of [{auth:true,bind:null},{auth:false,bind:{host:'127.0.0.1',port:8086}},
    {auth:true,bind:{host:'127.0.0.1',port:18086}}]){
    const text=dropInText(wanted);
    assert.match(text,/^# SkyHub Next - managed by/);
    assert.match(text,/\[Service\]/);
    assert.equal(/AUTH_ENABLED/.test(text),wanted.auth);
    assert.equal(/BIND_ADDRESS/.test(text),Boolean(wanted.bind));
    assert.deepEqual(parseDropIn(text),wanted);
  }
  assert.doesNotMatch(dropInText({auth:true,bind:null}),/password|secret/i);
});

test('client classification separates local, Docker, LAN, Tailscale and other peers',()=>{
  const expected={'127.0.0.1':'lokal','::1':'lokal','172.18.0.8':'docker','172.32.0.1':'andere',
    '192.168.178.70':'LAN','10.1.2.3':'LAN','100.98.97.84':'tailscale','8.8.8.8':'andere','::ffff:172.19.0.2':'docker'};
  for(const [ip,kind] of Object.entries(expected))assert.equal(classifyPeer(ip),kind,ip);
});
