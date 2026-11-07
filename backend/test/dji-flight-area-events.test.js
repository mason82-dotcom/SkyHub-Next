'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {inspectFlightAreaEvent,SCHEMA,MAX_BYTES,MAX_LOCATIONS}=
  require('../dji-flight-area-events');

const now=1792740000000;
const topic='thing/product/DOCK-TEST/events';
const base={method:'flight_areas_sync_progress',gateway:'DOCK-TEST',
  timestamp:now,need_reply:1,data:{status:'synchronizing',reason:0}};
const check=(env=base,overrides={})=>inspectFlightAreaEvent({
  topic,payload:Buffer.from(JSON.stringify(env)),expectedGatewaySn:'DOCK-TEST',
  now,...overrides
});
const copy=()=>JSON.parse(JSON.stringify(base));
const reject=(result,reason)=>assert.deepEqual(result,{accepted:false,reason});

test('known sync event is normalized without promising device or flight readiness',()=>{
  const result=check();
  assert.deepEqual(result,{
    accepted:true,schema:SCHEMA,kind:'sync_progress',
    status:'synchronizing',reasonCode:0,fileReferencePresent:false,
    deviceReportedSynchronized:false,syncVerified:false,flightReady:false,
    hardwareVerified:false,sourceTimestamp:now
  });
});

test('device-reported synchronized is not a verified file revision or flight approval',()=>{
  const env=copy();
  env.data.status='synchronized';
  env.data.file={name:'flight_area.geojson',checksum:'A'.repeat(64)};
  const result=check(env);
  assert.equal(result.deviceReportedSynchronized,true);
  assert.equal(result.syncVerified,false);
  assert.equal(result.flightReady,false);
  assert.equal(result.fileReferencePresent,true);
  assert.ok(!JSON.stringify(result).includes('flight_area.geojson'));
  assert.ok(!JSON.stringify(result).includes('AAAA'));
});

test('all five documented sync states and error reasons 0 through 13 are handled',()=>{
  for(const status of ['wait_sync','switch_fail','synchronizing','synchronized','fail']){
    for(let reason=0;reason<=13;reason++){
      const env=copy();
      env.data.status=status;
      env.data.reason=reason;
      const result=check(env);
      assert.equal(result.accepted,true);
      assert.equal(result.reasonCode,reason);
    }
  }
});

test('unknown or ambiguous sync values fail closed',()=>{
  for(const status of ['success','SYNCHRONIZED','',null,1]){
    const env=copy();env.data.status=status;
    reject(check(env),'invalid_data');
  }
  for(const reason of [-1,14,'0',null,NaN,1.5]){
    const env=copy();env.data.reason=reason;
    reject(check(env),'invalid_data');
  }
});

test('file metadata must match documented checksum shape but is never exposed',()=>{
  for(const file of [{name:'x',checksum:'BAD'},{name:'',checksum:'a'.repeat(64)},
    {name:'x',checksum:23},'bad',[],{name:'x'},{
      name:'x'.repeat(256),checksum:'a'.repeat(64)}]){
    const env=copy();env.data.file=file;
    reject(check(env),'invalid_file');
  }
});

test('DJI distance-to-area event retains only whitelisted finite measurements',()=>{
  const env={...base,method:'flight_areas_drone_location',
    data:{drone_locations:[
      {area_id:'area-1',area_distance:13.5,is_in_area:false,
        private_location:'do-not-leak',latitude:49},
      {area_id:'area-2',area_distance:0,is_in_area:true}
    ],secret:'do-not-leak'}};
  const result=check(env);
  assert.deepEqual(result,{
    accepted:true,schema:SCHEMA,kind:'drone_location',
    locations:[{areaId:'area-1',distanceMeters:13.5,inArea:false},
      {areaId:'area-2',distanceMeters:0,inArea:true}],
    flightReady:false,hardwareVerified:false,sourceTimestamp:now
  });
  assert.ok(!JSON.stringify(result).includes('private_location'));
});

test('empty area list is valid, but over-bound lists and duplicate area IDs are not',()=>{
  const env={...base,method:'flight_areas_drone_location',data:{drone_locations:[]}};
  assert.deepEqual(check(env).locations,[]);
  env.data.drone_locations=Array.from({length:MAX_LOCATIONS+1},(_,i)=>({
    area_id:'zone-'+i,area_distance:2,is_in_area:false
  }));
  reject(check(env),'invalid_data');
  env.data.drone_locations=[{area_id:'same',area_distance:3,is_in_area:false},
    {area_id:'same',area_distance:4,is_in_area:true}];
  reject(check(env),'invalid_location');
});

