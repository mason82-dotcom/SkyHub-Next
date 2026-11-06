'use strict';

// P2.0 – pure offline MAVLink 2 telemetry projection.
// Not an autopilot, not a controller, not a socket/network client.
// Never accept inbound MAVLink; no DJI control methods or permissions.
const {serial}=require('./dji');

const SCHEMA='skyhub-dji-mavlink-passive-v1';
const MAX_FIELD_AGE_MS=5000;
const MAX_ATTITUDE_SKEW_MS=500;
const MAVLINK_V2_MAGIC=0xfd;
const MAV_TYPE_ONBOARD_CONTROLLER=18;
const MAV_AUTOPILOT_INVALID=8;
const MAV_COMP_ID_ONBOARD_COMPUTER=191;
const MAV_STATE_UNINIT=0;

// Exact aircraft IDs already verified in SkyHub catalog. Type alone is unsafe.
const SUPPORTED=new Set(['0:77:2','0:99:1']);
const MESSAGES=Object.freeze({
  0:Object.freeze({length:9,crcExtra:50,name:'HEARTBEAT'}),
  30:Object.freeze({length:28,crcExtra:39,name:'ATTITUDE'}),
  251:Object.freeze({length:18,crcExtra:170,name:'NAMED_VALUE_FLOAT'})
});
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const safeTime=x=>Number.isSafeInteger(x)&&x>=1e12&&x<1e15;
const finite=(x,min,max)=>typeof x==='number'&&Number.isFinite(x)&&x>=min&&x<=max;
function denied(reason){
  return Object.freeze({schema:SCHEMA,accepted:false,reason,frames:Object.freeze([]),
    messageTypes:Object.freeze([]),hardwareVerified:false,flightReady:false,
    publisherEnabled:false,mqttUsed:false,udpSent:false,commandCapable:false});
}
function crcAccumulate(crc,byte){
  let x=(byte^(crc&255))&255;
  x^=(x<<4)&255;
  return ((crc>>8)^(x<<8)^(x<<3)^(x>>4))&0xffff;
}
// Private, fixed-message encoder. No API for arbitrary MAVLink messages.
function frame(id,payload,sequence,systemId){
  const spec=MESSAGES[id];
  if(!spec||payload.length!==spec.length)throw new Error('Unsupported MAVLink telemetry');
  const bytes=Buffer.alloc(10+payload.length+2);
  bytes[0]=MAVLINK_V2_MAGIC;
  bytes[1]=payload.length;
  bytes[2]=0; // incompat flags: never signed/command-capable
  bytes[3]=0; // compat flags
  bytes[4]=sequence;
  bytes[5]=systemId;
  bytes[6]=MAV_COMP_ID_ONBOARD_COMPUTER;
  bytes.writeUIntLE(id,7,3);
  payload.copy(bytes,10);
  let crc=0xffff;
  for(let i=1;i<10+payload.length;i++)crc=crcAccumulate(crc,bytes[i]);
  crc=crcAccumulate(crc,spec.crcExtra);
  bytes.writeUInt16LE(crc,bytes.length-2);
  return bytes;
}
function encodeHeartbeat(){
  const p=Buffer.alloc(9);
  p.writeUInt32LE(0,0); // no custom flight-control mode
  p[4]=MAV_TYPE_ONBOARD_CONTROLLER; // companion, not the DJI autopilot
  p[5]=MAV_AUTOPILOT_INVALID;
  p[6]=0; // never claim armed, guided or mission-capable
  p[7]=MAV_STATE_UNINIT; // no DJI flight-ready statement
  p[8]=3; // MAVLink wire-version field
  return p;
}
function encodeAttitude(uptimeMs,pitch,roll,heading){
  const p=Buffer.alloc(28);
  p.writeUInt32LE(uptimeMs,0);
  const rad=Math.PI/180;
  const yaw=((heading%360)+540)%360-180;
  p.writeFloatLE(roll*rad,4);
  p.writeFloatLE(pitch*rad,8);
  p.writeFloatLE(yaw*rad,12);
  // Angular rates are not in the verified DJI OSD projection. Unknown != zero.
  for(const offset of [16,20,24])p.writeFloatLE(Number.NaN,offset);
  return p;
}
function encodeNamedValue(uptimeMs,name,value){
  const p=Buffer.alloc(18);
  p.writeUInt32LE(uptimeMs,0);
  p.writeFloatLE(value,4);
  p.write(name,8,'ascii'); // 10-byte ASCII name, fixed and allowlisted
  return p;
}
function observedField(device,key,now){
  const at=device.telemetryFieldAt?.[key];
  return device.telemetryFieldTimeVerified?.[key]===true &&
    safeTime(at)&&at<=now&&now-at<=MAX_FIELD_AGE_MS?at:null;
}
function projectMavlinkTelemetry(device,{
  now=Date.now(),trustedDeviceSn,expectedGatewaySn,uptimeMs,
  sequence=0,systemId=220
}={}){
  if(!serial(trustedDeviceSn)||!serial(expectedGatewaySn))
    return denied('missing_trusted_identity');
  if(!object(device)||device.sn!==trustedDeviceSn||
     device.gatewaySn!==expectedGatewaySn)return denied('identity_mismatch');
  const model=device.model;
  const modelId=object(model)?String(model.domain)+':'+model.type+':'+model.subType:null;
  if(!SUPPORTED.has(modelId))return denied('unsupported_aircraft');
  if(device.role!=='subdevice'||device.topologyOnline!==true||
     device.topologyRestored===true||device.topologyTimeVerified!==true||
     !safeTime(device.lastTopologyAt)||device.lastTopologyAt>now)
    return denied('unverified_topology');
  if(!safeTime(now)||device.aircraftConnected!==true||
     device.online!==true||device.fresh!==true||
     device.telemetryTimeVerified!==true||
     !safeTime(device.lastTelemetryAt)||device.lastTelemetryAt>now||
     now-device.lastTelemetryAt>MAX_FIELD_AGE_MS)
    return denied('telemetry_not_fresh');
  if(!Number.isSafeInteger(uptimeMs)||uptimeMs<0||uptimeMs>0xffffffff||
     !Number.isInteger(systemId)||systemId<200||systemId>239||
     !Number.isInteger(sequence)||sequence<0||sequence>255)
    return denied('invalid_export_config');

  const measurements=object(device.telemetry)?device.telemetry:{};
  const frames=[],messageTypes=[];
  let next=sequence;
  const push=(id,payload)=>{
    frames.push(frame(id,payload,next,systemId));
    messageTypes.push(MESSAGES[id].name);
    next=(next+1)&255;
  };
  push(0,encodeHeartbeat());

  const at=[observedField(device,'attitudePitch',now),
    observedField(device,'attitudeRoll',now),
    observedField(device,'heading',now)];
  if(at.every(x=>x!==null)&&Math.max(...at)-Math.min(...at)<=MAX_ATTITUDE_SKEW_MS&&
     finite(measurements.attitudePitch,-90,90)&&
     finite(measurements.attitudeRoll,-180,180)&&
     finite(measurements.heading,-360,360))
    push(30,encodeAttitude(uptimeMs,measurements.attitudePitch,
      measurements.attitudeRoll,measurements.heading));

  // DJI elevation is relative to takeoff, not verified home/terrain/MSL.
  // Keep it clearly named; do NOT substitute for GLOBAL_POSITION_INT.alt.
  if(observedField(device,'altitude',now)!==null&&
     finite(measurements.altitude,-1000,10000))
    push(251,encodeNamedValue(uptimeMs,'DJI_TKOFF',measurements.altitude));
  if(observedField(device,'battery',now)!==null&&finite(measurements.battery,0,100))
    push(251,encodeNamedValue(uptimeMs,'DJI_BATT',measurements.battery));

  return Object.freeze({schema:SCHEMA,accepted:true,reason:null,
    frames:Object.freeze(frames),messageTypes:Object.freeze(messageTypes),
    nextSequence:next,generatedAt:now,hardwareVerified:false,flightReady:false,
    publisherEnabled:false,mqttUsed:false,udpSent:false,commandCapable:false});
}
module.exports={projectMavlinkTelemetry,SCHEMA,MAX_FIELD_AGE_MS};
