'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {beginFlighttaskObservation,summarizeFlighttaskObservation}=require('../dji-flighttask-observation');
const {
  observeFlighttaskServiceReply,observeFlighttaskProgressEvent,
  supportedExecuteReplyShape
}=require('../dji-flighttask-reply-adapter');

const now=1792518001000;
const ids={
  gatewaySn:'SYNTHETIC_GATEWAY',
  tid:'11111111-2222-4333-8444-555555555555',
  bid:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  flightId:'SYNTHETIC_FLIGHT',
  method:'flighttask_execute',sentAt:now-10000
};
const serviceTopic='thing/product/SYNTHETIC_GATEWAY/services_reply';
const eventTopic='thing/product/SYNTHETIC_GATEWAY/events';
function state(){return beginFlighttaskObservation(ids);}
function envelope(data={result:0},extra={}){
  return {
    tid:ids.tid,bid:ids.bid,method:ids.method,
    timestamp:now-6000,gateway:ids.gatewaySn,
    data,...extra
  };
}
function service(s=state(),e=envelope(),opts={}){
  return observeFlighttaskServiceReply(s,serviceTopic,
    Buffer.from(JSON.stringify(e)),{now,...opts});
}
function eventEnvelope(status='ok',extra={}){
  return {
    tid:'event-independent-tid',bid:'event-independent-bid',
    timestamp:now-3000,method:'flighttask_progress',
    gateway:ids.gatewaySn,need_reply:1,
    data:{result:0,output:{
      status,ext:{
        flight_id:ids.flightId,
        break_point:{latitude:51.1,longitude:7.8}
      },progress:{percent:100},other_private:'SENSITIVE_SECRET'
    }},...extra
  };
}
function progress(s,e=eventEnvelope(),opts={}){
  return observeFlighttaskProgressEvent(s,eventTopic,
    Buffer.from(JSON.stringify(e)),{now,...opts});
}

test('complete pipeline: successful service ACK stays awaiting progress',()=>{
  const a=service();
  assert.equal(a.applied,true);
  assert.equal(a.state.phase,'reply_accepted');
  assert.equal(a.state.reply.result,0);
  const summary=summarizeFlighttaskObservation(a.state);
  assert.equal(summary.serviceReplyAccepted,true);
  assert.equal(summary.progressObserved,false);
  assert.equal(summary.missionReportedComplete,false);
  assert.equal(summary.operationVerified,false);
  assert.equal(summary.flightReady,false);
});

test('progress reports completion only after accepted, fully correlated ACK',()=>{
  const unacknowledged=progress(state());
  assert.equal(unacknowledged.applied,false);
  assert.equal(unacknowledged.reason,'missing-accepted-reply');
  const a=service();
  const b=progress(a.state);
  assert.equal(b.applied,true);
  assert.equal(b.state.phase,'reported_ok');
  assert.equal(summarizeFlighttaskObservation(b.state).missionReportedComplete,true);
  assert.equal(summarizeFlighttaskObservation(b.state).hardwareVerified,false);
});

test('supported service reply shape is strictly result-only or null output',()=>{
  assert.equal(supportedExecuteReplyShape(JSON.stringify(envelope({result:0}))),true);
  assert.equal(supportedExecuteReplyShape(JSON.stringify(envelope({result:0,output:null}))),true);
  for(const data of [
    {result:0,output:{}},
    {result:0,output:[]},
    {result:0,output:{status:'ok'}},
    {result:{code:0}},
    {result:0,licenses:[]},
    {result:0,status:'in_progress'},
    {result:'0'},
    {result:0,output:null,extra:1},
    {output:null}
  ]){
    assert.equal(supportedExecuteReplyShape(JSON.stringify(envelope(data))),false);
    const r=service(state(),envelope(data));
    assert.equal(r.applied,false,JSON.stringify(data));
    assert.equal(r.state.phase,'awaiting_reply');
  }
});

test('a flat result=nonzero is a rejected request, not flight success',()=>{
  const out=service(state(),envelope({result:2016}));
  assert.equal(out.applied,true);
  assert.equal(out.state.phase,'reply_rejected');
  const later=progress(out.state);
  assert.equal(later.applied,false);
  assert.equal(summarizeFlighttaskObservation(later.state).missionReportedComplete,false);
});

test('require explicit flighttask_execute method even though generic RPC parser permits omission',()=>{
  const cases=[
    [envelope({result:0},{method:undefined}),'method-not-correlated'],
    [envelope({result:0},{method:null}),'invalid-service-reply'],
    [envelope({result:0},{method:'flighttask_prepare'}),'method-not-correlated'],
    [envelope({result:0},{method:'fly_to_point'}),'method-not-correlated']
  ];
  for(const [e,reason] of cases){
    const out=service(state(),e);
    assert.equal(out.applied,false);
    assert.equal(out.state.phase,'awaiting_reply');
    assert.equal(out.reason,reason,JSON.stringify(e));
  }
});

