'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {
  makePreflightEvidence,makeLiveEvidence,validateLiveEvidenceReceipt
}=require('../rc-plus2-m4t-evidence');

const NOW=new Date('2026-10-24T09:00:00.000Z');
const checks={
  schema:'skyhub-rcplus2-m4t-preflight-v1',
  healthApi:true,devicesApi:true,shapesApi:true,pairingsApi:true,
  mqttConnected:true,subscribed:true,
  topologyAckEnabled:true,topologyAckConnected:true
};
const data={
  passed:true,transportPassed:true,pairingConfirmed:true,
  transport:{
    mqttConnected:true,subscribed:true,
    topologyAckEnabled:true,topologyAckConnected:true,
    extraCredential:'PRIVATE_TRANSPORT'
  },
  pairing:{
    available:true,rcPlus2Paired:1,rcPlus2RecentlyUsed:1,
    devices:[{deviceId:'PRIVATE_PAIRING'}]
  },
  candidateCount:{linkedPairs:1,privateId:'PRIVATE_GATEWAY'},
  controller:{
    seen:true,topologyOnline:true,osdFresh:true,osdAgeSeconds:2,
    stateObserved:false,fieldInterface:true,
    fields:{documented:54,observed:15,fresh:12,
      freshNames:['private-device-key'],observedNames:['private-value']},
    sn:'PRIVATE_CONTROLLER'
  },
  aircraft:{
    seen:true,topologyOnline:true,osdFresh:true,osdAgeSeconds:1,
    stateObserved:true,fieldInterface:true,aircraftConnected:true,
    fields:{documented:202,observed:60,fresh:42,
      freshNames:['private-device-key']},
    dynamicFields:{observed:3,observedNames:['private-sensor-reading']},
    latitude:49.12345,serial:'PRIVATE_AIRCRAFT'
  }
};

test('preflight receipt only includes a fixed eight-key boolean allowlist',()=>{
  const r=makePreflightEvidence({...checks,token:'PRIVATE_TOKEN'},NOW);
  assert.equal(r.schema,'skyhub-rcplus2-m4t-evidence-v1');
  assert.equal(r.mode,'backend-preflight');
  assert.equal(r.result,'READY');
  assert.equal(r.measuredAt,NOW.toISOString());
  assert.equal(Object.keys(r.checks).length,8);
  assert.equal(r.hardwareAcceptanceComplete,false);
  assert.equal(r.flightReady,false);
  assert.equal(r.dispatchAllowed,false);
  assert.ok(!JSON.stringify(r).includes('PRIVATE_'));
});
test('preflight fails closed for absent or nonboolean flags',()=>{
  assert.throws(()=>makePreflightEvidence({...checks,subscribed:undefined},NOW));
  assert.throws(()=>makePreflightEvidence({...checks,mqttConnected:'true'},NOW));
  assert.throws(()=>makePreflightEvidence(checks,new Date('invalid')));
  assert.equal(makePreflightEvidence({...checks,pairingsApi:false},NOW)
    .result,'INCOMPLETE');
});
test('live read-only JSON receipt excludes arbitrary field names and IDs',()=>{
  const r=makeLiveEvidence(data,NOW),json=JSON.stringify(r);
  assert.equal(r.mode,'live-transport-smoke');
  assert.equal(r.result,'TRANSPORT_SMOKE_OK');
  assert.equal(r.controller.staticFieldsDocumented,54);
  assert.equal(r.aircraft.staticFieldsDocumented,202);
  assert.equal(r.aircraft.dynamicGimbalTypesObserved,3);
  assert.equal(r.hardwareAcceptanceComplete,false);
  assert.equal(r.flightReady,false);
  assert.equal(r.dispatchAllowed,false);
  assert.ok(!json.includes('PRIVATE_'));
  assert.ok(!json.includes('private-device-key'));
  assert.ok(!json.includes('private-sensor-reading'));
  assert.ok(!json.includes('49.12345'));
});
test('missing parser and unbounded counts map to null, not zero or guessed acceptance',()=>{
  const r=makeLiveEvidence({
    ...data,passed:false,transportPassed:false,pairingConfirmed:false,
    aircraft:{seen:true,topologyOnline:false,osdFresh:false,
      fieldInterface:false,fields:null,osdAgeSeconds:-10},
    pairing:{available:false}
  },NOW);
  assert.equal(r.result,'INCOMPLETE');
  assert.equal(r.aircraft.staticFieldsDocumented,null);
  assert.equal(r.aircraft.staticFieldsObserved,null);
  assert.equal(r.aircraft.osdAgeSeconds,null);
  assert.equal(r.aircraft.dynamicGimbalTypesObserved,null);
  assert.equal(r.pairing.listingAvailable,false);
  assert.equal(r.pairing.independentlyConfirmed,false);
});
test('invalid live reports are rejected before JSON serialization',()=>{
  assert.throws(()=>makeLiveEvidence({},NOW));
  assert.throws(()=>makeLiveEvidence({...data,passed:'yes'},NOW));
});
test('stale OSD age is preserved (up to one year), absurd values map to null',()=>{
  const age=v=>makeLiveEvidence({...data,aircraft:{...data.aircraft,osdAgeSeconds:v}},NOW).aircraft.osdAgeSeconds;
  assert.equal(age(5000),5000);
  assert.equal(age(86400*30),86400*30);
  assert.equal(age(86400*400),null);
});
test('receipt validation rejects impossible combinations of result and sub-facts',()=>{
  const r=makeLiveEvidence({
    passed:false,transportPassed:false,pairingConfirmed:false,
    transport:{},pairing:{available:false},candidateCount:{linkedPairs:0},
    controller:{},aircraft:{}
  },NOW);
  assert.equal(validateLiveEvidenceReceipt(r),true);
  // INCOMPLETE although both gates claim to pass
  const both={...r,transport:{...r.transport,transportPassed:true},pairing:{...r.pairing,independentlyConfirmed:true}};
  assert.equal(validateLiveEvidenceReceipt(both),false);
  // transportPassed without the facts it requires
  assert.equal(validateLiveEvidenceReceipt({...r,transport:{...r.transport,transportPassed:true}}),false);
  // field counts without a field interface
  assert.equal(validateLiveEvidenceReceipt({...r,aircraft:{...r.aircraft,staticFieldsDocumented:202}}),false);
  assert.equal(validateLiveEvidenceReceipt({...r,pairing:{...r.pairing,independentlyConfirmed:true}}),false);
});
