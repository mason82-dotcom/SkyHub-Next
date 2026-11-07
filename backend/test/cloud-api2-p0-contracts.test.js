'use strict';
// Deterministic offline contract tests. No network, DJI session, broker or device needed.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {
 CATALOG,RESOURCES,LAN,validateContract,listCapabilities,lookupDevice,
 auditRegisteredRoutes,auditClientRequests
}=require('../cloud-api2-contracts');
const root=path.resolve(__dirname,'../..');
const clone=()=>JSON.parse(JSON.stringify(CATALOG));
const reject=(value)=>assert.throws(()=>validateContract(value),/Cloud API 2 P0 contract:/);

test('DJI V1.1.0 and SDK/DevKit are independently pinned to immutable upstream revision',()=>{
  assert.equal(validateContract(),true);
  assert.equal(CATALOG.source.commit,'705c73f48a77bb5120b28d73436d73594d289359');
  assert.equal(CATALOG.source.platformVersion,'V1.1.0');
  assert.equal(CATALOG.source.platformReleased,'2026-11-05');
  assert.equal(CATALOG.source.sdkSourceVersion,'3.4.0');
  assert.equal(CATALOG.source.devkitPrebuiltJarVersion,'3.3.7');
  assert.equal(CATALOG.localBaseline.mainCommit,'a17b8b487ef27906c75badf713bef67dbe741087');
  for(const source of Object.values(CATALOG.source.documents)){
    assert.ok(source.url.includes(CATALOG.source.commit));
    assert.ok(source.url.endsWith('/'+source.path));
  }
  const changed=clone();changed.source.sdkSourceVersion='3.3.7';reject(changed);
  const changedSha=clone();changedSha.source.commit='0'.repeat(40);reject(changedSha);
  const unpinned=clone();unpinned.source.documents.sdk.url=unpinned.source.documents.sdk.url.replace(CATALOG.source.commit,'main');reject(unpinned);
});

test('all device/controller SKUs remain differentiated and no historical smoke is API2 acceptance',()=>{
  assert.deepEqual(CATALOG.deviceMatrix.map(d=>d.id),
    ['m3e','m3t','m3ta','m3m','m4t','rc-pro-enterprise','rc-plus2-enterprise']);
  assert.equal(lookupDevice('m3m').vendorSupport,'not-explicitly-listed');
  assert.equal(lookupDevice('m3ta').vendorSupport,'not-explicitly-listed');
  assert.equal(lookupDevice('m4t').vendorSupport,'explicitly-listed-not-hardware-certified');
  assert.equal(lookupDevice('not-a-device'),null);
  for(const d of CATALOG.deviceMatrix){
    assert.equal(d.cloudApi2HardwareVerified,false,d.id);
    assert.equal(d.flightReady,false,d.id);
  }
  for(const p of CATALOG.controllerAircraftMatrix){
    assert.equal(p.cloudApi2PairingVerified,false);
    assert.equal(p.hardwareAcceptanceComplete,false);
  }
  const forged=clone();forged.controllerAircraftMatrix[0].cloudApi2PairingVerified=true;reject(forged);
  const promoted=clone();promoted.deviceMatrix.find(x=>x.id==='m3m').vendorSupport='explicitly-listed-not-hardware-certified';reject(promoted);
});

test('the capability matrix separates DJI documentation from running SkyHub SDK',()=>{
  const caps=listCapabilities();
  assert.equal(caps.length,13);
  assert.equal(new Set(caps.map(c=>c.id)).size,caps.length);
  assert.ok(caps.every(c=>c.vendorDocumented===true&&c.api2RuntimeVerified===false&&
    c.skyhubCommandEnabled===false&&c.flightReady===false));
  for(const id of ['mcp-agent','flight-task-execute','remote-flight-control'])
    assert.equal(caps.find(c=>c.id===id).skyhubMode,'disabled');
  assert.equal(caps.find(c=>c.id==='wayline-library').skyhubOrigin,'local-wpml-metadata-no-execution');
  assert.equal(caps.find(c=>c.id==='media-catalog').skyhubOrigin,
    'skyhub-s3-inventory-no-origin-certification');
  const forged=clone();forged.capabilityMatrix.find(x=>x.id==='remote-flight-control').skyhubMode='read-only-projection';reject(forged);
  const enabled=clone();enabled.localBaseline.vendorPaaSInstalled=true;reject(enabled);
});

