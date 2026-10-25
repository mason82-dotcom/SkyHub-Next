'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {FLIGHT,COUNT,SN,METHODS,envelope,correlate,denyStorage,getJson} = require('./media-probe');
const sn='7UUXNABCDE1234',tid='f88caf13-0df1-44c7-a379-f1b7861a8c91',
  bid='f88caf13-0df1-44c7-a379-f1b7861a8c92',ts=1790000000000;
test('metadata-only media does not permit genuine device identities or extra files',()=>{
 assert.equal(SN.test(sn),true);
 assert.equal(SN.test('REAL_DOCK'),false);
 assert.equal(COUNT,2);assert.equal(FLIGHT,'skyhub-lab-media-01');
 assert.deepEqual(METHODS,['highest_priority_upload_flighttask_media','file_upload_callback']);
});
test('correlate event with reply and reject mismatches',()=>{
 const original={tid,bid,method:'file_upload_callback'};
 assert.equal(correlate(original,{...original,data:{result:0}}),true);
 assert.equal(correlate(original,{...original,tid:'bogus',data:{result:0}}),false);
 assert.equal(correlate(original,{...original,data:{result:1}}),false);
});
test('validate synthetic metadata only; reject arbitrary object keys',()=>{
 const topic='thing/product/'+sn+'/events',name='SIM_'+FLIGHT+'_1.jpg';
 const event={tid,bid,timestamp:ts,gateway:sn,method:'file_upload_callback',
 data:{file:{name,path:FLIGHT,object_key:'sim/'+FLIGHT+'/'+name,ext:{flight_id:FLIGHT}}}};
 assert.ok(envelope(topic,event,sn,ts));
 assert.equal(envelope(topic,{...event,gateway:'real'},sn,ts),null);
 assert.equal(envelope(topic,{...event,data:{file:{...event.data.file,object_key:'../secret'}}},sn,ts),null);
 assert.equal(envelope(topic,{...event,method:'hms'},sn,ts),null);
 assert.equal(envelope(topic,event,sn,ts+61000),null);
});
test('storage_config_get denies real STS and rejects output credentials',()=>{
 const request={tid,bid,gateway:sn,method:'storage_config_get'};
 assert.equal(denyStorage(request,{tid,bid,method:'storage_config_get',data:{result:1}},sn),true);
 assert.equal(denyStorage(request,{tid,bid,method:'storage_config_get',data:{
   result:1,output:{credentials:{access_key_id:'fake'}}}},sn),false);
 assert.equal(denyStorage(request,{tid,bid,method:'storage_config_get',data:{result:0}},sn),false);
 assert.equal(denyStorage(request,{tid:'bad',bid,method:'storage_config_get',data:{result:1}},sn),false);
});
test('media API URI allowlist rejects arbitrary network destinations before fetch',async()=>{
 await assert.rejects(()=>getJson('http://127.0.0.1:4000/api/media'));
 await assert.rejects(()=>getJson('http://hivemind-simulator:9090/api/not-media'));
});
