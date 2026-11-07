'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {beginFlighttaskObservation}=require('../dji-flighttask-observation');
const {createOfflineFlighttaskRecoveryStore,STORE_SCHEMA}=
  require('../dji-flighttask-recovery-store');

const now=1792518001000;
const request={
  gatewaySn:'GATEWAY_FAKE',tid:'11111111-2222-4333-8444-555555555555',
  bid:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  method:'flighttask_execute',flightId:'MISSION_FAKE',sentAt:now-10000
};
const replyTopic='thing/product/GATEWAY_FAKE/services_reply';
const eventTopic='thing/product/GATEWAY_FAKE/events';
const reply=(overrides={})=>Buffer.from(JSON.stringify({
  tid:request.tid,bid:request.bid,method:'flighttask_execute',
  timestamp:now-7000,gateway:request.gatewaySn,data:{result:0},
  ...overrides
}));
const event=(status='in_progress',overrides={})=>Buffer.from(JSON.stringify({
  method:'flighttask_progress',timestamp:now-4000,gateway:request.gatewaySn,
  need_reply:1,data:{
    result:0,output:{status,ext:{flight_id:request.flightId,
      break_point:{latitude:48.82,longitude:8.14}},
      progress:{percent:80},credential:'FAKE_ONLY'}
  },...overrides
}));
function setup(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'skyhub-flighttask-recovery-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const key=crypto.randomBytes(32);
  return {dir,key,store:createOfflineFlighttaskRecoveryStore({directory:dir,key})};
}
const snapshot=dir=>path.join(dir,'flighttask-observation.enc.json');

test('encrypted atomic snapshot survives new store instance; no plaintext identifiers on disk',t=>{
  const {dir,key,store}=setup(t);
  const start=store.initialize(beginFlighttaskObservation(request));
  assert.equal(start.revision,0);
  assert.equal(start.summary.phase,'awaiting_reply');
  assert.equal(fs.statSync(snapshot(dir)).mode&0o777,0o600);
  const text=fs.readFileSync(snapshot(dir),'utf8');
  assert.match(text,/"schema":"skyhub-flighttask-recovery-v1"/);
  for(const forbidden of [request.gatewaySn,request.tid,request.bid,request.flightId,
    'flighttask_execute','latitude','FAKE_ONLY']){
    assert.equal(text.includes(forbidden),false,forbidden);
  }
  const restarted=createOfflineFlighttaskRecoveryStore({directory:dir,key});
  const observation=restarted.inspect();
  assert.equal(observation.summary.phase,'awaiting_reply');
  assert.equal(observation.revision,0);
  assert.doesNotMatch(JSON.stringify(observation),/GATEWAY_FAKE|MISSION_FAKE|11111111/);
});

test('restart recovers accepted service reply without resending or declaring flight complete',t=>{
  const {dir,key,store}=setup(t);
  store.initialize(beginFlighttaskObservation(request));
  const acknowledged=store.observeServiceReply(replyTopic,reply(),{now});
  assert.equal(acknowledged.applied,true);
  assert.equal(acknowledged.revision,1);
  assert.equal(acknowledged.summary.phase,'reply_accepted');
  assert.equal(acknowledged.summary.missionReportedComplete,false);
  const reopened=createOfflineFlighttaskRecoveryStore({directory:dir,key});
  const restored=reopened.recover({now});
  assert.equal(restored.applied,false);
  assert.equal(restored.revision,1);
  assert.equal(restored.summary.phase,'reply_accepted');
  assert.equal(restored.summary.flightReady,false);
  assert.equal(restored.summary.operationVerified,false);
  const completion=reopened.observeProgressEvent(eventTopic,event('ok'),{now});
  assert.equal(completion.applied,true);
  assert.equal(completion.revision,2);
  assert.equal(completion.summary.missionReportedComplete,true);
  assert.equal(completion.summary.operationVerified,false);
});