test('six existing SkyHub API paths are strictly GET only with exact public/private policy',()=>{
  assert.deepEqual(RESOURCES,
    ['status','devices','capabilities','linkage','evidence','hardware/rc-plus2-m4t']);
  assert.deepEqual(LAN,['status','devices','capabilities','linkage']);
  assert.deepEqual(CATALOG.adapterContract.permittedMethods,['GET']);
  assert.deepEqual(CATALOG.adapterContract.forbiddenMethods,['POST','PUT','PATCH','DELETE']);
  assert.deepEqual(CATALOG.adapterContract.routes.map(r=>r.access),[
    'trusted-lan-get','trusted-lan-get','trusted-lan-get','trusted-lan-get',
    'view-token-required','view-token-required'
  ]);
  const registrations=[];
  const router={
    get(route){registrations.push({method:'GET',path:route});},
    post(){registrations.push({method:'POST',path:'/bad'});},
    put(){registrations.push({method:'PUT',path:'/bad'});},
    patch(){registrations.push({method:'PATCH',path:'/bad'});},
    delete(){registrations.push({method:'DELETE',path:'/bad'});}
  };
  const express={Router:()=>router};
  require('../cloud-api2-portal').createCloudApi2PortalRouter({express});
  require('../cloud-api2-linkage').createCloudApi2LinkageRouter({express});
  require('../cloud-api2-evidence').createCloudApi2EvidenceRouter({express});
  require('../cloud-api2-hardware').createCloudApi2HardwareRouter({express});
  // Router registration order is independent of the server mount order.
  const ordered=RESOURCES.map(res=>registrations.find(r=>r.path==='/'+res));
  assert.equal(registrations.length,6);
  assert.ok(ordered.every(Boolean));
  assert.equal(auditRegisteredRoutes(ordered),true);
  const wrongMethod=ordered.map(x=>({...x}));wrongMethod[4].method='POST';
  assert.throws(()=>auditRegisteredRoutes(wrongMethod),/unexpected HTTP method/);
  const added=[...ordered,{method:'GET',path:'/new'}];
  assert.throws(()=>auditRegisteredRoutes(added),/unexpected HTTP route count/);
  const forged=clone();forged.adapterContract.routes[4].access='trusted-lan-get';reject(forged);
});

test('browser facade sends only six same-origin GET requests and rejects all commands',async()=>{
  const {SkyHubDaaSClient}=await import('../../frontend/public/cloud-api2-sdk.mjs');
  const calls=[];
  const client=new SkyHubDaaSClient({fetchImpl:async(url,options)=>{
    calls.push({url,options});return {ok:true,json:async()=>({})};
  }});
  for(const resource of RESOURCES)await client.query(resource);
  assert.equal(auditClientRequests(calls),true);
  for(const invalid of ['../devices','/api/cloud-api2/devices',
    'https://evil.invalid/','flighttask_prepare','drc/start','wayline_execute']){
    await assert.rejects(client.query(invalid),/Read-only operation required/);
  }
  assert.equal(calls.length,6,'rejected resources must not reach fetch');
  const forged=calls.map(x=>({...x,options:{...x.options}}));
  forged[0].options.method='POST';
  assert.throws(()=>auditClientRequests(forged),/same-origin GET/);
  assert.throws(()=>new SkyHubDaaSClient({endpoint:'https://evil.invalid'}),/local SkyHub/);
});

