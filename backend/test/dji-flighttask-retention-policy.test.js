'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createPolicyBoundFlighttaskRetention}=require('../dji-flighttask-retention-policy');
const A='11111111-2222-4333-8444-555555555555';
const B='99999999-8888-4777-8666-555555555555';
const now=1792750000000,day=86400000;
const principal={id:'test-admin',workspaceId:A,role:'admin'};
function fixture({allowed=true,policy={enabled:true,legalHold:false,retentionDays:90,maxBatch:3},
  clock=()=>now,dbError=false}={}){
  const events=[];
  const db={async query(sql,args){
    events.push({type:'db',sql,args});
    if(dbError)throw Error('PRIVATE_DSN');
    return {rows:[{observation_id:'private'}]};
  }};
  // Stand-in for createFlighttaskWorkspaceTransactions(): records the scoped call.
  const transactions={async run(scope,work){
    events.push({type:'tx',scope});
    return work(db);
  }};
  const journal=createPolicyBoundFlighttaskRetention(transactions,{
    authorize:async(p,workspace,action)=>{
      events.push({type:'auth',workspace,action});
      return allowed&&p===principal&&workspace===A&&action==='prune';
    },
    resolvePolicy:async()=>{events.push({type:'policy'});return policy;},clock
  });
  return {journal,events};
}
test('no delete without explicit execute=true even for authorized administrator',async()=>{
  const f=fixture();
  assert.deepEqual(await f.journal.run({workspaceId:A,principal}),{
    executed:false,deletedCount:0,limited:false,classification:'policy-checked-no-delete'});
  assert.deepEqual(f.events.map(x=>x.type),['auth','policy']);
});
test('policy, not request, determines exact cutoff, cap and time',async()=>{
  const f=fixture();
  const r=await f.journal.run({workspaceId:A,principal,execute:true,retentionDays:1,now:9999999999999,maxRows:500});
  assert.deepEqual(r,{
    executed:true,deletedCount:1,limited:false,classification:'policy-bound-terminal-snapshots-only'});
  const q=f.events.find(x=>x.type==='db');
  assert.deepEqual(q.args[0],A);
  assert.equal(q.args[1],now-90*day);
  assert.equal(q.args[3],3);
  assert.ok(Object.isFrozen(r));
  assert.doesNotMatch(JSON.stringify(r),/private|11111111/);
});
test('legal hold, policy disabled, missing and unsafe policy fail closed without SQL',async()=>{
  for(const policy of [
    {enabled:true,legalHold:true,retentionDays:30,maxBatch:10},
    {enabled:false,legalHold:false,retentionDays:30,maxBatch:10},
    {enabled:true,retentionDays:30,maxBatch:10},
    null
  ]){
    const f=fixture({policy});
    await assert.rejects(f.journal.run({workspaceId:A,principal,execute:true}),/not enabled/);
    assert.equal(f.events.filter(x=>x.type==='db').length,0);
  }
  for(const policy of [
    {enabled:true,legalHold:false,retentionDays:0,maxBatch:10},
    {enabled:true,legalHold:false,retentionDays:30,maxBatch:501},
    {enabled:true,legalHold:false,retentionDays:'30',maxBatch:10}
  ]){
    const f=fixture({policy});
    await assert.rejects(f.journal.run({workspaceId:A,principal,execute:true}),/policy unavailable/);
    assert.equal(f.events.filter(x=>x.type==='db').length,0);
  }
});
test('caller may not switch workspace or use a viewer or operator identity',async()=>{
  const f=fixture();
  for(const attempt of [
    {workspaceId:B,principal},
    {workspaceId:A,principal:{...principal,workspaceId:B}},
    {workspaceId:A,principal:{...principal,role:'operator'}},
    {workspaceId:A,principal:{...principal,role:'viewer'}},
    {workspaceId:'../secrets',principal},
    {workspaceId:A,principal,execute:'true'}
  ])await assert.rejects(f.journal.run({...attempt}),/access denied/);
  assert.equal(f.events.length,0);
});
test('authorization callback must return literal true for every execution',async()=>{
  const f=fixture({allowed:false});
  await assert.rejects(f.journal.run({workspaceId:A,principal,execute:true}),/access denied/);
  assert.equal(f.events.filter(x=>x.type==='policy').length,0);
  assert.equal(f.events.filter(x=>x.type==='db').length,0);
});
test('invalid trusted clock and storage errors redact sensitive content',async()=>{
  const bad=fixture({clock:()=>null});
  await assert.rejects(bad.journal.run({workspaceId:A,principal,execute:true}),/policy unavailable/);
  const error=fixture({dbError:true});
  await assert.rejects(error.journal.run({workspaceId:A,principal,execute:true}),e=>{
    assert.equal(e.message,'Flighttask retention storage unavailable');
    return true;
  });
});
test('constructor requires injected identity decision, policy and workspace transactions',()=>{
  const ok={authorize:async()=>true,resolvePolicy:async()=>({})};
  assert.throws(()=>createPolicyBoundFlighttaskRetention(null,{}),/trusted dependencies/);
  assert.throws(()=>createPolicyBoundFlighttaskRetention({run:async()=>{}},{authorize:async()=>true}),/trusted dependencies/);
  // A raw pool or client would run the DELETE without the tenant scope: refuse it.
  assert.throws(()=>createPolicyBoundFlighttaskRetention({query:async()=>{}},ok),/trusted dependencies/);
  assert.throws(()=>createPolicyBoundFlighttaskRetention({connect:async()=>{}},ok),/trusted dependencies/);
  assert.throws(()=>createPolicyBoundFlighttaskRetention({run:async()=>{},query:async()=>{}},ok),/trusted dependencies/);
});
test('the delete runs only inside the scoped prune transaction, never in a dry run',async()=>{
  const dry=fixture();
  await dry.journal.run({workspaceId:A,principal});
  assert.equal(dry.events.filter(x=>x.type==='tx').length,0);
  const f=fixture();
  await f.journal.run({workspaceId:A,principal,execute:true});
  const order=f.events.map(x=>x.type);
  assert.ok(order.indexOf('tx')<order.indexOf('db'));
  assert.deepEqual(f.events.find(x=>x.type==='tx').scope,{workspaceId:A,principal,action:'prune'});
});
