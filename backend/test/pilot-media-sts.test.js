'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createPilotMediaStsHandler,MAX_ISSUE_SECONDS}=require('../pilot-media-sts');

const WORKSPACE='e3dea0f5-37f2-4d79-ae58-490af3228069';
const OTHER='123e4567-e89b-42d3-a456-426614174000';
const PILOT=Object.freeze({role:'pilot',workspaceId:WORKSPACE});
const STORAGE={bucket:'dji-cloud',region:'us-east-1',endpoint:'https://minio.example.test:9000'};
const TEMP={accessKeyId:'TEMP_ONLY',accessKeySecret:'TEST_NOT_REAL',securityToken:'SESSION_ONLY',expire:120};
const grant=(over={})=>({
  provider:'minio',bucket:STORAGE.bucket,endpoint:STORAGE.endpoint,region:STORAGE.region,
  objectKeyPrefix:WORKSPACE+'/media/session_00000001',credentials:{...TEMP},...over
});
function req(over={}){
  return {secure:true,headers:{'x-auth-token':'paired-test-token'},
    params:{workspaceId:WORKSPACE},query:{},body:{},...over};
}
function res(){
  return {statusCode:200,body:null,headers:{},
    status(code){this.statusCode=code;return this;},
    set(name,value){this.headers[name.toLowerCase()]=value;return this;},
    json(data){this.body=data;return data;}};
}
function handler({authorize=async()=>PILOT,issueGrant=async()=>grant(),
  allowIssuance=async()=>true,storage=STORAGE,workspace=WORKSPACE}={}){
  return createPilotMediaStsHandler({workspace,authorize,issueGrant,allowIssuance,storage});
}
async function execute(h,request=req()){
  const response=res();
  await h(request,response);
  assert.equal(response.headers['cache-control'],'no-store');
  return response;
}

test('synthetic temporary grant is DJI HTTPS-shaped and tightly bounded',async()=>{
  let seen=null;
  const h=handler({issueGrant:async args=>{seen=args;return grant();}});
  const r=await execute(h);
  assert.equal(r.statusCode,200);
  assert.equal(r.body.code,0);
  assert.deepEqual(Object.keys(r.body.data).sort(),
    ['bucket','credentials','endpoint','object_key_prefix','provider','region']);
  assert.equal(r.body.data.object_key_prefix,WORKSPACE+'/media/session_00000001');
  assert.equal(r.body.data.credentials.expire,120);
  assert.equal(MAX_ISSUE_SECONDS,900);
  assert.deepEqual(seen,{workspace:WORKSPACE,principal:PILOT,maxSeconds:900});
  assert.doesNotMatch(JSON.stringify(seen),/paired-test-token/);
});

test('no STS issuer or rate limiter means no credential output, even when paired',async()=>{
  for(const options of [
    {issueGrant:null},{allowIssuance:null},{storage:null},
    {storage:{...STORAGE,endpoint:'http://minio.example.test:9000'}},
    {storage:{...STORAGE,endpoint:'https://user:pw@minio.example.test:9000'}},
    {storage:{...STORAGE,endpoint:'https://minio.example.test:9000/path'}}
  ]){
    const r=await execute(handler(options));
    assert.equal(r.statusCode,503);
    assert.deepEqual(r.body.data,{});
    assert.doesNotMatch(JSON.stringify(r.body),/TEMP_ONLY|SESSION_ONLY|TEST_NOT_REAL/);
  }
});

test('TLS and exact workspace must be checked before authorization or issuing STS',async()=>{
  let called=0;
  const h=handler({authorize:async()=>{called++;return PILOT;},
    issueGrant:async()=>{called++;return grant();}});
  const insecure=await execute(h,req({secure:false,headers:{
    'x-auth-token':'paired-test-token','x-forwarded-proto':'https'
  }}));
  assert.equal(insecure.statusCode,403);
  const cross=await execute(h,req({params:{workspaceId:OTHER}}));
  assert.equal(cross.statusCode,404);
  assert.equal(called,0);
});

