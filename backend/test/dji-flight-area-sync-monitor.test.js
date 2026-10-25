'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createFlightAreaSyncMonitor,SCHEMA,DEFAULT_TIMEOUT_MS}=
  require('../dji-flight-area-sync-monitor');
const {inspectFlightAreaEvent}=require('../dji-flight-area-events');

const BASE=1792740000000;
const GATEWAY='DOCK-TEST';
const DIGEST='a'.repeat(64);
const TOPIC='thing/product/'+GATEWAY+'/events';
const monitor=(timeoutMs=DEFAULT_TIMEOUT_MS)=>createFlightAreaSyncMonitor({
  expectedGatewaySn:GATEWAY,timeoutMs
});
const sync=(status,timestamp,checksum=DIGEST,reason=0)=>({
  method:'flight_areas_sync_progress',gateway:GATEWAY,timestamp,
  data:{status,reason,file:{name:'never-expose-this.geojson',checksum,
    url:'https://signed.example.invalid/path?secret=TOKEN'}}
});
const send=(m,envelope,at=envelope.timestamp,extra={})=>m.observe({
  topic:TOPIC,payload:Buffer.from(JSON.stringify(envelope)),at,...extra
});
const target=(m,revision=1,sha256=DIGEST,at=BASE)=>m.configureTarget({revision,sha256,at});
const reject=(result,reason)=>assert.deepEqual(result,{accepted:false,reason});

test('monitor has no target, no runtime commands, and unverified readiness by default',()=>{
  const m=monitor();
  reject(send(m,sync('synchronized',BASE)),'no_target');
  const state=m.snapshot(BASE);
  assert.equal(state.schema,SCHEMA);
  assert.equal(state.phase,'no_target');
  assert.equal(state.commandDispatched,false);
  assert.equal(state.revisionVerified,false);
  assert.equal(state.syncVerified,false);
  assert.equal(state.flightReady,false);
  assert.equal(state.hardwareVerified,false);
  assert.equal(state.targetRevision,null);
});

test('target configuration is offline metadata, not proof a command was sent',()=>{
  const m=monitor();
  const result=target(m,2);
  assert.equal(result.accepted,true);
  assert.equal(result.changed,true);
  assert.equal(result.state.phase,'target_configured');
  assert.equal(result.state.commandDispatched,false);
  assert.equal(result.state.targetRevision,2);
  assert.equal(result.state.acceptedEvents,0);
});

test('documented waiting, synchronizing and synchronized status transitions',()=>{
  const m=monitor();
  target(m);
  const waiting=send(m,sync('wait_sync',BASE+10),BASE+10);
  assert.equal(waiting.state.phase,'device_waiting');
  const running=send(m,sync('synchronizing',BASE+20),BASE+20);
  assert.equal(running.state.phase,'device_syncing');
  const done=send(m,sync('synchronized',BASE+30),BASE+30);
  assert.equal(done.state.phase,'device_reported_target');
  assert.equal(done.state.deviceReportedTargetMatch,true);
  assert.equal(done.state.acceptedEvents,3);
  assert.equal(done.state.revisionVerified,false);
  assert.equal(done.state.syncVerified,false);
  assert.equal(done.state.flightReady,false);
});

test('even a matching checksum is reported evidence only, never independent verification',()=>{
  const m=monitor();
  target(m);
  const state=send(m,sync('synchronized',BASE+1),BASE+1).state;
  assert.equal(state.deviceReportedTargetMatch,true);
  assert.equal(state.commandDispatched,false);
  assert.equal(state.revisionVerified,false);
  assert.equal(state.syncVerified,false);
  assert.equal(state.hardwareVerified,false);
});

test('missing file or wrong SHA256 can never count as a target match',()=>{
  for(const malformedFile of [undefined,{name:'f',checksum:'b'.repeat(64)}]){
    const m=monitor();
    target(m);
    const msg=sync('synchronized',BASE+1);
    if(malformedFile===undefined)delete msg.data.file;
    else msg.data.file=malformedFile;
    const state=send(m,msg,BASE+1).state;
    assert.equal(state.phase,'device_reported_unmatched');
    assert.equal(state.deviceReportedTargetMatch,false);
    assert.equal(state.revisionVerified,false);
  }
});