test('a separate Node.js process reopens ciphertext with the caller-supplied key',t=>{
  const {dir,key,store}=setup(t);
  store.initialize(beginFlighttaskObservation(request));
  store.observeServiceReply(replyTopic,reply(),{now});
  // Key and directory travel via ephemeral stdin, not argv, stdout or disk.
  const child=String.raw`const fs=require('node:fs');
const {createOfflineFlighttaskRecoveryStore}=require(process.argv[1]);
const input=JSON.parse(fs.readFileSync(0,'utf8'));
const store=createOfflineFlighttaskRecoveryStore({
  directory:input.directory,key:Buffer.from(input.keyHex,'hex')
});
process.stdout.write(JSON.stringify(store.inspect()));`;
  const output=execFileSync(process.execPath,[
    '-e',child,require.resolve('../dji-flighttask-recovery-store')
  ],{
    input:JSON.stringify({directory:dir,keyHex:key.toString('hex')}),
    encoding:'utf8',timeout:5000,env:{NODE_ENV:'test'}
  });
  const observed=JSON.parse(output);
  assert.equal(observed.revision,1);
  assert.equal(observed.summary.phase,'reply_accepted');
  assert.equal(observed.summary.flightReady,false);
  assert.doesNotMatch(output,/GATEWAY_FAKE|MISSION_FAKE|11111111/);
});

test('replayed MQTT reply and progress are deduplicated across restarts',t=>{
  const {dir,key,store}=setup(t);
  store.initialize(beginFlighttaskObservation(request));
  store.observeServiceReply(replyTopic,reply(),{now});
  const restored=createOfflineFlighttaskRecoveryStore({directory:dir,key});
  const duplicate=restored.observeServiceReply(replyTopic,reply(),{now});
  assert.equal(duplicate.applied,false);
  assert.equal(duplicate.reason,'duplicate-reply');
  assert.equal(duplicate.revision,1);
  const inFlight=restored.observeProgressEvent(eventTopic,event(),{now});
  assert.equal(inFlight.applied,true);
  assert.equal(inFlight.revision,2);
  const yetAnother=createOfflineFlighttaskRecoveryStore({directory:dir,key});
  const seen=yetAnother.observeProgressEvent(eventTopic,event(),{now});
  assert.equal(seen.applied,false);
  assert.equal(seen.reason,'duplicate-event');
  assert.equal(seen.revision,2);
  assert.equal(seen.summary.phase,'reported_in_progress');
});

test('mismatched gateway, method, transaction or flight id never mutate persisted state',t=>{
  const {dir,key,store}=setup(t);
  store.initialize(beginFlighttaskObservation(request));
  const before=fs.readFileSync(snapshot(dir));
  const bad=[
    store.observeServiceReply(replyTopic,reply({method:'flighttask_prepare'}),{now}),
    store.observeServiceReply(replyTopic,reply({tid:'22222222-2222-4333-8444-555555555555'}),{now}),
    store.observeServiceReply('thing/product/OTHER/services_reply',reply(),{now}),
    store.observeServiceReply(replyTopic,reply(),{now,retained:true}),
    store.observeProgressEvent(eventTopic,event('ok'),{now})
  ];
  assert.ok(bad.every(r=>r.applied===false&&r.revision===0));
  assert.deepEqual(fs.readFileSync(snapshot(dir)),before);
  assert.equal(createOfflineFlighttaskRecoveryStore({directory:dir,key}).inspect().summary.phase,'awaiting_reply');
});

test('conflicting events after restart are durably marked without asserting mission success',t=>{
  const {dir,key,store}=setup(t);
  store.initialize(beginFlighttaskObservation(request));
  store.observeServiceReply(replyTopic,reply(),{now});
  store.observeProgressEvent(eventTopic,event('ok'),{now});
  const reopened=createOfflineFlighttaskRecoveryStore({directory:dir,key});
  const contrary=reopened.observeProgressEvent(eventTopic,
    event('failed',{timestamp:now-2000}),{now});
  assert.equal(contrary.applied,true);
  assert.equal(contrary.summary.phase,'conflicting_reports');
  assert.equal(contrary.summary.missionReportedComplete,false);
  assert.equal(contrary.summary.flightReady,false);
  assert.equal(createOfflineFlighttaskRecoveryStore({directory:dir,key}).inspect().summary.phase,'conflicting_reports');
});

test('restart after expiry materializes unknown execution, never flight failure or command retry',t=>{
  const {dir,key,store}=setup(t);
  store.initialize(beginFlighttaskObservation(request,{ttlMs:10000}));
  store.observeServiceReply(replyTopic,reply({timestamp:now-7000}),{now});
  const reopened=createOfflineFlighttaskRecoveryStore({directory:dir,key});
  const r=reopened.recover({now:request.sentAt+10001});
  assert.equal(r.applied,true);
  assert.equal(r.reason,'observation-expired');
  assert.equal(r.summary.phase,'expired_unverified');
  assert.equal(r.summary.operationVerified,false);
  const again=reopened.recover({now:request.sentAt+10002});
  assert.equal(again.applied,false);
  assert.equal(again.revision,r.revision);
  assert.equal(again.summary.phase,'expired_unverified');
  const staleReply=reopened.observeServiceReply(replyTopic,reply(),{now});
  assert.equal(staleReply.applied,false);
});