test('malformed, huge and nonfinite area measurements fail closed',()=>{
  const event={...base,method:'flight_areas_drone_location'};
  for(const entry of [
    {area_id:'a',area_distance:-1,is_in_area:false},
    {area_id:'a',area_distance:1e9,is_in_area:true},
    {area_id:'a',area_distance:'20',is_in_area:true},
    {area_id:'a',area_distance:2,is_in_area:'false'},
    {area_id:'../../private',area_distance:2,is_in_area:false},
    {area_id:'a',area_distance:2},
    null
  ]){
    reject(check({...event,data:{drone_locations:[entry]}}),'invalid_location');
  }
  const nonfinite=Buffer.from(JSON.stringify({...event,data:{drone_locations:[
    {area_id:'a',area_distance:1,is_in_area:false}]}}))
      .toString().replace('"area_distance":1','"area_distance":1e999');
  reject(inspectFlightAreaEvent({topic,payload:Buffer.from(nonfinite),
    expectedGatewaySn:'DOCK-TEST',now}),'invalid_location');
});

test('gateway must come from separately authorized context, never the MQTT payload',()=>{
  reject(check(base,{expectedGatewaySn:undefined}),'unbound_gateway');
  reject(check(base,{expectedGatewaySn:'OTHER-DOCK'}),'invalid_topic');
  reject(check({...base,gateway:'OTHER-DOCK'}),'gateway_mismatch');
  reject(check(base,{topic:'thing/product/OTHER-DOCK/events'}),'invalid_topic');
  reject(check(base,{topic:'thing/product/DOCK-TEST/services_reply'}),'invalid_topic');
  reject(check(base,{topic:'sys/product/DOCK-TEST/status'}),'invalid_topic');
});

test('retained MQTT messages and replayed/future events are rejected',()=>{
  reject(check(base,{packet:{retain:true}}),'retained');
  reject(check({...base,timestamp:now-300001}),'stale');
  reject(check({...base,timestamp:now+30001}),'future');
  assert.equal(check({...base,timestamp:now-300000}).accepted,true);
});

test('missing, string, null and impossible timestamps are not silently accepted',()=>{
  for(const timestamp of [null,'1792740000000',0,1e16,1.5]){
    const env=copy();env.timestamp=timestamp;
    reject(check(env),'invalid_timestamp');
  }
  const env=copy();delete env.timestamp;
  reject(check(env),'invalid_timestamp');
});

test('non-flight-area methods, invalid data, malformed JSON and bad size are ignored',()=>{
  reject(check({...base,method:'hms'}),'unsupported_method');
  reject(check({...base,data:null}),'invalid_data');
  reject(inspectFlightAreaEvent({topic,payload:Buffer.from('{not-json'),
    expectedGatewaySn:'DOCK-TEST',now}),'malformed');
  reject(inspectFlightAreaEvent({topic,payload:Buffer.alloc(0),
    expectedGatewaySn:'DOCK-TEST',now}),'invalid_size');
  reject(inspectFlightAreaEvent({topic,payload:Buffer.alloc(MAX_BYTES+1),
    expectedGatewaySn:'DOCK-TEST',now}),'invalid_size');
  reject(inspectFlightAreaEvent({topic,payload:'not-a-buffer',
    expectedGatewaySn:'DOCK-TEST',now}),'invalid_size');
});

test('arbitrary passwords, signed download links and credentials never cross inspector output',()=>{
  const env=copy();
  env.token='UNSAFE-TOKEN';
  env.data.internal_secret='DO_NOT_PASS';
  env.data.file={name:'secret-file-name',checksum:'f'.repeat(64),
    url:'https://example.invalid/?token=EXPOSED'};
  const output=JSON.stringify(check(env));
  for(const value of ['UNSAFE-TOKEN','DO_NOT_PASS','secret-file-name',
    'EXPOSED','ffffffff'])assert.ok(!output.includes(value));
});

test('module remains standalone and cannot gain implicit MQTT or filesystem side effects',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../dji-flight-area-events.js'),'utf8');
  for(const pattern of [/require\(['"]mqtt['"]\)/, /\.publish\s*\(/,
    /\.subscribe\s*\(/, /require\(['"]fs['"]\)/, /require\(['"]pg['"]\)/]){
    assert.doesNotMatch(source,pattern);
  }
  assert.equal(typeof inspectFlightAreaEvent,'function');
});
