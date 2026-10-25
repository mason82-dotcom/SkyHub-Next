'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {
  createFlighttaskMessageRouter,SQL_REPLY,SQL_PROGRESS
}=require('../dji-flighttask-multimission-router');

const now=1792518001000;
const A='11111111-2222-4333-8444-555555555555';
const B='99999999-8888-4777-8666-555555555555';
const O1='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const O2='cccccccc-dddd-4eee-8fff-aaaaaaaaaaaa';
const tid='66666666-7777-4888-8999-000000000000';
const bid='33333333-4444-4555-8666-777777777777';
const actor={id:'operator-synthetic',role:'operator',workspaceId:A};
const rc='SYNTHETIC_RC';
const flight='FLIGHT_SYNTHETIC';
const serviceTopic='thing/product/'+rc+'/services_reply';
const eventTopic='thing/product/'+rc+'/events';
const service=()=>JSON.stringify({
  method:'flighttask_execute',tid,bid,timestamp:now-3000,
  gateway:rc,data:{result:0}
});
const event=()=>JSON.stringify({
  method:'flighttask_progress',tid:'independent-event',
  bid:'independent-bid',timestamp:now-2000,gateway:rc,
  need_reply:1,
  data:{result:0,output:{status:'ok',ext:{flight_id:flight,
    break_point:{latitude:49.1,longitude:8.4}},
    secret:'NEVER_PERSIST_PRIVATE'}}
});
const request={gatewaySn:rc,flightId:flight,tid,bid,method:'flighttask_execute'};
const observation=(observationId,workspaceId=A,r=request)=>({workspaceId,observationId,request:r});
const input=(kind='service_reply',payload=service())=>({
  workspaceId:A,principal:actor,kind,
  topic:kind==='service_reply'?serviceTopic:eventTopic,
  payload,now
});

function fixture(records=[observation(O1)],{permit=true,throwDb=false}={}){
  const calls=[];
  let authorizeCount=0;
  const db={async query(sql,params){
    calls.push({type:'sql',sql,params});
    if(throwDb)throw Error('SECRET_DSN');
    const target=records.filter(x=>
      x.workspaceId===params[0]&&x.request.gatewaySn===params[1]&&
      (sql===SQL_REPLY?
        x.request.tid===params[2]&&x.request.bid===params[3]:
        x.request.flightId===params[2])
    ).slice(0,2);
    return {rows:target.map(x=>({observation_id:x.observationId}))};
  }};
  const scoped={
    async apply(args){
      calls.push({type:'apply',args});
      return {applied:true,reason:'request-acknowledged',revision:2,
        state:{request:{flightId:'PRIVATE'},raw:'PRIVATE'}};
    }
  };
  const authorize=async(p,w,action)=>{
    calls.push({type:'auth',action});
    authorizeCount++;
    return permit&&p===actor&&w===A&&action==='route_observation';
  };
  return {calls,router:createFlighttaskMessageRouter(db,scoped,{authorize}),
    get authorizeCount(){return authorizeCount;}};
}
const ofType=(f,t)=>f.calls.filter(x=>x.type===t);

test('only operator/admin within exact workspace and with trusted callback may route',async()=>{
  const f=fixture();
  for(const changes of [
    {workspaceId:B},{workspaceId:'../../outside'},
    {principal:{...actor,workspaceId:B}},
    {principal:{...actor,role:'pilot'}},
    {principal:{...actor,role:'viewer'}},
    {principal:{...actor,id:'../bad'}},
    {principal:null},{now:'1792518001000'}
  ])await assert.rejects(f.router.route({...input(),...changes}),/access denied/);
  assert.equal(f.calls.length,0);
  const r=await f.router.route(input());
  assert.deepEqual(r,{matched:true,applied:true,revision:2,reason:'request-acknowledged'});
  assert.equal(f.authorizeCount,1);
  assert.equal(ofType(f,'apply').length,1);
  assert.equal(ofType(f,'sql').length,1);
});

test('authorization must be exact boolean, not an object or role claim',async()=>{
  const db={query:async()=>{throw Error('DB should not be used');}};
  const scoped={apply:async()=>{throw Error('Journal should not be used');}};
  for(const value of [{allowed:true},'true',1,null,false]){
    const router=createFlighttaskMessageRouter(db,scoped,{authorize:async()=>value});
    await assert.rejects(router.route(input()),/access denied/);
  }
  const thrown=createFlighttaskMessageRouter(db,scoped,{
    authorize:async()=>{throw Error('PRIVATE_SESSION_TOKEN');}
  });
  await assert.rejects(thrown.route(input()),e=>{
    assert.equal(e.message,'Flighttask routing access denied');
    return true;
  });
});

