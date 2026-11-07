'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {makeLiveEvidence,validateLiveEvidenceReceipt}=require('../rc-plus2-m4t-evidence');

const cli=path.resolve(__dirname,'../../scripts/pi-rc-plus2-m4t-check.js');
const fakeDocker=String.raw`#!/usr/bin/env node
'use strict';
const path=require('node:path');
const {createRequire}=require('node:module');
const args=process.argv.slice(2);
const index=args.indexOf('-e');
if(index<0||!args[index+1])process.exit(4);
const backendRequire=createRequire(process.env.TEST_BACKEND_ENTRY);
const now=Date.now();
const rc={
 sn:'PRIVATE_RC_123',role:'gateway',model:{domain:'2',type:174,subType:0},
 children:['PRIVATE_M4T_456'],topologyOnline:true,fresh:true,
 lastTelemetryAt:now-1000,
 propertyProfile:{name:'rcPlus2'},
 deviceProperties:{osd:{capacity_percent:80},state:{}},
 propertyObservedAt:{osd:now-1000},
 propertyFieldObservedAt:{osd:{capacity_percent:now-1000},state:{}}
};
const air={
 sn:'PRIVATE_M4T_456',role:'subdevice',deviceCategory:'aircraft',
 gatewaySn:'PRIVATE_RC_123',model:{domain:'0',type:99,subType:1},
 topologyOnline:true,aircraftConnected:true,fresh:true,lastTelemetryAt:now-1100,
 propertyProfile:{name:'matrice4T'},
 deviceProperties:{osd:{mode_code:0,latitude:49.123456,longitude:8.123456},state:{}},
 propertyObservedAt:{osd:now-1100},
 propertyFieldObservedAt:{osd:{mode_code:now-1100,latitude:now-1100,longitude:now-1100},state:{}}
};
const data={
 '/api/health':{mqtt:true,subscribed:true,topologyReplyEnabled:true,
  topologyReplyConnected:true,privateCredential:'PRIVATE_HEALTH'},
 '/api/devices':[rc,air],
 '/api/diagnostics/mqtt-shapes':[],
 '/api/pilot-admin/pairings':{
   devices:[{model:'DJI RC Plus 2 Enterprise',lastUsedAt:now-800,
    token:'PRIVATE_TOKEN',id:'PRIVATE_PAIR'}],
   pending:[{code:'654321',model:'DJI RC Pro Enterprise'}]
 }
};
process.env.SKYHUB_VIEW_TOKEN='PRIVATE_VIEW_TOKEN';
const mockedRequire=id=>{
 if(process.env.TEST_NO_MODULE==='1'&&id.includes('rc-plus2-m4t-evidence')){
   throw Error('no runtime evidence module');
 }
 if(process.env.TEST_INJECT_SECRET==='1'&&id.includes('rc-plus2-m4t-evidence')){
   return {makeLiveEvidence:()=>{
     const r=backendRequire(id).makeLiveEvidence(
       backendRequire('./rc-plus2-m4t-hardware-validation')
         .evaluateHardwareSession([rc,air],data['/api/health'],[],now,
           data['/api/pilot-admin/pairings']));
     return {...r,PRIVATE_TOKEN:'LEAK'};
   }};
 }
 return backendRequire(id);
};
const fetch=async url=>{
 if(process.env.TEST_FAIL_GET&&url.endsWith(process.env.TEST_FAIL_GET))return {ok:false};
 return {ok:true,json:async()=>data[new URL(url).pathname]};
};
new Function('require','fetch',args[index+1])(mockedRequire,fetch);
`;
function run(testEnv={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'skyhub-livejson-'));
 try{
   fs.writeFileSync(path.join(dir,'docker'),fakeDocker,{mode:0o700});
   return spawnSync(process.execPath,[cli,'--json'],{
     cwd:dir,encoding:'utf8',timeout:10000,
     env:{...process.env,PATH:dir+path.delimiter+process.env.PATH,
       SKYHUB_COMPOSE_DIR:dir,
       TEST_BACKEND_ENTRY:path.resolve(__dirname,'../server.js'),
       ...testEnv}
   });
 }finally{fs.rmSync(dir,{force:true,recursive:true});}
}
test('live JSON receipt is projected inside Docker and hides original GET data',()=>{
 const r=run();
 assert.equal(r.status,0,r.stderr);
 const receipt=JSON.parse(r.stdout);
 assert.equal(receipt.mode,'live-transport-smoke');
 assert.equal(receipt.result,'TRANSPORT_SMOKE_OK');
 assert.equal(receipt.hardwareAcceptanceComplete,false);
 assert.equal(receipt.flightReady,false);
 assert.equal(receipt.dispatchAllowed,false);
 assert.equal(receipt.linkedPairs,1);
 assert.equal(receipt.aircraft.staticFieldsDocumented,202);
 assert.equal(validateLiveEvidenceReceipt(receipt),true);
 for(const secret of ['PRIVATE_','49.123456','8.123456','654321']){
   assert.ok(!r.stdout.includes(secret),secret+' leaked across boundary');
 }
});
test('older runtime missing evidence module fails closed without snapshot fallback',()=>{
 const r=run({TEST_NO_MODULE:'1'});
 assert.equal(r.status,3,r.stderr);
 assert.equal(r.stdout,'');
 assert.match(r.stderr,/Evidence-Module nicht/);
 assert.doesNotMatch(r.stderr,/PRIVATE_|49.123456|654321/);
});
test('a failing GET is an incomplete prerequisite (exit 3) like in preflight, without receipt',()=>{
 const r=run({TEST_FAIL_GET:'/api/diagnostics/mqtt-shapes'});
 assert.equal(r.status,3,r.stderr);
 assert.equal(r.stdout,'');
 assert.match(r.stderr,/API antwortet nicht/);
 assert.doesNotMatch(r.stderr,/PRIVATE_/);
});
test('host rejects injected unapproved keys before printing JSON receipt',()=>{
 const r=run({TEST_INJECT_SECRET:'1'});
 assert.equal(r.status,1,r.stderr);
 assert.equal(r.stdout,'');
 assert.doesNotMatch(r.stderr,/LEAK|PRIVATE_/);
});
test('live receipt validation rejects unapproved fields and false flight readiness',()=>{
 const valid=makeLiveEvidence({
  passed:false,transportPassed:false,pairingConfirmed:false,
  transport:{},pairing:{available:false},candidateCount:{linkedPairs:0},
  controller:{},aircraft:{}
 },new Date('2026-10-24T09:00:00.000Z'));
 assert.equal(validateLiveEvidenceReceipt(valid),true);
 assert.equal(validateLiveEvidenceReceipt({...valid,deviceId:'PRIVATE'}),false);
 assert.equal(validateLiveEvidenceReceipt({...valid,flightReady:true}),false);
 assert.equal(validateLiveEvidenceReceipt({...valid,measuredAt:'PRIVATE'}),false);
 assert.equal(validateLiveEvidenceReceipt({...valid,controller:{...valid.controller,raw:'PRIVATE'}}),false);
 assert.equal(validateLiveEvidenceReceipt({...valid,result:'TRANSPORT_SMOKE_OK'}),false);
});
