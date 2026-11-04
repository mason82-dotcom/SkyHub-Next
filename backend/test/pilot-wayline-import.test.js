'use strict';
// Pilot 2 → SkyHub route upload (DJI 1.18 waypointfile-upload-result-report): scope, size, WPML validation, no auto-release.
const test=require('node:test');
const assert=require('node:assert/strict');
const {Readable}=require('node:stream');
const {createPilotWaylineImport,CODES,parseCallback,cleanName}=require('../pilot-wayline-import');
const {DJI_NAME}=require('../wpml-mission-store');
const {createDjiWaylineRouter,UPLOAD_DISABLED_CODE}=require('../dji-wayline-http');

const WS='09016a46-e315-441d-bf4a-2c67e0903e11';
const KEY=WS+'/media/'+'a'.repeat(32)+'/route.kmz';
const KMZ=Buffer.from('PK\u0003\u0004'+'x'.repeat(100));

function setup({grant='verified',size=KMZ.length,bytes=KMZ,put,getError}={}){
  const calls={put:[],get:[],audit:[]};
  const media={async verifyGrantedObject({workspace,key}){
    assert.equal(workspace,WS);
    return grant==='verified'?{status:'verified',bucket:'dji-cloud',prefix:WS+'/media/'+'a'.repeat(32),evidence:{size,etag:'"e"',lastModified:1}}:{status:grant};
  }};
  const store={async put(buf,opts){calls.put.push({buf,opts});if(put)return put(buf,opts);return {id:'11111111-1111-4111-8111-111111111111',name:opts.name,created:true};}};
  const importUpload=createPilotWaylineImport({workspace:WS,media,headObject:async()=>null,store,
    getObject:async(bucket,key,opts)=>{calls.get.push({bucket,key,opts});if(getError)throw getError;return {body:Readable.from([bytes])};},
    audit:e=>calls.audit.push(e),log:()=>{}});
  return {importUpload,calls};
}

test('callback parsing: object_key required and relative, name cleaned, metadata ignored',()=>{
  assert.equal(parseCallback({}),null);
  assert.equal(parseCallback({object_key:'/abs/x.kmz'}),null);
  assert.equal(parseCallback({object_key:'a/../b.kmz'}),null);
  assert.deepEqual(parseCallback({object_key:KEY,name:' Michaelsberg.kmz ',metadata:{drone_model_key:'0-99-1'}}),{objectKey:KEY,name:'Michaelsberg'});
  assert.equal(parseCallback({object_key:KEY,name:'x'.repeat(200)}).name.length,64);
  // DJI name rule: Pilot names with _ . : etc. are cleaned instead of failing as "invalid WPML".
  for(const raw of ['Feld_Nord','Mission 1.2','A:B/C|D?E*F<G>H"I\\J','x'.repeat(80)])
    assert.match(cleanName(raw),DJI_NAME,raw);
  assert.equal(cleanName('Feld_Nord.kmz'),'Feld Nord');
});

test('a verified upload is stored write-once under its name by "Pilot 2"; callback metadata is not trusted',async()=>{
  const x=setup();
  const r=await x.importUpload({role:'pilot',userId:'pilot'},{object_key:KEY,name:'Michaelsberg',metadata:{drone_model_key:'0-77-2'}});
  assert.equal(r.created,true);
  assert.deepEqual(x.calls.get,[{bucket:'dji-cloud',key:KEY,opts:{ifMatch:'"e"'}}]);   // read bound to the HEAD ETag
  assert.equal(x.calls.put.length,1);
  assert.deepEqual(x.calls.put[0].opts,{name:'Michaelsberg',username:'Pilot 2'});
  assert.ok(x.calls.put[0].buf.equals(KMZ));
  assert.equal(x.calls.audit.at(-1).action,'wayline-import');
});

test('objects outside a registered, valid STS scope are refused without reading them',async()=>{
  for(const status of ['unregistered','expired','unverified']){
    const x=setup({grant:status});
    await assert.rejects(x.importUpload({},{object_key:KEY}),e=>e.code===CODES.scope);
    assert.equal(x.calls.get.length,0);assert.equal(x.calls.put.length,0);
  }
});

test('size cap: HEAD over 12 MiB is refused before reading, a longer stream is cut off',async()=>{
  let x=setup({size:13*1024*1024});
  await assert.rejects(x.importUpload({},{object_key:KEY}),e=>e.code===CODES.tooLarge);
  assert.equal(x.calls.get.length,0);
  x=setup({bytes:Buffer.alloc(12*1024*1024+1)});
  await assert.rejects(x.importUpload({},{object_key:KEY}),e=>e.code===CODES.tooLarge);
  assert.equal(x.calls.put.length,0);
});

