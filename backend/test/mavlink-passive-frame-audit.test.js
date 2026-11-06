'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {projectMavlinkTelemetry}=require('../mavlink-telemetry-readonly');
const {inspectPassiveFrame,inspectPassiveBatch,AGE_LIMIT_MS}=
  require('../mavlink-passive-frame-audit');

const NOW=1794000000000;
function sample(now=NOW){
  const ts=now-200;
  return {
    sn:'AIR_SYNTHETIC',gatewaySn:'RC_SYNTHETIC',role:'subdevice',
    model:{domain:'0',type:77,subType:2},
    topologyOnline:true,topologyRestored:false,topologyTimeVerified:true,
    lastTopologyAt:now-5000,aircraftConnected:true,online:true,fresh:true,
    telemetryTimeVerified:true,lastTelemetryAt:ts,
    telemetry:{altitude:52.5,battery:77,attitudePitch:-1.5,
      attitudeRoll:3.5,heading:271,latitude:49.13,longitude:8.46,
      heightEllipsoid:410},
    telemetryFieldAt:{altitude:ts,battery:ts,attitudePitch:ts,
      attitudeRoll:ts,heading:ts},
    telemetryFieldTimeVerified:{altitude:true,battery:true,
      attitudePitch:true,attitudeRoll:true,heading:true}
  };
}
function projection(now=NOW,overrides={}){
  return projectMavlinkTelemetry(sample(now),{
    now,trustedDeviceSn:'AIR_SYNTHETIC',
    expectedGatewaySn:'RC_SYNTHETIC',uptimeMs:2000,
    systemId:220,sequence:254,...overrides
  });
}
// Test-only checksum recomputation after a malicious payload mutation;
// independent of the encoder and the production auditor's implementation.
function resign(buffer,extra){
  const b=Buffer.from(buffer);
  let crc=0xffff;
  for(const byte of [...b.subarray(1,-2),extra]){
    crc^=byte;
    for(let i=0;i<8;i++)
      crc=crc&1?((crc>>>1)^0x8408):(crc>>>1);
  }
  b.writeUInt16LE(crc&0xffff,b.length-2);
  return b;
}
test('pinned independent heartbeat vector is parsed as a non-flight-controller',()=>{
  const vector=Buffer.from('fd09000000dcbf0000000000000012080000030d92','hex');
  const result=inspectPassiveFrame(vector);
  assert.equal(result.id,0);
  assert.equal(result.name,'HEARTBEAT');
  assert.equal(result.sequence,0);
  assert.equal(result.systemId,220);
  assert.equal(result.uptimeMs,null);
});
test('P2.0 generated batch has independent validated CRC, order and bounded epoch',()=>{
  const p=projection();
  assert.equal(p.generatedAt,NOW);
  const x=inspectPassiveBatch(p,{now:NOW});
  assert.equal(x.accepted,true);
  assert.equal(x.count,4);
  assert.equal(x.firstSequence,254);
  assert.equal(x.nextSequence,2);
  assert.equal(x.systemId,220);
  assert.deepEqual(x.types,['HEARTBEAT','ATTITUDE','DJI_TKOFF','DJI_BATT']);
  assert.equal(x.flightReady,false);
  assert.equal(x.hardwareVerified,false);
  assert.equal(x.commandCapable,false);
  for(const b of p.frames)assert.ok(inspectPassiveFrame(b));
  assert.doesNotMatch(JSON.stringify(x),/AIR_SYNTHETIC|RC_SYNTHETIC|49.13|8.46/);
});
test('expired, future, missing and self-described hardware proof fail closed',()=>{
  const p=projection();
  const wrong=[
    [inspectPassiveBatch(p,{now:NOW+AGE_LIMIT_MS+1}),'expired_or_unverified_batch'],
    [inspectPassiveBatch(p,{now:NOW-1}),'expired_or_unverified_batch'],
    [inspectPassiveBatch({...p,generatedAt:null},{now:NOW}),'expired_or_unverified_batch'],
    [inspectPassiveBatch({...p,hardwareVerified:true},{now:NOW}),'untrusted_batch'],
    [inspectPassiveBatch({...p,commandCapable:true},{now:NOW}),'untrusted_batch'],
    [inspectPassiveBatch({...p,accepted:false},{now:NOW}),'untrusted_batch']
  ];
  for(const [result,reason] of wrong){
    assert.equal(result.accepted,false);
    assert.equal(result.reason,reason);
  }
});
test('corrupt CRC, unsigned packet limits, injected command IDs and malformed lengths are rejected',()=>{
  const src=projection().frames[0];
  const corrupt=Buffer.from(src);corrupt[10]^=1;
  const incompatible=Buffer.from(src);incompatible[2]=1;
  const version=Buffer.from(src);version[0]=0xfe;
  const length=Buffer.from(src);length[1]=8;
  const command=Buffer.from(src);command[7]=76;
  for(const b of [corrupt,incompatible,version,length,command,src.subarray(0,12)])
    assert.equal(inspectPassiveFrame(b),null);
});
test('even correctly re-signed forged heartbeat and named values are rejected',()=>{
  const src=projection().frames;
  const armed=Buffer.from(src[0]);armed[16]=0x80;
  const impersonator=Buffer.from(src[0]);impersonator[15]=3;
  const target=Buffer.from(src[0]);target[5]=1;
  const secret=Buffer.from(src[2]);secret.write('SECRET',18,'ascii');
  for(const [bytes,extra] of [[armed,50],[impersonator,50],[target,50],[secret,170]]){
    assert.equal(inspectPassiveFrame(resign(bytes,extra)),null);
  }
});
test('single-frame mutations with correct CRC cannot smuggle flight-control data',()=>{
  const p=projection();
  const fake=Buffer.from(p.frames[1]);
  fake.writeFloatLE(0,26); // Pretends missing pitch rate is measured zero
  assert.equal(inspectPassiveFrame(resign(fake,39)),null);
  const more=Buffer.from(p.frames[3]);
  more.writeFloatLE(200,14); // Out-of-range 200% battery
  assert.equal(inspectPassiveFrame(resign(more,170)),null);
});
test('mixed MAVLink system IDs, replayed sequences, clock epochs and noncanonical order block a batch',()=>{
  const p=projection();
  const badId=Buffer.from(p.frames[1]);badId[5]=221;
  const badSeq=Buffer.from(p.frames[1]);badSeq[4]=3;
  const badTime=Buffer.from(p.frames[2]);badTime.writeUInt32LE(777,10);
  const permutations=[
    {...p,frames:[p.frames[0],resign(badId,39),...p.frames.slice(2)]},
    {...p,frames:[p.frames[0],resign(badSeq,39),...p.frames.slice(2)]},
    {...p,frames:[...p.frames.slice(0,2),resign(badTime,170),p.frames[3]]},
    {...p,frames:[p.frames[1],p.frames[0],p.frames[2],p.frames[3]]},
    {...p,nextSequence:3}
  ];
  for(const b of permutations)assert.equal(inspectPassiveBatch(b,{now:NOW}).accepted,false);
});
test('zero/empty and oversized batches never enter the independent verifier',()=>{
  const p=projection();
  for(const b of [
    {...p,frames:[]},{...p,frames:[...p.frames,p.frames[0]]},
    {...p,messageTypes:['HEARTBEAT']},{...p,nextSequence:999},
    {...p,frames:['arbitrary']},{...p,frames:[Buffer.alloc(200)]}
  ])assert.equal(inspectPassiveBatch(b,{now:NOW}).accepted,false);
});
test('auditor never imports encoder, transport, DJI command or network code',()=>{
  const source=readFileSync(require.resolve('../mavlink-passive-frame-audit'),'utf8');
  assert.doesNotMatch(source,/require\(['"](?:mqtt|dgram|net|node:dgram|node:net)['"]\)/);
  assert.doesNotMatch(source,/require\(['"].*mavlink-telemetry-readonly['"]\)/);
  assert.doesNotMatch(source,/\.(?:publish|send|connect|listen|bind)\s*\(/);
});
