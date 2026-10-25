'use strict';

// Observation only: this module has no transport, command sender, database, timers or GPIO.
// A services_reply result=0 acknowledges a request, NOT aircraft/mission completion.
// Input contract for service replies: projected output of isolated
// dji-service-reply-contract.js on feature/dji-demo-rpc-contract-20261022.
// This module intentionally does not copy or import that branch's parser.
const SCHEMA='skyhub-dji-flighttask-observation-v1';
const ID=/^[A-Za-z0-9_.-]{1,100}$/;
const MAX_BYTES=131072;
const MAX_AGE_MS=300000;
const MAX_SKEW_MS=30000;
const STATUSES=new Set(['sent','in_progress','paused','ok','failed','canceled']);
const FINAL=new Set(['conflicting_reports','reply_rejected','expired_unverified']);
const TERMINAL_REPORTS=new Set(['reported_ok','reported_failed','reported_canceled']);

const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const id=x=>typeof x==='string'&&ID.test(x);
const instant=x=>Number.isSafeInteger(x)&&x>=1e12&&x<=1e15;
const signed=x=>Number.isSafeInteger(x)&&x>=-2147483648&&x<=2147483647;

function seal(state){
  Object.freeze(state.request);
  Object.freeze(state.reply);
  Object.freeze(state.progress);
  return Object.freeze(state);
}
function beginFlighttaskObservation(request,{ttlMs=900000}={}){
  if(!obj(request)||!id(request.gatewaySn)||!id(request.tid)||
     !id(request.bid)||!id(request.flightId)||request.method!=='flighttask_execute'||
     !instant(request.sentAt)||!Number.isSafeInteger(ttlMs)||
     ttlMs<1000||ttlMs>3600000)throw new Error('Invalid flighttask observation request');
  return seal({
    schema:SCHEMA,
    request:{
      gatewaySn:request.gatewaySn,tid:request.tid,bid:request.bid,
      method:request.method,flightId:request.flightId,
      sentAt:request.sentAt,expiresAt:request.sentAt+ttlMs
    },
    phase:'awaiting_reply',
    reply:{result:null,timestamp:null},
    progress:{status:null,result:null,timestamp:null},
    // Observing progress is never a DJI flight-ready or device certification.
    flightReady:false,hardwareVerified:false
  });
}

function parseFlighttaskProgressEvent(topic,payload,{now=Date.now(),retained=false}={}){
  if(retained||!instant(now)||typeof topic!=='string'||!/^thing\/product\/[A-Za-z0-9_.-]{1,100}\/events$/.test(topic))
    throw new Error('Invalid flighttask progress event');
  if(!Buffer.isBuffer(payload)&&typeof payload!=='string')
    throw new Error('Invalid flighttask progress event');
  const bytes=Buffer.isBuffer(payload)?payload.length:Buffer.byteLength(payload);
  if(!bytes||bytes>MAX_BYTES)throw new Error('Invalid flighttask progress event');
  let e;
  try{e=JSON.parse(payload.toString());}catch(_err){throw new Error('Invalid flighttask progress event');}
  const gatewaySn=topic.split('/')[2];
  const data=e?.data, output=data?.output, ext=output?.ext;
  if(!obj(e)||e.method!=='flighttask_progress'||!obj(data)||!obj(output)||
     !obj(ext)||!id(ext.flight_id)||!signed(data.result)||
     !STATUSES.has(output.status)||!instant(e.timestamp)||
     e.timestamp>now+MAX_SKEW_MS||now-e.timestamp>MAX_AGE_MS||
     (e.gateway!==undefined&&e.gateway!==gatewaySn))
    throw new Error('Invalid flighttask progress event');
  // Drop coordinates, waypoints, nested data, payload, raw IDs other than flight ID.
  return Object.freeze({
    gatewaySn,method:'flighttask_progress',flightId:ext.flight_id,
    timestamp:e.timestamp,result:data.result,status:output.status
  });
}

