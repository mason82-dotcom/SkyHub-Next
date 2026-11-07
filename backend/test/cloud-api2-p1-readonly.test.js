'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'../..');
const {projectPublicContract,SCHEMA}=require('../cloud-api2-readonly-contract');
const {CAPABILITIES,createCloudApi2PortalRouter}=require('../cloud-api2-portal');
const {CATALOG,validateContract}=require('../cloud-api2-contracts');
const clone=x=>JSON.parse(JSON.stringify(x));
let adapterPromise=null;
const getAdapter=()=>adapterPromise??=import('../../frontend/public/cloud-api2-readonly-adapter.mjs');

test('P1 public contract is deterministic, version pinned and not a DJI SDK',()=>{
  assert.equal(validateContract(),true);
  const c=projectPublicContract();
  assert.equal(c.schema,SCHEMA);
  assert.equal(c.source,'pinned-offline-dji-reference-not-runtime');
  assert.equal(c.vendorCommit,CATALOG.source.commit);
  assert.equal(c.vendorPlatformVersion,'V1.1.0');
  assert.equal(c.sdkSourceVersion,'3.4.0');
  assert.equal(c.devkitJarVersion,'3.3.7');
  assert.deepEqual(c.devices.map(d=>d.id),CATALOG.deviceMatrix.map(d=>d.id));
  assert.deepEqual(c.capabilities.map(x=>x.id),CATALOG.capabilityMatrix.map(x=>x.id));
  assert.equal(c.controllerAircraft.length,2);
  assert.ok(c.devices.every(d=>d.hardwareVerified===false&&d.flightReady===false));
  assert.ok(c.capabilities.every(x=>x.api2RuntimeVerified===false&&
    x.commandEnabled===false&&x.flightReady===false));
  for(const name of ['api2RuntimeVerified','hardwareVerified','flightReady','dispatchAllowed',
    'accuracyVerified','validatedMissionExecution'])assert.equal(c[name],false);
  for(const link of ['deviceMission','missionMedia','deviceMedia'])assert.equal(c[link],'not-established');
  assert.equal(JSON.stringify(c).includes('SECRET_DEVICE_SN'),false);
});

test('existing capabilities GET exposes only bounded static P0 projection',()=>{
  assert.deepEqual(CAPABILITIES.contract,projectPublicContract());
  assert.deepEqual(CAPABILITIES.allowedMethods,['GET']);
  assert.equal(CAPABILITIES.externalMqttBridgeEnabled,false);
  assert.equal(CAPABILITIES.flightCommandsEnabled,false);
  const routes=[];
  createCloudApi2PortalRouter({
    express:{Router:()=>({get:(p,fn)=>routes.push({p,fn})})},
    registry:{snapshot:()=>[{sn:'PRIVATE_SN',telemetry:{latitude:49.99}}]}
  });
  assert.deepEqual(routes.map(x=>x.p),['/status','/devices','/capabilities']);
  let response;
  routes[2].fn({}, {json(x){response=x;return this;}});
  assert.equal(response.contract.devices.length,7);
  assert.equal(response.contract.capabilities.length,13);
  assert.doesNotMatch(JSON.stringify(response),/PRIVATE_SN|latitude|longitude|49\.99/);
});

test('browser P1 validates exact schema, SDK/JAR versions, matrix ordering and gates',async()=>{
  const {validateReadOnlyCapabilities}=await getAdapter();
  const c=validateReadOnlyCapabilities(CAPABILITIES);
  assert.equal(c.schema,SCHEMA);
  assert.equal(c.capabilities.length,13);
  assert.equal(c.devices.length,7);
  assert.equal(c.controllerAircraft.length,2);
  for(const d of c.devices)assert.equal(d.hardwareVerified,false);
  const tests=[
    x=>{x.allowedMethods=['GET','POST'];},
    x=>{x.flightCommandsEnabled=true;},
    x=>{x.djiRuntimeInstalled=true;},
    x=>{x.officialDjiSdkInstalled=true;},
    x=>{x.contract.schema='forged';},
    x=>{x.contract.sdkSourceVersion='3.3.7';},
    x=>{x.contract.vendorCommit='0'.repeat(40);},
    x=>{x.contract.flightReady=true;},
    x=>{x.contract.dispatchAllowed=true;},
    x=>{x.contract.accuracyVerified=true;},
    x=>{x.contract.validatedMissionExecution=true;},
    x=>{x.contract.deviceMedia='verified';},
    x=>{x.contract.devices[0].hardwareVerified=true;},
    x=>{x.contract.devices[0].serial='PRIVATE_SN';},
    x=>{x.contract.devices[3].vendorSupport='explicitly-listed-not-hardware-certified';},
    x=>{x.contract.capabilities[0].api2RuntimeVerified=true;},
    x=>{x.contract.capabilities[6].skyhubMode='read-only-projection';},
    x=>{x.contract.capabilities[11].commandEnabled=true;},
    x=>{x.contract.capabilities[12].secret='SECRET_KEY';},
    x=>{x.contract.controllerAircraft[0].api2PairingVerified=true;},
    x=>{x.contract.controllerAircraft[1].aircraft='m3m';},
    x=>{x.contract.controllerAircraft.push(x.contract.controllerAircraft[0]);},
    x=>{x.contract.extras='SECRET_DJI_TOKEN';},
    x=>{x.extra='SECRET_DJI_TOKEN';}
  ];
  for(const [i,mutate] of tests.entries()){
    const value=clone(CAPABILITIES);mutate(value);
    assert.throws(()=>validateReadOnlyCapabilities(value),/Read-only-Vertrag/,String(i));
  }
});

