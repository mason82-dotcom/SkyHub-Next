'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {parseMessage}=require('../dji');
const {createRegistry}=require('../registry');
const {summarizeTelemetryFields}=require('../telemetry-field-profile');

const receive=(channel,sn,timestamp,data,method)=>parseMessage(
  (channel==='status'?'sys':'thing')+'/product/'+sn+'/'+channel,
  Buffer.from(JSON.stringify({timestamp,method,data}))
);
function setup(now) {
  const registry=createRegistry();
  registry.ingest(receive('status','RC01',now-50000,{
    domain:'2',type:174,sub_type:0,
    sub_devices:[{sn:'AIR01',domain:'0',type:99,sub_type:1}]
  },'update_topo'),now-50000);
  return registry;
}

test('OSD channel timestamp does not falsely refresh absent nested DJI fields',()=>{
  const now=1792605000000,registry=setup(now);
  registry.ingest(receive('osd','AIR01',now-20000,{
    mode_code:4,battery:{capacity_percent:60},
    cameras:[{zoom_factor:3}],wind_speed:1
  }),now-20000);
  registry.ingest(receive('osd','AIR01',now-1000,{
    mode_code:4,wind_speed:2
  }),now-1000);
  const d=registry.get('AIR01',now);
  assert.equal(d.propertyObservedAt.osd,now-1000);
  assert.equal(d.propertyFieldObservedAt.osd['battery.capacity_percent'],now-20000);
  assert.equal(d.propertyFieldObservedAt.osd['cameras.zoom_factor'],now-20000);
  assert.equal(d.propertyFieldObservedAt.osd.wind_speed,now-1000);
  assert.equal(d.deviceProperties.osd.battery.capacity_percent,60);
  const [r]=summarizeTelemetryFields([d],now);
  assert.ok(r.observedDocumented.includes('osd:battery.capacity_percent'));
  assert.ok(r.staleDocumented.includes('osd:battery.capacity_percent'));
  assert.ok(!r.freshDocumented.includes('osd:battery.capacity_percent'));
  assert.ok(r.freshDocumented.includes('osd:wind_speed'));
  assert.ok(!r.freshDocumented.includes('state:firmware_version'));
  assert.doesNotMatch(JSON.stringify(r),/"capacity_percent"\s*:\s*60|AIR01|RC01/);
});

test('dynamic gimbal freshness uses field names, and model changes clear timestamps',()=>{
  const now=1792606000000,registry=setup(now);
  registry.ingest(receive('osd','AIR01',now-20000,{
    mode_code:4,'89-0-0':{gimbal_yaw:14.125,gimbal_pitch:3.75}
  }),now-20000);
  registry.ingest(receive('osd','AIR01',now-1000,{
    mode_code:4,'89-0-0':{gimbal_pitch:3.5}
  }),now-1000);
  let d=registry.get('AIR01',now);
  assert.equal(d.propertyFieldObservedAt.osd['payload_gimbals.gimbal_yaw'],now-20000);
  assert.equal(d.propertyFieldObservedAt.osd['payload_gimbals.gimbal_pitch'],now-1000);
  let [report]=summarizeTelemetryFields([d],now);
  assert.ok(report.freshDynamic.includes('gimbal_pitch'));
  assert.ok(!report.freshDynamic.includes('gimbal_yaw'));
  assert.doesNotMatch(JSON.stringify(d.propertyFieldObservedAt),/89-0-0|14\.125/);
  registry.ingest(receive('status','RC01',now,{
    domain:'2',type:174,sub_type:0,
    sub_devices:[{sn:'AIR01',domain:'0',type:77,sub_type:2}]
  },'update_topo'),now);
  d=registry.get('AIR01',now);
  assert.deepEqual(d.propertyFieldObservedAt.osd,{});
  assert.deepEqual(d.deviceProperties.osd,{});
  [report]=summarizeTelemetryFields([d],now);
  assert.equal(report.dynamicDocumentedTotal,0);
});