function advanceFlighttaskObservation(current,observation,{now=Date.now()}={}){
  if(!obj(current)||current.schema!==SCHEMA||!obj(current.request)||
     !obj(current.reply)||!obj(current.progress)||!obj(observation)||!instant(now))
    throw new Error('Invalid flighttask observation transition');
  const r=current.request;
  if(FINAL.has(current.phase))return {state:current,applied:false,reason:'finalized'};
  if(now<r.sentAt)return {state:current,applied:false,reason:'clock-before-request'};
  if(now>r.expiresAt){
    if(TERMINAL_REPORTS.has(current.phase))
      return {state:current,applied:false,reason:'terminal-report-recorded'};
    const state=seal({...current,phase:'expired_unverified'});
    return {state,applied:true,reason:'observation-expired'};
  }
  if(observation.kind==='clock')return {state:current,applied:false,reason:'no-change'};
  if(observation.kind==='service_reply'){
    const p=observation.reply;
    if(!obj(p)||p.gatewaySn!==r.gatewaySn||p.tid!==r.tid||
       p.bid!==r.bid||p.method!==r.method||!instant(p.timestamp)||
       !signed(p.result)||p.timestamp<r.sentAt||
       p.timestamp>now+MAX_SKEW_MS||now-p.timestamp>MAX_AGE_MS)
      return {state:current,applied:false,reason:'reply-not-correlated'};
    if(current.reply.result!==null){
      if(current.reply.result===p.result&&current.reply.timestamp===p.timestamp)
        return {state:current,applied:false,reason:'duplicate-reply'};
      const state=seal({...current,phase:'conflicting_reports'});
      return {state,applied:true,reason:'contradictory-reply'};
    }
    const state=seal({
      ...current,phase:p.result===0?'reply_accepted':'reply_rejected',
      reply:{result:p.result,timestamp:p.timestamp}
    });
    return {state,applied:true,reason:p.result===0?'request-acknowledged':'request-rejected'};
  }
  if(observation.kind==='flighttask_progress'){
    const p=observation.event;
    if(!obj(p)||p.gatewaySn!==r.gatewaySn||p.flightId!==r.flightId||
       p.method!=='flighttask_progress'||!instant(p.timestamp)||
       !signed(p.result)||!STATUSES.has(p.status)||
       p.timestamp<r.sentAt||p.timestamp>now+MAX_SKEW_MS||
       now-p.timestamp>MAX_AGE_MS)
      return {state:current,applied:false,reason:'event-not-correlated'};
    if(current.reply.result!==0)
      return {state:current,applied:false,reason:'missing-accepted-reply'};
    if(current.progress.timestamp!==null){
      if(p.timestamp<current.progress.timestamp)
        return {state:current,applied:false,reason:'replayed-event'};
      if(p.timestamp===current.progress.timestamp){
        if(p.status===current.progress.status&&p.result===current.progress.result)
          return {state:current,applied:false,reason:'duplicate-event'};
        const state=seal({...current,phase:'conflicting_reports'});
        return {state,applied:true,reason:'contradictory-event'};
      }
    }
    // A device-reported terminal status is evidence, not independent flight verification.
    const phase=p.result!==0||p.status==='failed'?'reported_failed':
      p.status==='canceled'?'reported_canceled':
      p.status==='ok'?'reported_ok':'reported_'+p.status;
    if(TERMINAL_REPORTS.has(current.phase)){
      if(phase!==current.phase){
        const state=seal({...current,phase:'conflicting_reports'});
        return {state,applied:true,reason:'contradictory-terminal-report'};
      }
      return {state:current,applied:false,reason:'duplicate-terminal-report'};
    }
    const state=seal({
      ...current,phase,
      progress:{status:p.status,result:p.result,timestamp:p.timestamp}
    });
    return {state,applied:true,reason:'progress-observed'};
  }
  return {state:current,applied:false,reason:'unsupported-observation'};
}

function summarizeFlighttaskObservation(state){
  if(!obj(state)||state.schema!==SCHEMA)throw new Error('Invalid flighttask observation');
  // No request metadata, flight identifiers, telemetry or DJI raw payloads in the report.
  return Object.freeze({
    schema:SCHEMA,phase:state.phase,
    serviceReplyObserved:state.reply.result!==null,
    serviceReplyAccepted:state.reply.result===0,
    progressObserved:state.progress.status!==null,
    missionReportedComplete:state.phase==='reported_ok',
    operationVerified:false,
    hardwareVerified:false,flightReady:false
  });
}
module.exports={
  SCHEMA,beginFlighttaskObservation,parseFlighttaskProgressEvent,
  advanceFlighttaskObservation,summarizeFlighttaskObservation
};
