'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createScopedFlighttaskJournal}=require('../dji-flighttask-journal-access');

const A='11111111-2222-4333-8444-555555555555';
const B='66666666-7777-4888-8999-000000000000';
const OBS='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const actor={id:'synthetic-operator',workspaceId:A,role:'operator'};
const viewer={id:'synthetic-viewer',workspaceId:A,role:'viewer'};
const key={workspaceId:A,observationId:OBS};
const record={phase:'reported_ok',operationVerified:false,hardwareVerified:false,flightReady:false};

function fixture({allowed=true,throwAuth=false,authResult,principal=actor}={}){
  const calls=[];
  const journal={
    async start(...args){calls.push({method:'start',args});return {created:true}},
    async read(...args){calls.push({method:'read',args});return {revision:2,state:{request:{flightId:'PRIVATE'}}}},
    async apply(...args){calls.push({method:'apply',args});return {applied:true}},
    async recover(...args){calls.push({method:'recover',args});return {recovered:true}},
    async summary(...args){calls.push({method:'summary',args});return record}
  };
  const authorize=async(p,w,action)=>{
    calls.push({auth:true,p,w,action});
    if(throwAuth)throw Error('PRIVATE_CREDENTIAL_INFO');
    if(authResult!==undefined)return authResult;
    return allowed&&p===principal&&w===A;
  };
  return {calls,secured:createScopedFlighttaskJournal(journal,{authorize})};
}
function storeCalls(f){return f.calls.filter(c=>c.method)}
function authCalls(f){return f.calls.filter(c=>c.auth)}

test('requires injected journal and explicit authorizer, never implicit allow',()=>{
  assert.throws(()=>createScopedFlighttaskJournal({},{}),/requires/);
  assert.throws(()=>createScopedFlighttaskJournal(null,{authorize:()=>true}),/requires/);
  assert.throws(()=>createScopedFlighttaskJournal(fixture().secured),/requires/);
});

test('authorized operator is scoped and forwarded for every isolated operation',async()=>{
  const f=fixture();
  assert.deepEqual(await f.secured.start({...key,principal:actor,request:{flightId:'SYNTHETIC'},ttlMs:8000}),
    {created:true});
  assert.equal((await f.secured.read({...key,principal:actor})).revision,2);
  assert.deepEqual(await f.secured.apply({...key,principal:actor,kind:'clock',now:1792500000000}),{applied:true});
  assert.deepEqual(await f.secured.recover({...key,principal:actor,now:1792500000000}),{recovered:true});
  assert.deepEqual(await f.secured.summary({...key,principal:actor}),record);
  assert.deepEqual(authCalls(f).map(c=>c.action),
    ['create','read_internal','observe','recover','summary']);
  assert.deepEqual(storeCalls(f).map(c=>c.method),['start','read','apply','recover','summary']);
  assert.ok(storeCalls(f).every(c=>c.args[0].workspaceId===A&&
    c.args[0].observationId===OBS));
  assert.ok(Object.isFrozen(f.secured));
});

test('readable summary may be shared with authorized viewer, internal identifiers may not',async()=>{
  const f=fixture({principal:viewer});
  assert.deepEqual(await f.secured.summary({...key,principal:viewer}),record);
  for(const method of ['start','read','apply','recover']){
    await assert.rejects(f.secured[method]({...key,principal:viewer}),/access denied/);
  }
  assert.equal(storeCalls(f).length,1);
  assert.deepEqual(authCalls(f).map(c=>c.action),['summary']);
});

test('pilot, arbitrary roles and unknown roles can never read any journal data',async()=>{
  const f=fixture({authResult:true});
  for(const role of ['pilot','admin-root','viewer-ish',null,'']){
    for(const method of ['start','read','apply','recover','summary'])
      await assert.rejects(f.secured[method]({...key,principal:{...actor,role}}),/access denied/);
  }
  assert.equal(f.calls.length,0);
});

test('wrong workspace, forged scope and malformed identifiers deny before auth or SQL',async()=>{
  const f=fixture({authResult:true});
  const bad=[
    {...key,workspaceId:B,principal:actor},
    {...key,principal:{...actor,workspaceId:B}},
    {...key,workspaceId:'../a',principal:actor},
    {...key,observationId:'../../secret',principal:actor},
    {...key,observationId:null,principal:actor},
    {...key,principal:{...actor,id:'../../secret'}},
    {...key,principal:{...actor,workspaceId:'not-uuid'}},
    {...key,principal:'operator'},
    {...key,principal:null}
  ];
  for(const input of bad)
    await assert.rejects(f.secured.summary(input),/access denied/);
  assert.equal(f.calls.length,0);
});

test('truthey objects and role strings from gate are not authorization',async()=>{
  for(const value of [{allowed:true},1,'true',[],null,false]){
    const f=fixture({authResult:value});
    await assert.rejects(f.secured.summary({...key,principal:actor}),/access denied/);
    assert.equal(storeCalls(f).length,0);
  }
});

test('authorization exception leaks no tokens or private callback data',async()=>{
  const f=fixture({throwAuth:true});
  await assert.rejects(f.secured.read({...key,principal:actor}),err=>{
    assert.equal(err.message,'Flighttask journal access denied');
    assert.doesNotMatch(err.message,/PRIVATE_CREDENTIAL_INFO/);
    return true;
  });
  assert.equal(storeCalls(f).length,0);
});

test('all actions require a fresh permission check (not only on start)',async()=>{
  const f=fixture({allowed:false});
  for(const method of ['start','read','apply','recover','summary']){
    await assert.rejects(f.secured[method]({...key,principal:actor}),/access denied/);
  }
  assert.equal(authCalls(f).length,5);
  assert.equal(storeCalls(f).length,0);
});

test('authorized admin may use internal operations in its own workspace only',async()=>{
  const admin={id:'synthetic-admin',workspaceId:A,role:'admin'};
  const f=fixture({principal:admin});
  assert.deepEqual(await f.secured.apply({...key,principal:admin,kind:'clock',now:1792500000000}),{applied:true});
  await assert.rejects(f.secured.read({...key,workspaceId:B,principal:admin}),/access denied/);
  assert.equal(storeCalls(f).length,1);
});

test('no principal or authorization callback is copied to journal request arguments',async()=>{
  const f=fixture();
  const raw=Buffer.from('PRIVATE_BROKER_FRAME');
  await f.secured.apply({...key,principal:actor,kind:'service_reply',
    topic:'thing/product/SYNTHETIC_RC/services_reply',payload:raw,now:1792500000000,retained:false});
  const stored=storeCalls(f)[0];
  assert.deepEqual(Object.keys(stored.args[0]),['workspaceId','observationId']);
  assert.equal(stored.args[1],'service_reply');
  assert.equal(stored.args[2].payload,raw);
  assert.equal('principal' in stored.args[0],false);
  assert.equal('authorize' in stored.args[0],false);
});

test('false after previously granted operation cannot reuse prior authorization',async()=>{
  let count=0;
  const calls=[];
  const journal={
    start:async()=>({}),read:async()=>({}),apply:async()=>({}),
    recover:async()=>({}),summary:async()=>{calls.push('summary');return record}
  };
  const secured=createScopedFlighttaskJournal(journal,{
    authorize:async()=>++count===1
  });
  assert.deepEqual(await secured.summary({...key,principal:actor}),record);
  await assert.rejects(secured.summary({...key,principal:actor}),/access denied/);
  assert.deepEqual(calls,['summary']);
});
