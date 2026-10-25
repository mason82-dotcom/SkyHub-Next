'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createPilotMediaStore,createRegisteredStsIssuer,
  prefixForKey,headEvidence,GRACE_MS}=require('../pilot-media-store');
const {createPilotMediaHead}=require('../pilot-media-head');

const WS='e3dea0f5-37f2-4d79-ae58-490af3228069';
const OTHER='203cc94c-aef1-4e0e-a520-05a24be33a31';
const SESSION='a'.repeat(32);
const PREFIX=WS+'/media/'+SESSION;
const NOW=Date.parse('2026-10-22T15:00:00.000Z');
const KEY=PREFIX+'/DJI_0001.JPG';
const grant={provider:'minio',bucket:'dji-cloud',objectKeyPrefix:PREFIX,
  credentials:{accessKeyId:'DO_NOT_PERSIST',accessKeySecret:'HIDDEN',securityToken:'PRIVATE',expire:900}};
const callback={result:0,name:'DJI_0001.JPG',object_key:KEY,fingerprint:'SHA256_OR_DJI_ID',
  ext:{tinny_fingerprint:'tiny_01',file_group_id:'mission1'},metadata:{
    shoot_position:{lat:49.1,lng:8.4},relative_altitude:17}};
const evidence={size:12345,etag:'"test-etag"',lastModified:new Date(NOW+1000)};

function memoryDb(){
  const grants=new Map(),files=new Map(),statements=[];
  const k=(workspace,key)=>workspace+'|'+key;
  return {grants,files,statements,
    async query(sql,args){
      statements.push({sql,args});
      if(sql.startsWith('INSERT INTO dji_pilot_media_grants')){
        const key=k(args[0],args[1]);
        if(grants.has(key))return {rows:[]};
        grants.set(key,{issued_at:args[3],expires_at:args[4]});
        return {rows:[{object_key_prefix:args[1]}]};
      }
      if(sql.startsWith('SELECT issued_at,expires_at FROM dji_pilot_media_grants')){
        const row=grants.get(k(args[0],args[1]));
        return {rows:row?[row]:[]};
      }
      if(sql.startsWith('INSERT INTO dji_pilot_media_verified')){
        const key=k(args[0],args[1]);
        if(files.has(key)||[...files.values()].some(row=>row.workspace_id===args[0]&&
          args[4]!==null&&row.fingerprint===args[4]))
          return {rows:[]};
        const row={workspace_id:args[0],object_key:args[1],grant_prefix:args[2],
          file_name:args[3],fingerprint:args[4],tiny_fingerprint:args[5],
          file_group_id:args[6],size_bytes:args[7],etag:args[8],object_last_modified:args[9]};
        files.set(key,row);
        return {rows:[{object_key:args[1]}]};
      }
      if(sql.startsWith('SELECT object_key,grant_prefix,file_name')){
        return {rows:[...files.values()].filter(row=>row.workspace_id===args[0]&&
          (row.object_key===args[1]||(args[2]!==null&&row.fingerprint===args[2])))};
      }
      if(sql.startsWith('SELECT DISTINCT tiny_fingerprint')){
        return {rows:[...files.values()].filter(row=>row.workspace_id===args[0]&&
          args[1].includes(row.tiny_fingerprint)).map(row=>({fingerprint:row.tiny_fingerprint}))};
      }
      if(sql.startsWith('SELECT 1 FROM dji_pilot_media_verified'))
        return {rows:[...files.values()].some(row=>row.workspace_id===args[0]&&
          row.fingerprint===args[1])?[{one:1}]:[]};
      throw Error('unexpected SQL '+sql);
    }
  };
}