test('matching checksum during waiting, syncing or failure is not completed target evidence',()=>{
  const m=monitor();
  target(m);
  const waiting=send(m,sync('wait_sync',BASE+1),BASE+1).state;
  assert.equal(waiting.deviceReportedTargetMatch,false);
  const syncing=send(m,sync('synchronizing',BASE+2),BASE+2).state;
  assert.equal(syncing.deviceReportedTargetMatch,false);
  const failed=send(m,sync('fail',BASE+3,DIGEST,12),BASE+3).state;
  assert.equal(failed.phase,'device_failed');
  assert.equal(failed.deviceReportedTargetMatch,false);
  const other=monitor();target(other);
  const nonzero=send(other,sync('synchronized',BASE+1,DIGEST,13),BASE+1).state;
  assert.equal(nonzero.phase,'device_failed');
  assert.equal(nonzero.deviceReportedTargetMatch,false);
});

test('bad status and every documented nonzero reason are terminal failures',()=>{
  for(const status of ['fail','switch_fail']){
    const m=monitor();target(m);
    assert.equal(send(m,sync(status,BASE+1),BASE+1).state.phase,'device_failed');
  }
  for(let code=1;code<=13;code++){
    const m=monitor();target(m);
    const state=send(m,sync('synchronized',BASE+1,DIGEST,code),BASE+1).state;
    assert.equal(state.phase,'device_failed');
    assert.equal(state.syncVerified,false);
  }
});

test('same-time duplicates, out-of-order packets and pre-target replay are refused',()=>{
  const m=monitor();
  target(m);
  assert.equal(send(m,sync('wait_sync',BASE+10),BASE+10).accepted,true);
  reject(send(m,sync('synchronizing',BASE+10),BASE+10),'duplicate');
  reject(send(m,sync('synchronizing',BASE+9),BASE+11),'out_of_order');
  assert.equal(m.snapshot(BASE+11).acceptedEvents,1);
  const other=monitor();
  target(other,1,DIGEST,BASE+100);
  reject(send(other,sync('synchronized',BASE+99),BASE+101),'before_target');
});

test('no timer extension: deadline is fixed when configuring target',()=>{
  const m=monitor(10000);
  target(m);
  assert.equal(send(m,sync('wait_sync',BASE+4000),BASE+4000).accepted,true);
  assert.equal(send(m,sync('synchronizing',BASE+9000),BASE+9000).accepted,true);
  assert.equal(m.snapshot(BASE+10000).phase,'device_syncing');
  assert.equal(m.snapshot(BASE+10001).phase,'timed_out');
  reject(send(m,sync('synchronized',BASE+10002),BASE+10002),'terminal');
  assert.equal(m.snapshot(BASE+10002).deviceReportedTargetMatch,false);
  assert.equal(m.snapshot(BASE+10002).syncVerified,false);
});

test('timeout can also fire without receiving a single device event',()=>{
  const m=monitor(10000);
  target(m);
  assert.equal(m.snapshot(BASE+10001).phase,'timed_out');
  assert.equal(m.snapshot(BASE+10001).acceptedEvents,0);
});

test('terminal evidence cannot be rewritten by a later event for the same revision',()=>{
  const m=monitor();
  target(m);
  assert.equal(send(m,sync('synchronized',BASE+1),BASE+1).accepted,true);
  reject(send(m,sync('fail',BASE+2),BASE+2),'terminal');
  assert.equal(m.snapshot(BASE+2).phase,'device_reported_target');
});

test('new target revision resets evidence; old and same revisions do not',()=>{
  const m=monitor();
  target(m,5,DIGEST,BASE);
  send(m,sync('synchronized',BASE+1),BASE+1);
  reject(target(m,4,DIGEST,BASE+2),'revision_rollback');
  reject(target(m,5,'b'.repeat(64),BASE+2),'revision_conflict');
  const equal=target(m,5,DIGEST,BASE+2);
  assert.equal(equal.changed,false);
  assert.equal(equal.state.phase,'device_reported_target');
  const next=target(m,6,'b'.repeat(64),BASE+3);
  assert.equal(next.changed,true);
  assert.equal(next.state.phase,'target_configured');
  assert.equal(next.state.acceptedEvents,0);
  reject(send(m,sync('synchronized',BASE+2),BASE+4),'before_target');
  const newEvidence=send(m,sync('synchronized',BASE+5),BASE+5);
  assert.equal(newEvidence.state.phase,'device_reported_unmatched');
});

