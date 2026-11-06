'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {projectDevice,projectRegistry,CAPABILITIES,createCloudApi2PortalRouter}=require('../cloud-api2-portal');

test('device projection redacts identifiers, positions, secrets and raw payloads',()=>{
  const device={sn:'SECRET-SERIAL',gatewaySn:'SECRET-GATEWAY',key:'SECRET-KEY',
    modelName:'Matrice 4T',role:'subdevice',online:true,fresh:true,topologyOnline:true,
    lastTelemetryAt:9000,telemetry:{battery:72,latitude:49.99,longitude:8.8,altitude:100}};
  const projection=projectRegistry({snapshot:()=>[device]},10000);
  assert.equal(projection.total,1);assert.equal(projection.online,1);
  assert.equal(projection.devices[0].batteryPercent,72);
  assert.equal(projection.devices[0].telemetryAgeSeconds,1);
  assert.equal(projection.readOnly,true);
  assert.equal(projection.flightReady,false);
  const json=JSON.stringify(projection);
  for(const secret of ['SECRET-SERIAL','SECRET-GATEWAY','SECRET-KEY','latitude','longitude','altitude','49.99']) {
    assert.ok(!json.includes(secret),secret+' leaked');
  }
});

test('stale, unverified and malformed telemetry cannot claim a live device',()=>{
  const device=projectDevice({
    modelName:'',role:'pilot',online:true,fresh:false,topologyOnline:true,
    lastTelemetryAt:12000,telemetry:{battery:800}
  },10000);
  assert.equal(device.online,false);
  assert.equal(device.modelName,'Unbekannt');
  assert.equal(device.role,'unknown');
  assert.equal(device.batteryPercent,null);
  assert.equal(device.telemetryAgeSeconds,null);
});

test('registry projections are bounded, do not mutate source and never grant flight readiness',()=>{
  const items=Array.from({length:120},(_,i)=>({sn:'S-'+i,online:false,fresh:false}));
  const snapshot=projectRegistry({snapshot:()=>items},1000);
  assert.equal(snapshot.total,120);assert.equal(snapshot.truncated,true);
  assert.equal(snapshot.devices.length,100);
  assert.equal(snapshot.hardwareVerified,false);
  assert.equal(snapshot.flightReady,false);
  assert.equal(items.length,120);
});

test('capabilities describe only GET read paths and do not advertise licensed components',()=>{
  assert.deepEqual(CAPABILITIES.allowedMethods,['GET']);
  for(const name of ['djiRuntimeInstalled','officialDjiSdkInstalled',
    'officialDjiFrontendLoaded','externalMqttBridgeEnabled',
    'flightCommandsEnabled','missionDispatchEnabled'])assert.equal(CAPABILITIES[name],false);
});

test('HTTP router registers exactly three read-only GET handlers',()=>{
  const found=[];
  const express={Router:()=>({get:(name,callback)=>found.push({name,callback})})};
  createCloudApi2PortalRouter({express,registry:{snapshot:()=>[]},mqttState:{connected:true,subscribed:true}});
  assert.deepEqual(found.map(x=>x.name),['/status','/devices','/capabilities']);
  const response={json:(body)=>{response.last=body;return response;}};
  found[0].callback({},response);
  assert.equal(response.last.mqttConnected,true);
  assert.equal(response.last.flightControlEnabled,false);
});

test('new portal mounts behind the existing SkyHub authorization',()=>{
  const source=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
  const auth=source.indexOf("app.use('/api',auth);");
  const portal=source.indexOf("app.use('/api/cloud-api2'");
  assert.ok(auth>0&&portal>auth,'portal must be behind central API auth');
  const authSource=fs.readFileSync(path.join(__dirname,'..','http-auth.js'),'utf8');
  assert.match(authSource,/\/cloud-api2\/devices/);
});

test('browser assets avoid external script loading and any flight/publish implementation',()=>{
  const root=path.resolve(__dirname,'../../frontend/public');
  for(const file of ['cloud-api2.html','cloud-api2.js','cloud-api2-sdk.mjs','cloud-api2-lab.mjs']){
    const data=fs.readFileSync(path.join(root,file),'utf8');
    for(const forbidden of [/mqtt\.publish\s*\(/i,/flighttask_prepare/i,/drcSendStickControl/i,/<script[^>]+src=["']https?:\/\//i]){
      assert.doesNotMatch(data,forbidden,file);
    }
  }
});

test('object-oriented client permits only three same-origin GET operations',async()=>{
  const {SkyHubDaaSClient}=await import('../../frontend/public/cloud-api2-sdk.mjs');
  const calls=[];
  const c=new SkyHubDaaSClient({fetchImpl:async(url,options)=>{
    calls.push({url,options});return {ok:true,json:async()=>({ok:true})};
  }});
  await c.getStatus();await c.listDevices();await c.getCapabilities();
  assert.deepEqual(calls.map(x=>x.url),[
    '/api/cloud-api2/status','/api/cloud-api2/devices','/api/cloud-api2/capabilities']);
  assert.ok(calls.every(x=>x.options.method==='GET'&&x.options.credentials==='same-origin'));
  await assert.rejects(c.query('publish'),/Read-only/);
  assert.throws(()=>new SkyHubDaaSClient({endpoint:'https://example.org'}),/local SkyHub/);
});

test('simulator uses only deterministic synthetic frames and exports synthetic provenance',async()=>{
  const {SkyHubLabSimulator}=await import('../../frontend/public/cloud-api2-lab.mjs');
  const sim=new SkyHubLabSimulator();
  assert.equal(sim.current().altitude,0);
  assert.equal(sim.current().synthetic,true);
  sim.advance();assert.equal(sim.current().altitude,15);
  const payload=sim.exportData();
  assert.equal(payload.synthetic,true);
  assert.equal(payload.hardwareVerified,false);
  assert.equal(payload.flightReady,false);
  sim.reset();assert.equal(sim.current().altitude,0);
});