test('exact reply selectors require TID, BID and gateway with no other DB parameters',async()=>{
  const f=fixture([observation(O1),observation(O2,A,{...request,tid:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'})]);
  const r=await f.router.route(input());
  assert.equal(r.matched,true);
  const q=ofType(f,'sql')[0];
  assert.equal(q.sql,SQL_REPLY);
  assert.deepEqual(q.params,[A,rc,tid,bid]);
  const a=ofType(f,'apply')[0].args;
  assert.equal(a.observationId,O1);
  assert.equal(a.workspaceId,A);
  assert.equal(a.principal,actor);
  assert.equal(a.kind,'service_reply');
  assert.equal(a.payload,input().payload);
});

test('progress correlates by workspace, gateway and flight_id, NOT independent event TID/BID',async()=>{
  const f=fixture([observation(O1),observation(O2,B)]);
  const r=await f.router.route(input('flighttask_progress',event()));
  assert.equal(r.matched,true);
  const q=ofType(f,'sql')[0];
  assert.equal(q.sql,SQL_PROGRESS);
  assert.deepEqual(q.params,[A,rc,flight]);
  assert.equal(ofType(f,'apply')[0].args.observationId,O1);
  assert.equal(JSON.stringify(q.params).includes('NEVER_PERSIST_PRIVATE'),false);
  assert.equal(JSON.stringify(q.params).includes('latitude'),false);
});

test('ambiguous same-workspace mission keys block routing rather than guess a target',async()=>{
  const f=fixture([observation(O1),observation(O2)]);
  const p=await f.router.route(input('flighttask_progress',event()));
  assert.deepEqual(p,{matched:false,applied:false,reason:'ambiguous-observation'});
  assert.equal(ofType(f,'apply').length,0);
  const dup=fixture([observation(O1),observation(O2)]);
  const s=await dup.router.route(input());
  assert.equal(s.reason,'ambiguous-observation');
  assert.equal(ofType(dup,'apply').length,0);
});

test('nonmatching, other-workspace and other-device payloads cannot touch a journal',async()=>{
  for(const records of [
    [],[observation(O1,B)],
    [observation(O1,A,{...request,gatewaySn:'OTHER'})],
    [observation(O1,A,{...request,tid:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'})]
  ]){
    const f=fixture(records);
    const result=await f.router.route(input());
    assert.deepEqual(result,{matched:false,applied:false,reason:'no-matching-observation'});
    assert.equal(ofType(f,'apply').length,0);
  }
});

test('invalid, stale, future, retained, oversized and unsupported replies bypass SQL',async()=>{
  const payloads=[
    '{bad json',
    service().replace('"flighttask_execute"','"flighttask_prepare"'),
    JSON.stringify({...JSON.parse(service()),method:null}),
    JSON.stringify({...JSON.parse(service()),timestamp:now+30001}),
    JSON.stringify({...JSON.parse(service()),data:{result:{code:0}}}),
    JSON.stringify({...JSON.parse(service()),data:{result:0,output:{status:'ok'}}}),
    Buffer.alloc(131073,'x')
  ];
  for(const raw of payloads){
    const f=fixture();const r=await f.router.route(input('service_reply',raw));
    assert.equal(r.applied,false);
    assert.equal(ofType(f,'sql').length,0);
  }
  const f=fixture();
  const retained=await f.router.route({...input(),retained:true});
  assert.equal(retained.reason,'invalid-observation-envelope');
  assert.equal(ofType(f,'sql').length,0);
  const other=await f.router.route({...input(),kind:'publish'});
  assert.equal(other.reason,'unsupported-message-kind');
  assert.equal(ofType(f,'sql').length,0);
});

test('invalid retained and future events fail closed before SQL',async()=>{
  const f=fixture();
  const bad=[
    {...input('flighttask_progress',event()),retained:true},
    input('flighttask_progress','{bad'),
    input('flighttask_progress',JSON.stringify({...JSON.parse(event()),timestamp:now+30001})),
    input('flighttask_progress',JSON.stringify({...JSON.parse(event()),data:{
      result:0,output:{status:'ok',ext:{flight_id:''}}}}))
  ];
  for(const args of bad){
    const out=await f.router.route(args);
    assert.equal(out.applied,false);
  }
  assert.equal(ofType(f,'sql').length,0);
});

test('storage errors are redacted; malformed rows never call the journal',async()=>{
  const f=fixture([observation(O1)],{throwDb:true});
  await assert.rejects(f.router.route(input()),err=>{
    assert.equal(err.message,'Flighttask routing storage unavailable');
    assert.equal(err.message.includes('SECRET_DSN'),false);
    return true;
  });
  for(const rows of [[{}],[{observation_id:'../../secret'}],[{observation_id:O1},{observation_id:O2},{observation_id:O1}],null]){
    const calls=[];
    const db={async query(){calls.push('query');return {rows};}};
    const scoped={async apply(){calls.push('apply');}};
    const router=createFlighttaskMessageRouter(db,scoped,{authorize:async()=>true});
    await assert.rejects(router.route(input()),/invalid lookup result/);
    assert.deepEqual(calls,['query']);
  }
});

test('returned DTO is redacted and has no raw event, flight ID or internal state',async()=>{
  const f=fixture();const r=await f.router.route(input('flighttask_progress',event()));
  assert.deepEqual(Object.keys(r).sort(),['applied','matched','reason','revision']);
  assert.equal(Object.isFrozen(r),true);
  assert.doesNotMatch(JSON.stringify(r),/SYNTHETIC_RC|FLIGHT_SYNTHETIC|PRIVATE|latitude/);
  assert.throws(()=>createFlighttaskMessageRouter({},{}),/requires trusted/);
});
