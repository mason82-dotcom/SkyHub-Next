'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {waylineId}=require('../wpml-mission-store');
const {aircraftModel,missionModel,compatibleModels,collectLinkage,createCloudApi2LinkageRouter}=require('../cloud-api2-linkage');
const UUID='dbe034d7-32f7-4a3f-8d12-9f7446290b4d';
const SHA='ab'.repeat(32);
const mission={id:waylineId(SHA),sha256:SHA,droneModelKey:'0-77-2',name:'SECRET-WAYLINE'};
const device={sn:'SECRET-SERIAL',role:'subdevice',topologyOnline:true,topologyTimeVerified:true,topologyRestored:false,
  online:true,fresh:true,telemetryTimeVerified:true,
  model:{domain:'0',type:'77',subType:'2'},telemetry:{latitude:49.99,longitude:8.5}};
const mediaDb={query:async(sql,args)=>{
  assert.match(sql,/^SELECT count\(\*\)::integer AS n FROM dji_pilot_media_verified WHERE workspace_id=\$1$/);
  assert.deepEqual(args,[UUID]);
  return {rows:[{n:12}]};
}};
test('mission SHA->UUID and precise topology model produce candidates, never execution proof',async()=>{
  assert.equal(aircraftModel(device),'0-77-2');
  assert.equal(missionModel(mission),'0-77-2');
  const match=compatibleModels([device], [mission]);
  assert.deepEqual(match,{topologyVerifiedAircraft:1,metadataConsistentMissions:1,compatiblePairs:1});
  let reads=0;
  const report=await collectLinkage({
    registry:{snapshot:()=>{reads++;return [device];}},
    wpmlStore:{all:async()=>{reads++;return [mission];}},
    db:mediaDb,workspace:UUID
  });
  assert.equal(reads,2);
  assert.equal(report.inventories.media.count,12);
  assert.equal(report.modelCompatibility.status,'candidate-only');
  assert.equal(report.modelCompatibility.candidatePairs,1);
  assert.equal(report.modelCompatibility.validatedExecution,false);
  assert.equal(report.flightReady,false);
  assert.equal(report.hardwareVerified,false);
  assert.equal(report.deviceCorrelation,'not-established');
  for(const link of Object.values(report.links)){
    assert.deepEqual(link,{status:'not-established',verified:0});
  }
  for(const secret of ['SECRET-SERIAL','SECRET-WAYLINE',SHA,mission.id,'49.99','8.5',UUID])
    assert.ok(!JSON.stringify(report).includes(secret),secret+' leaked');
});
test('model-only, stale topology, restored state, invalid mission SHA and same time never link',()=>{
  assert.equal(aircraftModel({...device,topologyTimeVerified:false}),null);
  assert.equal(aircraftModel({...device,topologyRestored:true}),null);
  assert.equal(aircraftModel({...device,online:false}),null);
  assert.equal(aircraftModel({...device,fresh:false}),null);
  assert.equal(aircraftModel({...device,telemetryTimeVerified:null}),null);
  assert.equal(aircraftModel({...device,topologyOnline:false}),null);
  assert.equal(aircraftModel({...device,role:'gateway'}),null);
  assert.equal(missionModel({...mission,id:'00000000-0000-0000-0000-000000000000'}),null);
  assert.equal(missionModel({...mission,sha256:'not-a-hash'}),null);
  assert.equal(missionModel({...mission,droneModelKey:'0-77-3'}),'0-77-3');
  assert.equal(compatibleModels([{...device,topologyTimeVerified:false}],[mission]).compatiblePairs,0);
  assert.equal(compatibleModels([device],[{...mission,droneModelKey:'0-77-3'}]).compatiblePairs,0);
  assert.equal(compatibleModels([device],[{...mission,id:waylineId(SHA),name:'same-file'}]).compatiblePairs,1);
  assert.equal(compatibleModels(new Array(501).fill(device),[mission]),null);
});
test('unknown storage, absent workspace and invalid source responses fail closed',async()=>{
  const empty=await collectLinkage();
  assert.equal(empty.inventories.device.status,'unavailable');
  assert.equal(empty.inventories.mission.status,'unavailable');
  assert.equal(empty.inventories.media.status,'unavailable');
  assert.equal(empty.modelCompatibility.status,'unknown');
  assert.equal(empty.modelCompatibility.candidatePairs,null);
  const failure=await collectLinkage({
    registry:{snapshot:()=>{throw new Error('SECRET-REGISTRY');}},
    wpmlStore:{all:async()=>{throw new Error('SECRET-WPML');}},
    db:{query:async()=>{throw new Error('SECRET-DB');}},workspace:UUID
  });
  assert.equal(failure.inventories.device.status,'unknown');
  assert.equal(failure.inventories.mission.status,'unknown');
  assert.equal(failure.inventories.media.status,'unknown');
  assert.equal(failure.modelCompatibility.status,'unknown');
  assert.doesNotMatch(JSON.stringify(failure),/SECRET-/);
});
test('new endpoint is GET-only, token-protected and mounted after WPML initialization',async()=>{
  const found=[];
  const express={Router:()=>({get:(route,fn)=>found.push({route,fn})})};
  createCloudApi2LinkageRouter({express});
  assert.deepEqual(found.map(e=>e.route),['/linkage']);
  const server=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
  const auth=server.indexOf("app.use('/api',auth);");
  const mount=server.indexOf("app.use('/api/cloud-api2',createCloudApi2LinkageRouter");
  const wpml=server.indexOf('let wpmlStore=null;');
  assert.ok(auth>=0&&mount>auth&&mount>wpml);
  const policy=fs.readFileSync(path.join(__dirname,'../http-auth.js'),'utf8');
  assert.equal(policy.includes("'/cloud-api2/linkage'"),true);
  assert.equal(policy.includes('/cloud-api2/(evidence|linkage)'),false);
});
test('configured LAN access allows only redacted linkage GET while external clients stay token-gated',()=>{
  const {createHttpAuth}=require('../http-auth');
  let permitted=0;
  const make=(allowed)=>createHttpAuth({secret:'Z'.repeat(32),lanAccess:{
    allows:()=>allowed
  }}).auth;
  const query=(auth,method,p)=>{
    const req={path:p,method,headers:{},socket:{remoteAddress:'192.0.2.7'}};
    const res={code:null,status(n){this.code=n;return this;},json(){return this;}};
    let ok=false;auth(req,res,()=>{ok=true;});
    return {ok,status:res.code};
  };
  assert.deepEqual(query(make(true),'GET','/cloud-api2/linkage'),{ok:true,status:null});
  assert.deepEqual(query(make(true),'HEAD','/cloud-api2/linkage'),{ok:true,status:null});
  assert.equal(query(make(true),'POST','/cloud-api2/linkage').status,401);
  assert.equal(query(make(true),'GET','/cloud-api2/evidence').status,401);
  assert.equal(query(make(false),'GET','/cloud-api2/linkage').status,401);
});
test('browser rejects false verified links and never uses write methods',async()=>{
  const {normalizeLinkage}=await import('../../frontend/public/cloud-api2-linkage.mjs');
  const {SkyHubDaaSClient}=await import('../../frontend/public/cloud-api2-sdk.mjs');
  const report=await collectLinkage({registry:{snapshot:()=>[device]},wpmlStore:{all:async()=>[mission]},
    db:mediaDb,workspace:UUID});
  const projected=normalizeLinkage(report);
  assert.equal(projected.modelCandidatePairs,1);
  assert.equal(projected.deviceMedia,'not-established');
  assert.throws(()=>normalizeLinkage({...report,links:{...report.links,deviceMedia:{status:'verified',verified:1}}}),/Unbelegte/);
  assert.throws(()=>normalizeLinkage({...report,flightReady:true}),/Unbestätigte/);
  assert.throws(()=>normalizeLinkage({...report,deviceCorrelation:'verified'}),/Unbestätigte/);
  const calls=[];
  const client=new SkyHubDaaSClient({fetchImpl:async(url,options)=>{
    calls.push({url,options});return {ok:true,json:async()=>report};
  }});
  await client.getLinkage();
  assert.deepEqual(calls.map(x=>x.url),['/api/cloud-api2/linkage']);
  assert.equal(calls[0].options.method,'GET');
  assert.equal(calls[0].options.credentials,'same-origin');
  await assert.rejects(()=>client.query('publish'),/Read-only/);
  const html=fs.readFileSync(path.join(__dirname,'../../frontend/public/cloud-api2.html'),'utf8');
  const script=fs.readFileSync(path.join(__dirname,'../../frontend/public/cloud-api2.js'),'utf8');
  assert.match(html,/id="loadLinkage"/);
  assert.match(script,/addEventListener\('click',inspectLinkage\)/);
  assert.doesNotMatch(script,/mqtt\.publish\s*\(|flighttask_prepare|drcSendStickControl/i);
});
