'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {inspectDjiEventProfile,SCHEMA}=require('../dji-event-profile-audit');

const NOW=1794000000000;
const GW='GATEWAY_PRIVATE_1',TOPIC='thing/product/'+GW+'/events';
const RC_PRO={domain:2,type:144,subType:0};
const RC_PLUS={domain:'2',type:174,subType:0};
const M3M={domain:0,type:77,subType:2};
const M4T={domain:0,type:99,subType:1};
const DOCK1={domain:3,type:1,subType:0};
const DOCK2={domain:3,type:2,subType:0};
const DOCK3={domain:3,type:3,subType:0};
const pair=(gatewayModel=RC_PRO,aircraftModel=M3M)=>({
  gatewaySn:GW,gatewayModel,aircraftModel
});
const payload=(method='airsense_warning',overrides={})=>({
  timestamp:NOW-1000,gateway:GW,method,need_reply:1,
  data:[{warning_level:3,distance:700,icao:'SECRET_ICAO',
    latitude:49.1234,longitude:8.5678}],...overrides
});
const inspect=(message=payload(),opts={})=>{
  const {binding=pair(),resolveTrustedPair=()=>binding,...rest}=opts;
  return inspectDjiEventProfile({topic:TOPIC,
    payload:Buffer.from(JSON.stringify(message)),now:NOW,
    resolveTrustedPair,...rest});
};
function progress(){
  return payload('flighttask_progress',{
    data:{result:0,output:{status:'ok',ext:{flight_id:'MISSION_PRIVATE'}}}
  });
}
function assertPassive(result){
  for(const key of ['replyPublished','liveMqttUsed','hardwareVerified',
    'operationVerified','flightReady'])assert.equal(result[key],false,key);
  assert.doesNotMatch(JSON.stringify(result),
    /SECRET_ICAO|49\.1234|8\.5678|MISSION_PRIVATE|GATEWAY_PRIVATE/i);
}
test('RC Pro + M3M supports passive AirSense candidate without disclosing third parties',()=>{
  const out=inspect();
  assert.equal(out.schema,SCHEMA);
  assert.deepEqual([out.accepted,out.profile,out.family,out.method],
    [true,'pilot-rc-pro-m3m','pilot-to-cloud','airsense_warning']);
  assert.equal(out.replyObligation,'required');
  assert.equal(out.shapeValidated,true);
  assert.equal(out.modelBindingMatched,true);
  assertPassive(out);
});
test('RC Plus 2 + Matrice 4T is matched only by exact numeric model tuple',()=>{
  const out=inspect(payload('airsense_warning',{need_reply:0}),{
    binding:pair(RC_PLUS,M4T)
  });
  assert.equal(out.profile,'pilot-rc-plus2-m4t');
  assert.equal(out.replyObligation,'not-required');
  assert.equal(out.accepted,true);
  assertPassive(out);
});
test('Pilot 2 nested HMS is accepted with unknown reply obligation when absent',()=>{
  const event=payload(undefined,{data:{
    event:'hms',method:'hms',output:{codes:[{id:370147430,level:2}]}
  }});
  delete event.method;
  delete event.need_reply;
  const out=inspect(event);
  assert.equal(out.accepted,true);
  assert.equal(out.method,'hms');
  assert.equal(out.replyObligation,'unknown');
  assert.equal(out.shapeValidated,true);
  assertPassive(out);
});
test('Dock 1/2/3 matched against exact supported aircraft families',()=>{
  for(const [gateway,aircraft,name] of [
    [DOCK1,{domain:0,type:67,subType:0},'dock-1'],
    [DOCK2,{domain:0,type:91,subType:1},'dock-2'],
    [DOCK3,{domain:0,type:100,subType:0},'dock-3']
  ]){
    const out=inspect(progress(),{binding:pair(gateway,aircraft)});
    assert.equal(out.accepted,true);
    assert.equal(out.profile,name);
    assert.equal(out.family,'dock-to-cloud');
    assert.equal(out.shapeValidated,true);
    assert.equal(out.replyObligation,'required');
    assertPassive(out);
  }
});
test('Dock gateway may be classified without an aircraft; never infer pair from payload',()=>{
  const out=inspect(payload('file_upload_callback',{
    data:{file:{object_key:'SECRET_KEY',name:'PRIVATE.jpg'}}
  }),{binding:{gatewaySn:GW,gatewayModel:DOCK2}});
  assert.equal(out.accepted,true);
  assert.equal(out.profile,'dock-2');
  assert.equal(out.shapeValidated,false); // envelope only; not S3 HEAD verified
  assertPassive(out);
});
test('Pilot 2 never inherits dock mission, media or OTA event contracts',()=>{
  for(const method of ['flighttask_progress','flighttask_ready',
    'file_upload_callback','ota_progress','fileupload_progress']){
    const data=method==='flighttask_progress'?progress():
      payload(method,{data:{valid:'envelope-only'}});
    const out=inspect(data);
    assert.equal(out.accepted,false,method);
    assert.equal(out.reason,'event_outside_profile',method);
    assert.equal(out.replyObligation,'unknown',method);
    assertPassive(out);
  }
});
test('incorrect pair, unknown and untyped models fail closed',()=>{
  const bad=[
    [pair(RC_PRO,M4T),'unsupported_aircraft_pair'],
    [pair(RC_PLUS,M3M),'unsupported_aircraft_pair'],
    [pair(DOCK2,M4T),'unsupported_aircraft_pair'],
    [pair({domain:null,type:144,subType:0},M3M),'unknown_gateway_model'],
    [pair({domain:2,type:144},M3M),'unknown_gateway_model'],
    [pair({domain:2,type:119,subType:0},M3M),'unsupported_gateway_model'],
    [{gatewaySn:GW,gatewayModel:RC_PRO},'missing_aircraft_binding'],
    [{gatewaySn:'OTHER',gatewayModel:RC_PRO,aircraftModel:M3M},'unbound_gateway']
  ];
  for(const [binding,reason] of bad){
    const out=inspect(payload(),{binding});
    assert.equal(out.accepted,false,reason);
    assert.equal(out.reason,reason);
    assertPassive(out);
  }
});
test('untrusted payload cannot select or override the independently resolved profile',()=>{
  const attempt=payload('flighttask_progress',{
    gateway:'OTHER',data:{result:0,output:{status:'ok',ext:{flight_id:'MISSION_PRIVATE'}}},
    model:{domain:3,type:2,subType:0}
  });
  let calls=0;
  const resolver=()=>{calls++;return pair(DOCK2,{domain:0,type:91,subType:0});};
  const out=inspect(attempt,{resolveTrustedPair:resolver});
  assert.equal(out.accepted,false);
  assert.equal(out.reason,'gateway_mismatch');
  assert.equal(calls,0);
  assertPassive(out);
  const out2=inspect(progress(),{binding:pair()});
  assert.equal(out2.reason,'event_outside_profile');
});
test('untrusted/stale and malformed messages never invoke a device resolver',()=>{
  for(const opts of [
    {packet:{retain:true}},
    {payload:'{'},
    {payload:Buffer.from(JSON.stringify(payload('airsense_warning',
      {timestamp:NOW-300001})))},
    {topic:'thing/product/'+GW+'/services_reply'}
  ]){
    let called=0;
    const {payload:raw=Buffer.from(JSON.stringify(payload())),...rest}=opts;
    const out=inspectDjiEventProfile({topic:TOPIC,payload:raw,now:NOW,
      ...rest,resolveTrustedPair:()=>{called++;return pair();}});
    assert.equal(out.accepted,false);
    assert.equal(called,0);
    assertPassive(out);
  }
});
test('missing, throwing and asynchronous resolvers cannot classify an event',()=>{
  const raw=Buffer.from(JSON.stringify(payload()));
  const missing=inspectDjiEventProfile({topic:TOPIC,payload:raw,now:NOW});
  assert.equal(missing.reason,'missing_trusted_resolver');
  assert.equal(inspect(payload(),{resolveTrustedPair:()=>{throw new Error('SECRET');}})
    .reason,'trusted_resolver_failed');
  assert.equal(inspect(payload(),{resolveTrustedPair:()=>Promise.resolve(pair())})
    .reason,'unbound_gateway');
  assertPassive(missing);
});
test('invalid or absent ACK hint is never inferred or turned into an outbound action',()=>{
  const without=payload();delete without.need_reply;
  const out=inspect(without);
  assert.equal(out.accepted,true);
  assert.equal(out.replyObligation,'unknown');
  assert.equal(inspect(payload('airsense_warning',{need_reply:'1'})).reason,
    'invalid_need_reply');
  assertPassive(out);
});
test('profile module has no MQTT/network/publisher dependencies',()=>{
  const src=fs.readFileSync(require.resolve('../dji-event-profile-audit'),'utf8');
  assert.doesNotMatch(src,/\brequire\(['"](?:mqtt|express|pg|ioredis|node:https|node:net)['"]\)/);
  assert.doesNotMatch(src,/\.publish\s*\(|\.connect\s*\(/);
  assert.equal(typeof inspectDjiEventProfile,'function');
});
