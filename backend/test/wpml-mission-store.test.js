'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const express=require('express');
const planner=require('../../frontend/public/wpml-editor-core');
const {createWpmlMissionStore,createWpmlMissionRouter,storeConfiguration,
  presignGetUrl,waylineId}=require('../wpml-mission-store');

function kmz(name='Store test',lat=49.1){
  return Buffer.from(planner.build({name,model:'mavic3m',speed:5,takeoffHeight:30,
    finishAction:'goHome',timestamp:1792573200000,
    waypoints:[{lat,lon:8.6,height:50,photo:true},{lat:lat+0.001,lon:8.601,height:50}]}).kmz);
}
// Minimal in-memory S3 with conditional-write semantics (If-None-Match: *).
function fakeS3(){
  const objects=new Map();const calls=[];
  const notFound=()=>Object.assign(new Error('NotFound'),{name:'NotFound',$metadata:{httpStatusCode:404}});
  return {objects,calls,async send(command){
    const name=command.constructor.name,input=command.input;
    calls.push({name,input});
    if(name==='PutObjectCommand'){
      if(input.IfNoneMatch==='*'&&objects.has(input.Key))
        throw Object.assign(new Error('pre'),{name:'PreconditionFailed',$metadata:{httpStatusCode:412}});
      assert.equal(input.ContentMD5,crypto.createHash('md5').update(input.Body).digest('base64'));
      objects.set(input.Key,{body:Buffer.from(input.Body),meta:input.Metadata,at:new Date(1792573200000)});
      return {};
    }
    if(name==='HeadObjectCommand'){
      const o=objects.get(input.Key);if(!o)throw notFound();
      return {Metadata:o.meta,ContentLength:o.body.length,LastModified:o.at};
    }
    if(name==='GetObjectCommand'){
      const o=objects.get(input.Key);
      if(!o)throw Object.assign(new Error('NoSuchKey'),{name:'NoSuchKey',$metadata:{httpStatusCode:404}});
      return {Body:{transformToByteArray:async()=>new Uint8Array(o.body)},Metadata:o.meta};
    }
    if(name==='ListObjectsV2Command'){
      const keys=[...objects.keys()].filter(k=>k.startsWith(input.Prefix)).slice(0,input.MaxKeys);
      return {IsTruncated:false,Contents:keys.map(Key=>({Key}))};
    }
    throw new Error('unexpected '+name);
  }};
}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test('configuration reuses the existing backend MinIO account and validates endpoints',()=>{
  const base={SKYHUB_S3_ENDPOINT:'http://skyhub-minio:9000',
    SKYHUB_S3_ACCESS_KEY:'backend-reader',SKYHUB_S3_SECRET_KEY:'x'.repeat(40)};
  const cfg=storeConfiguration(base);
  assert.equal(cfg.bucket,'skyhub-wpml');
  assert.equal(cfg.accessKeyId,'backend-reader');
  assert.equal(storeConfiguration({...base,SKYHUB_WPML_S3_ACCESS_KEY:'own',SKYHUB_WPML_S3_SECRET_KEY:'y'.repeat(40)})
    .accessKeyId,'own');
  assert.equal(storeConfiguration({...base,SKYHUB_PILOT_MEDIA_S3_PUBLIC_ENDPOINT:'https://pi.lan:9446'}).publicEndpoint,
    'https://pi.lan:9446');
  assert.throws(()=>storeConfiguration({...base,SKYHUB_S3_SECRET_KEY:''}),/credentials/);
  assert.throws(()=>storeConfiguration({...base,SKYHUB_PILOT_UPLOAD_S3_ACCESS_KEY:'backend-reader'}),/Pilot 2 upload/);
  assert.throws(()=>storeConfiguration({...base,SKYHUB_S3_ENDPOINT:'ftp://x'}),/endpoint/);
  assert.throws(()=>storeConfiguration({...base,SKYHUB_WPML_S3_PUBLIC_ENDPOINT:'https://x/path'}),/public/);
  assert.throws(()=>storeConfiguration({...base,SKYHUB_WPML_S3_BUCKET:'Bad_Bucket'}),/bucket/);
});

test('wayline ids are deterministic RFC 9562 v8 UUIDs of the content hash',()=>{
  const sha='ab'.repeat(32);
  assert.match(waylineId(sha),UUID);
  assert.equal(waylineId(sha),waylineId(sha));
  assert.notEqual(waylineId(sha),waylineId('cd'.repeat(32)));
});