test('only exact workspace and cryptographic 128-bit session determine callback scope',()=>{
  assert.equal(prefixForKey(WS,KEY),PREFIX);
  for(const key of [
    OTHER+'/media/'+SESSION+'/x.jpg',PREFIX,PREFIX+'evil/x.jpg',
    PREFIX+'/../x.jpg',WS+'/media/x/x.jpg',PREFIX+'/x//y',
    '/'+KEY,KEY+'\\evil'])assert.equal(prefixForKey(WS,key),null);
  assert.equal(headEvidence(evidence).size,12345);
  assert.equal(headEvidence({...evidence,lastModified:'garbage'}),null);
  assert.equal(headEvidence({...evidence,size:0}),null);
  assert.equal(GRACE_MS,900000);
});

test('registered STS issuer stores ONLY scope, never any secret, before returning grant',async()=>{
  const db=memoryDb(),store=createPilotMediaStore(db,{clock:()=>NOW});
  const issue=createRegisteredStsIssuer({store,issueGrant:async()=>grant});
  const g=await issue({workspace:WS,principal:{role:'pilot',workspaceId:WS},maxSeconds:900});
  assert.equal(g,grant);
  assert.equal(db.grants.size,1);
  assert.doesNotMatch(JSON.stringify(db.statements),/DO_NOT_PERSIST|HIDDEN|PRIVATE/);
  await assert.rejects(()=>issue({workspace:WS,principal:{role:'pilot',workspaceId:WS},
    maxSeconds:900}),/Duplicate/);
  await assert.rejects(()=>createRegisteredStsIssuer({
    issueGrant:async()=>grant,store:{registerGrant:async()=>{throw Error('DB unreachable');}}
  })({workspace:WS,principal:{role:'pilot',workspaceId:WS},maxSeconds:900}),/DB unreachable/);
  const notUsed=createRegisteredStsIssuer({
    issueGrant:async()=>{throw Error('should not issue');},store
  });
  await assert.rejects(()=>notUsed({workspace:WS,principal:{role:'pilot',workspaceId:OTHER},
    maxSeconds:900}),/context/);
});

test('valid HEAD is required and callback is idempotent',async()=>{
  const db=memoryDb(),store=createPilotMediaStore(db,{clock:()=>NOW+2000});
  await store.registerGrant({workspace:WS,grant});
  // Fixed clock for grant issue and S3 evidence; metadata timestamp is later.
  db.grants.get(WS+'|'+PREFIX).issued_at=new Date(NOW);
  db.grants.get(WS+'|'+PREFIX).expires_at=new Date(NOW+900000);
  let checked=0;
  const headObject=async q=>{checked++;assert.deepEqual(q,{bucket:'dji-cloud',key:KEY});return evidence;};
  assert.deepEqual(await store.verifyCallback({workspace:WS,callback,headObject}),
    {status:'verified'});
  assert.deepEqual(await store.verifyCallback({workspace:WS,callback,headObject}),
    {status:'duplicate'});
  assert.equal(checked,2);
  assert.equal(db.files.size,1);
  assert.deepEqual(await store.existingTinyFingerprints({
    workspace:WS,body:{tiny_fingerprints:['unknown','tiny_01','tiny_01']}
  }),['tiny_01']);
  assert.deepEqual(await store.verifiedFingerprint({
    workspace:WS,body:{fingerprint:'SHA256_OR_DJI_ID'}}),{exists:true});
  assert.deepEqual(await store.verifiedFingerprint({
    workspace:OTHER,body:{fingerprint:'SHA256_OR_DJI_ID'}}),{exists:false});
  assert.doesNotMatch(JSON.stringify(db.statements),/HIDDEN|DO_NOT_PERSIST/);
});

