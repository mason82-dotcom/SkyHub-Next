'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createMapElementHandler}=require('../map-element-api');

const WORKSPACE='e3dea0f5-37f2-4d79-ae58-490af3228069';
const PILOT={role:'pilot',workspaceId:WORKSPACE};
const OPERATOR={role:'operator',workspaceId:WORKSPACE};
function response(){
  return {statusCode:200,body:null,
    status(code){this.statusCode=code;return this;},
    json(body){this.body=body;return body;}};
}
function request({secure=true,token='pilot-token',workspaceId=WORKSPACE,query={}}={}){
  return {secure,headers:{'x-auth-token':token},params:{workspaceId},query};
}

test('map-group route requires HTTPS and a valid DJI API token',async()=>{
  let reads=0;
  const handler=createMapElementHandler({workspaceId:WORKSPACE,
    authorize:async token=>token==='pilot-token'?PILOT:null,
    store:{readResponse:async()=>{reads++;return {code:0,data:[]};}}});
  const insecure=response();
  await handler(request({secure:false}),insecure);
  assert.equal(insecure.statusCode,403);
  const unauthorized=response();
  await handler(request({token:'wrong'}),unauthorized);
  assert.equal(unauthorized.statusCode,401);
  assert.equal(reads,0);
});

test('map-group route binds the requested workspace and forwards official GET filters',async()=>{
  let read;
  const expected={code:0,message:'success',data:[]};
  const handler=createMapElementHandler({workspaceId:WORKSPACE,
    authorize:async token=>token==='pilot-token'?OPERATOR:null,
    store:{readResponse:async(...args)=>{read=args;return expected;}}});
  const res=response();
  await handler(request({query:{group_id:'shared',is_distributed:'false'}}),res);
  assert.deepEqual(read,[WORKSPACE,{groupId:'shared',isDistributed:false}]);
  assert.equal(res.body,expected);
  const wrongWorkspace=response();
  await handler(request({workspaceId:'123e4567-e89b-42d3-a456-426614174000'}),wrongWorkspace);
  assert.equal(wrongWorkspace.statusCode,404);
});

test('invalid filters and unavailable storage fail without leaking errors',async()=>{
  const handler=createMapElementHandler({workspaceId:WORKSPACE,
    authorize:async()=>PILOT,
    store:{readResponse:async()=>{throw Error('database password must stay private');}}});
  const badFilter=response();
  await handler(request({query:{is_distributed:'yes'}}),badFilter);
  assert.equal(badFilter.statusCode,400);
  const failedRead=response();
  await handler(request(),failedRead);
  assert.equal(failedRead.statusCode,503);
  assert.doesNotMatch(JSON.stringify(failedRead.body),/password|private/);
});

test('repeated query filters are rejected before storage access',async()=>{
  let reads=0;
  const handler=createMapElementHandler({workspaceId:WORKSPACE,
    authorize:async()=>PILOT,
    store:{readResponse:async()=>{reads++;return {code:0,data:[]};}}});
  for(const query of [
    {group_id:['shared','private']},
    {is_distributed:['true','false']}
  ]){
    const res=response();
    await handler(request({query}),res);
    assert.equal(res.statusCode,400);
  }
  assert.equal(reads,0);
});

test('authorization backend failures return a redacted service error',async()=>{
  const handler=createMapElementHandler({workspaceId:WORKSPACE,
    authorize:async()=>{throw Error('private redis details');},store:null});
  const res=response();
  await handler(request(),res);
  assert.equal(res.statusCode,503);
  assert.doesNotMatch(JSON.stringify(res.body),/private redis/);
});

test('paired Pilot can read shared groups only; private filters never reach database',async()=>{
  let reads=0;
  const handler=createMapElementHandler({workspaceId:WORKSPACE,
    authorize:async token=>token==='pilot-token'?PILOT:null,
    store:{readResponse:async()=>{reads++;return {code:0,data:[]};}}});
  const shared=response();
  await handler(request(),shared);
  assert.equal(shared.statusCode,200);
  assert.equal(reads,1);
  const denied=response();
  await handler(request({query:{is_distributed:'false'}}),denied);
  assert.equal(denied.statusCode,403);
  assert.equal(reads,1);
  assert.doesNotMatch(JSON.stringify(denied.body),/private|workspace|token/i);
});

test('workspace mismatch and boolean-only authorization are denied before database reads',async()=>{
  let reads=0;
  const handler=createMapElementHandler({workspaceId:WORKSPACE,
    authorize:async()=>({role:'pilot',workspaceId:'123e4567-e89b-42d3-a456-426614174000'}),
    store:{readResponse:async()=>{reads++;return {code:0,data:[]};}}});
  const denied=response();
  await handler(request(),denied);
  assert.equal(denied.statusCode,403);
  assert.equal(reads,0);
  const legacy=createMapElementHandler({workspaceId:WORKSPACE,
    authorize:async()=>true,
    store:{readResponse:async()=>{reads++;return {code:0,data:[]};}}});
  const invalid=response();
  await legacy(request(),invalid);
  assert.equal(invalid.statusCode,403);
  assert.equal(reads,0);
});

test('caller-supplied role and workspace cannot elevate a paired Pilot',async()=>{
  let reads=0;
  const handler=createMapElementHandler({workspaceId:WORKSPACE,
    authorize:async()=>PILOT,
    store:{readResponse:async()=>{reads++;return {code:0,data:[]};}}});
  const res=response();
  await handler(request({query:{
    is_distributed:'false',role:'admin',workspace_id:WORKSPACE,access:'operator'
  }}),res);
  assert.equal(res.statusCode,403);
  assert.equal(reads,0);
});

test('every error response uses the DJI {code, message, data} envelope without leaking details',async()=>{
  const handler=createMapElementHandler({workspaceId:WORKSPACE,
    authorize:async token=>token==='pilot-token'?PILOT:null,
    store:{readResponse:async()=>{throw Error('database password must stay private');}}});
  const cases=[
    [request({secure:false}),403],
    [request({token:'wrong'}),401],
    [request({workspaceId:'123e4567-e89b-42d3-a456-426614174000'}),404],
    [request({query:{group_id:''}}),400],
    [request({query:{is_distributed:'false'}}),403],
    [request(),503]
  ];
  for(const [req,status] of cases){
    const res=response();
    await handler(req,res);
    assert.equal(res.statusCode,status);
    assert.equal(res.body.code,status);
    assert.equal(typeof res.body.message,'string');
    assert.deepEqual(res.body.data,{});
    assert.doesNotMatch(JSON.stringify(res.body),/password|private/);
  }
});