test('new revision cannot be configured with backward clock',()=>{
  const m=monitor();target(m);
  reject(target(m,2,DIGEST,BASE-1),'clock_rollback');
});

test('unknown gateway and malformed configuration fail closed',()=>{
  assert.throws(()=>createFlightAreaSyncMonitor({}),/gateway/);
  assert.throws(()=>createFlightAreaSyncMonitor({expectedGatewaySn:'a/b'}),/gateway/);
  for(const timeoutMs of [0,9999,3600001,1.4,'300000']){
    assert.throws(()=>createFlightAreaSyncMonitor({expectedGatewaySn:GATEWAY,timeoutMs}));
  }
  const m=monitor();
  for(const invalidTarget of [
    {revision:0,sha256:DIGEST,at:BASE},
    {revision:1,sha256:'short',at:BASE},
    {revision:'1',sha256:DIGEST,at:BASE},
    {revision:1,sha256:DIGEST,at:'bad'}
  ])reject(m.configureTarget(invalidTarget),'invalid_target');
  assert.equal(m.snapshot(BASE).phase,'no_target');
});

test('wrong MQTT gateway, retained packets and non-sync events never mutate state',()=>{
  const m=monitor();
  target(m);
  const good=sync('synchronizing',BASE+1);
  reject(send(m,{...good,gateway:'OTHER'},BASE+1),'gateway_mismatch');
  reject(send(m,good,BASE+1,{topic:'thing/product/OTHER/events'}),'invalid_topic');
  reject(send(m,good,BASE+1,{packet:{retain:true}}),'retained');
  reject(send(m,{...good,method:'flight_areas_drone_location',
    data:{drone_locations:[]}},BASE+1),'not_sync_event');
  assert.equal(m.snapshot(BASE+1).phase,'target_configured');
  assert.equal(m.snapshot(BASE+1).acceptedEvents,0);
});

test('sensitive file and gateway information cannot appear in monitor snapshots',()=>{
  const m=monitor();
  target(m);
  const result=send(m,sync('synchronized',BASE+1),BASE+1);
  const json=JSON.stringify(result);
  for(const secret of ['never-expose-this','TOKEN',DIGEST,GATEWAY,
    'signed.example.invalid'])assert.ok(!json.includes(secret),secret);
  assert.equal(typeof m.snapshot(BASE+1).deviceReportedTargetMatch,'boolean');
});

test('inspector comparison remains optional and does not disclose either checksum',()=>{
  const event=sync('synchronized',BASE+1);
  const raw=Buffer.from(JSON.stringify(event));
  const base={topic:TOPIC,payload:raw,expectedGatewaySn:GATEWAY,now:BASE+1};
  const old=inspectFlightAreaEvent(base);
  assert.equal(old.accepted,true);
  assert.ok(!Object.hasOwn(old,'reportedTargetChecksumMatch'));
  const match=inspectFlightAreaEvent({...base,expectedFileChecksum:DIGEST.toUpperCase()});
  assert.equal(match.reportedTargetChecksumMatch,true);
  const mismatch=inspectFlightAreaEvent({...base,expectedFileChecksum:'b'.repeat(64)});
  assert.equal(mismatch.reportedTargetChecksumMatch,false);
  reject(inspectFlightAreaEvent({...base,expectedFileChecksum:'BAD'}),'invalid_target_checksum');
  assert.ok(!JSON.stringify(match).includes(DIGEST));
});

test('monitor is offline-only: no publisher, subscriptions, I/O or wall-clock timer',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../dji-flight-area-sync-monitor.js'),'utf8');
  for(const pattern of [/\.publish\s*\(/,/\.subscribe\s*\(/, /setInterval\s*\(/,
    /require\(['"]mqtt['"]\)/,/require\(['"]fs['"]\)/,
    /require\(['"]pg['"]\)/,/\.emit\s*\(/])assert.doesNotMatch(source,pattern);
});
