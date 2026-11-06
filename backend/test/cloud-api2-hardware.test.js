'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {collectHardwareEvidence,readPairings,createCloudApi2HardwareRouter}=
  require('../cloud-api2-hardware');
const {makePreflightEvidence,makeRuntimeEvidence,makeLiveEvidence,
  validateLiveEvidenceReceipt}=require('../rc-plus2-m4t-evidence');

const DATE=new Date('2026-11-06T22:00:00.000Z');
const now=DATE.getTime();
function providers(devices=[],pairing=null){
  return {
    registry:{snapshot:(at)=>{assert.ok(Number.isFinite(at));return devices;}},
    healthSnapshot:()=>({mqtt:true,subscribed:true,
      topologyReplyEnabled:true,topologyReplyConnected:true,
      serial:'SECRET_HEALTH_SN',latitude:49.123456}),
    mqttShapes:{snapshot:()=>[]},pairing
  };
}
const positiveReport={
  passed:true,transportPassed:true,pairingConfirmed:true,
  transport:{mqttConnected:true,subscribed:true,
    topologyAckEnabled:true,topologyAckConnected:true,secret:'PRIVATE_MQTT'},
  pairing:{available:true,rcPlus2Paired:1,rcPlus2RecentlyUsed:1,
    devices:[{token:'SECRET_TOKEN'}]},candidateCount:{linkedPairs:1},
  controller:{seen:true,topologyOnline:true,osdFresh:true,osdAgeSeconds:1,
    stateObserved:true,fieldInterface:true,fields:{documented:54,observed:21,fresh:14},
    sn:'SECRET_RC'},
  aircraft:{seen:true,topologyOnline:true,osdFresh:true,osdAgeSeconds:1,
    stateObserved:true,fieldInterface:true,aircraftConnected:true,
    fields:{documented:202,observed:100,fresh:91},
    dynamicFields:{observed:5,observedNames:['PRIVATE_GIMBAL']},
    sn:'SECRET_M4T',latitude:49.123456}
};

