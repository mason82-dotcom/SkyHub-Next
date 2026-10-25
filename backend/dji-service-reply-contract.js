'use strict';

// Isolated, read-only DJI services_reply contract. No MQTT subscriptions, publishes,
// commands, timers, secret storage or live server changes are performed here.
const MAX_REPLY_BYTES=131072;
const MAX_REPLY_AGE_MS=300000;
const MAX_FUTURE_SKEW_MS=30000;
const ID=/^[A-Za-z0-9_.-]{1,100}$/;
const METHOD=/^[a-z][a-z0-9_]{0,79}$/;
const STAGES=new Set(['sent','in_progress','paused','ok','rejected','failed','canceled','timeout']);
const FINISHED=new Set(['ok','rejected','failed','canceled','timeout']);

function invalid(){throw new Error('Invalid DJI service reply');}
function object(value){return value!==null&&typeof value==='object'&&!Array.isArray(value);}
function identifier(value){return typeof value==='string'&&ID.test(value);}
function methodName(value){return typeof value==='string'&&METHOD.test(value);}

function parseServiceReply(topic,payload,{retained=false,now=Date.now()}={}){
  // The device identifier comes from the MQTT topic, not an untrusted payload field.
  if(retained || !Number.isSafeInteger(now)) invalid();
  const match=typeof topic==='string'&&/^thing\/product\/([^/]{1,100})\/services_reply$/.exec(topic);
  if(!match||!identifier(match[1])) invalid();
  if(!Buffer.isBuffer(payload)&&typeof payload!=='string') invalid();
  const length=Buffer.isBuffer(payload)?payload.length:Buffer.byteLength(payload,'utf8');
  if(!length||length>MAX_REPLY_BYTES) invalid();
  let envelope;
  try{envelope=JSON.parse(payload.toString());}catch(_err){invalid();}
  if(!object(envelope)||!object(envelope.data)) invalid();
  if(!identifier(envelope.tid)||!identifier(envelope.bid)) invalid();
  if(envelope.gateway!==undefined&&envelope.gateway!==match[1]) invalid();
  if(!Number.isSafeInteger(envelope.timestamp)||envelope.timestamp<1e12||
     envelope.timestamp>1e15||envelope.timestamp>now+MAX_FUTURE_SKEW_MS||
     now-envelope.timestamp>MAX_REPLY_AGE_MS) invalid();
  if(envelope.method!==undefined&&!methodName(envelope.method)) invalid();
  const data=envelope.data;
  const status=data.status===undefined?null:data.status;
  if(status!==null&&!STAGES.has(status)) invalid();
  const code=object(data.result)?data.result.code:data.result;
  const result=code===undefined?null:code;
  if(result!==null&&(!Number.isSafeInteger(result)||result<-2147483648||result>2147483647)) invalid();
  if(status===null&&result===null) invalid();
  // Deliberately drop arbitrary payload keys: secrets, task parameters and progress.
  return Object.freeze({
    gatewaySn:match[1],tid:envelope.tid,bid:envelope.bid,
    method:envelope.method??null,timestamp:envelope.timestamp,
    status,result,terminal:(result!==null&&result!==0)||
      (status===null&&result!==null)||FINISHED.has(status)
  });
}

function correlateServiceReply(expected,reply,{now=Date.now(),ttlMs=30000}={}){
  // Nothing is resolved or sent here; a future command manager owns timeouts,
  // permissions, task state and transitions. Comparison never uses raw payloads.
  if(!object(expected)||!object(reply)||!identifier(expected.gatewaySn)||
     !identifier(expected.tid)||!identifier(expected.bid)||
     (expected.method!=null&&!methodName(expected.method))||
     !Number.isSafeInteger(expected.sentAt)||!Number.isSafeInteger(now)||
     !Number.isSafeInteger(ttlMs)||ttlMs<1||ttlMs>3600000)
    return {matched:false,reason:'invalid'};
  if(now<expected.sentAt||now-expected.sentAt>ttlMs)
    return {matched:false,reason:'expired'};
  if(reply.gatewaySn!==expected.gatewaySn||reply.tid!==expected.tid||
     reply.bid!==expected.bid||
     (expected.method&&reply.method&&expected.method!==reply.method))
    return {matched:false,reason:'mismatch'};
  if(!Number.isSafeInteger(reply.timestamp)||reply.timestamp<expected.sentAt-MAX_FUTURE_SKEW_MS)
    return {matched:false,reason:'stale'};
  return {
    matched:true,terminal:reply.terminal===true,
    success:reply.terminal===true&&reply.result===0&&
      (reply.status===null||reply.status==='ok'),
    status:reply.status,result:reply.result
  };
}

module.exports={parseServiceReply,correlateServiceReply,
  MAX_REPLY_BYTES,MAX_REPLY_AGE_MS,MAX_FUTURE_SKEW_MS};
