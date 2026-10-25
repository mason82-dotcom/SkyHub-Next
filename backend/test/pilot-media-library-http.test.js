'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const fs=require('node:fs');
const path=require('node:path');
const {createPilotMediaLibraryHandlers,createPilotMediaLibraryRouter}=require('../pilot-media-library-http');
const {createPilotMediaRateLimiter}=require('../pilot-media-rate-limit');
const WS='e3dea0f5-37f2-4d79-ae58-490af3228069';
const OTHER='203cc94c-aef1-4e0e-a520-05a24be33a31';
const ID='33670000-0000-4000-8000-000000000001';
const OPERATOR={role:'operator',workspaceId:WS};
const TOKEN='test-private-token';
function fixture(over={}){
  const called={list:0,detail:0,group:0,head:0,audit:[],rate:[]};
  const deps={
    workspace:WS,
    authorize:async value=>value===TOKEN?OPERATOR:null,
    allowRead:async({workspace,principal,operation})=>{
      called.rate.push({workspace,principal,operation});
      return true;
    },
    audit:async entry=>{called.audit.push(entry);},
    library:{
      async list({workspace,limit,cursor}){
        called.list++;assert.equal(workspace,WS);
        assert.ok(limit>0&&limit<=100);
        assert.ok(cursor===null||typeof cursor==='string');
        return {schema:'skyhub-pilot-media-library-v1',items:[],nextCursor:null};
      },
      async detail({workspace,id,headObject}){
        called.detail++;assert.equal(workspace,WS);
        if(id!==ID)return {status:'not-found'};
        called.head++;
        await headObject({bucket:'dji-cloud',key:'private/key'});
        return {status:'ok',item:{id,verifiedAt:'2026-10-22T15:00:00Z'}};
      },
      async m3mGroup({workspace,groupId}){
        called.group++;assert.equal(workspace,WS);
        return groupId==='mission-1'?{status:'ok',report:{
          schema:'skyhub-m3m-library-hints-v1',examined:4,ndviReady:false
        }}:{status:'not-found'};
      }
    },
    headObject:async()=>({size:1,etag:'"etag"',
      lastModified:new Date('2026-10-22T15:00:00Z')}),
    ...over
  };
  return {called,config:deps,handlers:createPilotMediaLibraryHandlers(deps)};
}
function request(over={}){
  return {secure:true,headers:{'x-auth-token':TOKEN},params:{workspaceId:WS},
    query:{},...over};
}
function response(){
  return {statusCode:200,headers:{},body:null,
    set(k,v){this.headers[k.toLowerCase()]=v;return this;},
    status(n){this.statusCode=n;return this;},
    json(v){this.body=v;return v;}};
}
async function invoke(fn,req){const res=response();await fn(req,res);return res;}

test('Pilot and Operator can read only their workspace with audited limiting',async()=>{
  const f=fixture();
  const r=await invoke(f.handlers.list,request({query:{limit:'3'}}));
  assert.equal(r.statusCode,200);
  assert.equal(r.body.code,0);
  assert.equal(r.body.data.schema,'skyhub-pilot-media-library-v1');
  assert.equal(r.headers['cache-control'],'no-store');
  assert.deepEqual(f.called.rate,[{workspace:WS,principal:OPERATOR,operation:'library_list'}]);
  assert.deepEqual(f.called.audit,[{workspace:WS,action:'list',outcome:'ok'}]);
  assert.doesNotMatch(JSON.stringify(f.called.audit),/test-private-token|objectKey|cursor/);
  const pilot=fixture({authorize:async()=>({role:'pilot',workspaceId:WS})});
  assert.equal((await invoke(pilot.handlers.list,request())).statusCode,200);
});

test('details are only returned after library-supplied current S3 HEAD',async()=>{
  const f=fixture();
  const good=await invoke(f.handlers.detail,request({params:{workspaceId:WS,assetId:ID}}));
  assert.equal(good.statusCode,200);
  assert.equal(good.body.data.item.id,ID);
  assert.equal(f.called.head,1);
  const missing=await invoke(f.handlers.detail,request({
    params:{workspaceId:WS,assetId:'33670000-0000-4000-8000-000000000099'}
  }));
  assert.equal(missing.statusCode,404);
  const stale=fixture({library:{...f.config.library,
    detail:async()=>({status:'changed'})}});
  assert.equal((await invoke(stale.handlers.detail,request({
    params:{workspaceId:WS,assetId:ID}
  }))).statusCode,409);
});

test('M3M grouped summary gives filename hints but not capture UUID or radiometric status',async()=>{
  const f=fixture();
  const r=await invoke(f.handlers.m3mGroup,request({
    params:{workspaceId:WS,groupId:'mission-1'}
  }));
  assert.equal(r.statusCode,200);
  assert.equal(r.body.data.ndviReady,false);
  assert.equal(f.called.audit[0].action,'m3m_group');
  assert.equal((await invoke(f.handlers.m3mGroup,request({
    params:{workspaceId:WS,groupId:'not-found'}
  }))).statusCode,404);
});