test('expired progress observed as terminal stays reported but not independently verified',t=>{
  const {dir,key,store}=setup(t);
  store.initialize(beginFlighttaskObservation(request,{ttlMs:10000}));
  store.observeServiceReply(replyTopic,reply(),{now});
  store.observeProgressEvent(eventTopic,event('ok'),{now});
  const restored=createOfflineFlighttaskRecoveryStore({directory:dir,key});
  const r=restored.recover({now:request.sentAt+10001});
  assert.equal(r.applied,false);
  assert.equal(r.summary.phase,'reported_ok');
  assert.equal(r.summary.operationVerified,false);
});

test('wrong decryption key or modified authentication tag fails closed, no fallback',t=>{
  const {dir,key,store}=setup(t);
  store.initialize(beginFlighttaskObservation(request));
  const wrong=createOfflineFlighttaskRecoveryStore({directory:dir,key:crypto.randomBytes(32)});
  assert.throws(()=>wrong.inspect(),/Invalid encrypted flighttask recovery snapshot/);
  const p=snapshot(dir), data=JSON.parse(fs.readFileSync(p,'utf8'));
  data.tag=Buffer.alloc(16).toString('base64');
  fs.writeFileSync(p,JSON.stringify(data));
  const restored=createOfflineFlighttaskRecoveryStore({directory:dir,key});
  assert.throws(()=>restored.inspect(),/Invalid encrypted flighttask recovery snapshot/);
  assert.throws(()=>restored.recover({now}),/Invalid encrypted flighttask recovery snapshot/);
});

test('non-exclusive permissions and symbolic-linked snapshot are rejected',t=>{
  const {dir,key,store}=setup(t);
  store.initialize(beginFlighttaskObservation(request));
  fs.chmodSync(dir,0o755);
  assert.throws(()=>store.inspect(),/mode 0700/);
  fs.chmodSync(dir,0o700);
  const p=snapshot(dir),backup=path.join(dir,'saved-enc');
  fs.renameSync(p,backup);
  fs.symlinkSync(backup,p);
  assert.throws(()=>store.inspect(),/ELOOP|Invalid encrypted|symbolic/i);
});

test('file lock prevents concurrent changes and is not silently stolen',t=>{
  const {dir,store}=setup(t);
  store.initialize(beginFlighttaskObservation(request));
  const lock=path.join(dir,'.flighttask-observation.lock');
  fs.writeFileSync(lock,'busy',{mode:0o600,flag:'wx'});
  const before=fs.readFileSync(snapshot(dir));
  assert.throws(()=>store.recover({now}),/store locked/);
  assert.deepEqual(fs.readFileSync(snapshot(dir)),before);
  assert.ok(fs.existsSync(lock));
  fs.unlinkSync(lock);
  assert.equal(store.recover({now}).summary.phase,'awaiting_reply');
});

test('initialize refuses overwrite; malformed supplied states and keys fail closed',t=>{
  const {dir,key,store}=setup(t);
  const original=beginFlighttaskObservation(request);
  store.initialize(original);
  assert.throws(()=>store.initialize(original),/already initialized/);
  assert.throws(()=>createOfflineFlighttaskRecoveryStore({directory:dir,key:Buffer.alloc(31)}),/32-byte/);
  assert.throws(()=>createOfflineFlighttaskRecoveryStore({directory:'relative',key}),/absolute/);
  assert.equal(STORE_SCHEMA,'skyhub-flighttask-recovery-v1');
  const bad={...original,request:{...original.request,method:'drone_propeller_stop_v1'}};
  assert.throws(()=>store.initialize(bad),/Invalid encrypted/);
});

test('offline storage exports no broker or dispatch functionality',()=>{
  assert.deepEqual(Object.keys(require('../dji-flighttask-recovery-store')).sort(),
    ['STORE_SCHEMA','createOfflineFlighttaskRecoveryStore'].sort());
});
