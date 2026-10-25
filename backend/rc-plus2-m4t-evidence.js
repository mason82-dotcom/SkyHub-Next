'use strict';

// Deliberately restrictive projection for a *local* read-only diagnosis.
// No serials, pairing records, packet payloads, model user-agent strings,
// device coordinates or arbitrary upstream field names are transferred.
const SCHEMA='skyhub-rcplus2-m4t-evidence-v1';
const PREFLIGHT_KEYS=[
  'healthApi','devicesApi','shapesApi','pairingsApi','mqttConnected',
  'subscribed','topologyAckEnabled','topologyAckConnected'
];

function measuredAtISOString(date){
  if(!(date instanceof Date)||!Number.isFinite(date.getTime())){
    throw new TypeError('invalid measurement time');
  }
  return date.toISOString();
}
function boundedCount(value){
  return Number.isSafeInteger(value)&&value>=0&&value<=1000?value:null;
}
// OSD age is a duration, not a count: a stale device must stay distinguishable from
// "never observed" (null). Only absurd values (> 1 year) are treated as unknown.
const MAX_AGE_SECONDS=366*24*3600;
function boundedAge(value){
  return Number.isSafeInteger(value)&&value>=0&&value<=MAX_AGE_SECONDS?value:null;
}
function receiptBase(mode,date){
  return {
    schema:SCHEMA,mode,
    measuredAt:measuredAtISOString(date),
    measurementClock:'diagnostic-host',
    classification:'read-only-diagnostic-not-hardware-certification',
    hardwareAcceptanceComplete:false,
    flightReady:false,
    dispatchAllowed:false
  };
}
function makePreflightEvidence(snapshot,date=new Date()){
  if(snapshot?.schema!=='skyhub-rcplus2-m4t-preflight-v1'||
      PREFLIGHT_KEYS.some(key=>typeof snapshot[key]!=='boolean')){
    throw new TypeError('invalid preflight response');
  }
  const checks=Object.fromEntries(PREFLIGHT_KEYS.map(key=>[key,snapshot[key]]));
  return {
    ...receiptBase('backend-preflight',date),
    result:PREFLIGHT_KEYS.every(key=>checks[key])?'READY':'INCOMPLETE',
    checks
  };
}
const RUNTIME_KEYS=['evaluatorAvailable','evidenceAvailable'];
function makeRuntimeEvidence(snapshot,date=new Date()){
  if(snapshot?.schema!=='skyhub-rcplus2-m4t-runtime-check-v1'||
      RUNTIME_KEYS.some(key=>typeof snapshot[key]!=='boolean')||
      Object.keys(snapshot).length!==RUNTIME_KEYS.length+1){
    throw new TypeError('invalid runtime module check');
  }
  const checks=Object.fromEntries(RUNTIME_KEYS.map(key=>[key,snapshot[key]]));
  return {
    ...receiptBase('runtime-module-check',date),
    result:RUNTIME_KEYS.every(key=>checks[key])?'READY':'INCOMPLETE',
    checks
  };
}
function summarizeDevice(device,includeAircraft){
  // Always return explicit null (not fabricated zero) for unsupported profiles.
  const fields=device?.fieldInterface===true?device.fields:null;
  const summary={
    seen:device?.seen===true,
    topologyOnline:device?.topologyOnline===true,
    osdFresh:device?.osdFresh===true,
    osdAgeSeconds:boundedAge(device?.osdAgeSeconds),
    stateObserved:device?.stateObserved===true,
    fieldInterface:device?.fieldInterface===true,
    staticFieldsDocumented:boundedCount(fields?.documented),
    staticFieldsObserved:boundedCount(fields?.observed),
    staticFieldsFresh:boundedCount(fields?.fresh)
  };
  if(includeAircraft){
    summary.aircraftConnected=device?.aircraftConnected===true;
    summary.dynamicGimbalTypesObserved=boundedCount(
      device?.fieldInterface===true?device?.dynamicFields?.observed:null);
  }
  return summary;
}
function makeLiveEvidence(report,date=new Date()){
  if(!report||typeof report.passed!=='boolean'||
      typeof report.transportPassed!=='boolean'||
      typeof report.pairingConfirmed!=='boolean'||
      !report.transport||!report.controller||!report.aircraft){
    throw new TypeError('invalid transport report');
  }
  return {
    ...receiptBase('live-transport-smoke',date),
    result:report.passed?'TRANSPORT_SMOKE_OK':'INCOMPLETE',
    transport:{
      mqttConnected:report.transport.mqttConnected===true,
      subscribed:report.transport.subscribed===true,
      topologyAckEnabled:report.transport.topologyAckEnabled===true,
      topologyAckConnected:report.transport.topologyAckConnected===true,
      transportPassed:report.transportPassed===true
    },
    pairing:{
      listingAvailable:report.pairing?.available===true,
      rcPlus2Registered:(report.pairing?.rcPlus2Paired??0)>0,
      rcPlus2RecentlyUsed:(report.pairing?.rcPlus2RecentlyUsed??0)>0,
      independentlyConfirmed:report.pairingConfirmed===true
    },
    linkedPairs:boundedCount(report.candidateCount?.linkedPairs),
    controller:summarizeDevice(report.controller,false),
    aircraft:summarizeDevice(report.aircraft,true)
  };
}
// The host prints *only* structurally verified evidence from docker exec.
// Reject arbitrary extra fields or raw device snapshots at the process boundary.
function keysExactly(value,keys){
  return value!==null&&typeof value==='object'&&!Array.isArray(value)&&
    Object.keys(value).length===keys.length&&
    keys.every(key=>Object.hasOwn(value,key));
}
function isCountOrNull(value){
  return value===null||boundedCount(value)===value;
}
function isAgeOrNull(value){
  return value===null||boundedAge(value)===value;
}
function isDeviceReceipt(value,aircraft){
  const base=['seen','topologyOnline','osdFresh','osdAgeSeconds',
    'stateObserved','fieldInterface','staticFieldsDocumented',
    'staticFieldsObserved','staticFieldsFresh'];
  const fields=aircraft?[...base,'aircraftConnected','dynamicGimbalTypesObserved']:base;
  if(!keysExactly(value,fields))return false;
  if(['seen','topologyOnline','osdFresh','stateObserved','fieldInterface',
    ...(aircraft?['aircraftConnected']:[])].some(key=>typeof value[key]!=='boolean')){
    return false;
  }
  if(!isAgeOrNull(value.osdAgeSeconds))return false;
  const counts=['staticFieldsDocumented','staticFieldsObserved','staticFieldsFresh',
    ...(aircraft?['dynamicGimbalTypesObserved']:[])];
  if(!counts.every(key=>isCountOrNull(value[key])))return false;
  // Counts only exist for profiles with a field interface (summarizeDevice emits null otherwise).
  return value.fieldInterface||counts.every(key=>value[key]===null);
}
function validateLiveEvidenceReceipt(value){
  const base=['schema','mode','measuredAt','measurementClock','classification',
    'hardwareAcceptanceComplete','flightReady','dispatchAllowed','result',
    'transport','pairing','linkedPairs','controller','aircraft'];
  if(!keysExactly(value,base)||
      value.schema!==SCHEMA||value.mode!=='live-transport-smoke'||
      value.measurementClock!=='diagnostic-host'||
      value.classification!=='read-only-diagnostic-not-hardware-certification'||
      value.hardwareAcceptanceComplete!==false||value.flightReady!==false||
      value.dispatchAllowed!==false||
      !['TRANSPORT_SMOKE_OK','INCOMPLETE'].includes(value.result)||
      typeof value.measuredAt!=='string'||value.measuredAt.length!==24||
      !Number.isFinite(Date.parse(value.measuredAt))||
      new Date(value.measuredAt).toISOString()!==value.measuredAt){
    return false;
  }
  const transportKeys=['mqttConnected','subscribed','topologyAckEnabled',
    'topologyAckConnected','transportPassed'];
  const pairingKeys=['listingAvailable','rcPlus2Registered',
    'rcPlus2RecentlyUsed','independentlyConfirmed'];
  if(!keysExactly(value.transport,transportKeys)||
      !transportKeys.every(key=>typeof value.transport[key]==='boolean')||
      !keysExactly(value.pairing,pairingKeys)||
      !pairingKeys.every(key=>typeof value.pairing[key]==='boolean')||
      !isCountOrNull(value.linkedPairs)||
      !isDeviceReceipt(value.controller,false)||
      !isDeviceReceipt(value.aircraft,true)){
    return false;
  }
  const {transport,pairing,controller,aircraft}=value;
  // Sub-facts must be consistent with the summary flags they feed.
  if(transport.transportPassed&&!(transport.mqttConnected&&transport.subscribed&&
      transport.topologyAckEnabled&&transport.topologyAckConnected&&
      controller.topologyOnline&&aircraft.topologyOnline&&
      controller.osdFresh&&aircraft.osdFresh&&aircraft.aircraftConnected&&
      controller.fieldInterface&&aircraft.fieldInterface))return false;
  if(pairing.independentlyConfirmed&&!(pairing.listingAvailable&&
      pairing.rcPlus2Registered&&pairing.rcPlus2RecentlyUsed))return false;
  // The result is exactly the conjunction of both gates, in both directions.
  const passed=transport.transportPassed&&pairing.independentlyConfirmed;
  if((value.result==='TRANSPORT_SMOKE_OK')!==passed)return false;
  if(passed&&value.linkedPairs!==1)return false;
  return true;
}
module.exports={makePreflightEvidence,makeRuntimeEvidence,makeLiveEvidence,validateLiveEvidenceReceipt};