test('P1 client performs only existing same-origin capabilities GET; 401 and network failure do not fallback',async()=>{
  const {SkyHubReadOnlyContractAdapter}=await getAdapter();
  const {SkyHubDaaSClient}=await import('../../frontend/public/cloud-api2-sdk.mjs');
  const calls=[];
  const client=new SkyHubDaaSClient({fetchImpl:async(url,opts)=>{
    calls.push({url,opts});
    return {ok:true,json:async()=>clone(CAPABILITIES)};
  }});
  const adapter=new SkyHubReadOnlyContractAdapter({client});
  assert.deepEqual((await adapter.inspect()).devices.map(x=>x.id),
    CATALOG.deviceMatrix.map(x=>x.id));
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,'/api/cloud-api2/capabilities');
  assert.equal(calls[0].opts.method,'GET');
  assert.equal(calls[0].opts.credentials,'same-origin');
  assert.equal(calls[0].opts.cache,'no-store');
  assert.throws(()=>new SkyHubReadOnlyContractAdapter({client:{}}),/GET client required/);
  await assert.rejects(new SkyHubReadOnlyContractAdapter({
    client:{getCapabilities:async()=>{throw new Error('HTTP 401');}}
  }).inspect(),/HTTP 401/);
  await assert.rejects(new SkyHubReadOnlyContractAdapter({
    client:{getCapabilities:async()=>{throw new Error('offline');}}
  }).inspect(),/offline/);
  await assert.rejects(new SkyHubReadOnlyContractAdapter({
    client:{getCapabilities:async()=>({...clone(CAPABILITIES),flightCommandsEnabled:true})}
  }).inspect(),/Read-only-Vertrag/);
});

test('P1 view has explicit click-to-inspect and does not introduce auth changes or new routes',()=>{
  const html=fs.readFileSync(path.join(root,'frontend/public/cloud-api2.html'),'utf8');
  const js=fs.readFileSync(path.join(root,'frontend/public/cloud-api2.js'),'utf8');
  const sdk=fs.readFileSync(path.join(root,'frontend/public/cloud-api2-sdk.mjs'),'utf8');
  const server=fs.readFileSync(path.join(root,'backend/server.js'),'utf8');
  const auth=fs.readFileSync(path.join(root,'backend/http-auth.js'),'utf8');
  assert.match(html,/data-view="contracts"/);
  for(const id of ['view-contracts','inspectReadOnlyAdapter','readonlyAdapterStatus',
    'readonlyAdapterSummary','readonlyAdapterDevices','readonlyAdapterModules'])
    assert.match(html,new RegExp('id="'+id+'"'));
  assert.match(js,/SkyHubReadOnlyContractAdapter/);
  assert.match(js,/get\('inspectReadOnlyAdapter'\)\.addEventListener\('click',inspectReadOnlyContract\)/);
  assert.match(js,/function paintReadOnlyContract\(contract\)/);
  assert.match(js,/\.textContent/);
  assert.match(js,/UNBEKANNT: Vertrag nicht erreichbar/);
  assert.doesNotMatch(sdk,/getContractSnapshot\(|\/api\/cloud-api2\/adapter/);
  const authIndex=server.indexOf("app.use('/api',auth);");
  const routes=server.indexOf("app.use('/api/cloud-api2',createCloudApi2PortalRouter");
  assert.ok(authIndex>0&&routes>authIndex);
  assert.doesNotMatch(auth,/\/cloud-api2\/adapter/);
});

test('P1 implementation has no new network, storage, device command or DJI SDK dependency',()=>{
  const backend=fs.readFileSync(path.join(root,'backend/cloud-api2-readonly-contract.js'),'utf8');
  const browser=fs.readFileSync(path.join(root,'frontend/public/cloud-api2-readonly-adapter.mjs'),'utf8');
  const js=fs.readFileSync(path.join(root,'frontend/public/cloud-api2.js'),'utf8');
  for(const source of [backend,browser]){
    for(const forbidden of [/\bmqtt\.publish\s*\(/,
      /\bfetch\s*\(/,/\bWebSocket\b/,/\bXMLHttpRequest\b/,
      /\brequire\(['"](?:mqtt|axios|express|pg|ioredis|node:net|node:http)/])
      assert.doesNotMatch(source,forbidden);
  }
  for(const source of [browser,js])
    for(const forbidden of [/\bdrcSendStickControl\b/,/\bflighttask_prepare\b/,
      /\bmqtt\.publish\s*\(/])assert.doesNotMatch(source,forbidden);
});
