'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {resolveFlighttaskObservation:resolve}=require('../dji-flighttask-correlation-guard');
const A='11111111-2222-4333-8444-555555555555';
const B='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const T='66666666-7777-4888-8999-000000000000';
const U='33333333-4444-4555-8666-777777777777';
const T2='44444444-3333-4222-8111-999999999999';
const base={workspaceId:A,observationId:A,gatewaySn:'gateway1',
  flightId:'flight1',tid:T,bid:U};
const reply={workspaceId:A,gatewaySn:'gateway1',tid:T,bid:U,kind:'service_reply'};
const progress={workspaceId:A,gatewaySn:'gateway1',
  flightId:'flight1',kind:'flighttask_progress'};
const rejected=(c,r)=>assert.throws(()=>resolve(c,r),/Flighttask correlation refused/);

test('DJI service replies have no flight_id: select exact gateway + TID + BID',()=>{
  const result=resolve([
    {...base,workspaceId:B},
    {...base,observationId:B,tid:T2},
    base
  ],reply);
  assert.deepEqual(result,{workspaceId:A,observationId:A});
  assert.ok(Object.isFrozen(result));
});

test('service reply is ambiguous with reused transaction on different flight IDs',()=>{
  rejected([base,{...base,observationId:B,flightId:'flight2'}],reply);
  rejected([base],{...reply,flightId:'flight1'});
});

test('progress uses gateway and flight_id, ignoring independent event TID/BID',()=>{
  assert.deepEqual(resolve([base],{...progress,tid:'independent',
    bid:'independent2'}),{workspaceId:A,observationId:A});
  rejected([base,{...base,observationId:B,tid:T2}],progress);
});

test('cross-workspace, wrong transaction, wrong gateway and unknown keys fail closed',()=>{
  for(const r of [
    {...reply,workspaceId:B},{...reply,gatewaySn:'other'},
    {...reply,tid:T2},{...reply,bid:T2},{...reply,tid:null},
    {...reply,kind:'unknown'},{...reply,tid:'not-a-uuid'}
  ])rejected([base],r);
  rejected([],reply);
  rejected([base],{...progress,flightId:'flight2'});
  rejected([base],{...progress,workspaceId:B});
  rejected([base],{...progress,gatewaySn:'other'});
});

test('malformed candidates, duplicate matches and excessive sets are rejected',()=>{
  rejected([base,base],reply);
  for(const change of [
    {observationId:'bad'},{gatewaySn:'@bad'},{tid:'not-a-uuid'},
    {bid:8},{workspaceId:23},{flightId:null}
  ])rejected([base,{...base,...change}],reply);
  rejected('not-an-array',reply);
  rejected(Array.from({length:1001},()=>base),reply);
  rejected([base],{...progress,flightId:'x'.repeat(101)});
});

test('helper exports only a selection function; no DJI transport or store',()=>{
  assert.deepEqual(Object.keys(require('../dji-flighttask-correlation-guard')),
    ['resolveFlighttaskObservation']);
});