test('authorization prevents access across workspace, HTTP, role or forged headers',async()=>{
  let reads=0;
  const f=fixture({authorize:async()=>{reads++;return OPERATOR;}});
  for(const [req,code] of [
    [request({secure:false,headers:{'x-auth-token':TOKEN,'x-forwarded-proto':'https'}}),403],
    [request({params:{workspaceId:OTHER}}),404],
    [request({headers:{'x-auth-token':[TOKEN]}}),401],
    [request({headers:{'x-auth-token':''}}),401]
  ]){
    const res=await invoke(f.handlers.list,req);
    assert.equal(res.statusCode,code);
    assert.deepEqual(res.body.data,{});
  }
  assert.equal(reads,0);
  const denied=fixture({authorize:async()=>({role:'operator',workspaceId:OTHER})});
  assert.equal((await invoke(denied.handlers.list,request())).statusCode,403);
  const bool=fixture({authorize:async()=>true});
  assert.equal((await invoke(bool.handlers.list,request())).statusCode,403);
  const admin=fixture({authorize:async()=>({role:'admin',workspaceId:WS})});
  assert.equal((await invoke(admin.handlers.list,request())).statusCode,403);
});

test('invalid query and rate limit reject before library reads',async()=>{
  const f=fixture();
  for(const query of [{limit:'0'},{limit:'101'},{limit:['1','2']},
    {role:'admin'},{cursor:['token','other']},{cursor:'x'.repeat(513)}]){
    const r=await invoke(f.handlers.list,request({query}));
    assert.equal(r.statusCode,400);
  }
  const rate=fixture({allowRead:async()=>false});
  assert.equal((await invoke(rate.handlers.list,request())).statusCode,429);
  assert.equal(rate.called.list,0);
  assert.equal(rate.called.audit[0].outcome,'denied');
  const down=fixture({allowRead:async()=>{throw Error('REDIS_PRIVATE');}});
  const failed=await invoke(down.handlers.list,request());
  assert.equal(failed.statusCode,503);
  assert.doesNotMatch(JSON.stringify(failed.body),/REDIS_PRIVATE/);
});

test('data and audit outages are redacted and fail closed',async()=>{
  const bad=fixture({library:{
    list:async()=>{throw Error('PRIVATE_POSTGRES_PASSWORD');},
    detail:async()=>{throw Error('PRIVATE_AWS_KEY');},
    m3mGroup:async()=>{throw Error('SECRET_XMP_CAPTURE_UUID');}
  }});
  const result=await invoke(bad.handlers.list,request());
  assert.equal(result.statusCode,503);
  assert.doesNotMatch(JSON.stringify(result.body),/PRIVATE|POSTGRES|AWS/);
  const audit=fixture({audit:async()=>{throw Error('PRIVATE_AUDIT_KEY');}});
  const denied=await invoke(audit.handlers.list,request());
  assert.equal(denied.statusCode,503);
  assert.doesNotMatch(JSON.stringify(denied.body),/PRIVATE_AUDIT_KEY/);
});

test('Redis library read operations accept operator but never elevate writes',async()=>{
  const keys=new Map();
  const redis={status:'ready',async eval(_script,_n,key){
    keys.set(key,(keys.get(key)||0)+1);return keys.get(key);
  }};
  const allow=createPilotMediaRateLimiter(redis,{
    clock:()=>Date.parse('2026-10-22T15:00:00Z')});
  for(const action of ['library_list','library_detail','library_m3m_group'])
    assert.equal(await allow({workspace:WS,principal:OPERATOR,operation:action}),true);
  await assert.rejects(()=>allow({workspace:WS,principal:OPERATOR,operation:'upload_callback'}));
});

test('Express GET router works and does not add any production listener',async t=>{
  const f=fixture();
  const app=express();
  app.use((req,_res,next)=>{Object.defineProperty(req,'secure',{value:true});next();});
  app.use(createPilotMediaLibraryRouter(f.config));
  const server=app.listen(0,'127.0.0.1');
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  await new Promise(resolve=>server.once('listening',resolve));
  const url='http://127.0.0.1:'+server.address().port+
    '/api/media-library/v1/workspaces/'+WS;
  for(const [suffix,status] of [
    ['/assets?limit=2',200],['/assets/'+ID,200],
    ['/groups/mission-1/m3m-hints',200],['/groups/missing/m3m-hints',404],
    ['/assets?limit=0',400],['/assets?cursor=INVALID',200]
  ]){
    const response=await fetch(url+suffix,{headers:{'x-auth-token':TOKEN}});
    assert.equal(response.status,status,suffix);
    const data=await response.json();
    assert.equal(typeof data.code,'number');
  }
  const unauth=await fetch(url+'/assets');
  assert.equal(unauth.status,401);
  const source=fs.readFileSync(path.resolve(__dirname,'../server.js'),'utf8');
  assert.doesNotMatch(source,/pilot-media-library/);
});
