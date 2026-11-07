'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {SCHEMA,collectEvidence,createCloudApi2EvidenceRouter}=require('../cloud-api2-evidence');

test('evidence includes only inventory counts, not raw mission, GPS, serial or media keys',async()=>{
  const snapshot=await collectEvidence({
    wpmlStore:{status:async()=>({status:'online',bucket:'private-bucket'}),
      list:async(opts)=>{assert.deepEqual(opts,{page:1,pageSize:1});return {list:[{name:'SECRET-MISSION',location:'49.99'}],pagination:{total:7}};}},
    ppkFlights:{list:async()=>[{name:'SECRET-FLIGHT',photos:10,position:{lat:49.99,lon:8.55}},{photos:1}]},
    mediaStorage:{buckets:async()=>['private-bucket']},
    mediaIndex:async()=>({objects:[{key:'SECRET-SERIAL_DJI_002_T.JPG'},{key:'DJI_002_V.JPG'}]})
  });
  assert.equal(snapshot.schema,SCHEMA);
  assert.equal(snapshot.modules.mission.count,7);
  assert.equal(snapshot.modules.mapping.count,1);
  assert.equal(snapshot.modules.thermal.count,1);
  assert.equal(snapshot.modules.mission.status,'observed');
  assert.equal(snapshot.hardwareVerified,false);
  assert.equal(snapshot.accuracyVerified,false);
  assert.equal(snapshot.flightReady,false);
  assert.equal(snapshot.deviceCorrelation,'not-established');
  assert.equal(snapshot.synthetic,false);
  assert.equal(snapshot.modules.mapping.evidenceKind,'flight-inputs-not-coverage-results');
  assert.equal(snapshot.modules.thermal.accuracyVerified,false);
  const json=JSON.stringify(snapshot);
  for(const token of ['private-bucket','SECRET-MISSION','SECRET-FLIGHT','SECRET-SERIAL','49.99','8.55']){
    assert.equal(json.includes(token),false,token+' leaked');
  }
});

test('disabled, failed, and suspiciously large sources fail closed',async()=>{
  const absent=await collectEvidence();
  for(const module of Object.values(absent.modules)){
    assert.equal(module.status,'unavailable');assert.equal(module.count,null);
  }
  const failed=await collectEvidence({
    wpmlStore:{status:async()=>({status:'online'}),list:async()=>{throw Error('SECRET-KMZ')}},
    ppkFlights:{list:async()=>{throw Error('SECRET-POSITION')}},
    mediaStorage:{buckets:async()=>Array.from({length:9},(_,i)=>'bucket'+i)},
    mediaIndex:async()=>{throw Error('SECRET-BUCKET')}
  });
  for(const module of Object.values(failed.modules)){
    assert.equal(module.status,'unknown');assert.equal(module.count,null);
  }
  assert.doesNotMatch(JSON.stringify(failed),/SECRET-/);
});

test('empty catalog is not a verified mapping, thermal or mission release',async()=>{
  const empty=await collectEvidence({
    wpmlStore:{status:async()=>({status:'online'}),list:async()=>({pagination:{total:0}})},
    ppkFlights:{list:async()=>[]},
    mediaStorage:{buckets:async()=>[]},
    mediaIndex:async()=>({objects:[]})
  });
  for(const result of Object.values(empty.modules)){
    assert.equal(result.status,'empty');assert.equal(result.count,0);
    assert.equal(result.flightReady,false);
  }
});

test('evidence route exposes one explicit GET and remains behind existing authorization',async()=>{
  const methods=[],router={get:(route,handler)=>methods.push({route,handler})};
  createCloudApi2EvidenceRouter({express:{Router:()=>router}});
  assert.deepEqual(methods.map(m=>m.route),['/evidence']);
  assert.equal(methods.length,1);
  const server=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
  const auth=server.indexOf("app.use('/api',auth);");
  const evidence=server.indexOf("app.use('/api/cloud-api2',createCloudApi2EvidenceRouter");
  const storage=server.indexOf('const ppkFlights=');
  assert.ok(auth>=0 && evidence>auth && evidence>storage);
  const policy=fs.readFileSync(path.join(__dirname,'../http-auth.js'),'utf8');
  assert.equal(policy.includes("'/cloud-api2/evidence'"),false);
});

test('same-origin client only performs GET evidence and normalizer rejects unsafe metadata',async()=>{
  const {SkyHubDaaSClient}=await import('../../frontend/public/cloud-api2-sdk.mjs');
  const {normalizeEvidence}=await import('../../frontend/public/cloud-api2-evidence.mjs');
  const calls=[];
  const client=new SkyHubDaaSClient({fetchImpl:async(url,options)=>{
    calls.push({url,options});return {ok:true,json:async()=>({})};
  }});
  await client.getEvidence();
  assert.deepEqual(calls.map(x=>x.url),['/api/cloud-api2/evidence']);
  assert.equal(calls[0].options.method,'GET');
  assert.equal(calls[0].options.credentials,'same-origin');
  const base=await collectEvidence();
  const normalized=normalizeEvidence(base);
  assert.equal(normalized.modules.length,3);
  assert.equal(normalized.flightReady,false);
  assert.throws(()=>normalizeEvidence({...base,flightReady:true}),/Ungültiger/);
  assert.throws(()=>normalizeEvidence({...base,deviceCorrelation:'linked'}),/Ungültiger/);
  assert.throws(()=>normalizeEvidence({...base,accuracyVerified:true}),/Ungültiger/);
});

test('evidence UI has no automatic fetch and keeps read-only labels',()=>{
  const root=path.resolve(__dirname,'../../frontend/public');
  const html=fs.readFileSync(path.join(root,'cloud-api2.html'),'utf8');
  const js=fs.readFileSync(path.join(root,'cloud-api2.js'),'utf8');
  assert.match(html,/id="loadEvidence"/);
  assert.match(html,/id="evidenceModules"/);
  assert.match(js,/get\('loadEvidence'\)\.addEventListener\('click',inspectEvidence\)/);
  assert.doesNotMatch(js,/mqtt\.publish\s*\(|flighttask_prepare|drcSendStickControl/i);
  assert.match(html,/ANSICHTSTOKEN ERFORDERLICH/);
});
