'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createFhMsdkObserve}=require('../fh-msdk-observe');
const {createFhUgcsReader}=require('../fh-ugcs-reader');
const {fhMetrics}=require('../fh-metrics');
const token='x'.repeat(48);
function call(config={}){
 const handler=createFhMsdkObserve({observer:{observeMsdk:()=>true},
  registry:{get:()=>({sn:'AIR01',gatewaySn:'RC01',role:'subdevice'})},
  enabled:config.enabled??true,token,clock:()=>100000});
 const req={secure:config.secure??true,socket:{encrypted:false},
  get:()=>config.auth??('Bearer '+token),
  body:config.body??{aircraftSn:'AIR01',gatewaySn:'RC01',
   sampledAt:99999,values:{battery:50}}};
 const res={statusCode:200,status(n){this.statusCode=n;return this;},
  json(v){this.body=v;return this;}};
 handler(req,res);return res;
}
test('MSDK endpoint rejects disabled, cleartext and wrong auth',()=>{
 assert.equal(call({enabled:false}).statusCode,503);
 assert.equal(call({secure:false}).statusCode,403);
 assert.equal(call({auth:'Bearer invalid'}).statusCode,401);
 assert.equal(call().statusCode,202);
});
test('MSDK rejects unknown keys, commands and untrusted envelopes',()=>{
 assert.equal(call({body:{aircraftSn:'AIR01',gatewaySn:'RC01',
  sampledAt:99999,values:{flightControl:1}}}).statusCode,409);
 assert.equal(call({body:{aircraftSn:'AIR01',gatewaySn:'RC01',
  sampledAt:99999,values:{battery:50},secret:'NO'}}).statusCode,400);
});
test('UgCS GET only, internal bridge and secret redaction',async()=>{
 const urls=[];
 const r=createFhUgcsReader({baseUrl:'http://ugcs-bridge:8092/',
 fetchImpl:async(url,opts)=>{urls.push([url.href,opts.method]);return {
  ok:true,text:async()=>JSON.stringify([{id:'1',name:'Drone',password:'PRIVATE'}])
 };}});
 const result=await r.read('vehicles');
 assert.equal(result.status,200);
 assert.deepEqual(result.data.records,[{id:'1',name:'Drone'}]);
 assert.deepEqual(urls,[['http://ugcs-bridge:8092/vehicles','GET']]);
 assert.equal((await createFhUgcsReader().read('vehicles')).status,503);
 assert.throws(()=>createFhUgcsReader({baseUrl:'https://example.com/'}));
});
test('Prometheus metrics have no identifiers or labels',()=>{
 const txt=fhMetrics({metrics:()=>({accepted:5,trackedDevices:1})});
 assert.match(txt,/skyhub_fh_accepted 5/);
 assert.doesNotMatch(txt,/AIR|RC|latitude|\{/);
});