test('store rejections map to clear codes (invalid WPML, name taken, storage down)',async()=>{
  const err=(status,message)=>Object.assign(new Error(message),{status});
  let x=setup({put:()=>{throw err(422,'WPML validation failed');}});
  await assert.rejects(x.importUpload({},{object_key:KEY,name:'A'}),e=>e.code===CODES.rejected&&/WPML/.test(e.message));
  x=setup({put:()=>{throw err(409,'A different wayline with this name already exists');}});
  await assert.rejects(x.importUpload({},{object_key:KEY,name:'A'}),e=>e.code===CODES.nameTaken);
  x=setup({put:()=>{throw new Error('socket hang up');}});
  await assert.rejects(x.importUpload({},{object_key:KEY,name:'A'}),e=>e.code===CODES.unavailable&&!/socket/.test(e.message));
});

// HTTP: the router answers DJI-style; without an importer the old refusal stays.
async function call(router,body){
  const express=require('express'),http=require('node:http');
  const app=express();app.set('trust proxy',true);app.use(express.json());
  app.use((req,res,next)=>{Object.defineProperty(req,'secure',{value:true});next();});
  app.use(router);
  const server=http.createServer(app);await new Promise(r=>server.listen(0,'127.0.0.1',r));
  try{
    const res=await fetch('http://127.0.0.1:'+server.address().port+'/wayline/api/v1/workspaces/'+WS+'/upload-callback',
      {method:'POST',headers:{'Content-Type':'application/json','x-auth-token':'t'},body:JSON.stringify(body)});
    return {status:res.status,body:await res.json()};
  }finally{server.close();}
}
const deps={workspace:WS,authorize:async()=>({role:'pilot',workspaceId:WS,userId:'pilot'}),
  store:{all:async()=>[],downloadUrl:async()=>'x'},favorites:{list:async()=>new Set()},log:()=>{}};

test('upload-callback over HTTP: success code 0, refusal with SkyHub code, default still disabled',async()=>{
  const x=setup();
  let r=await call(createDjiWaylineRouter({...deps,importUpload:x.importUpload}),{object_key:KEY,name:'See'});
  assert.equal(r.status,200);assert.equal(r.body.code,0);
  const y=setup({grant:'expired'});
  r=await call(createDjiWaylineRouter({...deps,importUpload:y.importUpload}),{object_key:KEY});
  assert.equal(r.body.code,CODES.scope);
  r=await call(createDjiWaylineRouter(deps),{object_key:KEY});
  assert.equal(r.body.code,UPLOAD_DISABLED_CODE);
});

test('fallback name without a Pilot name passes the DJI name rule',async()=>{
  const x=setup();
  await x.importUpload({userId:'p'},{object_key:KEY});
  assert.match(x.calls.put[0].opts.name,DJI_NAME);
  assert.match(x.calls.put[0].opts.name,/^Pilot 2 \d{4}-\d{2}-\d{2} \d{2}h\d{2}$/);
});

test('object changed or gone after the check is not imported; size must match the HEAD evidence',async()=>{
  for(const status of [404,412]){
    const x=setup({getError:Object.assign(new Error('x'),{status})});
    await assert.rejects(x.importUpload({},{object_key:KEY}),e=>e.code===CODES.scope);
    assert.equal(x.calls.put.length,0);
  }
  const y=setup({size:KMZ.length+5});
  await assert.rejects(y.importUpload({},{object_key:KEY}),e=>e.code===CODES.scope);
  assert.equal(y.calls.put.length,0);
});

test('repeated callbacks for the same object are answered from memory; a pilot is limited to 30 per minute',async()=>{
  const x=setup();
  await x.importUpload({userId:'p'},{object_key:KEY,name:'See'});
  const again=await x.importUpload({userId:'p'},{object_key:KEY,name:'See'});
  assert.equal(again.created,false);
  assert.equal(x.calls.put.length,1,'no second read/validation');
  const y=setup();
  for(let i=0;i<30;i++)await y.importUpload({userId:'q'},{object_key:KEY,name:'R '+i});
  await assert.rejects(y.importUpload({userId:'q'},{object_key:KEY,name:'zu viel'}),e=>e.code===CODES.busy);
  await y.importUpload({userId:'other'},{object_key:KEY,name:'anderer Pilot'});
});

test('only import errors reach Pilot 2; other errors stay generic',async()=>{
  const leaky=async()=>{throw Object.assign(new Error('internal storage secret path'),{code:503});};
  const r=await call(createDjiWaylineRouter({...deps,importUpload:leaky}),{object_key:KEY});
  assert.equal(r.status,503);
  assert.doesNotMatch(JSON.stringify(r.body),/secret/);
});
