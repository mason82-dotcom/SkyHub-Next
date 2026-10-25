'use strict';

// OFFLINE-ONLY workspace-scoped dispatcher for *observing* multiple flighttasks.
// No MQTT client/subscription, mission command sender, HTTP route, pool, or timers.
// The independently authenticated backend must inject an authorizer and a
// createScopedFlighttaskJournal() instance. Never pass caller-provided auth data.
const {parseServiceReply}=require('./dji-service-reply-contract');
const {parseFlighttaskProgressEvent}=require('./dji-flighttask-observation');
const {supportedExecuteReplyShape}=require('./dji-flighttask-reply-adapter');

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTOR=/^[A-Za-z0-9_.:@-]{1,128}$/;
const ROLES=new Set(['operator','admin']);
const TIME=x=>Number.isSafeInteger(x)&&x>=1e12&&x<=1e15;
const SIGNED=x=>Number.isSafeInteger(x)&&x>=-2147483648&&x<=2147483647;
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const denied=()=>new Error('Flighttask routing access denied');
const failure=(reason)=>Object.freeze({matched:false,applied:false,reason});
const SQL_REPLY=[
  'SELECT observation_id FROM dji_flighttask_observation_snapshots',
  'WHERE workspace_id=$1',
  "AND snapshot #>> '{request,gatewaySn}' = $2",
  "AND snapshot #>> '{request,tid}' = $3",
  "AND snapshot #>> '{request,bid}' = $4",
  "AND snapshot #>> '{request,method}' = 'flighttask_execute'",
  'ORDER BY observation_id LIMIT 2'
].join('\n');
const SQL_PROGRESS=[
  'SELECT observation_id FROM dji_flighttask_observation_snapshots',
  'WHERE workspace_id=$1',
  "AND snapshot #>> '{request,gatewaySn}' = $2",
  "AND snapshot #>> '{request,flightId}' = $3",
  "AND snapshot #>> '{request,method}' = 'flighttask_execute'",
  'ORDER BY observation_id LIMIT 2'
].join('\n');

function createFlighttaskMessageRouter(db,scopedJournal,{authorize}={}){
  if(!db||typeof db.query!=='function'||!object(scopedJournal)||
     typeof scopedJournal.apply!=='function'||typeof authorize!=='function')
    throw new Error('Flighttask router requires trusted storage, journal, and authorization');
  async function route({workspaceId,principal,kind,topic,payload,now,retained=false}={}){
    if(typeof workspaceId!=='string'||!UUID.test(workspaceId)||
       !object(principal)||typeof principal.id!=='string'||!ACTOR.test(principal.id)||
       typeof principal.workspaceId!=='string'||principal.workspaceId!==workspaceId||
       !ROLES.has(principal.role)||!TIME(now))
      throw denied();
    let authorized=false;
    try{authorized=(await authorize(principal,workspaceId,'route_observation'))===true;}
    catch(_error){authorized=false;}
    if(!authorized)throw denied();
    if(kind!=='service_reply'&&kind!=='flighttask_progress')
      return failure('unsupported-message-kind');
    // Parse *before* any lookup. Invalid, future, retained and oversized frames
    // cannot cause a DB query. These parsers discard private DJI payload fields.
    let lookup;
    try{
      if(kind==='service_reply'){
        const dto=parseServiceReply(topic,payload,{now,retained});
        if(dto.method!=='flighttask_execute'||!UUID.test(dto.tid)||
           !UUID.test(dto.bid)||dto.status!==null||!SIGNED(dto.result)||
           !supportedExecuteReplyShape(payload))
          return failure('invalid-execute-reply');
        lookup={sql:SQL_REPLY,params:[workspaceId,dto.gatewaySn,dto.tid,dto.bid]};
      }else{
        const dto=parseFlighttaskProgressEvent(topic,payload,{now,retained});
        lookup={sql:SQL_PROGRESS,params:[workspaceId,dto.gatewaySn,dto.flightId]};
      }
    }catch(_error){return failure('invalid-observation-envelope');}
    let rows;
    try{
      ({rows}=await db.query(lookup.sql,lookup.params));
    }catch(_error){throw new Error('Flighttask routing storage unavailable');}
    if(!Array.isArray(rows)||rows.length>2||
       rows.some(r=>!object(r)||typeof r.observation_id!=='string'||!UUID.test(r.observation_id)))
      throw new Error('Flighttask routing invalid lookup result');
    if(rows.length===0)return failure('no-matching-observation');
    if(rows.length!==1)return failure('ambiguous-observation');
    // A fresh per-call authorization check is performed again by the scoped
    // journal, which uses SQL revision-CAS and revalidates the full message.
    // Its *internal* observation state and IDs never cross this boundary.
    const result=await scopedJournal.apply({
      workspaceId,observationId:rows[0].observation_id,principal,
      kind,topic,payload,now,retained
    });
    const revision=Number(result?.revision);
    if(typeof result?.applied!=='boolean'||
       !Number.isSafeInteger(revision)||revision<1)
      throw new Error('Flighttask routing invalid journal response');
    const reason=typeof result.reason==='string'&&
       /^[a-z][a-z0-9-]{0,63}$/.test(result.reason)
        ?result.reason:'unclassified';
    return Object.freeze({matched:true,applied:result.applied,reason,revision});
  }
  return Object.freeze({route});
}

module.exports={createFlighttaskMessageRouter,SQL_REPLY,SQL_PROGRESS};