test('valid KMZ is stored write-once with DJI wayline metadata and read back intact',async()=>{
  const s3=fakeS3();
  const store=createWpmlMissionStore({client:s3,env:{}});
  const bytes=kmz();
  const first=await store.put(bytes,{name:'Feld Nord Ü',username:'SkyHub'});
  assert.match(first.id,UUID);
  assert.equal(first.objectKey,'missions/'+first.id+'.kmz');
  assert.equal(first.created,true);
  assert.equal(first.flightReady,false);
  assert.equal(first.dispatched,false);
  // DJI sample: sign = MD5 hex of the KMZ; device keys domain-type-subtype.
  assert.equal(first.sign,crypto.createHash('md5').update(bytes).digest('hex'));
  assert.equal(first.droneModelKey,'0-77-2');
  assert.deepEqual(first.payloadModelKeys,['1-68-0']);
  assert.deepEqual(first.templateTypes,[0]);
  assert.equal(first.validation.aircraft,'Mavic 3M');
  const put=s3.calls.find(c=>c.name==='PutObjectCommand').input;
  assert.equal(put.IfNoneMatch,'*');
  assert.equal(put.ContentType,'application/vnd.google-earth.kmz');
  for(const v of Object.values(put.Metadata))assert.match(v,/^[\x20-\x7e]*$/,'S3 metadata must stay ASCII');
  const again=await store.put(bytes,{name:'Feld Nord Ü'});
  assert.equal(again.created,false);
  assert.equal(again.id,first.id);
  assert.equal(s3.objects.size,1);
  const listed=await store.list();
  assert.equal(listed.pagination.total,1);
  assert.equal(listed.list[0].name,'Feld Nord Ü');
  assert.equal(listed.list[0].waypointCount,2);
  const loaded=await store.get(first.id);
  assert.deepEqual(loaded.bytes,bytes);
  assert.deepEqual(await store.duplicateNames(['Feld Nord Ü','Neu']),['Feld Nord Ü']);
});

test('explicit ancestry persists as immutable metadata; unrelated legacy files remain roots',async()=>{
  const s3=fakeS3();
  const store=createWpmlMissionStore({client:s3,env:{}});
  const root=await store.put(kmz('Root',49.1),{name:'Farm original'});
  assert.equal(root.parentId,null);
  assert.equal(root.rootId,root.id);
  assert.equal(root.generation,1);
  const childBytes=kmz('Child',49.2);
  const child=await store.put(childBytes,{name:'Farm Revision Two',parentId:root.id});
  assert.equal(child.parentId,root.id);
  assert.equal(child.rootId,root.id);
  assert.equal(child.generation,2);
  const third=await store.put(kmz('Third',49.3),
    {name:'Farm Revision Three',parentId:child.id});
  assert.equal(third.parentId,child.id);
  assert.equal(third.rootId,root.id);
  assert.equal(third.generation,3);
  assert.equal((await store.describe(child.id)).parentId,root.id);
  assert.equal((await store.list()).list.find(x=>x.id===third.id).generation,3);
  const unchanged=await store.get(root.id);
  assert.deepEqual(unchanged.bytes,kmz('Root',49.1));
  const repeated=await store.put(childBytes,{name:'Farm Revision Two',parentId:root.id});
  assert.equal(repeated.created,false);
  assert.equal(s3.objects.size,3,'lineage must not rewrite existing KMZ');
});

test('ancestry rejects fabricated, missing, cross-aircraft and conflicting parents',async()=>{
  const s3=fakeS3(),store=createWpmlMissionStore({client:s3,env:{}});
  const root=await store.put(kmz('Root'),{name:'Root'});
  const missing='aaaaaaaa-aaaa-8aaa-8aaa-aaaaaaaaaaaa';
  await assert.rejects(store.put(kmz('X',49.2),{name:'Missing',parentId:'bad'}),
    e=>e.status===400);
  await assert.rejects(store.put(kmz('X',49.2),{name:'Missing',parentId:missing}),
    e=>e.status===404);
  await assert.rejects(store.put(kmz('Root'),{name:'Root',parentId:root.id}),
    e=>e.status===409,'self-reference rejected');
  const other=Buffer.from(planner.build({name:'Other aircraft',model:'mavic3e',speed:5,
    takeoffHeight:30,finishAction:'goHome',timestamp:1792573200000,
    waypoints:[{lat:49.2,lon:8.6,height:50,photo:false},
      {lat:49.201,lon:8.601,height:50,photo:false}]}).kmz);
  await assert.rejects(store.put(other,{name:'Other aircraft',parentId:root.id}),
    e=>e.status===422,'aircraft cannot be changed within one lineage');
  const childBytes=kmz('Child',49.2);
  const child=await store.put(childBytes,{name:'Second',parentId:root.id});
  const unrelated=await store.put(kmz('Unrelated',49.3),{name:'Separate'});
  await assert.rejects(store.put(childBytes,{name:'Second',parentId:unrelated.id}),
    e=>e.status===409,'cannot claim false parent on idempotent reupload');
  assert.equal((await store.describe(child.id)).parentId,root.id);
  assert.equal(s3.objects.size,3);
});

