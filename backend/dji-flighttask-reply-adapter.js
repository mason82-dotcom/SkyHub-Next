'use strict';

// Offline-only integration of the isolated SkyHub services_reply parser and the
// flighttask observation reducer. No transport, broker, command dispatch or persistence.
const {parseServiceReply,correlateServiceReply}=require('./dji-service-reply-contract');
const {
  parseFlighttaskProgressEvent,advanceFlighttaskObservation,SCHEMA
}=require('./dji-flighttask-observation');

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SIGNED=value=>Number.isSafeInteger(value)&&value>=-2147483648&&value<=2147483647;
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);

function blocked(state,reason){return Object.freeze({state,applied:false,reason});}
function validState(state){
  const r=state?.request;
  return obj(state)&&state.schema===SCHEMA&&obj(r)&&
    r.method==='flighttask_execute'&&UUID.test(r.tid??'')&&UUID.test(r.bid??'')&&
    Number.isSafeInteger(r.sentAt)&&Number.isSafeInteger(r.expiresAt)&&
    r.expiresAt>r.sentAt&&r.expiresAt-r.sentAt<=3600000;
}

// Only the method-specific, independently documented response shape is supported.
// flighttask_execute: data.result = int; output may be omitted or null.
// The separate RPC prototype's nested {result:{code:...}} shape remains unverified;
// never upgrade that candidate to an acknowledged DJI flighttask request.
function supportedExecuteReplyShape(payload){
  let e;
  try{e=JSON.parse(payload.toString());}catch(_error){return false;}
  if(!obj(e)||!obj(e.data))return false;
  const keys=Object.keys(e.data);
  if(!SIGNED(e.data.result)||keys.length<1||keys.length>2)return false;
  if(keys.some(k=>k!=='result'&&k!=='output'))return false;
  return !Object.hasOwn(e.data,'output')||e.data.output===null;
}

function observeFlighttaskServiceReply(state,topic,payload,options={}){
  if(!validState(state))throw new Error('Invalid flighttask reply observation state');
  const now=options.now??Date.now();
  if(!Number.isSafeInteger(now)||now<1e12||now>1e15)
    return blocked(state,'invalid-observation-time');
  let reply;
  try{
    reply=parseServiceReply(topic,payload,{now,retained:options.retained===true});
  }catch(_error){
    return blocked(state,'invalid-service-reply');
  }
  if(reply.method!==state.request.method)
    return blocked(state,'method-not-correlated');
  if(!supportedExecuteReplyShape(payload))
    return blocked(state,'unsupported-reply-shape');
  if(!UUID.test(reply.tid)||!UUID.test(reply.bid)||reply.status!==null||!SIGNED(reply.result))
    return blocked(state,'invalid-execute-reply');
  const expected=state.request;
  const correlation=correlateServiceReply(expected,reply,{
    now,ttlMs:expected.expiresAt-expected.sentAt
  });
  if(!correlation.matched)
    return blocked(state,'correlation-'+correlation.reason);
  // Do not consume correlation.success or reply.terminal for mission completion.
  // Only a correlated flighttask_progress event can produce reported_ok.
  return advanceFlighttaskObservation(state,{
    kind:'service_reply',reply
  },{now});
}

function observeFlighttaskProgressEvent(state,topic,payload,options={}){
  if(!validState(state))throw new Error('Invalid flighttask event observation state');
  const now=options.now??Date.now();
  let event;
  try{
    event=parseFlighttaskProgressEvent(topic,payload,{now,retained:options.retained===true});
  }catch(_error){
    return blocked(state,'invalid-flighttask-event');
  }
  return advanceFlighttaskObservation(state,{kind:'flighttask_progress',event},{now});
}

module.exports={
  observeFlighttaskServiceReply,
  observeFlighttaskProgressEvent,
  supportedExecuteReplyShape
};