test('missing or invalid token and mismatched or untyped principal deny issuance',async()=>{
  let issued=0;
  const h=handler({issueGrant:async()=>{issued++;return grant();}});
  for(const value of ['',undefined,['token'],'x'.repeat(513)]){
    const r=await execute(h,req({headers:{'x-auth-token':value}}));
    assert.equal(r.statusCode,401);
  }
  for(const principal of [null,true,{role:'admin',workspaceId:WORKSPACE},
    {role:'pilot',workspaceId:OTHER},{role:'viewer',workspaceId:WORKSPACE}]){
    const denied=await execute(handler({
      authorize:async()=>principal,
      issueGrant:async()=>{issued++;return grant();}
    }));
    assert.equal(denied.statusCode,403);
  }
  assert.equal(issued,0);
});

test('only an empty STS request is accepted; client cannot choose storage scope',async()=>{
  let issued=0;
  const h=handler({issueGrant:async()=>{issued++;return grant();}});
  for(const change of [{body:{prefix:'other'}},{body:[]},{query:{bucket:'pv-inspections'}},
    {query:{workspace:OTHER}}]){
    const r=await execute(h,req(change));
    assert.equal(r.statusCode,400);
  }
  assert.equal(issued,0);
});

test('rate limiter denies and fails closed before issuer runs',async()=>{
  let issued=0;
  const issuer=async()=>{issued++;return grant();};
  const throttled=await execute(handler({issueGrant:issuer,allowIssuance:async()=>false}));
  assert.equal(throttled.statusCode,429);
  const crashed=await execute(handler({issueGrant:issuer,
    allowIssuance:async()=>{throw new Error('redis PRIVATE_TOKEN');}}));
  assert.equal(crashed.statusCode,503);
  assert.equal(issued,0);
  assert.doesNotMatch(JSON.stringify(crashed.body),/PRIVATE_TOKEN/);
});

test('rejects wrong provider, destination, foreign prefix and unlimited token duration',async()=>{
  const bad=[
    grant({provider:'aws'}),
    grant({bucket:'farming'}),
    grant({endpoint:'https://evil.example.test'}),
    grant({region:'another-region'}),
    grant({objectKeyPrefix:OTHER+'/media/session_00000001'}),
    grant({objectKeyPrefix:WORKSPACE+'/media'}),
    grant({objectKeyPrefix:WORKSPACE+'/media/session/subpath'}),
    grant({objectKeyPrefix:WORKSPACE+'/media/../bad'}),
    grant({objectKeyPrefix:WORKSPACE+'/media/x'}),
    grant({credentials:{...TEMP,expire:MAX_ISSUE_SECONDS+1}}),
    grant({credentials:{...TEMP,expire:0}}),
    grant({credentials:{...TEMP,securityToken:undefined}}),
    grant({credentials:{...TEMP,accessKeySecret:'x'.repeat(4097)}}),
    null
  ];
  for(const item of bad){
    const r=await execute(handler({issueGrant:async()=>item}));
    assert.equal(r.statusCode,503);
    assert.deepEqual(r.body.data,{});
    assert.doesNotMatch(JSON.stringify(r.body),/TEMP_ONLY|TEST_NOT_REAL|SESSION_ONLY/);
  }
});

test('authorization and storage provider exceptions cannot expose internals',async()=>{
  const auth=await execute(handler({authorize:async()=>{throw Error('PRIVATE_AUTH_SECRET');}}));
  assert.equal(auth.statusCode,503);
  const storage=await execute(handler({issueGrant:async()=>{throw Error('PRIVATE_S3_KEY');}}));
  assert.equal(storage.statusCode,503);
  assert.doesNotMatch(JSON.stringify([auth.body,storage.body]),/PRIVATE_|SECRET/);
});

test('invalid setup fails closed, and no live server route or I/O is introduced',()=>{
  assert.throws(()=>createPilotMediaStsHandler({workspace:'bad',authorize:async()=>PILOT}));
  assert.throws(()=>createPilotMediaStsHandler({workspace:WORKSPACE,authorize:null}));
  const source=fs.readFileSync(path.resolve(__dirname,'../pilot-media-sts.js'),'utf8');
  const server=fs.readFileSync(path.resolve(__dirname,'../server.js'),'utf8');
  assert.doesNotMatch(server,/require\(['"]\.\/pilot-media-sts['"]\)/);
  assert.doesNotMatch(source,/require\(['"](?:node:)?(?:fs|net|http|https|child_process)['"]\)/);
  assert.doesNotMatch(source,/process\.env|@aws-sdk|MinioClient|mqtt\.connect/);
});