test('DJI naming rules: required, no reserved characters, unique per library',async()=>{
  const s3=fakeS3();
  const store=createWpmlMissionStore({client:s3,env:{}});
  for(const name of [undefined,'','  ','a.b','a_b','a/b','a:b','x'.repeat(65),'a\u0000b'])
    await assert.rejects(store.put(kmz(),{name}),e=>e.status===400,String(name));
  await store.put(kmz('a',49.1),{name:'Hof'});
  await assert.rejects(store.put(kmz('b',49.2),{name:'Hof'}),e=>e.status===409);
  assert.equal(s3.calls.filter(c=>c.name==='PutObjectCommand').length,1);
});

test('invalid archives and invalid WPML are rejected before any write',async()=>{
  const s3=fakeS3();
  const store=createWpmlMissionStore({client:s3,env:{}});
  await assert.rejects(store.put(Buffer.from('not a zip at all, definitely'),{name:'x'}),e=>e.status===422);
  await assert.rejects(store.put(Buffer.alloc(3),{name:'x'}),e=>e.status===400);
  const docs=planner.documents({name:'b',model:'mavic3m',speed:5,timestamp:1,
    waypoints:[{lat:1,lon:1},{lat:1.001,lon:1.001}]});
  const broken=planner.createKmz(docs.templateXml,
    docs.waylinesXml.replace(/<wpml:globalTransitionalSpeed>5</,'<wpml:globalTransitionalSpeed>99<'));
  await assert.rejects(store.put(Buffer.from(broken),{name:'x'}),e=>e.status===422&&Array.isArray(e.details.errors));
  assert.equal(s3.calls.filter(c=>c.name==='PutObjectCommand').length,0);
});

test('reads reject malformed ids and tampered objects',async()=>{
  const s3=fakeS3();
  const store=createWpmlMissionStore({client:s3,env:{}});
  await assert.rejects(store.get('../etc/passwd'),e=>e.status===400);
  await assert.rejects(store.get('00000000-0000-8000-8000-000000000000'),e=>e.status===404);
  const {id,objectKey}=await store.put(kmz(),{name:'T'});
  s3.objects.get(objectKey).body[40]^=1;
  await assert.rejects(store.get(id),e=>e.status===502);
  await assert.rejects(store.list({pageSize:1000}),e=>e.status===400);
});

test('presigned GET follows AWS SigV4 query signing (AWS documentation example)',()=>{
  // Example from the AWS S3 docs "Authenticating Requests: Using Query Parameters".
  const url=presignGetUrl({endpoint:'https://examplebucket.s3.amazonaws.com',bucket:'examplebucket',
    key:'test.txt',accessKeyId:'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey:'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',expiresIn:3600,
    now:new Date('2013-05-24T00:00:00Z')});
  const u=new URL(url);
  assert.equal(u.searchParams.get('X-Amz-Credential'),'AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request');
  assert.equal(u.searchParams.get('X-Amz-Expires'),'3600');
  assert.match(u.searchParams.get('X-Amz-Signature'),/^[0-9a-f]{64}$/);
  assert.throws(()=>presignGetUrl({endpoint:'https://x',bucket:'b',key:'k',accessKeyId:'a',
    secretAccessKey:'s',expiresIn:7200}),/expiresIn/);
});

