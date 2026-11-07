'use strict';

// OPTIONAL, ISOLATED PostgreSQL flighttask observation journal.
// Never invoked by backend/server.js. No schema migration at runtime.
// Caller must provide a scoped database client and enforce workspace authorization.
// This persists only the bounded, redacted observation state (not raw DJI messages).
const {
  beginFlighttaskObservation,advanceFlighttaskObservation,summarizeFlighttaskObservation,SCHEMA
}=require('./dji-flighttask-observation');
const {
  observeFlighttaskServiceReply,observeFlighttaskProgressEvent
}=require('./dji-flighttask-reply-adapter');

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ID=/^[A-Za-z0-9_.-]{1,100}$/;
const PHASE=new Set([
  'awaiting_reply','reply_accepted','reply_rejected',
  'reported_sent','reported_in_progress','reported_paused',
  'reported_ok','reported_failed','reported_canceled',
  'conflicting_reports','expired_unverified'
]);
const EVENT_STATUS=new Set(['sent','in_progress','paused','ok','failed','canceled']);
const MAX_RETRIES=6;
const MAX_SNAPSHOT_BYTES=2048;
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const time=x=>Number.isSafeInteger(x)&&x>=1e12&&x<=1e15;
const integer=x=>Number.isSafeInteger(x)&&x>=-2147483648&&x<=2147483647;
const id=x=>typeof x==='string'&&ID.test(x);
const uuid=x=>typeof x==='string'&&UUID.test(x);
const parseRevision=x=>{
  if(typeof x==='number')return Number.isSafeInteger(x)&&x>=1?x:null;
  if(typeof x!=='string'||!/^[1-9][0-9]*$/.test(x))return null;
  const n=Number(x);
  return Number.isSafeInteger(n)?n:null;
};
const invalidDbResponse=()=>new Error('Flighttask journal invalid storage response');
const exactKeys=(obj,keys)=>object(obj)&&
  Object.keys(obj).length===keys.length&&keys.every(key=>Object.hasOwn(obj,key));

function validateSnapshot(s){
  if(!exactKeys(s,['schema','request','phase','reply','progress','flightReady','hardwareVerified'])||
      s.schema!==SCHEMA||s.flightReady!==false||s.hardwareVerified!==false||
      !PHASE.has(s.phase)||!exactKeys(s.request,
        ['gatewaySn','tid','bid','method','flightId','sentAt','expiresAt'])||
      !exactKeys(s.reply,['result','timestamp'])||
      !exactKeys(s.progress,['status','result','timestamp']))return false;
  const r=s.request;
  if(!id(r.gatewaySn)||!uuid(r.tid)||!uuid(r.bid)||!id(r.flightId)||
     r.method!=='flighttask_execute'||!time(r.sentAt)||!time(r.expiresAt)||
     r.expiresAt<=r.sentAt||r.expiresAt-r.sentAt<1000||
     r.expiresAt-r.sentAt>3600000)return false;
  if(s.reply.result!==null&&!integer(s.reply.result))return false;
  if(s.reply.timestamp!==null&&!time(s.reply.timestamp))return false;
  if((s.reply.result===null)!==(s.reply.timestamp===null))return false;
  if(s.reply.timestamp!==null&&
     (s.reply.timestamp<r.sentAt||s.reply.timestamp>r.expiresAt+30000))return false;
  if(s.progress.status!==null&&!EVENT_STATUS.has(s.progress.status))return false;
  if(s.progress.result!==null&&!integer(s.progress.result))return false;
  if(s.progress.timestamp!==null&&!time(s.progress.timestamp))return false;
  if(s.progress.timestamp!==null&&
     (s.progress.timestamp<r.sentAt||s.progress.timestamp>r.expiresAt+30000))return false;
  if((s.progress.status===null)!==(s.progress.timestamp===null)||
     (s.progress.status===null)!==(s.progress.result===null))return false;
  if(s.phase==='awaiting_reply'&&
     (s.reply.result!==null||s.progress.status!==null))return false;
  if(s.phase==='reply_accepted'&&
     (s.reply.result!==0||s.progress.status!==null))return false;
  if(s.phase==='reply_rejected'&&
     (s.reply.result===null||s.reply.result===0||s.progress.status!==null))return false;
  if(s.phase.startsWith('reported_')){
    if(s.reply.result!==0||s.progress.status===null)return false;
    const expected=s.progress.result!==0||s.progress.status==='failed'?'reported_failed':
      s.progress.status==='canceled'?'reported_canceled':
      s.progress.status==='ok'?'reported_ok':'reported_'+s.progress.status;
    if(s.phase!==expected)return false;
  }
  if(Buffer.byteLength(JSON.stringify(s))>MAX_SNAPSHOT_BYTES)return false;
  return true;
}
function freezeSnapshot(s){
  Object.freeze(s.request);Object.freeze(s.reply);Object.freeze(s.progress);
  return Object.freeze(s);
}
function checkId(value){if(!uuid(value))
  throw new Error('Invalid flighttask journal key');}

