'use strict';

// P2.1: independent, strict validator for P2.0 MAVLink 2 frames.
// Does not import the encoder, parse incoming GCS commands, open a socket,
// or authorize a DJI device. Uses bit-at-a-time CRC independent of encoder.
const SCHEMA='skyhub-mavlink-passive-audit-v1';
const AGE_LIMIT_MS=1000;
const COMPONENT_ID=191;
const MESSAGE_SPECS=Object.freeze({
  0:Object.freeze({length:9,crc:50,name:'HEARTBEAT'}),
  30:Object.freeze({length:28,crc:39,name:'ATTITUDE'}),
  251:Object.freeze({length:18,crc:170,name:'NAMED_VALUE_FLOAT'})
});
function reject(reason){
  return Object.freeze({schema:SCHEMA,accepted:false,reason,count:0,
    types:Object.freeze([]),hardwareVerified:false,flightReady:false,
    commandCapable:false});
}
// Independent CRC-16/X.25 (MCRF4XX), reflected 0x8408 polynomial.
// MAVLink wire checksum runs over bytes [1..end-payload] + CRC_EXTRA.
function checksum(bytes,crcExtra){
  let result=0xffff;
  for(let i=1;i<bytes.length-2;i++){
    result^=bytes[i];
    for(let bit=0;bit<8;bit++)
      result=result&1?((result>>>1)^0x8408):(result>>>1);
  }
  result^=crcExtra;
  for(let bit=0;bit<8;bit++)
    result=result&1?((result>>>1)^0x8408):(result>>>1);
  return result&0xffff;
}
function inspectPassiveFrame(bytes){
  if(!Buffer.isBuffer(bytes)||bytes.length<12||bytes.length>255)
    return null;
  if(bytes[0]!==0xfd||bytes[2]!==0||bytes[3]!==0||
     bytes.length!==12+bytes[1]||bytes[5]<200||bytes[5]>239||
     bytes[6]!==COMPONENT_ID||bytes[9]!==0)
    return null;
  const id=bytes.readUInt16LE(7);
  const spec=Object.hasOwn(MESSAGE_SPECS,id)?MESSAGE_SPECS[id]:null;
  if(!spec||bytes[1]!==spec.length||
     checksum(bytes,spec.crc)!==bytes.readUInt16LE(bytes.length-2))
    return null;
  const p=bytes.subarray(10,-2);
  if(id===0){
    // Companion, not armed, not a flight controller and no advertised commands.
    if(p.readUInt32LE(0)!==0||p[4]!==18||p[5]!==8||
       p[6]!==0||p[7]!==0||p[8]!==3)return null;
    return Object.freeze({id,name:spec.name,sequence:bytes[4],
      systemId:bytes[5],uptimeMs:null,label:null});
  }
  const time=p.readUInt32LE(0);
  if(id===30){
    const roll=p.readFloatLE(4),pitch=p.readFloatLE(8),
      yaw=p.readFloatLE(12);
    if(!Number.isFinite(roll)||Math.abs(roll)>Math.PI+1e-5||
       !Number.isFinite(pitch)||Math.abs(pitch)>Math.PI/2+1e-5||
       !Number.isFinite(yaw)||Math.abs(yaw)>Math.PI+1e-5||
       ![16,20,24].every(offset=>Number.isNaN(p.readFloatLE(offset))))
      return null;
    return Object.freeze({id,name:spec.name,sequence:bytes[4],
      systemId:bytes[5],uptimeMs:time,label:null});
  }
  const value=p.readFloatLE(4);
  const rawName=p.subarray(8,18);
  const label=rawName.toString('ascii').replace(/\0+$/,'');
  const expected=Buffer.alloc(10);
  expected.write(label,0,'ascii');
  if(!rawName.equals(expected)||!Number.isFinite(value)||
     !(label==='DJI_BATT'&&value>=0&&value<=100||
       label==='DJI_TKOFF'&&value>=-1000&&value<=10000))
    return null;
  return Object.freeze({id,name:spec.name,sequence:bytes[4],
    systemId:bytes[5],uptimeMs:time,label});
}
function inspectPassiveBatch(batch,{now=Date.now()}={}){
  if(!batch||typeof batch!=='object'||batch.accepted!==true||
     batch.hardwareVerified!==false||batch.flightReady!==false||
     batch.publisherEnabled!==false||batch.mqttUsed!==false||
     batch.udpSent!==false||batch.commandCapable!==false)
    return reject('untrusted_batch');
  if(!Number.isSafeInteger(now)||!Number.isSafeInteger(batch.generatedAt)||
     batch.generatedAt>now||now-batch.generatedAt>AGE_LIMIT_MS)
    return reject('expired_or_unverified_batch');
  if(!Array.isArray(batch.frames)||batch.frames.length<1||
     batch.frames.length>4||!Array.isArray(batch.messageTypes)||
     batch.messageTypes.length!==batch.frames.length||
     !Number.isInteger(batch.nextSequence)||
     batch.nextSequence<0||batch.nextSequence>255)
    return reject('invalid_batch_shape');
  const infos=batch.frames.map(inspectPassiveFrame);
  if(infos.some(x=>x===null))return reject('invalid_frame');
  if(infos[0].id!==0||infos.some(x=>x.systemId!==infos[0].systemId))
    return reject('invalid_batch_identity');
  for(let i=0;i<infos.length;i++){
    if(infos[i].name!==batch.messageTypes[i]||
       i>0&&infos[i].sequence!==((infos[i-1].sequence+1)&255))
      return reject('invalid_frame_order');
  }
  if(batch.nextSequence!==((infos[infos.length-1].sequence+1)&255))
    return reject('invalid_next_sequence');
  // P2.0 order: heartbeat, optional attitude, optional takeoff height, battery.
  let stage=0,bootMs=null;
  for(let i=1;i<infos.length;i++){
    const entry=infos[i];
    const next=entry.id===30?1:
      entry.label==='DJI_TKOFF'?2:entry.label==='DJI_BATT'?3:0;
    if(next===0||next<=stage)return reject('unsupported_frame_sequence');
    if(bootMs!==null&&entry.uptimeMs!==bootMs)
      return reject('mixed_clock_epoch');
    bootMs=entry.uptimeMs;
    stage=next;
  }
  return Object.freeze({schema:SCHEMA,accepted:true,reason:null,
    count:infos.length,systemId:infos[0].systemId,
    firstSequence:infos[0].sequence,nextSequence:batch.nextSequence,
    types:Object.freeze(infos.map(x=>x.label||x.name)),
    hardwareVerified:false,flightReady:false,commandCapable:false});
}
module.exports={inspectPassiveFrame,inspectPassiveBatch,SCHEMA,AGE_LIMIT_MS};