test('HTTP router: upload, list, download; errors never leak storage details',async()=>{
  const s3=fakeS3();
  const store=createWpmlMissionStore({client:s3,env:{}});
  const app=express();
  app.use(express.json({limit:'128kb'}));
  app.use('/api/wpml/missions',createWpmlMissionRouter({express,store}));
  const server=http.createServer(app);
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base='http://127.0.0.1:'+server.address().port+'/api/wpml/missions';
  const post=(body,headers)=>fetch(base,{method:'POST',body,headers:{
    'Content-Type':'application/vnd.google-earth.kmz',...headers}});
  try{
    const bytes=kmz();
    let res=await post(bytes,{'X-SkyHub-Mission-Name':encodeURIComponent('Hof Süd')});
    assert.equal(res.status,201);
    const stored=await res.json();
    assert.equal(stored.name,'Hof Süd');
    assert.equal(stored.flightReady,false);
    res=await post(bytes,{'X-SkyHub-Mission-Name':encodeURIComponent('Hof Süd')});
    assert.equal(res.status,200);
    res=await post(kmz('z',49.3),{'X-SkyHub-Mission-Name':encodeURIComponent('Hof Süd')});
    assert.equal(res.status,409);
    res=await post(bytes,{});
    assert.equal(res.status,400);
    res=await fetch(base,{method:'POST',body:'{}',headers:{'Content-Type':'application/json'}});
    assert.equal(res.status,415);
    res=await post(Buffer.from('garbage-garbage-garbage'),{'X-SkyHub-Mission-Name':'G'});
    assert.equal(res.status,422);
    res=await post(bytes,{'X-SkyHub-Mission-Name':'%E0%A4%A'});
    assert.equal(res.status,400);
    res=await fetch(base+'?page=1&page_size=10');
    assert.equal(res.status,200);
    assert.equal((await res.json()).list.length,1);
    res=await fetch(base+'/'+stored.id+'/kmz');
    assert.equal(res.status,200);
    assert.equal(res.headers.get('content-type'),'application/vnd.google-earth.kmz');
    assert.deepEqual(Buffer.from(await res.arrayBuffer()),bytes);
    res=await fetch(base+'/'+stored.id);
    assert.equal((await res.json()).waypointCount,2);
    res=await post(kmz('Revision',49.35),{
      'X-SkyHub-Mission-Name':encodeURIComponent('Hof Revision'),
      'X-SkyHub-Parent-Mission-Id':stored.id
    });
    assert.equal(res.status,201);
    const derivative=await res.json();
    assert.equal(derivative.parentId,stored.id);
    assert.equal(derivative.generation,2);
    assert.equal((await (await fetch(base+'/'+derivative.id)).json()).rootId,stored.id);
    res=await post(kmz('Revision',49.35),{
      'X-SkyHub-Mission-Name':'Hof Revision',
      'X-SkyHub-Parent-Mission-Id':'invalid'
    });
    assert.equal(res.status,400);
    res=await fetch(base+'/nothex/kmz');
    assert.equal(res.status,400);
    s3.send=async()=>{throw Object.assign(new Error('connect ECONNREFUSED 10.0.0.5:9000 secret'),{name:'Error'});};
    res=await fetch(base+'/'+stored.id);
    assert.equal(res.status,503);
    assert.doesNotMatch(await res.text(),/ECONNREFUSED|10\.0\.0\.5|secret/);
    res=await fetch(base+'/status');
    assert.equal((await res.json()).status,'unavailable');
  }finally{server.close();}
});

test('server mounts the store only when explicitly enabled and behind /api auth',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
  assert.match(source,/SKYHUB_WPML_STORE_ENABLED==='true'/);
  const auth=source.indexOf("app.use('/api',auth)");
  const mount=source.indexOf("app.use('/api/wpml/missions'");
  assert.ok(auth>0&&mount>auth,'WPML store must be mounted after the /api auth middleware');
  const lan=fs.readFileSync(path.join(__dirname,'../http-auth.js'),'utf8');
  assert.match(lan,/createWpmlLanAuth/,'WPML LAN access is gated by a separate opt-in policy');
  assert.match(lan,/!hdr && allowWpmlLan\(req\)/,'no-token WPML access is scoped and cannot override explicit bearer tokens');
  assert.match(source,/SKYHUB_WPML_LAN_NO_TOKEN_ENABLED==='true'/,'no-token mode defaults off');
  const compose=fs.readFileSync(path.join(__dirname,'../../docker-compose.yml'),'utf8');
  assert.match(compose,/SKYHUB_WPML_STORE_ENABLED: \$\{SKYHUB_WPML_STORE_ENABLED:-false\}/);
  assert.match(compose,/SKYHUB_PILOT_WAYLINE_ENABLED: \$\{SKYHUB_PILOT_WAYLINE_ENABLED:-false\}/);
});
