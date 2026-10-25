'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {
  beginFlighttaskObservation,parseFlighttaskProgressEvent,
  advanceFlighttaskObservation,summarizeFlighttaskObservation
}=require('../dji-flighttask-observation');

const now=1792518001000;
const ids={gatewaySn:'GATEWAY_SYNTHETIC',tid:'11111111-2222-4333-8444-555555555555',
  bid:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',flightId:'MISSION_SYNTHETIC',
  method:'flighttask_execute',sentAt:now-10000};
const topic='thing/product/GATEWAY_SYNTHETIC/events';
function start(){return beginFlighttaskObservation(ids);}
function reply(changes={}){
  return {...ids,gatewaySn:ids.gatewaySn,method:ids.method,
    timestamp:now-8000,result:0,terminal:true,...changes};
}
function progress(status='in_progress',changes={}){
  return {
    tid:'EVENT_TID_SYNTHETIC',bid:'EVENT_BID_SYNTHETIC',
    timestamp:now-7000,method:'flighttask_progress',gateway:ids.gatewaySn,need_reply:1,
    data:{result:0,output:{
      status,ext:{flight_id:ids.flightId,break_point:{latitude:49.1,longitude:8.4}},
      progress:{percent:37},secret:'PRIVATE_SYNTHETIC'
    }},...changes
  };
}
function event(status='in_progress',changes={}){
  return parseFlighttaskProgressEvent(topic,JSON.stringify(progress(status,changes)),{now});
}
function step(state,observation,at=now){
  return advanceFlighttaskObservation(state,observation,{now:at});
}
function ack(s=start()){return step(s,{kind:'service_reply',reply:reply()}).state;}

test('request ACK result zero is not flight completion even with terminal=true from RPC DTO',()=>{
  const s=ack();
  assert.equal(s.phase,'reply_accepted');
  assert.equal(s.reply.result,0);
  assert.equal(s.progress.status,null);
  assert.equal(summarizeFlighttaskObservation(s).missionReportedComplete,false);
  assert.equal(summarizeFlighttaskObservation(s).operationVerified,false);
  assert.equal(summarizeFlighttaskObservation(s).flightReady,false);
  assert.equal(Object.isFrozen(s),true);
  assert.equal(Object.isFrozen(s.request),true);
});

test('flighttask_progress has independent event TID/BID, correlates by gateway + flight_id',()=>{
  const parsed=event();
  assert.deepEqual(Object.keys(parsed),[
    'gatewaySn','method','flightId','timestamp','result','status'
  ]);
  const next=step(ack(),{kind:'flighttask_progress',event:parsed});
  assert.equal(next.applied,true);
  assert.equal(next.state.phase,'reported_in_progress');
  assert.equal(next.state.progress.status,'in_progress');
  assert.doesNotMatch(JSON.stringify(parsed),/PRIVATE_SYNTHETIC|latitude|longitude|percent/);
});

test('separate accepted request and reported_ok stay only observational evidence',()=>{
  const a=ack();
  const b=step(a,{kind:'flighttask_progress',event:event('ok')});
  assert.equal(b.state.phase,'reported_ok');
  const summary=summarizeFlighttaskObservation(b.state);
  assert.equal(summary.serviceReplyAccepted,true);
  assert.equal(summary.progressObserved,true);
  assert.equal(summary.missionReportedComplete,true);
  assert.equal(summary.operationVerified,false);
  assert.equal(summary.flightReady,false);
  assert.equal(summary.hardwareVerified,false);
  assert.doesNotMatch(JSON.stringify(summary),/GATEWAY_SYNTHETIC|MISSION_SYNTHETIC|11111111/);
});

test('events before request acknowledgement never certify progress',()=>{
  const s=start();
  const x=step(s,{kind:'flighttask_progress',event:event('ok')});
  assert.equal(x.applied,false);
  assert.equal(x.reason,'missing-accepted-reply');
  assert.equal(x.state.phase,'awaiting_reply');
});

test('missing or mismatched reply method, device, request IDs and timestamps fail closed',()=>{
  for(const changes of [
    {method:null},{method:'flighttask_prepare'},{gatewaySn:'OTHER'},
    {tid:'OTHER'},{bid:'OTHER'},{timestamp:now-20000},
    {timestamp:now+MAX_FUTURE_SKEW_TEST},{timestamp:now-400000},{result:'0'}
  ]){
    const x=step(start(),{kind:'service_reply',reply:reply(changes)});
    assert.equal(x.applied,false,JSON.stringify(changes));
    assert.equal(x.reason,'reply-not-correlated');
  }
});
const MAX_FUTURE_SKEW_TEST=30001;

test('rejected service reply cannot become a completed flight',()=>{
  const x=step(start(),{kind:'service_reply',reply:reply({result:2048})});
  assert.equal(x.applied,true);
  assert.equal(x.state.phase,'reply_rejected');
  const y=step(x.state,{kind:'flighttask_progress',event:event('ok')});
  assert.equal(y.applied,false);
  assert.equal(y.state.phase,'reply_rejected');
});

test('wrong gateway, flight ID, status and event timestamp do not correlate',()=>{
  const wrong=[
    {...event(),gatewaySn:'OTHER'},
    {...event(),flightId:'OTHER'},
    {...event(),status:'success'},
    {...event(),timestamp:now-20000},
    {...event(),timestamp:now+30001}
  ];
  for(const bad of wrong){
    const x=step(ack(),{kind:'flighttask_progress',event:bad});
    assert.equal(x.applied,false);
    assert.equal(x.reason,'event-not-correlated');
  }
});

