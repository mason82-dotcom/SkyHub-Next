'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const express=require('express');
const {createPilotMediaHandlers,createPilotMediaRouter,ROOT}=require('../pilot-media-http');

const WS='e3dea0f5-37f2-4d79-ae58-490af3228069';
const OTHER='203cc94c-aef1-4e0e-a520-05a24be33a31';
const PREFIX=WS+'/media/'+'a'.repeat(32);
const KEY=PREFIX+'/DJI_0001.JPG';
const PRINCIPAL={role:'pilot',workspaceId:WS};
const CALLBACK={result:0,name:'DJI_0001.JPG',object_key:KEY,fingerprint:'file-01',
  ext:{file_group_id:'group-01',tinny_fingerprint:'tiny-01'}};

function request(body={},override={}){
  return {secure:true,headers:{'x-auth-token':'paired-token','content-type':'application/json'},
    params:{workspaceId:WS},query:{},body,...override};
}
function response(){
  return {statusCode:200,body:null,headers:{},
    set(k,v){this.headers[k.toLowerCase()]=v;return this;},
    status(code){this.statusCode=code;return this;},
    json(v){this.body=v;return v;}};
}
function fixture(over={}){
  const calls={authorization:0,limit:0,audit:[],reads:[],groups:[],head:[]};
  const config={
    workspace:WS,
    authorize:async token=>{calls.authorization++;return token==='paired-token'?PRINCIPAL:null;},
    allowRequest:async({workspace,principal,operation})=>{
      calls.limit++;
      assert.equal(workspace,WS);assert.equal(principal,PRINCIPAL);
      assert.ok(['tiny_fingerprints','fast_upload','upload_callback','group_upload_callback'].includes(operation));
      return true;
    },
    audit:async entry=>{calls.audit.push(entry);},
    store:{
      existingTinyFingerprints:async({workspace,body})=>{
        calls.reads.push({workspace,body});return ['tiny-01'];
      },
      verifiedFingerprint:async({workspace,body})=>{
        calls.reads.push({workspace,body});return {exists:true};
      },
      verifyCallback:async({workspace,callback,headObject})=>{
        calls.reads.push({workspace,callback});return (await headObject({bucket:'dji-cloud',key:KEY}))?
          {status:'verified'}:{status:'unverified'};
      }
    },
    groups:{report:async args=>{calls.groups.push(args);return {status:'recorded'};}},
    headObject:async q=>{calls.head.push(q);return {size:450,etag:'"fake"'};},
    ...over
  };
  config.transaction??=async work=>work({store:config.store,groups:config.groups,audit:config.audit});
  return {calls,config,handlers:createPilotMediaHandlers(config)};
}
async function call(handler,req){const res=response();await handler(req,res);return res;}

test('DJI tiny fingerprint request returns exactly existing verified workspace items',async()=>{
  const f=fixture();
  const r=await call(f.handlers.tinyFingerprints,request({tiny_fingerprints:['tiny-01','tiny-02']}));
  assert.deepEqual(r.body,{code:0,message:'success',data:{tiny_fingerprints:['tiny-01']}});
  assert.equal(r.statusCode,200);
  assert.equal(r.headers['cache-control'],'no-store');
  assert.equal(f.calls.reads[0].workspace,WS);
  assert.deepEqual(f.calls.audit,[{workspace:WS,operation:'tiny_fingerprints',outcome:'ok'}]);
  assert.doesNotMatch(JSON.stringify(f.calls.audit),/paired-token|tiny-01/);
});

test('DJI fast upload reports existing media only, never fabricates a stored image',async()=>{
  const f=fixture();
  const yes=await call(f.handlers.fastUpload,request({fingerprint:'file-01'}));
  assert.deepEqual(yes.body,{code:0,message:'success',data:{}});
  const no=fixture({store:{...f.config.store,verifiedFingerprint:async()=>({exists:false})}});
  const notFound=await call(no.handlers.fastUpload,request({fingerprint:'file-02'}));
  assert.equal(notFound.statusCode,404);
  assert.deepEqual(notFound.body.data,{});
  assert.equal(notFound.body.code,404);
  assert.deepEqual(no.calls.audit,[{workspace:WS,operation:'fast_upload',outcome:'pending'}]);
});

