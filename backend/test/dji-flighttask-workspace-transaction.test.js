'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createFlighttaskWorkspaceTransactions}=require('../dji-flighttask-workspace-transaction');
const A='11111111-2222-4333-8444-555555555555';
const B='99999999-8888-4777-8666-555555555555';
const operator={id:'synthetic-operator',workspaceId:A,role:'operator'};
const admin={id:'synthetic-admin',workspaceId:A,role:'admin'};
const viewer={id:'synthetic-viewer',workspaceId:A,role:'viewer'};
function fixture({authorize=async()=>true,role={rolname:'skyhub_test_worker',rolsuper:false,rolbypassrls:false},
  fail,commitFail=false,rollbackFail=false}={}){
  const calls=[],connection={released:0,async query(sql,params){
    calls.push([sql,params]);
    if(fail===sql||(commitFail&&sql==='COMMIT'))throw Error('PRIVATE_DATABASE_DSN');
    if(rollbackFail&&sql==='ROLLBACK')throw Error('PRIVATE_DATABASE_DSN');
    if(sql.startsWith('SELECT rolname,rolsuper'))return {rows:[role]};
    return {rows:[]};
  },release(destroy){this.released++;this.destroyed=destroy}};
  const pool={async connect(){calls.push(['connect']);return connection}};
  const transactions=createFlighttaskWorkspaceTransactions(pool,{authorize,dbRole:'skyhub_test_worker'});
  return {calls,connection,transactions};
}
test('trusted scope is transactional, fixed-role, local GUC and released after commit',async()=>{
  const f=fixture();
  const result=await f.transactions.run({workspaceId:A,principal:operator,action:'observe'},async client=>{
    assert.equal(client,f.connection);await client.query('SELECT 1');return 'ok';
  });
  assert.equal(result,'ok');
  assert.deepEqual(f.calls.map(x=>x[0]),[
    'connect','BEGIN','SET LOCAL ROLE "skyhub_test_worker"',
    'SELECT rolname,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=CURRENT_USER',
    "SELECT set_config('skyhub.workspace_id',$1,true)",'SELECT 1','COMMIT']);
  assert.deepEqual(f.calls[4][1],[A]);
  assert.equal(f.connection.released,1);
  assert.ok(Object.isFrozen(f.transactions));
});
test('viewer may only summarize and pruning requires admin',async()=>{
  const f=fixture();
  for(const [p,action] of [[viewer,'create'],[viewer,'observe'],[viewer,'read_internal'],
    [viewer,'route_observation'],[operator,'prune'],[operator,'unknown']]){
    await assert.rejects(f.transactions.run({workspaceId:A,principal:p,action},async()=>1),/access denied/);
  }
  assert.equal(f.calls.length,0);
  assert.equal(await f.transactions.run({workspaceId:A,principal:viewer,action:'summary'},async()=>17),17);
  assert.equal(await f.transactions.run({workspaceId:A,principal:admin,action:'prune'},async()=>18),18);
});
test('workspace scope forged by request or principal denied before database access',async()=>{
  const f=fixture();
  const rejected=[
    {workspaceId:B,principal:operator},
    {workspaceId:'invalid',principal:operator},
    {workspaceId:A,principal:{...operator,workspaceId:B}},
    {workspaceId:A,principal:{...operator,id:'../PRIVATE'}},
    {workspaceId:A,principal:{...operator,role:'pilot'}},
    {workspaceId:A,principal:null}
  ];
  for(const p of rejected)
    await assert.rejects(f.transactions.run({...p,action:'summary'},async()=>1),/access denied/);
  assert.equal(f.calls.length,0);
});
test('authorization must be exact true and is checked freshly for each transaction',async()=>{
  let grants=0;
  const f=fixture({authorize:async()=>++grants===1});
  assert.equal(await f.transactions.run({workspaceId:A,principal:operator,action:'observe'},async()=>1),1);
  await assert.rejects(f.transactions.run({workspaceId:A,principal:operator,action:'observe'},async()=>1),/access denied/);
  assert.equal(f.calls.filter(c=>c[0]==='connect').length,1);
  const bad=fixture({authorize:async()=>({allowed:true})});
  await assert.rejects(bad.transactions.run({workspaceId:A,principal:operator,action:'observe'},async()=>1),/access denied/);
  assert.equal(bad.calls.length,0);
});
test('nonprivileged database role is verified, not assumed from client role string',async()=>{
  for(const role of [
    {rolname:'skyhub_test_worker',rolsuper:true,rolbypassrls:false},
    {rolname:'skyhub_test_worker',rolsuper:false,rolbypassrls:true},
    {rolname:'other_role',rolsuper:false,rolbypassrls:false},
    null
  ]){
    const f=fixture({role});
    await assert.rejects(f.transactions.run({workspaceId:A,principal:operator,action:'observe'},async()=>1),/transaction unavailable/);
    assert.equal(f.calls.at(-1)[0],'ROLLBACK');
    assert.equal(f.connection.released,1);
  }
});
test('failing SQL or callback rolls back, releases and never discloses credentials',async()=>{
  for(const opt of [{fail:"SELECT set_config('skyhub.workspace_id',$1,true)"},{commitFail:true},{}]){
    const f=fixture(opt);
    await assert.rejects(f.transactions.run({workspaceId:A,principal:operator,action:'observe'},async()=>{
      if(!opt.fail&&!opt.commitFail)throw Error('PRIVATE_TOKEN');
    }),err=>{
      assert.equal(err.message,'Flighttask workspace transaction unavailable');
      return true;
    });
    assert.ok(f.calls.some(c=>c[0]==='ROLLBACK'));
    assert.equal(f.connection.released,1);
  }
});
test('constructor refuses untrusted role names or absent callbacks',()=>{
  assert.throws(()=>createFlighttaskWorkspaceTransactions({connect:async()=>{}},{dbRole:'worker'}),/requires/);
  assert.throws(()=>createFlighttaskWorkspaceTransactions({connect:async()=>{}},{
    authorize:async()=>true,dbRole:'worker"; DROP TABLE users;--'}),/requires/);
});
test('a failed ROLLBACK discards the connection instead of returning it to the pool',async()=>{
  const f=fixture({commitFail:true,rollbackFail:true});
  await assert.rejects(f.transactions.run({workspaceId:A,principal:operator,action:'observe'},async()=>{}),
    /transaction unavailable/);
  assert.equal(f.connection.released,1);
  assert.equal(f.connection.destroyed,true);
  const ok=fixture();
  await ok.transactions.run({workspaceId:A,principal:operator,action:'observe'},async()=>{});
  assert.ok(!ok.connection.destroyed);
});