function createFlighttaskJournal(db){
  if(!db||typeof db.query!=='function')
    throw new Error('Flighttask journal requires isolated database adapter');
  async function query(sql,params){
    try{return await db.query(sql,params);}catch(_error){
      throw new Error('Flighttask journal storage unavailable');
    }
  }
  async function read(key){
    checkId(key?.workspaceId);checkId(key?.observationId);
    const response=await query(
      'SELECT revision,snapshot FROM dji_flighttask_observation_snapshots '+
      'WHERE workspace_id=$1 AND observation_id=$2',
      [key.workspaceId,key.observationId]);
    const rows=response?.rows;
    if(!Array.isArray(rows)||rows.length>1)throw invalidDbResponse();
    if(rows.length===0)return null;
    const revision=parseRevision(rows[0]?.revision);
    if(revision===null||!validateSnapshot(rows[0]?.snapshot))
      throw new Error('Flighttask journal stored snapshot invalid');
    return {revision,state:freezeSnapshot(rows[0].snapshot)};
  }
  async function start({workspaceId,observationId,request,ttlMs=900000}={}){
    checkId(workspaceId);checkId(observationId);
    const snapshot=beginFlighttaskObservation(request,{ttlMs});
    if(!validateSnapshot(snapshot))throw new Error('Flighttask journal initial snapshot invalid');
    const response=await query(
      'INSERT INTO dji_flighttask_observation_snapshots '+
      '(workspace_id,observation_id,revision,snapshot) '+
      'VALUES ($1,$2,1,$3::jsonb) ON CONFLICT (workspace_id,observation_id) '+
      'DO NOTHING RETURNING revision',
      [workspaceId,observationId,JSON.stringify(snapshot)]);
    const rows=response?.rows;
    if(!Array.isArray(rows)||rows.length>1)throw invalidDbResponse();
    if(rows.length===1){
      if(parseRevision(rows[0]?.revision)!==1)throw invalidDbResponse();
      return {created:true,revision:1,state:snapshot};
    }
    const existing=await read({workspaceId,observationId});
    if(!existing||Object.keys(snapshot.request).some(k=>existing.state.request[k]!==snapshot.request[k]))
      throw new Error('Flighttask journal identity collision');
    return {...existing,created:false};
  }
  async function apply(key,kind,{topic,payload,now,retained=false}={}){
    checkId(key?.workspaceId);checkId(key?.observationId);
    if(!time(now))throw new Error('Invalid flighttask journal clock');
    if(!['service_reply','flighttask_progress','clock'].includes(kind))
      throw new Error('Unsupported flighttask journal operation');
    for(let attempt=0;attempt<MAX_RETRIES;attempt++){
      const prev=await read(key);
      if(!prev)throw new Error('Flighttask journal observation absent');
      let change;
      if(kind==='service_reply')
        change=observeFlighttaskServiceReply(prev.state,topic,payload,{now,retained});
      else if(kind==='flighttask_progress')
        change=observeFlighttaskProgressEvent(prev.state,topic,payload,{now,retained});
      else change=advanceFlighttaskObservation(prev.state,{kind:'clock'},{now});
      if(!change.applied){
        // The report is only a snapshot of what was read; callers wanting latest
        // state after a concurrent write must perform a fresh read.
        return {applied:false,reason:change.reason,...prev};
      }
      if(!validateSnapshot(change.state))
        throw new Error('Flighttask journal transition invalid');
      const updated=await query(
        'UPDATE dji_flighttask_observation_snapshots SET '+
        'snapshot=$4::jsonb,revision=revision+1,updated_at=CURRENT_TIMESTAMP '+
        'WHERE workspace_id=$1 AND observation_id=$2 AND revision=$3 '+
        'RETURNING revision',
        [key.workspaceId,key.observationId,prev.revision,JSON.stringify(change.state)]);
      if(!Array.isArray(updated?.rows)||updated.rows.length>1)throw invalidDbResponse();
      if(updated.rows.length===1){
        const revision=parseRevision(updated.rows[0]?.revision);
        if(revision!==prev.revision+1)throw invalidDbResponse();
        return {applied:true,reason:change.reason,revision,state:change.state};
      }
    }
    throw new Error('Flighttask journal CAS retries exhausted');
  }
  async function recover(key,{now}={}){
    // Explicitly reevaluate TTL on restart. No restored progress becomes live.
    const updated=await apply(key,'clock',{now});
    return {
      ...updated,
      recovered:true,
      summary:summarizeFlighttaskObservation(updated.state)
    };
  }
  async function summary(key){
    const x=await read(key);
    return x?summarizeFlighttaskObservation(x.state):null;
  }
  return Object.freeze({start,read,apply,recover,summary});
}

module.exports={
  createFlighttaskJournal,validateSnapshot,MAX_RETRIES,
  MAX_SNAPSHOT_BYTES
};
