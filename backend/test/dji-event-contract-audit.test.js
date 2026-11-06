'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {inspectDjiEvent,SCHEMA,MAX_BYTES}=require('../dji-event-contract-audit');

const NOW=1794000000000;
const GATEWAY='RC_SYNTHETIC_01';
const TOPIC='thing/product/'+GATEWAY+'/events';
const basic=(changes={})=>({
  timestamp:NOW-1000,gateway:GATEWAY,method:'flighttask_ready',
  need_reply:1,data:{flight_ids:['FLIGHT_PRIVATE']},...changes
});
const check=(message=basic(),opts={})=>inspectDjiEvent({
  topic:TOPIC,payload:Buffer.from(JSON.stringify(message)),
  expectedGatewaySn:GATEWAY,now:NOW,...opts
});

test('valid event reports ACK obligation but can never publish or certify flight',()=>{
  const result=check();
  assert.equal(result.schema,SCHEMA);
  assert.equal(result.accepted,true);
  assert.equal(result.kind,'mission');
  assert.equal(result.method,'flighttask_ready');
  assert.equal(result.replyObligation,'required');
  assert.equal(result.shapeValidated,false);
  for(const key of ['replyPublished','liveMqttUsed','hardwareVerified',
    'operationVerified','flightReady'])assert.equal(result[key],false,key);
  assert.equal(Object.isFrozen(result),true);
});

test('need_reply 0, 1 and absent remain distinct; other types fail closed',()=>{
  assert.equal(check(basic({need_reply:0})).replyObligation,'not-required');
  const absent=basic();delete absent.need_reply;
  assert.equal(check(absent).replyObligation,'unknown');
  for(const bad of [false,'1',2,null]){
    assert.equal(check(basic({need_reply:bad})).reason,'invalid_need_reply');
  }
});

test('unsupported method never receives a reply decision or echoes identifiers',()=>{
  const x=check(basic({method:'command_secret_123',need_reply:1}));
  assert.equal(x.accepted,false);
  assert.equal(x.reason,'unsupported_method');
  assert.equal(x.replyObligation,'unknown');
  assert.equal(x.method,null);
  assert.doesNotMatch(JSON.stringify(x),/secret|RC_SYNTHETIC|FLIGHT_PRIVATE/i);
});

test('retained, stale, future, missing timestamps and wrong gateway fail closed',()=>{
  const bad=[
    check(basic(),{packet:{retain:true}}),
    check(basic({timestamp:NOW-300001})),
    check(basic({timestamp:NOW+30001})),
    check(basic({timestamp:undefined})),
    check(basic({gateway:'OTHER_GATEWAY'})),
    check(basic(),{expectedGatewaySn:'OTHER_GATEWAY'}),
    check(basic(),{expectedGatewaySn:null})
  ];
  assert.deepEqual(bad.map(x=>x.reason),[
    'retained','stale','future','invalid_timestamp',
    'gateway_mismatch','gateway_mismatch','unbound_gateway'
  ]);
  assert.ok(bad.every(x=>!x.accepted&&x.replyPublished===false));
});

test('only the events topic and bounded JSON payloads are accepted',()=>{
  assert.equal(check(basic(),{topic:'thing/product/'+GATEWAY+'/services_reply'}).reason,'invalid_topic');
  assert.equal(check(basic(),{topic:'sys/product/'+GATEWAY+'/status'}).reason,'invalid_topic');
  assert.equal(check(basic(),{payload:'{'}).reason,'malformed');
  assert.equal(check(basic(),{payload:'[]'}).reason,'malformed');
  assert.equal(check(basic(),{payload:'x'.repeat(MAX_BYTES+1)}).reason,'invalid_size');
  assert.equal(check(basic({data:null})).reason,'invalid_data');
  assert.equal(check(basic(),{now:0}).reason,'invalid_clock');
});

test('Pilot 2 nested HMS and AirSense reuse the existing SkyHub allowlist',()=>{
  const hms=basic({method:undefined,need_reply:0,data:{
    event:'hms',method:'hms',output:{codes:[{id:370147430,level:2}]}
  }});
  delete hms.method;
  const a=check(hms);
  assert.deepEqual([a.accepted,a.kind,a.method,a.shapeValidated],
    [true,'health','hms',true]);
  const air=check(basic({method:'airsense_warning',data:[{
    warning_level:3,distance:900,icao:'THIRD_PARTY_PRIVATE',
    latitude:49.1234,longitude:8.5678
  }]}));
  assert.equal(air.accepted,true);
  assert.equal(air.shapeValidated,true);
  assert.doesNotMatch(JSON.stringify(air),/THIRD_PARTY|icao|49\.1234|8\.5678/);
  assert.equal(check(basic({method:'airsense_warning',data:{invalid:true}})).reason,
    'invalid_method_shape');
});

test('flighttask_progress is strictly parsed and never certifies operation',()=>{
  const msg=basic({method:'flighttask_progress',data:{result:0,
    output:{status:'ok',ext:{flight_id:'FLIGHT_PRIVATE'}}}});
  const good=check(msg);
  assert.equal(good.accepted,true);
  assert.equal(good.shapeValidated,true);
  assert.equal(good.operationVerified,false);
  assert.equal(good.flightReady,false);
  const broken=basic({method:'flighttask_progress',data:{
    result:0,output:{status:'ok',ext:{}}}});
  assert.equal(check(broken).reason,'invalid_method_shape');
});

test('redacted output and pure module contain no transport or credentials',()=>{
  const v=check(basic({data:{secret:'CREDENTIAL_PRIVATE',password:'TOP_SECRET'}}));
  assert.doesNotMatch(JSON.stringify(v),/PRIVATE|SECRET|password|RC_SYNTHETIC/);
  const source=readFileSync(require.resolve('../dji-event-contract-audit'),'utf8');
  assert.doesNotMatch(source,/\brequire\(['"](?:mqtt|express|pg|ioredis)['"]\)/);
  assert.doesNotMatch(source,/\.publish\s*\(|\.connect\s*\(/);
});