test('exact gateway, request transaction and valid timestamps are mandatory',()=>{
  const changed=[
    [envelope({result:0},{gateway:'OTHER'}),'invalid-service-reply'],
    [envelope({result:0},{tid:'11111111-2222-4333-8444-555555555556'}),'correlation-mismatch'],
    [envelope({result:0},{bid:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeef'}),'correlation-mismatch'],
    [envelope({result:0},{tid:'invalid/uuid'}),'invalid-service-reply'],
    [envelope({result:0},{timestamp:ids.sentAt-1000}),'reply-not-correlated'],
    [envelope({result:0},{timestamp:now+30001}),'invalid-service-reply'],
    [envelope({result:0},{timestamp:now-300001}),'invalid-service-reply']
  ];
  for(const [e,expected] of changed){
    const out=service(state(),e);
    assert.equal(out.reason,expected,JSON.stringify(e));
    assert.equal(out.applied,false);
  }
  const otherTopic=observeFlighttaskServiceReply(state(),
    'thing/product/OTHER/services_reply',JSON.stringify(envelope()),{now});
  assert.equal(otherTopic.reason,'invalid-service-reply');
  const retained=service(state(),envelope(),{retained:true});
  assert.equal(retained.reason,'invalid-service-reply');
});

test('replay, conflicting services replies and contradictory terminal events fail closed',()=>{
  const a=service();
  const duplicate=service(a.state);
  assert.equal(duplicate.reason,'duplicate-reply');
  assert.equal(duplicate.applied,false);
  const changed=service(a.state,envelope({result:5}));
  assert.equal(changed.applied,true);
  assert.equal(changed.state.phase,'conflicting_reports');
  const finish=progress(a.state).state;
  const contradictory=progress(finish,eventEnvelope('failed',{timestamp:now-1000}));
  assert.equal(contradictory.state.phase,'conflicting_reports');
  assert.equal(summarizeFlighttaskObservation(contradictory.state).missionReportedComplete,false);
  const duplicateEvent=progress(finish);
  assert.equal(duplicateEvent.applied,false);
});

test('event ID mismatch, stale, retained and wrong topic do not progress mission',()=>{
  const ready=service().state;
  const cases=[
    eventEnvelope('ok',{gateway:'OTHER'}),
    eventEnvelope('ok',{timestamp:now-300001}),
    eventEnvelope('ok',{timestamp:now+30001}),
    eventEnvelope('ok',{data:{result:0,output:{status:'ok',ext:{flight_id:'OTHER'}}}})
  ];
  for(const e of cases){
    const result=progress(ready,e);
    assert.equal(result.applied,false,JSON.stringify(e));
  }
  const oldTopic=observeFlighttaskProgressEvent(ready,
    'thing/product/OTHER/events',JSON.stringify(eventEnvelope()),{now});
  assert.equal(oldTopic.applied,false);
  const retained=progress(ready,eventEnvelope(),{retained:true});
  assert.equal(retained.reason,'invalid-flighttask-event');
});

test('bounded inputs and invalid state do not create an executable command path',()=>{
  const huge=observeFlighttaskServiceReply(state(),serviceTopic,
    Buffer.alloc(131073,0),{now});
  assert.equal(huge.reason,'invalid-service-reply');
  const badTime=service(state(),envelope(),{now:NaN});
  assert.equal(badTime.reason,'invalid-observation-time');
  assert.throws(()=>observeFlighttaskServiceReply(
    {...state(),request:{...ids,method:'drone_propeller_stop_v1'}},
    serviceTopic,JSON.stringify(envelope()),{now}),/Invalid flighttask reply observation state/);
  assert.throws(()=>observeFlighttaskProgressEvent(
    {...state(),request:{...ids,tid:'not-uuid'}},
    eventTopic,JSON.stringify(eventEnvelope()),{now}),/Invalid flighttask event observation state/);
});

test('end-to-end reports never expose device IDs, GPS data, secrets or the raw DJI payload',()=>{
  const a=service().state,b=progress(a).state;
  const publicReport=JSON.stringify(summarizeFlighttaskObservation(b));
  for(const part of [
    ids.gatewaySn,ids.tid,ids.bid,ids.flightId,'SENSITIVE_SECRET',
    'latitude','longitude','break_point','percent'
  ]) assert.equal(publicReport.includes(part),false);
  assert.equal(JSON.parse(publicReport).flightReady,false);
  assert.equal(JSON.parse(publicReport).operationVerified,false);
});

test('only parser and observation methods are exported, not publishers',()=>{
  const adapter=require('../dji-flighttask-reply-adapter');
  assert.deepEqual(Object.keys(adapter).sort(),[
    'observeFlighttaskProgressEvent','observeFlighttaskServiceReply','supportedExecuteReplyShape'
  ].sort());
});