test('unregistered, failed, stale and missing HEAD callbacks never produce rows',async()=>{
  const db=memoryDb(),store=createPilotMediaStore(db,{clock:()=>NOW+1000});
  let calls=0;
  const headObject=async()=>{calls++;return evidence;};
  assert.deepEqual(await store.verifyCallback({workspace:WS,callback,headObject}),
    {status:'unregistered'});
  assert.equal(calls,0);
  await store.registerGrant({workspace:WS,grant});
  assert.deepEqual(await store.verifyCallback({workspace:WS,
    callback:{...callback,result:3},headObject}),{status:'failed-upload'});
  assert.deepEqual(await store.verifyCallback({workspace:WS,
    callback:{...callback,object_key:OTHER+'/media/'+SESSION+'/x'},headObject}),
    {status:'unregistered'});
  assert.deepEqual(await store.verifyCallback({workspace:WS,
    callback,headObject:async()=>null}),{status:'unverified'});
  assert.deepEqual(await store.verifyCallback({workspace:WS,
    callback,headObject:async()=>({...evidence,lastModified:new Date(NOW-60000)})}),
    {status:'unverified'});
  assert.equal(db.files.size,0);
});

test('conflicting fingerprint or file details cannot overwrite an existing media record',async()=>{
  const db=memoryDb(),store=createPilotMediaStore(db,{clock:()=>NOW+1000});
  await store.registerGrant({workspace:WS,grant});
  const headObject=async()=>evidence;
  assert.deepEqual(await store.verifyCallback({workspace:WS,callback,headObject}),
    {status:'verified'});
  assert.deepEqual(await store.verifyCallback({workspace:WS,callback:{
    ...callback,name:'DIFFERENT.jpg'},headObject}),{status:'conflict'});
  assert.deepEqual(await store.verifyCallback({workspace:WS,callback:{
    ...callback,object_key:PREFIX+'/DIFFERENT.jpg'},headObject}),
    {status:'conflict'});
  assert.equal(db.files.size,1);
});

test('untrusted callback fields and invalid fingerprints never query storage',async()=>{
  const db=memoryDb(),store=createPilotMediaStore(db,{clock:()=>NOW});
  await assert.rejects(()=>store.verifyCallback({workspace:WS,callback:{
    ...callback,object_key:KEY+'/../../x'},headObject:async()=>{throw Error('must not read');}
  }));
  await assert.rejects(()=>store.verifiedFingerprint({
    workspace:WS,body:{fingerprint:'../../secret'}}));
  await assert.rejects(()=>store.existingTinyFingerprints({
    workspace:WS,body:{tiny_fingerprints:['bad slash/']}}));
  assert.equal(db.statements.length,0);
});

test('S3 HEAD adapter only uses the trusted bucket, and refuses failed verification',async()=>{
  let captured;
  const verifier=createPilotMediaHead({send:async command=>{
    captured=command;return {
      ContentLength:42,ETag:'"etag"',LastModified:new Date(NOW+1000)
    };
  }});
  assert.deepEqual(await verifier({bucket:'dji-cloud',key:KEY}),{
    size:42,etag:'"etag"',lastModified:new Date(NOW+1000)
  });
  assert.equal(captured.constructor.name,'HeadObjectCommand');
  assert.deepEqual(captured.input,{Bucket:'dji-cloud',Key:KEY});
  await assert.rejects(()=>verifier({bucket:'farming',key:KEY}),/Invalid/);
  const absent=createPilotMediaHead({send:async()=>{throw Object.assign(
    Error('missing'),{name:'NotFound',$metadata:{httpStatusCode:404}});}});
  assert.equal(await absent({bucket:'dji-cloud',key:KEY}),null);
  const forbidden=createPilotMediaHead({send:async()=>{throw Object.assign(
    Error('secret access log'),{name:'AccessDenied',$metadata:{httpStatusCode:403}});}});
  await assert.rejects(()=>forbidden({bucket:'dji-cloud',key:KEY}),/verification unavailable/);
});

test('no live backend import, listener, command or raw media upload',()=>{
  const server=fs.readFileSync(path.resolve(__dirname,'../server.js'),'utf8');
  assert.doesNotMatch(server,/pilot-media-(store|head)/);
  const source=fs.readFileSync(path.resolve(__dirname,'../pilot-media-store.js'),'utf8');
  assert.doesNotMatch(source,/process\.env|console\.(log|error)|mqtt\.connect|PutObjectCommand/);
});
