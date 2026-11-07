'use strict';

// Isolated, synchronous *selection-only* helper; not a DJI parser, authorizer,
// database lookup, service publisher or mission execution path.
// A flighttask_execute services_reply does NOT contain a trustworthy flight_id.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ID=/^[A-Za-z0-9_.-]{1,100}$/;
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const uuid=x=>typeof x==='string'&&UUID.test(x);
const id=x=>typeof x==='string'&&ID.test(x);
const invalid=()=>new Error('Flighttask correlation refused');

function resolveFlighttaskObservation(candidates,report){
  if(!Array.isArray(candidates)||candidates.length>1000||!object(report)||
     !uuid(report.workspaceId)||!id(report.gatewaySn)||
     (report.kind!=='service_reply'&&report.kind!=='flighttask_progress'))
    throw invalid();

  if(report.kind==='service_reply'){
    // DJI's service reply is correlated by gateway + TID + BID, not flight_id.
    // Forbid a caller-supplied pseudo flight ID to prevent false assurance.
    if(!uuid(report.tid)||!uuid(report.bid)||Object.hasOwn(report,'flightId'))
      throw invalid();
  }else if(!id(report.flightId)){
    // Progress-event TID/BID are independent of the execute RPC transaction.
    throw invalid();
  }

  let match=null;
  for(const c of candidates){
    if(!object(c)||!uuid(c.workspaceId)||!uuid(c.observationId)||
       !id(c.gatewaySn)||!id(c.flightId)||!uuid(c.tid)||!uuid(c.bid))
      throw invalid();
    if(c.workspaceId!==report.workspaceId||c.gatewaySn!==report.gatewaySn)
      continue;
    const same=report.kind==='service_reply'
      ?c.tid===report.tid&&c.bid===report.bid
      :c.flightId===report.flightId;
    if(!same)continue;
    if(match!==null)throw invalid(); // Never choose an arbitrary observation.
    match=c;
  }
  if(match===null)throw invalid();
  return Object.freeze({workspaceId:match.workspaceId,
    observationId:match.observationId});
}

module.exports={resolveFlighttaskObservation};
