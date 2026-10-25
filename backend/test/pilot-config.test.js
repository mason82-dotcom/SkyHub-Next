'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {pilotConfiguration}=require('../pilot-config');

const configured={
  SKYHUB_PILOT_ENABLED:'true',
  SKYHUB_PILOT_ACCESS_TOKEN:'a'.repeat(48),
  SKYHUB_DJI_APP_ID:'cloud-app-id',
  SKYHUB_DJI_APP_KEY:'example-app-key',
  SKYHUB_DJI_APP_LICENSE:'example-license',
  SKYHUB_PILOT_MQTT_USER:'pilot_publish',
  SKYHUB_PILOT_MQTT_PASSWORD:'example-mqtt-password',
  SKYHUB_PILOT_MQTT_URL:'mqtt://192.168.178.63:1884',
  SKYHUB_PILOT_WORKSPACE_ID:'e3dea0f5-37f2-4d79-ae58-490af3228069'
};
test('Pilot 2 onboarding is disabled by default with no exposed bootstrap secrets',()=>{
  const c=pilotConfiguration({});
  assert.equal(c.ready,false);
  assert.throws(()=>c.bootstrap(),/not configured/);
  assert.equal(c.missing.includes('SKYHUB_PILOT_ENABLED'),true);
  assert.equal(JSON.stringify(c).includes('example-mqtt-password'),false);
});
test('Pilot 2 transport maps Pi MQTT 1884 to DJI Bridge tcp:// URL',()=>{
  const c=pilotConfiguration(configured);
  assert.equal(c.ready,true);
  const b=c.bootstrap();
  assert.equal(b.mqtt.host,'tcp://192.168.178.63:1884');
  assert.equal(b.mqtt.username,'pilot_publish');
  assert.equal(b.workspaceId,configured.SKYHUB_PILOT_WORKSPACE_ID);
  assert.equal(JSON.stringify({ready:c.ready,missing:c.missing}).includes(b.mqtt.password),false);
});
test('Prevent accidental Pilot 2 MQTT 1883, localhost or container hostname',()=>{
  for(const url of ['mqtt://192.168.178.63:1883','mqtt://localhost:1884',
                    'mqtt://host.docker.internal:1884','mqtt://127.0.0.1:1884']){
    const c=pilotConfiguration({...configured,SKYHUB_PILOT_MQTT_URL:url});
    assert.equal(c.ready,false,url);
    assert.throws(()=>c.bootstrap(),/not configured/);
  }
});
test('Reject incomplete license, missing credentials, weak access token and invalid workspace',()=>{
  for(const patch of [
    {SKYHUB_DJI_APP_LICENSE:''},{SKYHUB_DJI_APP_ID:''},
    {SKYHUB_PILOT_MQTT_PASSWORD:''},
    {SKYHUB_PILOT_ACCESS_TOKEN:'123'},
    {SKYHUB_PILOT_WORKSPACE_ID:'foo'},
    {SKYHUB_PILOT_ENABLED:'false'}
  ])assert.equal(pilotConfiguration({...configured,...patch}).ready,false);
});
test('Pilot 2 enabled endpoint rejects broad LAN bind, requiring a trusted HTTPS reverse proxy',()=>{
  const c=pilotConfiguration({...configured,SKYHUB_BIND_ADDRESS:'0.0.0.0'});
  assert.equal(c.ready,false);
  assert.match(c.missing.join(' '),/loopback/);
});
test('No unverified MQTT TLS mode is advertised as working',()=>{
  const c=pilotConfiguration({...configured,SKYHUB_PILOT_MQTT_URL:'mqtts://192.168.178.63:1884'});
  assert.equal(c.ready,false);
});

test('TSA stays off without an HTTPS origin',()=>{
  const inactive=pilotConfiguration(configured);
  assert.equal(inactive.tsa.enabled,false);
  const invalid=pilotConfiguration({...configured,SKYHUB_DJI_TSA_ENABLED:'true',
    SKYHUB_PILOT_PUBLIC_URL:'http://example.invalid/'});
  assert.equal(invalid.tsa.enabled,false);
  assert.match(invalid.tsa.issue,/HTTPS/);
});
test('TSA accepts only exact trusted proxy IP addresses',()=>{
  const base={...configured,SKYHUB_DJI_TSA_ENABLED:'true',
    SKYHUB_PILOT_PUBLIC_URL:'https://pilot.example.test/'};
  const valid=pilotConfiguration({...base,SKYHUB_DJI_TSA_TRUSTED_PROXY_IPS:'172.18.0.1,::1'});
  assert.equal(valid.tsa.enabled,true);
  assert.deepEqual(valid.tsa.trustedProxyIps,['172.18.0.1','::1']);
  assert.equal(valid.bootstrap().tsa.wsHost,'wss://pilot.example.test/ws/tsa');
  for(const bad of ['172.16.0.0/12','*','0.0.0.0','::','192.168.*','none']){
    const c=pilotConfiguration({...base,SKYHUB_DJI_TSA_TRUSTED_PROXY_IPS:bad});
    assert.equal(c.tsa.enabled,false,bad);
    assert.match(c.tsa.issue,/proxy IPs/);
  }
});

