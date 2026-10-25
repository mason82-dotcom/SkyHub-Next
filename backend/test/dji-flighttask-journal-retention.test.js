'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {
  createFlighttaskRetention,DELETE_SQL,PHASES,MAX_BATCH
}=require('../dji-flighttask-journal-retention');
const workspace='11111111-2222-4333-8444-555555555555';
const other='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const now=1792750000000;
const principal={id:'synthetic-operator',workspaceId:workspace};
const request={workspaceId:workspace,principal,now};
function fixture({allow=true,deleteCount=2,dbFailure=false}={}){
  const calls=[];
  const db={async query(sql,args){
    calls.push({sql,args});
    if(dbFailure)throw new Error('PRIVATE_DB_DSN');
    return {rows:Array.from({length:deleteCount},()=>({observation_id:'PRIVATE_ID'}))};
  }};
  const allowCallback=async (user,workspaceId)=>{
    calls.push({authorization:{user,workspaceId}});
    return allow&&user===principal&&workspaceId===workspace;
  };
  return {calls,journal:createFlighttaskRetention(db,{authorize:allowCallback})};
}

test('never retain or delete a running or awaiting observation through SQL predicate',()=>{
  assert.match(DELETE_SQL,/workspace_id=\$1/);
  assert.match(DELETE_SQL,/updated_at < to_timestamp\(\$2::double precision \/ 1000\)/);
  assert.match(DELETE_SQL,/snapshot->>'phase' = ANY\(\$3::text\[\]\)/);
  assert.match(DELETE_SQL,/FOR UPDATE SKIP LOCKED/);
  assert.match(DELETE_SQL,/LIMIT \$4/);
  assert.doesNotMatch(JSON.stringify(PHASES),/awaiting_reply|reply_accepted|reported_in_progress|reported_paused|reported_sent/);
  assert.ok(PHASES.includes('expired_unverified'));
  assert.ok(PHASES.includes('reported_ok'));
});

test('authorization must be injected and must explicitly return boolean true',async()=>{
  assert.throws(()=>createFlighttaskRetention({query:async()=>({rows:[]})}),/authorization/);
  assert.throws(()=>createFlighttaskRetention(null,{authorize:async()=>true}),/database/);
  const f=fixture({allow:false});
  await assert.rejects(f.journal.prune(request),/access denied/);
  assert.equal(f.calls.filter(c=>c.sql).length,0);
  const ambiguous=createFlighttaskRetention(
    {query:async()=>{throw Error('should not run');}},
    {authorize:async()=>({allowed:true})});
  await assert.rejects(ambiguous.prune(request),/access denied/);
});

test('workspace authority cannot be bypassed by changing workspaceId',async()=>{
  const f=fixture();
  await assert.rejects(f.journal.prune({...request,workspaceId:other}),/access denied/);
  assert.equal(f.calls.filter(c=>c.sql).length,0);
});

test('bounded batch, deterministic cutoff and only redacted output',async()=>{
  const f=fixture();
  const r=await f.journal.prune({...request,retentionDays:30,maxRows:2});
  assert.deepEqual(r,{
    deletedCount:2,limited:true,classification:'isolated-terminal-snapshots-only'
  });
  const q=f.calls.find(c=>c.sql);
  assert.deepEqual(q.args,[workspace,now-30*86400000,PHASES,2]);
  assert.equal(JSON.stringify(r).includes(workspace),false);
  assert.equal(JSON.stringify(r).includes('PRIVATE_ID'),false);
  assert.equal(Object.isFrozen(r),true);
});

test('no-op when nothing eligible and authorizes before touching SQL',async()=>{
  const f=fixture({deleteCount:0});
  const r=await f.journal.prune(request);
  assert.equal(r.deletedCount,0);
  assert.equal(r.limited,false);
  assert.equal(f.calls[0].authorization.workspaceId,workspace);
});

test('invalid timestamps, scope, TTL and limit parameters reject before authorization',async()=>{
  const bad=[
    {workspaceId:'../../shadow'}, {workspaceId:null},
    {principal:null},{now:'1792750000000'}, {now:0}, {now:NaN},
    {retentionDays:0},{retentionDays:3651},{retentionDays:1.2},
    {maxRows:0},{maxRows:MAX_BATCH+1},{maxRows:1.5}
  ];
  const f=fixture();
  for(const change of bad)
    await assert.rejects(f.journal.prune({...request,...change}),/Invalid flighttask retention request/);
  assert.equal(f.calls.length,0);
});

test('authorization and storage exceptions never expose secrets',async()=>{
  const f=fixture({dbFailure:true});
  await assert.rejects(f.journal.prune(request),err=>{
    assert.equal(err.message,'Flighttask retention storage unavailable');
    assert.doesNotMatch(err.message,/PRIVATE_DB_DSN/);
    return true;
  });
  const denied=createFlighttaskRetention({query:async()=>{throw Error('QUERY_SHOULD_NOT_RUN');}},
    {authorize:async()=>{throw Error('CREDENTIAL_SECRET');}});
  await assert.rejects(denied.prune(request),err=>{
    assert.equal(err.message,'Flighttask retention access denied');
    assert.doesNotMatch(err.message,/CREDENTIAL_SECRET/);
    return true;
  });
});

test('unexpected database response is refused, not guessed',async()=>{
  for(const rows of [null,undefined,{},Array.from({length:501},()=>({}))]){
    const db={async query(){return {rows};}};
    const x=createFlighttaskRetention(db,{authorize:async()=>true});
    await assert.rejects(x.prune({...request,maxRows:500}),/invalid storage response/);
  }
});
