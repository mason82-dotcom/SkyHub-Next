'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const dgram=require('node:dgram');
const {readFileSync}=require('node:fs');
const {projectMavlinkTelemetry}=require('../mavlink-telemetry-readonly');
const {inspectPassiveFrame}=require('../mavlink-passive-frame-audit');
const {createLoopbackTelemetryLab,MIN_INTERVAL_MS}=require('../mavlink-loopback-lab');

function projection(sequence=0){
  const now=Date.now(),time=now-150;
  const device={
    sn:'TEST_AIR',gatewaySn:'TEST_RC',role:'subdevice',
    model:{domain:0,type:99,subType:1},
    topologyOnline:true,topologyRestored:false,
    topologyTimeVerified:true,lastTopologyAt:now-10000,
    aircraftConnected:true,online:true,fresh:true,
    telemetryTimeVerified:true,lastTelemetryAt:time,
    telemetry:{altitude:80,battery:75,attitudePitch:-3,
      attitudeRoll:4,heading:90,latitude:49.1,longitude:8.4},
    telemetryFieldAt:{altitude:time,battery:time,attitudePitch:time,
      attitudeRoll:time,heading:time},
    telemetryFieldTimeVerified:{altitude:true,battery:true,
      attitudePitch:true,attitudeRoll:true,heading:true}
  };
  const p=projectMavlinkTelemetry(device,{
    now,trustedDeviceSn:'TEST_AIR',expectedGatewaySn:'TEST_RC',
    uptimeMs:50000,sequence,systemId:220
  });
  assert.equal(p.accepted,true);
  return p;
}
function passive(out){
  assert.equal(out.commandCapable,false);
  assert.equal(out.flightReady,false);
  assert.equal(out.hardwareVerified,false);
  assert.equal(out.loopbackOnly,true);
}
test('no auto-bind, and opt-in plus literal loopback and explicit port are mandatory',async()=>{
  for(const opts of [
    {},{enabled:false,port:14550},{enabled:1,port:14550},
    {enabled:true,port:14550,host:'localhost'},
    {enabled:true,port:14550,host:'0.0.0.0'},
    {enabled:true,port:14550,host:'192.168.178.63'},
    {enabled:true,port:14550,host:'::1'},
    {enabled:true,port:80},{enabled:true,port:65536},
    {enabled:true,port:14550.5},{enabled:true,port:'14550'},
    {enabled:true}
  ]){
    const lab=createLoopbackTelemetryLab(opts);
    assert.equal(lab.enabled,false,JSON.stringify(opts));
    const result=await lab.sendBatch(projection());
    assert.equal(result.accepted,false,JSON.stringify(opts));
    assert.equal(result.framesSent,0);
    assert.equal(result.udpSent,false);
    passive(result);
    lab.close();
  }
});
test('malformed/replayed projection is rejected before a UDP socket is created',async()=>{
  const lab=createLoopbackTelemetryLab({enabled:true,port:14550});
  const p=projection();
  for(const v of [
    null,{...p,generatedAt:Date.now()-3000},
    {...p,flightReady:true},
    {...p,frames:[Buffer.from([1,2,3])]},
    {...p,frames:[...p.frames,p.frames[0]]},
    {...p,commandCapable:true}
  ]){
    const result=await lab.sendBatch(v);
    assert.equal(result.accepted,false);
    assert.equal(result.reason,'unverified_frames');
    assert.equal(result.udpSent,false);
    passive(result);
  }
  lab.close();
  assert.equal((await lab.sendBatch(projection())).accepted,false);
});
test('real isolated UDP loopback receives only validated passive frames, with rate/replay gates',async()=>{
  const sink=dgram.createSocket('udp4');
  const received=[];
  sink.on('message',msg=>received.push(Buffer.from(msg)));
  try{
    await new Promise((resolve,reject)=>{
      sink.once('error',reject);
      sink.bind(0,'127.0.0.1',resolve);
    });
    const port=sink.address().port;
    assert.ok(port>1024);
    const lab=createLoopbackTelemetryLab({enabled:true,
      host:'127.0.0.1',port});
    assert.equal(lab.enabled,true);
    const p=projection(250);
    const result=await lab.sendBatch(p);
    assert.equal(result.accepted,true);
    assert.equal(result.framesSent,4);
    assert.equal(result.udpSent,true);
    passive(result);
    const deadline=Date.now()+1500;
    while(received.length<4&&Date.now()<deadline)
      await new Promise(r=>setTimeout(r,10));
    assert.equal(received.length,4,'all four datagrams arrived on local sink');
    assert.deepEqual(received.map(b=>inspectPassiveFrame(b).id),[0,30,251,251]);
    assert.deepEqual(received.map(b=>b[4]),[250,251,252,253]);
    const tooFast=await lab.sendBatch(projection(254));
    assert.equal(tooFast.reason,'rate_limited');
    assert.equal(tooFast.udpSent,false);
    await new Promise(r=>setTimeout(r,MIN_INTERVAL_MS+20));
    const repeat=await lab.sendBatch(projection(250));
    assert.equal(repeat.reason,'replay_or_out_of_order');
    assert.equal(repeat.udpSent,false);
    assert.equal(received.length,4,'repeated batch was never transmitted');
    lab.close();
    assert.equal(lab.enabled,false);
    assert.equal((await lab.sendBatch(projection(254))).udpSent,false);
  }finally{
    await new Promise(resolve=>sink.close(resolve));
  }
});
test('lab module never receives/forwards GCS commands and has no server wiring',()=>{
  const source=readFileSync(require.resolve('../mavlink-loopback-lab'),'utf8');
  assert.doesNotMatch(source,/\.on\s*\(\s*['"]message['"]/);
  assert.doesNotMatch(source,/\.bind\s*\(|\.connect\s*\(/);
  assert.doesNotMatch(source,/require\(['"](?:mqtt|express|pg|ioredis)['"]\)/);
  assert.doesNotMatch(source,/require\(['"].*server['"]\)/);
  assert.match(source,/127\.0\.0\.1/);
});
