'use strict';

// Offline integration across the actual intake and both hardware evaluators.
// No Docker, broker, Redis, PostgreSQL or DJI connection is opened.
const test=require('node:test');
const assert=require('node:assert/strict');
const {parseMessage}=require('../dji');
const {classifyMessage}=require('../message-guard');
const {createRegistry}=require('../registry');
const {createMqttMetrics}=require('../mqtt-metrics');
const {createModelShapeCatalog}=require('../mqtt-shape');
const {deviceCachePayload}=require('../device-cache');
const {evaluateHardwareSession:evaluateM3M,formatReport:printM3M}=require('../hardware-validation');
const {evaluateHardwareSession:evaluateM4T,formatReport:printM4T}=require('../rc-plus2-m4t-hardware-validation');

const NOW=1792609000000;
function intake(){
  const registry=createRegistry(),metrics=createMqttMetrics(),shapes=createModelShapeCatalog();
  function receive(topic,data,at=NOW-1000,method,receivedAt=at){
    metrics.observed(topic);
    const message=parseMessage(topic,Buffer.from(JSON.stringify({timestamp:at,data,method})));
    assert.equal(classifyMessage(message,{},receivedAt).accept,true);
    const result=registry.ingest(message,receivedAt);
    assert.equal(result.dropReason,undefined);
    metrics.accepted(message,result,receivedAt);
    const device=registry.get(message.sn,receivedAt);
    shapes.record(message,device,receivedAt);
  }
  for(const [rc,air,type,subtype] of [
    ['PRIVATE_PRO','PRIVATE_M3M',144,2],['PRIVATE_PLUS','PRIVATE_M4T',174,1]
  ]){
    receive('sys/product/'+rc+'/status',{
      domain:2,type,sub_type:0,
      sub_devices:[{sn:air,domain:0,type:type===144?77:99,sub_type:subtype}]
    },NOW-2000,'update_topo');
    receive('thing/product/'+rc+'/osd',{capacity_percent:75});
    receive('thing/product/'+air+'/osd',{
      mode_code:0,latitude:49.123456,longitude:8.123456,
      battery:{capacity_percent:65},rth_altitude:90,rc_lost_action:2,
      distance_limit_status:{state:1,distance_limit:500,is_near_distance_limit:0}
    });
    receive('thing/product/'+rc+'/state',{firmware_version:'1.2.3'},NOW-60000,undefined,NOW-500);
    receive('thing/product/'+air+'/state',{low_battery_warning_threshold:20},NOW-60000,undefined,NOW-500);
  }
  return {registry,metrics,shapes,receive};
}
const pairing={devices:[{model:'DJI RC Plus 2 Enterprise',lastUsedAt:NOW-1000}],pending:[]};
function health(metrics){return {...metrics.snapshot(),mqtt:true,subscribed:true,
  topologyReplyEnabled:true,topologyReplyConnected:true,topologyReplySent:2};}

test('both device families retain current main safeguards through the real parser and registry',()=>{
  const {registry,metrics,shapes}=intake();
  const devices=registry.snapshot(NOW);
  assert.equal(devices.length,4);
  const m3m=evaluateM3M(devices,health(metrics),[],NOW,shapes.snapshot());
  const m4t=evaluateM4T(devices,health(metrics),[],NOW,pairing);
  assert.equal(m3m.linked,true);
  assert.equal(m3m.controller.propertyFields.documented,55);
  assert.equal(m3m.aircraft.propertyFields.documented,150);
  assert.equal(m3m.m3mExtensions.accepted,6);
  assert.equal(m3m.stateEvidence.modelRc,1);
  assert.equal(m3m.stateEvidence.modelM3m,1);
  assert.equal(m4t.passed,true);
  assert.equal(m4t.controller.fields.documented,54);
  assert.equal(m4t.aircraft.fields.documented,202);
  for(const report of [m3m,m4t]){
    assert.ok(report.stages.filter(s=>s.step.includes('State')).every(s=>s.status==='BESTÄTIGT'));
  }
  for(const device of devices){
    assert.equal(device.telemetryFieldAt.battery,NOW-1000);
    const cached=deviceCachePayload(device);
    assert.equal(Object.hasOwn(cached,'telemetryFieldAt'),false);
    assert.equal(Object.hasOwn(cached,'telemetryFieldTimeVerified'),false);
  }
  assert.doesNotMatch(JSON.stringify([m3m,m4t])+printM3M(m3m)+printM4T(m4t),
    /PRIVATE_|49\.123456|8\.123456|1\.2\.3/);
});

test('disconnect replay of one aircraft cannot refresh it or invalidate the other family',()=>{
  const {registry,metrics,shapes,receive}=intake();
  receive('thing/product/PRIVATE_M4T/osd',{
    mode_code:14,latitude:50,longitude:9,battery:{capacity_percent:99}
  },NOW);
  const devices=registry.snapshot(NOW);
  const m3m=evaluateM3M(devices,health(metrics),[],NOW,shapes.snapshot());
  const m4t=evaluateM4T(devices,health(metrics),[],NOW,pairing);
  assert.equal(m3m.aircraft.osdFresh,true);
  assert.equal(m3m.aircraft.aircraftConnected,true);
  assert.equal(m4t.passed,false);
  assert.equal(m4t.aircraft.aircraftConnected,false);
  const disconnected=registry.get('PRIVATE_M4T',NOW);
  assert.equal(disconnected.lastTelemetryAt,NOW-1000);
  assert.equal(disconnected.telemetry.battery,65);
  assert.equal(disconnected.telemetry.latitude,49.123456);
});
