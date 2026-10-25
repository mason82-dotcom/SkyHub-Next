'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {GATEWAY,FLIGHT_ID,ALLOWED,requestEnvelope,replyMatches,validProgress}
  =require('./mission-probe');
const UUID=crypto.randomUUID();
const BID=crypto.randomUUID();
test('hardcoded mission scope cannot address a production device or method',()=>{
 assert.match(GATEWAY,/^7UUXN[A-Z0-9]{9}$/);
 assert.deepEqual(ALLOWED,['flighttask_prepare','flighttask_execute','flighttask_pause','flighttask_recovery','flighttask_undo','flighttask_stop']);
 assert.throws(()=>requestEnvelope('flighttask_undo',{flight_ids:['real-mission']},UUID,BID));
 assert.throws(()=>requestEnvelope('flighttask_stop',{flight_id:FLIGHT_ID,reason:1},UUID,BID));
 assert.throws(()=>requestEnvelope('takeoff_to_point',{},UUID,BID));
 assert.throws(()=>requestEnvelope('flighttask_execute',{flight_id:'real-flight'},UUID,BID));
 assert.throws(()=>requestEnvelope('flighttask_prepare',{},UUID,BID));
 assert.throws(()=>requestEnvelope('flighttask_prepare',{flight_id:FLIGHT_ID},'bad',BID));
 const x=requestEnvelope('flighttask_prepare',{flight_id:FLIGHT_ID},UUID,BID,1790000000000);
 assert.equal(x.gateway,GATEWAY);assert.equal(x.method,'flighttask_prepare');
 assert.equal(x.timestamp,1790000000000);
});
test('strict request/reply tid/bid/method correlation',()=>{
 const req=requestEnvelope('flighttask_pause',{},UUID,BID,1790000000000);
 const response={tid:UUID,bid:BID,method:'flighttask_pause',gateway:GATEWAY,
   timestamp:1790000000001,data:{result:0}};
 assert.equal(replyMatches(response,req),true);
 assert.equal(replyMatches({...response,data:{result:326109}},req,326109),true);
 assert.equal(replyMatches({...response,data:{result:0}},req,326109),false);
 for(const bad of [
   {...response,tid:crypto.randomUUID()},
   {...response,bid:crypto.randomUUID()},
   {...response,gateway:'outside-lab'},
   {...response,method:'return_home'},
   {...response,data:{result:1}},
   {...response,timestamp:null},
 ])assert.equal(replyMatches(bad,req),false);
});
test('only same synthetic flight_id and execution bid counts as progress',()=>{
 const progress={method:'flighttask_progress',bid:BID,gateway:GATEWAY,data:{
   result:0,output:{ext:{flight_id:FLIGHT_ID},status:'in_progress',
     progress:{current_step:0,percent:20}}}};
 assert.equal(validProgress(progress,BID),true);
 assert.equal(validProgress({...progress,bid:UUID},BID),false);
 assert.equal(validProgress({...progress,gateway:'real'},BID),false);
 assert.equal(validProgress({...progress,data:{...progress.data,output:{
   ...progress.data.output,ext:{flight_id:'real'}}}},BID),false);
 assert.equal(validProgress({...progress,data:{...progress.data,output:{
   ...progress.data.output,progress:{current_step:0,percent:111}}}},BID),false);
});
