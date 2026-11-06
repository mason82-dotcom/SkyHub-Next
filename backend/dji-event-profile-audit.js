'use strict';

// P1.2: offline-only DJI event profile gate. No MQTT client, event reply,
// database, network, flight command or runtime wiring. No GPL code copied.
// The caller must supply an independently authorized, trusted registry resolver;
// untrusted MQTT data may never declare a gateway or aircraft model.
const {parseTopic}=require('./dji');
const {resolveDeviceModel}=require('./catalog');
const {inspectDjiEvent}=require('./dji-event-contract-audit');

const SCHEMA='skyhub-dji-event-profile-audit-v1';
const PILOT_EVENTS=Object.freeze(['hms','airsense_warning']);
const DOCK_EVENTS=Object.freeze([
  'hms','airsense_warning','flighttask_progress','flighttask_ready',
  'file_upload_callback','highest_priority_upload_flighttask_media',
  'ota_progress','fileupload_progress',
  'flight_areas_sync_progress','flight_areas_drone_location'
]);
const PROFILE_RULES=Object.freeze({
  '2:144:0':Object.freeze({name:'pilot-rc-pro-m3m',family:'pilot-to-cloud',
    aircraft:Object.freeze(['0:77:2']),events:PILOT_EVENTS}),
  '2:174:0':Object.freeze({name:'pilot-rc-plus2-m4t',family:'pilot-to-cloud',
    aircraft:Object.freeze(['0:99:1']),events:PILOT_EVENTS}),
  '3:1:0':Object.freeze({name:'dock-1',family:'dock-to-cloud',
    aircraft:Object.freeze(['0:67:0','0:67:1']),events:DOCK_EVENTS}),
  '3:2:0':Object.freeze({name:'dock-2',family:'dock-to-cloud',
    aircraft:Object.freeze(['0:91:0','0:91:1']),events:DOCK_EVENTS}),
  '3:3:0':Object.freeze({name:'dock-3',family:'dock-to-cloud',
    aircraft:Object.freeze(['0:100:0','0:100:1']),events:DOCK_EVENTS})
});
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
function modelKey(value){
  if(!object(value))return null;
  const {domain,type,subType}=value;
  if(!['0','2','3'].includes(String(domain))||
     !Number.isInteger(type)||type<0||type>999||
     !Number.isInteger(subType)||subType<0||subType>255)
    return null;
  return String(domain)+':'+type+':'+subType;
}
function reject(reason,profile=null){
  return Object.freeze({
    schema:SCHEMA,accepted:false,reason,profile,family:null,method:null,
    replyObligation:'unknown',shapeValidated:false,modelBindingMatched:false,
    replyPublished:false,liveMqttUsed:false,hardwareVerified:false,
    operationVerified:false,flightReady:false
  });
}
function inspectDjiEventProfile({
  topic,payload,packet={},now=Date.now(),resolveTrustedPair
}={}){
  const source=typeof topic==='string'?parseTopic(topic):null;
  if(!source||source.source!=='thing'||source.channel!=='events')
    return reject('invalid_topic');

  // Validate the envelope BEFORE invoking the registry resolver. This
  // preserves all P1.1 freshness, retained and payload safety gates.
  const base=inspectDjiEvent({
    topic,payload,packet,now,expectedGatewaySn:source.sn
  });
  if(!base.accepted)return reject(base.reason);
  if(typeof resolveTrustedPair!=='function')return reject('missing_trusted_resolver');

  let binding;
  try{binding=resolveTrustedPair(source.sn);}
  catch(_err){return reject('trusted_resolver_failed');}
  // No async/network resolver or self-asserted trust flag.
  if(!object(binding)||typeof binding.then==='function'||
     binding.gatewaySn!==source.sn)return reject('unbound_gateway');

  const gatewayKey=modelKey(binding.gatewayModel);
  if(!gatewayKey||!resolveDeviceModel(binding.gatewayModel))
    return reject('unknown_gateway_model');
  const profile=Object.hasOwn(PROFILE_RULES,gatewayKey)
    ?PROFILE_RULES[gatewayKey]:null;
  if(!profile)return reject('unsupported_gateway_model');

  const suppliedAircraft=Object.hasOwn(binding,'aircraftModel');
  const aircraftKey=suppliedAircraft?modelKey(binding.aircraftModel):null;
  if(profile.family==='pilot-to-cloud'&&!suppliedAircraft)
    return reject('missing_aircraft_binding',profile.name);
  if(suppliedAircraft && (!aircraftKey||
      !resolveDeviceModel(binding.aircraftModel)||
      !profile.aircraft.includes(aircraftKey)))
    return reject('unsupported_aircraft_pair',profile.name);
  if(!profile.events.includes(base.method))
    return reject('event_outside_profile',profile.name);

  // A static profile is not a live DJI firmware capability claim. Even when
  // need_reply=1, the result never authorizes an MQTT events_reply publisher.
  return Object.freeze({
    schema:SCHEMA,accepted:true,reason:null,profile:profile.name,
    family:profile.family,method:base.method,
    replyObligation:base.replyObligation,
    shapeValidated:base.shapeValidated,modelBindingMatched:true,
    replyPublished:false,liveMqttUsed:false,hardwareVerified:false,
    operationVerified:false,flightReady:false
  });
}
module.exports={inspectDjiEventProfile,SCHEMA};
