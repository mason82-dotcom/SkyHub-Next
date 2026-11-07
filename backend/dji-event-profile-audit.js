'use strict';

// P1.2: offline-only DJI event profile gate. No MQTT client, event reply,
// database, network, flight command or runtime wiring. No GPL code copied.
// The caller must supply an independently authorized, trusted registry resolver;
// untrusted MQTT data may never declare a gateway or aircraft model.
const {parseTopic}=require('./dji');
const {resolveDeviceModel}=require('./catalog');
const {inspectDjiEvent,EVENT_KINDS}=require('./dji-event-contract-audit');

const SCHEMA='skyhub-dji-event-profile-audit-v1';
const PILOT_EVENTS=Object.freeze(['hms','airsense_warning']);
// Dock follows the complete P1.1 allowlist: derived, so a method added there cannot silently diverge here.
const DOCK_EVENTS=Object.freeze(Object.keys(EVENT_KINDS));
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
// Exact numeric model tuple only: no string, array or toString-coerced domains.
function modelKey(value){
  if(!object(value))return null;
  const {domain,type,subType}=value;
  if(typeof domain!=='number'||![0,2,3].includes(domain)||
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
  topic,payload,packet={},now=Date.now(),resolveTrustedPair,authenticatedGatewaySn
}={}){
  const source=typeof topic==='string'?parseTopic(topic):null;
  if(!source||source.source!=='thing'||source.channel!=='events')
    return reject('invalid_topic');
  // The topic SN is attacker-controlled. When the caller knows the gateway identity from the authenticated MQTT
  // connection (broker ACL / client certificate), it MUST pass it here; P1.1 then compares it with the topic.
  // Without it this gate only proves self-consistency of the topic. REQUIRED before any runtime wiring.
  const expectedGatewaySn=authenticatedGatewaySn===undefined?source.sn:authenticatedGatewaySn;

  // Validate the envelope BEFORE invoking the registry resolver. This
  // preserves all P1.1 freshness, retained and payload safety gates.
  const base=inspectDjiEvent({
    topic,payload,packet,now,expectedGatewaySn
  });
  if(!base.accepted)return reject(base.reason);
  if(typeof resolveTrustedPair!=='function')return reject('missing_trusted_resolver');

  // Read every resolver field exactly once inside the guard: throwing getters/Proxies fail closed.
  let binding;
  try{
    const raw=resolveTrustedPair(source.sn);
    if(raw!==null&&(typeof raw==='object'||typeof raw==='function')&&typeof raw.then==='function'){
      // No async/network resolver: reject, and swallow a later rejection so it can never crash the process.
      Promise.resolve(raw).catch(()=>{});
      return reject('unbound_gateway');
    }
    if(!object(raw))return reject('unbound_gateway');
    binding={gatewaySn:raw.gatewaySn,gatewayModel:raw.gatewayModel,aircraftModel:raw.aircraftModel};
  }catch(_err){return reject('trusted_resolver_failed');}
  if(binding.gatewaySn!==source.sn)return reject('unbound_gateway');

  const gatewayKey=modelKey(binding.gatewayModel);
  if(!gatewayKey||!resolveDeviceModel(binding.gatewayModel))
    return reject('unknown_gateway_model');
  const profile=Object.hasOwn(PROFILE_RULES,gatewayKey)
    ?PROFILE_RULES[gatewayKey]:null;
  if(!profile)return reject('unsupported_gateway_model');

  // null/undefined = no aircraft bound (e.g. an empty dock); only a real value is checked as a pair.
  const suppliedAircraft=binding.aircraftModel!==undefined&&binding.aircraftModel!==null;
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
