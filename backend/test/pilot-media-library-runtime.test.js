'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const {createPilotMediaLibraryRuntime}=require('../pilot-media-library-runtime');

const WS='e3dea0f5-37f2-4d79-ae58-490af3228069';
const OTHER='203cc94c-aef1-4e0e-a520-05a24be33a31';
const env={SKYHUB_MEDIA_ENABLED:'true',SKYHUB_MEDIA_LIBRARY_ENABLED:'true',
  SKYHUB_MEDIA_LIBRARY_CURSOR_SECRET:'ab'.repeat(32)};
function deps(over={}){
  const calls={reads:0,audits:[],heads:0};
  const settings={env,db:{async query(sql,args){
    if(sql.startsWith('SELECT')){calls.reads++;return {rows:[]};}
    if(sql.startsWith('INSERT INTO dji_pilot_media_library_audit')){
      calls.audits.push(args);return {rows:[]};
    }
    throw Error('Unexpected SQL');
  }},redis:{status:'ready',eval:async()=>1},
  authorize:async token=>token==='pilot-token'?{role:'pilot',workspaceId:WS}:null,
  storage:{headObject:async()=>{calls.heads++;return null;}},
  pilot:{ready:true,workspaceId:WS},...over};
  return {settings,calls};
}

test('runtime refuses incomplete feature configuration before mounting',()=>{
  const {settings}=deps();
  assert.equal(createPilotMediaLibraryRuntime({
    ...settings,env:{...env,SKYHUB_MEDIA_LIBRARY_ENABLED:'false'}}),null);
  for(const change of [
    {env:{...env,SKYHUB_MEDIA_ENABLED:'false'}},
    {env:{...env,SKYHUB_MEDIA_LIBRARY_CURSOR_SECRET:'too-short'}},
    {env:{...env,SKYHUB_VIEW_TOKEN:env.SKYHUB_MEDIA_LIBRARY_CURSOR_SECRET}},
    {env:{...env,SKYHUB_PILOT_ACCESS_TOKEN:env.SKYHUB_MEDIA_LIBRARY_CURSOR_SECRET}},
    {pilot:{ready:false,workspaceId:WS}},
    {storage:{}},
    {db:null}
  ])assert.throws(()=>createPilotMediaLibraryRuntime({...settings,...change}));
});

test('mounted runtime requires both view and workspace-bound Pilot identity, rate limit and audit',async t=>{
  const {settings,calls}=deps();
  const router=createPilotMediaLibraryRuntime(settings);
  const app=express();
  app.use((req,res,next)=>{
    Object.defineProperty(req,'secure',{value:true});
    return req.headers.authorization==='Bearer view-token'?next():res.sendStatus(401);
  });
  app.use(router);
  const server=app.listen(0,'127.0.0.1');
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port+
    '/api/media-library/v1/workspaces/';
  const headers={authorization:'Bearer view-token','x-auth-token':'pilot-token'};
  const request=(url,h=headers)=>fetch(url,{headers:h});
  assert.equal((await request(base+WS+'/assets',{...headers,authorization:'bad'})).status,401);
  assert.equal((await request(base+WS+'/assets',{...headers,'x-auth-token':'bad'})).status,403);
  assert.equal((await request(base+OTHER+'/assets')).status,404);
  assert.equal(calls.reads,0);
  const response=await request(base+WS+'/assets?limit=1');
  assert.equal(response.status,200);
  const body=await response.json();
  assert.equal(body.data.items.length,0);
  assert.deepEqual(calls.audits,[[WS,'list','ok']]);
  assert.equal(calls.reads,1);
  assert.equal(calls.heads,0);
  assert.doesNotMatch(JSON.stringify(body),/pilot-token|view-token|abababab/);
});