test('situation awareness is off by default and never part of the bootstrap then',()=>{
  const c=pilotConfiguration(configured);
  assert.deepEqual(c.tsa,{enabled:false,issue:null,apiHost:null,wsHost:null,trustedProxyIps:[]});
  assert.equal('tsa' in c.bootstrap(),false);
  // A public URL alone does not switch it on.
  const urlOnly=pilotConfiguration({...configured,SKYHUB_PILOT_PUBLIC_URL:'https://rpi5.fritz.box'});
  assert.equal(urlOnly.tsa.enabled,false);
});

test('enabled situation awareness hands the RC an https api host and a wss channel',()=>{
  const c=pilotConfiguration({...configured,SKYHUB_DJI_TSA_ENABLED:'true',
    SKYHUB_PILOT_PUBLIC_URL:'https://rpi5.fritz.box'});
  assert.equal(c.ready,true);
  assert.deepEqual(c.tsa,{enabled:true,issue:null,apiHost:'https://rpi5.fritz.box',
    wsHost:'wss://rpi5.fritz.box/ws/tsa',trustedProxyIps:['127.0.0.1','::1']});
  assert.deepEqual(c.bootstrap().tsa,{apiHost:'https://rpi5.fritz.box',wsHost:'wss://rpi5.fritz.box/ws/tsa'});
  const port=pilotConfiguration({...configured,SKYHUB_DJI_TSA_ENABLED:'true',
    SKYHUB_PILOT_PUBLIC_URL:'https://rpi5.fritz.box:8443/'});
  assert.equal(port.tsa.wsHost,'wss://rpi5.fritz.box:8443/ws/tsa');
});

test('an unsafe or unclear public URL disables situation awareness without blocking Pilot 2',()=>{
  for(const url of ['','http://rpi5.fritz.box','https://user:pw@rpi5.fritz.box','https://rpi5.fritz.box/sub',
    'https://rpi5.fritz.box/?x=1','https://rpi5.fritz.box/#a','not a url','wss://rpi5.fritz.box']){
    const c=pilotConfiguration({...configured,SKYHUB_DJI_TSA_ENABLED:'true',SKYHUB_PILOT_PUBLIC_URL:url});
    assert.equal(c.ready,true,url);
    assert.equal(c.tsa.enabled,false,url);
    assert.match(c.tsa.issue,/HTTPS origin/,url);
    assert.equal('tsa' in c.bootstrap(),false,url);
    assert.doesNotMatch(JSON.stringify(c.tsa),/pw|user/,url);
  }
});

test('opt-in Mosquitto profile requires a LAN-reachable matching Pilot 2 1883 endpoint',()=>{
  const mosquito={
    ...configured,
    SKYHUB_MQTT_BROKER_KIND:'mosquitto',
    SKYHUB_MQTT_REQUIRED_PORT:'1883',
    SKYHUB_PILOT_MQTT_URL:'mqtt://192.168.178.63:1883'
  };
  const c=pilotConfiguration(mosquito);
  assert.equal(c.ready,true);
  assert.equal(c.bootstrap().mqtt.host,'tcp://192.168.178.63:1883');
  for(const patch of [
    {SKYHUB_PILOT_MQTT_URL:'mqtt://192.168.178.63:1884'},
    {SKYHUB_MQTT_REQUIRED_PORT:'1884'},
    {SKYHUB_MQTT_BROKER_KIND:'emqx'},
    {SKYHUB_PILOT_MQTT_URL:'mqtt://127.0.0.1:1883'}
  ]){
    const result=pilotConfiguration({...mosquito,...patch});
    assert.equal(result.ready,false);
    assert.throws(()=>result.bootstrap(),/not configured/);
  }
});

test('dedicated authenticated Mosquitto profile hands the RC the matching 1884 LAN endpoint',()=>{
  const dedicated={
    ...configured,
    SKYHUB_MQTT_BROKER_KIND:'mosquitto-dedicated',
    SKYHUB_MQTT_REQUIRED_PORT:'1884',
    SKYHUB_PILOT_MQTT_URL:'mqtt://192.168.178.63:1884'
  };
  const c=pilotConfiguration(dedicated);
  assert.equal(c.ready,true);
  assert.equal(c.bootstrap().mqtt.host,'tcp://192.168.178.63:1884');
  for(const patch of [
    {SKYHUB_PILOT_MQTT_URL:'mqtt://192.168.178.63:1883'},
    {SKYHUB_MQTT_REQUIRED_PORT:'1883'},
    {SKYHUB_MQTT_BROKER_KIND:'mosquitto'},
    {SKYHUB_PILOT_MQTT_URL:'mqtt://host.docker.internal:1884'},
    {SKYHUB_PILOT_MQTT_URL:'mqtt://127.0.0.1:1884'}
  ]){
    const result=pilotConfiguration({...dedicated,...patch});
    assert.equal(result.ready,false,JSON.stringify(patch));
    assert.throws(()=>result.bootstrap(),/not configured/);
  }
});