test('new operator-driven endpoint uses existing in-memory snapshots only and fails closed without devices',async()=>{
  const result=await collectHardwareEvidence(providers(),DATE);
  assert.equal(result.mode,'live-transport-smoke');
  assert.equal(result.result,'INCOMPLETE');
  assert.equal(result.linkedPairs,0);
  assert.equal(result.controller.osdFresh,false);
  assert.equal(result.aircraft.osdFresh,false);
  assert.equal(result.flightReady,false);
  assert.equal(result.hardwareAcceptanceComplete,false);
  assert.equal(result.dispatchAllowed,false);
  assert.equal(validateLiveEvidenceReceipt(result),true);
  const serialized=JSON.stringify(result);
  assert.doesNotMatch(serialized,/SECRET_|latitude|longitude|serial|token|gatewaySn|PRIVATE_/);
});
test('pairing lookup is bounded and unavailable Redis does not invent confirmation',async()=>{
  assert.equal(await readPairings(),null);
  assert.equal(await readPairings({devices:()=>Promise.reject(Error('secret device token'))}),null);
  assert.equal(await readPairings({devices:async()=>[{}]}).then(x=>x.pending.length),0);
  assert.equal(await readPairings({devices:async()=>Array.from({length:201},()=>({}))}),null);
  assert.equal(await readPairings({devices:()=>new Promise(()=>{})},15),null);
});
test('bad source structure cannot return any raw registry information',async()=>{
  await assert.rejects(collectHardwareEvidence(providers(Array.from({length:201},()=>({sn:'SECRET'}))),DATE));
  await assert.rejects(collectHardwareEvidence({
    ...providers(),mqttShapes:{snapshot:()=>Array.from({length:129},()=>({latitude:49.99}))}
  },DATE));
});
test('the router has one GET-only route, no-store, and sanitized error messages',async()=>{
  let handler;const methods=[];
  const express={Router:()=>({get:(endpoint,fn)=>{methods.push(endpoint);handler=fn;}})};
  createCloudApi2HardwareRouter({express,...providers()});
  assert.deepEqual(methods,['/hardware/rc-plus2-m4t']);
  const response={
    headers:{},statusCode:200,body:null,
    set(name,value){this.headers[name]=value;return this;},
    status(code){this.statusCode=code;return this;},
    json(body){this.body=body;return this;}
  };
  await handler({},response);
  assert.equal(response.statusCode,200);
  assert.equal(response.headers['Cache-Control'],'no-store');
  assert.equal(response.body.result,'INCOMPLETE');
  let failing;
  createCloudApi2HardwareRouter({express:{Router:()=>({
    get:(_endpoint,fn)=>{failing=fn;}
  })},registry:{snapshot:()=>{throw Error('SECRET_SN_PRIVATE');}}});
  await failing({},response);
  assert.equal(response.statusCode,503);
  assert.deepEqual(response.body,{error:'Hardware evidence unavailable'});
});
test('hardware route is behind central auth and not in the token-free LAN allowlist',()=>{
  const server=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
  const policy=fs.readFileSync(path.join(__dirname,'../http-auth.js'),'utf8');
  const auth=server.indexOf("app.use('/api',auth);");
  const mount=server.indexOf("app.use('/api/cloud-api2',createCloudApi2HardwareRouter");
  assert.ok(auth>0&&mount>auth);
  assert.equal(policy.includes("'/cloud-api2/hardware/rc-plus2-m4t'"),false);
  const browser=fs.readFileSync(path.join(__dirname,'../../frontend/public/cloud-api2.js'),'utf8');
  const html=fs.readFileSync(path.join(__dirname,'../../frontend/public/cloud-api2.html'),'utf8');
  assert.match(browser,/get\('loadM4tHardware'\)\.addEventListener\('click',inspectM4tHardware\)/);
  assert.match(html,/id="view-m4t-hardware"/);
  assert.match(html,/id="m4tReceiptFile"/);
  assert.doesNotMatch(browser,/mqtt\.publish\s*\(|flighttask_prepare|drcSendStickControl/i);
});
test('browser SDK only adds explicit same-origin GET hardware evidence request',async()=>{
  const {SkyHubDaaSClient}=await import('../../frontend/public/cloud-api2-sdk.mjs');
  const calls=[];
  const client=new SkyHubDaaSClient({fetchImpl:async(url,options)=>{
    calls.push([url,options]);return {ok:true,json:async()=>({schema:'dummy'})};
  }});
  await client.getRcPlus2M4tEvidence();
  assert.equal(calls.length,1);
  assert.equal(calls[0][0],'/api/cloud-api2/hardware/rc-plus2-m4t');
  assert.equal(calls[0][1].method,'GET');
  assert.equal(calls[0][1].cache,'no-store');
  assert.equal(calls[0][1].credentials,'same-origin');
  await assert.rejects(client.query('drc/start'),/Read-only/);
});

test('browser accepts exactly the three redacted evidence receipt modes',async()=>{
  const {normalizeHardwareReceipt,validateHardwareReceipt}=await import('../../frontend/public/cloud-api2-hardware.mjs');
  const p=makePreflightEvidence({
    schema:'skyhub-rcplus2-m4t-preflight-v1',
    healthApi:true,devicesApi:true,shapesApi:true,pairingsApi:true,
    mqttConnected:true,subscribed:true,topologyAckEnabled:true,topologyAckConnected:true
  },DATE);
  const r=makeRuntimeEvidence({
    schema:'skyhub-rcplus2-m4t-runtime-check-v1',
    evaluatorAvailable:true,evidenceAvailable:false
  },DATE);
  const live=makeLiveEvidence(positiveReport,DATE);
  assert.equal(validateHardwareReceipt(p,now+1000),true);
  assert.equal(validateHardwareReceipt(r,now+1000),true);
  assert.equal(validateHardwareReceipt(live,now+1000),true);
  assert.equal(normalizeHardwareReceipt(p,{now:now+1000}).result,'READY');
  assert.equal(normalizeHardwareReceipt(r,{now:now+1000}).result,'INCOMPLETE');
  const norm=normalizeHardwareReceipt(live,{origin:'backend-live',now:now+1000});
  assert.equal(norm.result,'TRANSPORT_SMOKE_OK');
  assert.equal(norm.origin,'SkyHub-Backend');
  assert.equal(norm.timeClass,'AKTUELL');
  assert.equal(norm.hardwareAcceptanceComplete,false);
  assert.equal(norm.flightReady,false);
  assert.equal(norm.dispatchAllowed,false);
  assert.equal(norm.checks.find(x=>x.name==='Matrice 4T: beobachtete Felder').status,'100');
  assert.equal(JSON.stringify(norm).includes('SECRET_'),false);
  assert.equal(normalizeHardwareReceipt(live,{now:now+3600000}).timeClass,'HISTORISCH');
  assert.throws(()=>normalizeHardwareReceipt({...live,serial:'SECRET_SN'},{now:now+1000}));
  assert.throws(()=>normalizeHardwareReceipt({...live,flightReady:true},{now:now+1000}));
  assert.throws(()=>normalizeHardwareReceipt({...live,result:'INCOMPLETE'},{now:now+1000}));
  assert.throws(()=>normalizeHardwareReceipt({...live,controller:{...live.controller,token:'SECRET'}},{now:now+1000}));
  assert.throws(()=>normalizeHardwareReceipt({...live,measuredAt:'2036-11-06T22:00:00.000Z'},{now:now+1000}));
  assert.throws(()=>normalizeHardwareReceipt({...p,checks:{...p.checks,apiToken:'SECRET'}},{now:now+1000}));
});