test('duplicate service reply does not double-advance; contradictory reply is flagged',()=>{
  const s=ack();
  const duplicate=step(s,{kind:'service_reply',reply:reply()});
  assert.equal(duplicate.reason,'duplicate-reply');
  assert.equal(duplicate.applied,false);
  const conflict=step(s,{kind:'service_reply',reply:reply({result:4})});
  assert.equal(conflict.state.phase,'conflicting_reports');
  assert.equal(conflict.applied,true);
  assert.equal(summarizeFlighttaskObservation(conflict.state).missionReportedComplete,false);
});

test('older, duplicate, and contradictory same-timestamp progress are distinguished',()=>{
  const initial=step(ack(),{kind:'flighttask_progress',event:event('in_progress')}).state;
  const duplicate=step(initial,{kind:'flighttask_progress',event:event('in_progress')});
  assert.equal(duplicate.reason,'duplicate-event');
  const stale=step(initial,{kind:'flighttask_progress',event:{...event(),timestamp:now-9000}});
  assert.equal(stale.reason,'replayed-event');
  const inconsistent=step(initial,{kind:'flighttask_progress',event:event('failed')});
  assert.equal(inconsistent.state.phase,'conflicting_reports');
  assert.equal(inconsistent.reason,'contradictory-event');
});

test('terminal progress cannot regress silently to running or contradictory failure',()=>{
  const reported=step(ack(),{kind:'flighttask_progress',event:event('ok')}).state;
  const failure=step(reported,{kind:'flighttask_progress',event:{
    ...event('failed'),timestamp:now-5000}});
  assert.equal(failure.state.phase,'conflicting_reports');
  assert.equal(summarizeFlighttaskObservation(failure.state).missionReportedComplete,false);
  const renewed=step(reported,{kind:'flighttask_progress',event:{
    ...event('in_progress'),timestamp:now-5000}});
  assert.equal(renewed.reason,'contradictory-terminal-report');
  const repeated=step(reported,{kind:'flighttask_progress',event:{
    ...event('ok'),timestamp:now-5000}});
  assert.equal(repeated.reason,'duplicate-terminal-report');
});

test('failed and canceled progress stay separate from successful completion',()=>{
  for(const [status,expected] of [['failed','reported_failed'],['canceled','reported_canceled']]){
    const x=step(ack(),{kind:'flighttask_progress',event:event(status)});
    assert.equal(x.state.phase,expected);
    assert.equal(summarizeFlighttaskObservation(x.state).missionReportedComplete,false);
  }
  const resultError=step(ack(),{kind:'flighttask_progress',event:{
    ...event('ok'),result:1002}});
  assert.equal(resultError.state.phase,'reported_failed');
});

test('timeouts indicate unknown execution, not an automatically failed flight',()=>{
  const s=ack();
  const expired=step(s,{kind:'clock'},ids.sentAt+900001);
  assert.equal(expired.state.phase,'expired_unverified');
  assert.equal(expired.state.flightReady,false);
  const terminal=step(ack(),{kind:'flighttask_progress',event:event('ok')}).state;
  const lateClock=step(terminal,{kind:'clock'},ids.sentAt+900001);
  assert.equal(lateClock.state.phase,'reported_ok');
  assert.equal(lateClock.reason,'terminal-report-recorded');
});

test('bounded event parser rejects retained, stale, future, wrong channel and invalid data',()=>{
  const bad=[
    ()=>parseFlighttaskProgressEvent(topic,JSON.stringify(progress()),{now,retained:true}),
    ()=>parseFlighttaskProgressEvent(topic.replace('/events','/services'),JSON.stringify(progress()),{now}),
    ()=>parseFlighttaskProgressEvent(topic,'{',{now}),
    ()=>parseFlighttaskProgressEvent(topic,'x'.repeat(131073),{now}),
    ()=>parseFlighttaskProgressEvent(topic,JSON.stringify(progress('unknown')),{now}),
    ()=>parseFlighttaskProgressEvent(topic,JSON.stringify(progress('ok',{gateway:'OTHER'})),{now}),
    ()=>parseFlighttaskProgressEvent(topic,JSON.stringify(progress('ok',{timestamp:now-300001})),{now}),
    ()=>parseFlighttaskProgressEvent(topic,JSON.stringify(progress('ok',{timestamp:now+30001})),{now}),
    ()=>parseFlighttaskProgressEvent(topic,JSON.stringify(progress('ok',{
      data:{result:0,output:{status:'ok',ext:{}}}})),{now})
  ];
  for(const fn of bad)assert.throws(fn,/Invalid flighttask progress event/);
});

test('unknown controls and unsupported methods are never made executable',()=>{
  assert.throws(()=>beginFlighttaskObservation({...ids,method:'drone_propeller_stop_v1'}),/Invalid/);
  assert.throws(()=>beginFlighttaskObservation({...ids,flightId:''}),/Invalid/);
  assert.throws(()=>beginFlighttaskObservation(ids,{ttlMs:0}),/Invalid/);
  const x=step(start(),{kind:'publish',topic:'thing/product/GATEWAY_SYNTHETIC/services'});
  assert.equal(x.applied,false);
  assert.equal(x.reason,'unsupported-observation');
});

test('raw fixture identifiers and secrets do not escape summary',()=>{
  const s=step(ack(),{kind:'flighttask_progress',event:event('ok')}).state;
  const data=JSON.stringify(summarizeFlighttaskObservation(s));
  for(const value of [ids.gatewaySn,ids.flightId,ids.tid,ids.bid,'PRIVATE_SYNTHETIC','latitude'])
    assert.equal(data.includes(value),false);
});
