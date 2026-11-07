'use strict';

// Offline-only event contract inspection. No broker connection, event reply,
// persistence, command, flight authorization or runtime wiring.
// Independently authored from DJI message shapes; no upstream GPL code copied.
const {parseTopic, parseMessage, serial}=require('./dji');
const {classifyMessage}=require('./message-guard');
const {parseFlighttaskProgressEvent}=require('./dji-flighttask-observation');

const SCHEMA='skyhub-dji-event-contract-audit-v1';
const MAX_BYTES=131072;
const EVENT_KINDS=Object.freeze({
  flighttask_progress:'mission',
  flighttask_ready:'mission',
  file_upload_callback:'media',
  highest_priority_upload_flighttask_media:'media',
  airsense_warning:'safety',
  hms:'health',
  ota_progress:'maintenance',
  fileupload_progress:'maintenance',
  flight_areas_sync_progress:'flight-area',
  flight_areas_drone_location:'flight-area'
});
const owns=(obj,key)=>Object.prototype.hasOwnProperty.call(obj,key);
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
function rejected(reason){
  return Object.freeze({schema:SCHEMA,accepted:false,reason,
    kind:null,method:null,replyObligation:'unknown',shapeValidated:false,
    replyPublished:false,liveMqttUsed:false,hardwareVerified:false,
    operationVerified:false,flightReady:false});
}

// Returns only redacted contract labels: no IDs, coordinates, credentials,
// arbitrary method names, DJI payloads, or third-party aircraft data.
function inspectDjiEvent({topic,payload,packet={},expectedGatewaySn,now=Date.now()}={}){
  if(!serial(expectedGatewaySn))return rejected('unbound_gateway');
  const source=typeof topic==='string'?parseTopic(topic):null;
  if(!source||source.source!=='thing'||source.channel!=='events')
    return rejected('invalid_topic');
  if(source.sn!==expectedGatewaySn)return rejected('gateway_mismatch');
  if(packet?.retain===true)return rejected('retained');
  if(!Number.isSafeInteger(now)||now<1e12||now>1e15)return rejected('invalid_clock');
  if(!Buffer.isBuffer(payload)&&typeof payload!=='string')return rejected('invalid_payload');
  const size=Buffer.isBuffer(payload)?payload.length:Buffer.byteLength(payload);
  if(size===0||size>MAX_BYTES)return rejected('invalid_size');
  let envelope;
  try{envelope=JSON.parse(payload.toString('utf8'));}
  catch(_err){return rejected('malformed');}
  if(!object(envelope))return rejected('malformed');
  if(owns(envelope,'gateway') && envelope.gateway!==expectedGatewaySn)
    return rejected('gateway_mismatch');
  if(!Number.isSafeInteger(envelope.timestamp)||
     envelope.timestamp<1e12||envelope.timestamp>1e15)
    return rejected('invalid_timestamp');
  if(owns(envelope,'need_reply')&&envelope.need_reply!==0&&envelope.need_reply!==1)
    return rejected('invalid_need_reply');
  let parsed;
  try{parsed=parseMessage(topic,Buffer.from(payload));}
  catch(_err){return rejected('malformed');}
  if(!parsed||(parsed.gatewaySn!==null&&parsed.gatewaySn!==expectedGatewaySn))
    return rejected('gateway_mismatch');
  const freshness=classifyMessage(parsed,packet,now);
  if(!freshness.accept||freshness.timestampVerified!==true)
    return rejected(freshness.reason||'unverified_timestamp');
  if(typeof parsed.method!=='string'||!owns(EVENT_KINDS,parsed.method))
    return rejected('unsupported_method');
  if(!object(envelope.data)&&!Array.isArray(envelope.data))
    return rejected('invalid_data');

  let shapeValidated=false;
  if(parsed.method==='flighttask_progress'){
    try{parseFlighttaskProgressEvent(topic,payload,{now,retained:false});}
    catch(_err){return rejected('invalid_method_shape');}
    shapeValidated=true;
  }else if(parsed.method==='airsense_warning'){
    if(!Array.isArray(envelope.data)||parsed.airsense===null)
      return rejected('invalid_method_shape');
    shapeValidated=true;
  }else if(parsed.method==='hms'){
    if(parsed.hms===null)return rejected('invalid_method_shape');
    shapeValidated=true;
  }

  // Missing need_reply differs from an explicit zero; no inferred publisher.
  const replyObligation=!owns(envelope,'need_reply')?'unknown':
    envelope.need_reply===1?'required':'not-required';
  return Object.freeze({schema:SCHEMA,accepted:true,reason:null,
    kind:EVENT_KINDS[parsed.method],method:parsed.method,replyObligation,
    shapeValidated,replyPublished:false,liveMqttUsed:false,
    hardwareVerified:false,operationVerified:false,flightReady:false});
}
module.exports={inspectDjiEvent,SCHEMA,MAX_BYTES,EVENT_KINDS};