test('upload callback only acknowledges server-HEAD-verified media with DJI object_key',async()=>{
  const f=fixture();
  const r=await call(f.handlers.uploadCallback,request(CALLBACK));
  assert.equal(r.statusCode,200);
  assert.deepEqual(r.body,{code:0,message:'success',data:{object_key:KEY}});
  assert.deepEqual(f.calls.head,[{bucket:'dji-cloud',key:KEY}]);
  assert.equal(f.calls.audit[0].operation,'upload_callback');
  assert.doesNotMatch(JSON.stringify(f.calls.audit),/DJI_0001|file-01|paired-token/);
  const unverified=fixture({store:{
    ...f.config.store,verifyCallback:async()=>({status:'unverified'})
  }});
  const absent=await call(unverified.handlers.uploadCallback,request(CALLBACK));
  assert.equal(absent.statusCode,409);
  assert.deepEqual(absent.body.data,{});
  assert.equal(unverified.calls.audit[0].outcome,'pending');
});

test('individual upload duplicate returns idempotent DJI envelope; mismatch is a conflict',async()=>{
  const previous=fixture();
  for(const [status,expected] of [['duplicate',200],['failed-upload',409],
    ['unregistered',409],['expired',409],['conflict',409]]){
    const f=fixture({store:{...previous.config.store,verifyCallback:async()=>({status})}});
    const r=await call(f.handlers.uploadCallback,request(CALLBACK));
    assert.equal(r.statusCode,expected,status);
    assert.equal(r.body.code,expected===200?0:expected);
  }
});

test('group callback only confirms checked report; missing id and pending remain nonzero',async()=>{
  const f=fixture();
  const body={file_group_id:'group-01',file_count:3,file_uploaded_count:2};
  const r=await call(f.handlers.groupUploadCallback,request(body));
  assert.equal(r.statusCode,200);
  assert.deepEqual(r.body,{code:0,message:'success',data:{}});
  assert.deepEqual(f.calls.groups,[{workspace:WS,body}]);
  for(const [state,code] of [['recorded',200],['duplicate',200],
    ['pending',409],['conflict',409],['unverifiable',409]]){
    const g=fixture({groups:{report:async()=>({status:state})}});
    assert.equal((await call(g.handlers.groupUploadCallback,request(body))).statusCode,code,state);
  }
});

test('requests require HTTPS, exact workspace, bound Pilot principal and one token',async()=>{
  let hits=0;
  const f=fixture({authorize:async token=>{hits++;return token==='paired-token'?PRINCIPAL:null;}});
  for(const [req,code] of [
    [request({}, {secure:false,headers:{
      'x-auth-token':'paired-token','content-type':'application/json',
      'x-forwarded-proto':'https'}}),403],
    [request({}, {params:{workspaceId:OTHER}}),404],
    [request({}, {headers:{'x-auth-token':['paired-token'],'content-type':'application/json'}}),401],
    [request({}, {headers:{'x-auth-token':'','content-type':'application/json'}}),401],
    [request({}, {query:{role:'admin'}}),400],
  ]){
    const r=await call(f.handlers.tinyFingerprints,req);
    assert.equal(r.statusCode,code);
    assert.deepEqual(r.body.data,{});
  }
  assert.equal(hits,0);
  const wrong=fixture({authorize:async()=>({role:'admin',workspaceId:WS})});
  assert.equal((await call(wrong.handlers.tinyFingerprints,request({tiny_fingerprints:[]}))).statusCode,403);
  const other=fixture({authorize:async()=>({role:'pilot',workspaceId:OTHER})});
  assert.equal((await call(other.handlers.tinyFingerprints,request({tiny_fingerprints:[]}))).statusCode,403);
  const yes=fixture({authorize:async()=>true});
  assert.equal((await call(yes.handlers.tinyFingerprints,request({tiny_fingerprints:[]}))).statusCode,403);
  const crashed=fixture({authorize:async()=>{throw Error('REDIS_PRIVATE_KEY');}});
  const failed=await call(crashed.handlers.tinyFingerprints,request({tiny_fingerprints:[]}));
  assert.equal(failed.statusCode,503);
  assert.doesNotMatch(JSON.stringify(failed.body),/REDIS_PRIVATE_KEY/);
});

test('an independent limiter is required; failure does not reach the media store',async()=>{
  const f=fixture({allowRequest:async()=>false});
  const res=await call(f.handlers.tinyFingerprints,request({tiny_fingerprints:[]}));
  assert.equal(res.statusCode,429);
  assert.equal(f.calls.reads.length,0);
  assert.equal(f.calls.audit[0].outcome,'denied');
  const broken=fixture({allowRequest:async()=>{throw Error('LIMITER_PRIVATE');}});
  const reply=await call(broken.handlers.uploadCallback,request(CALLBACK));
  assert.equal(reply.statusCode,503);
  assert.doesNotMatch(JSON.stringify(reply.body),/LIMITER_PRIVATE/);
});