test('real HTTP auth policy keeps hardware and evidence token-gated, LAN linkage read-only',()=>{
  const policy=fs.readFileSync(path.join(root,'backend/http-auth.js'),'utf8');
  const server=fs.readFileSync(path.join(root,'backend/server.js'),'utf8');
  const auth=server.indexOf("app.use('/api',auth);");
  assert.ok(auth>=0);
  for(const factory of ['Portal','Hardware','Evidence','Linkage']){
    const name="app.use('/api/cloud-api2',createCloudApi2"+factory+"Router";
    assert.ok(server.indexOf(name)>auth,name+' must be mounted after auth');
  }
  for(const route of LAN)assert.ok(policy.includes("'/cloud-api2/"+route+"'"));
  for(const route of ['evidence','hardware/rc-plus2-m4t'])
    assert.ok(!policy.includes("'/cloud-api2/"+route+"'"));
  const {createHttpAuth}=require('../http-auth');
  const authFn=createHttpAuth({secret:'P'.repeat(32),lanAccess:{allows:()=>true}}).auth;
  const run=(method,p)=>{
    const req={path:'/cloud-api2/'+p,method,headers:{},socket:{remoteAddress:'198.51.100.10'}};
    const res={statusCode:200,status(x){this.statusCode=x;return this;},json(){return this;}};
    let allowed=false;authFn(req,res,()=>allowed=true);
    return {allowed,statusCode:res.statusCode};
  };
  for(const p of LAN){
    assert.equal(run('GET',p).allowed,true);
    assert.equal(run('POST',p).statusCode,401);
  }
  for(const p of ['evidence','hardware/rc-plus2-m4t']){
    assert.equal(run('GET',p).statusCode,401);
    assert.equal(run('HEAD',p).statusCode,401);
  }
});

test('redacted device projection and synthetic lab cannot imply certified operation',async()=>{
  const {projectRegistry,CAPABILITIES}=require('../cloud-api2-portal');
  const registry={snapshot:()=>[{sn:'PRIVATE-SN-1',modelName:'Matrice 4T',
    role:'subdevice',online:true,fresh:false,topologyOnline:true,
    telemetry:{battery:44,latitude:49.02,longitude:8.4},lastTelemetryAt:9000}]};
  const snapshot=projectRegistry(registry,10000);
  assert.equal(snapshot.devices[0].online,false);
  assert.equal(snapshot.flightReady,false);
  assert.equal(snapshot.hardwareVerified,false);
  assert.doesNotMatch(JSON.stringify(snapshot),/PRIVATE-SN|latitude|longitude|49\.02/);
  for(const key of ['djiRuntimeInstalled','officialDjiSdkInstalled','externalMqttBridgeEnabled',
    'flightCommandsEnabled','missionDispatchEnabled'])assert.equal(CAPABILITIES[key],false);
  const {SkyHubLabSimulator}=await import('../../frontend/public/cloud-api2-lab.mjs');
  const lab=new SkyHubLabSimulator();lab.advance();
  const exported=lab.exportData();
  assert.equal(exported.synthetic,true);
  assert.equal(exported.hardwareVerified,false);
  assert.equal(exported.flightReady,false);
});

test('mission/media/thermal provenance stays unverified until independent receipts exist',()=>{
  const gates=CATALOG.immutableGates;
  for(const flag of ['hardwareVerified','flightReady','dispatchAllowed','accuracyVerified',
     'validatedMissionExecution'])assert.equal(gates[flag],false);
  for(const relation of ['deviceMission','missionMedia','deviceMedia'])
    assert.equal(gates[relation],'not-established');
  const fake=clone();fake.immutableGates.deviceMedia='verified';reject(fake);
  const fakeFlight=clone();fakeFlight.immutableGates.flightReady=true;reject(fakeFlight);
});

test('P0 is offline documentation/testing only: no runtime routes, Docker or device publishers added',()=>{
  const sources=['backend/cloud-api2-contracts.js','backend/test/cloud-api2-p0-contracts.test.js'];
  // Inspect the production P0 module, not this test's deliberately hostile strings.
  const module=fs.readFileSync(path.join(root,sources[0]),'utf8');
  for(const forbidden of [/\brequire\(['"](?:mqtt|express|axios|node:net|node:http)/,
    /\bmqtt\.publish\s*\(/,/\bfetch\s*\(/,/\brouter\.(?:post|put|patch|delete)\s*\(/])
    assert.doesNotMatch(module,forbidden);
  assert.equal(CATALOG.localBaseline.liveControlPermitted,false);
  assert.equal(CATALOG.adapterContract.automaticMqttPublish,false);
});
