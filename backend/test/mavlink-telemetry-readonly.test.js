'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {projectMavlinkTelemetry,SCHEMA,MAX_FIELD_AGE_MS}=
  require('../mavlink-telemetry-readonly');

const NOW=1794000000000;
const TS=NOW-500;
const snapshot=()=>({
  sn:'AIR_SYNTHETIC',gatewaySn:'RC_SYNTHETIC',role:'subdevice',
  model:{domain:'0',type:77,subType:2},topologyOnline:true,
  topologyRestored:false,topologyTimeVerified:true,lastTopologyAt:NOW-20000,
  aircraftConnected:true,online:true,fresh:true,
  telemetryTimeVerified:true,lastTelemetryAt:TS,
  telemetry:{latitude:49.12,longitude:8.44,heightEllipsoid:451.2,
    altitude:80.5,battery:76,heading:270,attitudePitch:-2.5,
    attitudeRoll:5.25,horizontalSpeed:6.1},
  telemetryFieldAt:{altitude:TS,battery:TS,heading:TS,
    attitudePitch:TS,attitudeRoll:TS,latitude:TS,longitude:TS},
  telemetryFieldTimeVerified:{altitude:true,battery:true,heading:true,
    attitudePitch:true,attitudeRoll:true,latitude:true,longitude:true}
});
const project=(device=snapshot(),more={})=>projectMavlinkTelemetry(device,{
  now:NOW,trustedDeviceSn:'AIR_SYNTHETIC',
  expectedGatewaySn:'RC_SYNTHETIC',uptimeMs:123456,
  sequence:0,systemId:220,...more
});
const msgId=buf=>buf.readUIntLE(7,3);
const crcExtra={0:50,30:39,251:170};
// Independent bit-at-a-time CRC-16/MCRF4XX verification.
function verifyMavlinkFrame(bytes){
  assert.equal(bytes[0],0xfd);
  assert.equal(bytes.length,12+bytes[1]);
  assert.equal(bytes[2],0);assert.equal(bytes[3],0);
  const id=msgId(bytes);
  assert.ok(Object.hasOwn(crcExtra,id),'unexpected MAVLink command/type '+id);
  let crc=0xffff;
  for(const byte of [...bytes.subarray(1,bytes.length-2),crcExtra[id]]){
    crc^=byte;
    for(let i=0;i<8;i++)crc=(crc&1)?((crc>>1)^0x8408):(crc>>1);
  }
  assert.equal(bytes.readUInt16LE(bytes.length-2),crc);
}
function passive(result){
  for(const key of ['hardwareVerified','flightReady','publisherEnabled',
    'mqttUsed','udpSent','commandCapable'])
    assert.equal(result[key],false,key);
}
test('HEARTBEAT is a non-autopilot companion, never an armed DJI flight controller',()=>{
  const result=project();
  assert.equal(result.accepted,true);
  assert.equal(result.schema,SCHEMA);
  assert.deepEqual(result.messageTypes,[
    'HEARTBEAT','ATTITUDE','NAMED_VALUE_FLOAT','NAMED_VALUE_FLOAT'
  ]);
  for(const frame of result.frames)verifyMavlinkFrame(frame);
  const heartbeat=result.frames[0];
  assert.equal(heartbeat.toString('hex'),
    'fd09000000dcbf0000000000000012080000030d92');
  assert.equal(heartbeat[14],18); // onboard controller (not quadrotor)
  assert.equal(heartbeat[15],8); // MAV_AUTOPILOT_INVALID
  assert.equal(heartbeat[16],0); // no MAV_MODE_FLAG_SAFETY_ARMED
  assert.equal(heartbeat[17],0); // MAV_STATE_UNINIT
  assert.equal(heartbeat[6],191); // onboard computer
  passive(result);
});
test('ATTITUDE converts verified degrees to radians, unknown angular rates remain NaN',()=>{
  const b=project().frames[1];
  assert.equal(msgId(b),30);
  assert.equal(b.readUInt32LE(10),123456);
  assert.ok(Math.abs(b.readFloatLE(14)-(5.25*Math.PI/180))<1e-6);
  assert.ok(Math.abs(b.readFloatLE(18)-(-2.5*Math.PI/180))<1e-6);
  assert.ok(Math.abs(b.readFloatLE(22)-(-Math.PI/2))<1e-6);
  for(const at of [26,30,34])assert.ok(Number.isNaN(b.readFloatLE(at)));
});
test('DJI relative takeoff height and battery have explicit names, not MSL positions',()=>{
  const result=project();
  assert.deepEqual(result.frames.slice(2).map(x=>x.subarray(18,28).toString('ascii')
    .replace(/\0/g,'')),['DJI_TKOFF','DJI_BATT']);
  assert.ok(Math.abs(result.frames[2].readFloatLE(14)-80.5)<1e-5);
  assert.ok(Math.abs(result.frames[3].readFloatLE(14)-76)<1e-5);
  assert.ok(!result.frames.some(x=>[24,33,141].includes(msgId(x))),
    'No GPS/position or MAVLink relative/home/MSL altitude inference');
});
test('Matrice 4T exact model pair is supported without changing export semantics',()=>{
  const d=snapshot();d.model={domain:'0',type:99,subType:1};
  assert.equal(project(d).accepted,true);
  d.model={domain:'0',type:99,subType:0}; // Matrice 4E not in scope
  assert.equal(project(d).reason,'unsupported_aircraft');
  d.model={domain:'0',type:77,subType:1}; // Mavic 3T, not Mavic 3M
  assert.equal(project(d).reason,'unsupported_aircraft');
});
test('unverified, restored, disconnected and spoofed aircraft are rejected',()=>{
  for(const [change,reason] of [
    [{role:'gateway'},'unverified_topology'],
    [{topologyOnline:false},'unverified_topology'],
    [{topologyRestored:true},'unverified_topology'],
    [{topologyTimeVerified:false},'unverified_topology'],
    [{lastTopologyAt:null},'unverified_topology'],
    [{aircraftConnected:false},'telemetry_not_fresh'],
    [{aircraftConnected:null},'telemetry_not_fresh'],
    [{online:false},'telemetry_not_fresh'],
    [{telemetryTimeVerified:false},'telemetry_not_fresh'],
    [{lastTelemetryAt:NOW-MAX_FIELD_AGE_MS-1},'telemetry_not_fresh'],
    [{sn:'SPOOF'},'identity_mismatch'],
    [{gatewaySn:'SPOOF'},'identity_mismatch']
  ]){
    const rejected=project({...snapshot(),...change});
    assert.equal(rejected.accepted,false,JSON.stringify(change));
    assert.equal(rejected.reason,reason,JSON.stringify(change));
    assert.deepEqual(rejected.frames,[]);
    passive(rejected);
  }
});
test('per-field age, time provenance and coherent attitude are all mandatory',()=>{
  const d=snapshot();
  d.telemetryFieldAt.attitudeRoll=NOW-MAX_FIELD_AGE_MS-1;
  let result=project(d);
  assert.deepEqual(result.messageTypes,[
    'HEARTBEAT','NAMED_VALUE_FLOAT','NAMED_VALUE_FLOAT']);
  d.telemetryFieldAt.attitudeRoll=TS;
  d.telemetryFieldTimeVerified.heading=false;
  result=project(d);
  assert.ok(!result.messageTypes.includes('ATTITUDE'));
  d.telemetryFieldTimeVerified.heading=true;
  d.telemetryFieldAt.heading=TS-1000;
  result=project(d);
  assert.ok(!result.messageTypes.includes('ATTITUDE'));
});
test('invalid fields never turn into fake zero measurements',()=>{
  const d=snapshot();
  d.telemetry.altitude=null;
  d.telemetry.battery=101;
  d.telemetry.attitudePitch=NaN;
  const result=project(d);
  assert.deepEqual(result.messageTypes,['HEARTBEAT']);
  passive(result);
});
test('position and unknown secrets never leak into arbitrary message fields',()=>{
  const d=snapshot();
  d.device_secret='DO_NOT_COPY_SECRET';
  d.telemetry.latitude=42.1234567;
  d.telemetry.longitude=71.1234567;
  d.telemetry.heightEllipsoid=999999;
  const result=project(d);
  assert.equal(result.accepted,true);
  const frames=Buffer.concat(result.frames);
  assert.equal(frames.includes(Buffer.from('SECRET')),false);
  assert.ok(!result.messageTypes.includes('GLOBAL_POSITION_INT'));
  assert.doesNotMatch(JSON.stringify({accepted:result.accepted,
    messageTypes:result.messageTypes}),/DO_NOT_COPY_SECRET|AIR_SYNTHETIC/);
});
test('sequence wraps but never permits arbitrary message IDs or socket I/O',()=>{
  const result=project(snapshot(),{sequence:254});
  assert.deepEqual(result.frames.map(x=>x[4]),[254,255,0,1]);
  assert.equal(result.nextSequence,2);
  for(const b of result.frames)verifyMavlinkFrame(b);
  const text=readFileSync(require.resolve('../mavlink-telemetry-readonly'),'utf8');
  assert.doesNotMatch(text,/require\(['"](?:mqtt|dgram|net|https|http|node:dgram|node:net)['"]\)/);
  assert.doesNotMatch(text,/\.(?:publish|send|connect|bind|listen)\s*\(/);
});
test('fail-closed on missing trusted IDs or malformed stream configuration',()=>{
  for(const opts of [
    {trustedDeviceSn:null},{expectedGatewaySn:null},
    {uptimeMs:null},{uptimeMs:-1},{uptimeMs:0x100000000},
    {sequence:-1},{sequence:256},{systemId:0},{systemId:255}
  ]){
    const result=project(snapshot(),opts);
    assert.equal(result.accepted,false,JSON.stringify(opts));
    assert.deepEqual(result.frames,[]);
    passive(result);
  }
});