test('invalid body and oversized payloads fail before media database access',async()=>{
  const f=fixture();
  const invalid=[
    request({tiny_fingerprints:['bad/character']}),
    request({tiny_fingerprints:'not-array'}),
    request({tiny_fingerprints:[]},{headers:{
      'x-auth-token':'paired-token','content-type':'text/plain'
    }}),
    request({tiny_fingerprints:[]},{headers:{
      'x-auth-token':'paired-token','content-type':'application/json','content-length':'9999999'
    }}),
    request({tiny_fingerprints:[]},{body:[]})
  ];
  for(const bad of invalid){
    const res=await call(f.handlers.tinyFingerprints,bad);
    assert.equal(res.statusCode,400);
  }
  assert.equal(f.calls.reads.length,0);
  assert.equal(f.calls.audit.length,invalid.length);
  assert.ok(f.calls.audit.every(entry=>entry.outcome==='invalid'));
});

test('database or audit failure cannot leak secrets or produce a success response',async()=>{
  const f=fixture({store:{
    existingTinyFingerprints:async()=>{throw Error('POSTGRES_PASSWORD=PRIVATE_DB');},
    verifiedFingerprint:async()=>{throw Error('PRIVATE');},
    verifyCallback:async()=>{throw Error('PRIVATE');}
  }});
  const response=await call(f.handlers.tinyFingerprints,request({tiny_fingerprints:[]}));
  assert.equal(response.statusCode,503);
  assert.doesNotMatch(JSON.stringify(response.body),/PRIVATE/);
  const auditDown=fixture({audit:async()=>{throw Error('AUDIT_TOKEN_PRIVATE');}});
  const denied=await call(auditDown.handlers.uploadCallback,request(CALLBACK));
  assert.equal(denied.statusCode,503);
  assert.deepEqual(denied.body.data,{});
  assert.doesNotMatch(JSON.stringify(denied.body),/AUDIT_TOKEN_PRIVATE|DJI_0001/);
});

test('Express router defines four DJI endpoints; malformed JSON uses redacted envelope',async t=>{
  const f=fixture();
  const app=express();
  app.use((req,_res,next)=>{
    // Simulates already validated TLS from the reverse proxy; not user headers.
    Object.defineProperty(req,'secure',{value:true});
    next();
  });
  app.use(createPilotMediaRouter(f.config));
  const server=app.listen(0,'127.0.0.1');
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  await new Promise(resolve=>server.once('listening',resolve));
  const url='http://127.0.0.1:'+server.address().port;
  const headers={'x-auth-token':'paired-token','content-type':'application/json'};
  async function post(suffix,body,over={}){
    const resp=await fetch(url+'/media/api/v1/workspaces/'+WS+suffix,{
      method:'POST',headers,body, ...over
    });
    return {status:resp.status,data:await resp.json()};
  }
  const tiny=await post('/files/tiny-fingerprints',JSON.stringify({tiny_fingerprints:['tiny-01']}));
  assert.equal(tiny.status,200);
  assert.deepEqual(tiny.data.data,{tiny_fingerprints:['tiny-01']});
  const fast=await post('/fast-upload',JSON.stringify({fingerprint:'file-01'}));
  assert.equal(fast.status,200);
  const callback=await post('/upload-callback',JSON.stringify(CALLBACK));
  assert.equal(callback.status,200);
  const group=await post('/group-upload-callback',JSON.stringify({
    file_group_id:'group-01',file_count:1,file_uploaded_count:1
  }));
  assert.equal(group.status,200);
  const malformed=await post('/fast-upload','{broken');
  assert.equal(malformed.status,400);
  assert.deepEqual(malformed.data.data,{});
  assert.doesNotMatch(JSON.stringify(malformed.data),/SyntaxError|stack|PRIVATE/);
  assert.equal(ROOT,'/media/api/v1/workspaces/:workspaceId');
});

test('media router cannot be constructed without all dependencies and is not mounted',()=>{
  assert.throws(()=>createPilotMediaHandlers({workspace:WS}));
  assert.throws(()=>createPilotMediaRouter({workspace:WS}));
  const server=fs.readFileSync(path.resolve(__dirname,'../server.js'),'utf8');
  assert.doesNotMatch(server,/pilot-media-http|pilot-media-groups|pilot-media-http-audit/);
});
