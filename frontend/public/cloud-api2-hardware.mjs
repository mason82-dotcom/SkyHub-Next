// Strict browser-side projection of anonymous RC Plus 2 / Matrice 4T receipts.
// The input may come from authenticated backend GET or a locally selected JSON file.
// Never render raw payloads, arbitrary keys, device identifiers or GPS coordinates.
const SCHEMA='skyhub-rcplus2-m4t-evidence-v1';
const CLASSIFICATION='read-only-diagnostic-not-hardware-certification';
const BASE=['schema','mode','measuredAt','measurementClock','classification',
  'hardwareAcceptanceComplete','flightReady','dispatchAllowed','result'];
const PREFLIGHT=['healthApi','devicesApi','shapesApi','pairingsApi',
  'mqttConnected','subscribed','topologyAckEnabled','topologyAckConnected'];
const RUNTIME=['evaluatorAvailable','evidenceAvailable'];
const TRANSPORT=['mqttConnected','subscribed','topologyAckEnabled','topologyAckConnected','transportPassed'];
const PAIRING=['listingAvailable','rcPlus2Registered','rcPlus2RecentlyUsed','independentlyConfirmed'];
const CONTROLLER=['seen','topologyOnline','osdFresh','osdAgeSeconds',
  'stateObserved','fieldInterface','staticFieldsDocumented','staticFieldsObserved','staticFieldsFresh'];
const AIRCRAFT=[...CONTROLLER,'aircraftConnected','dynamicGimbalTypesObserved'];
const MAX_AGE=366*24*3600;
function exact(obj,keys){
  return obj!==null&&typeof obj==='object'&&!Array.isArray(obj)&&
    Object.keys(obj).length===keys.length&&keys.every(k=>Object.hasOwn(obj,k));
}
function flagSet(obj,keys){return keys.every(k=>typeof obj[k]==='boolean');}
function bounded(value,max){return value===null||(Number.isSafeInteger(value)&&value>=0&&value<=max);}
function deviceOK(d,aircraft=false){
  const keys=aircraft?AIRCRAFT:CONTROLLER;
  if(!exact(d,keys))return false;
  if(!flagSet(d,['seen','topologyOnline','osdFresh','stateObserved','fieldInterface',
    ...(aircraft?['aircraftConnected']:[])]))return false;
  if(!bounded(d.osdAgeSeconds,MAX_AGE))return false;
  const counts=['staticFieldsDocumented','staticFieldsObserved','staticFieldsFresh',
    ...(aircraft?['dynamicGimbalTypesObserved']:[])];
  if(!counts.every(k=>bounded(d[k],1000)))return false;
  if(d.fieldInterface===false&&!counts.every(k=>d[k]===null))return false;
  return true;
}
function validateHardwareReceipt(r,now=Date.now()){
  if(!r||r.schema!==SCHEMA||r.measurementClock!=='diagnostic-host'||
    r.classification!==CLASSIFICATION||r.hardwareAcceptanceComplete!==false||
    r.flightReady!==false||r.dispatchAllowed!==false||
    typeof r.measuredAt!=='string'||r.measuredAt.length!==24||
    !Number.isFinite(Date.parse(r.measuredAt))||
    new Date(r.measuredAt).toISOString()!==r.measuredAt||
    Date.parse(r.measuredAt)>now+30000)return false;
  if(r.mode==='backend-preflight'||r.mode==='runtime-module-check'){
    const keys=r.mode==='backend-preflight'?PREFLIGHT:RUNTIME;
    if(!exact(r,[...BASE,'checks'])||!exact(r.checks,keys)||!flagSet(r.checks,keys)||
      !['READY','INCOMPLETE'].includes(r.result))return false;
    return (r.result==='READY')===keys.every(k=>r.checks[k]===true);
  }
  if(r.mode!=='live-transport-smoke'||
    !exact(r,[...BASE,'transport','pairing','linkedPairs','controller','aircraft'])||
    !['TRANSPORT_SMOKE_OK','INCOMPLETE'].includes(r.result)||
    !exact(r.transport,TRANSPORT)||!flagSet(r.transport,TRANSPORT)||
    !exact(r.pairing,PAIRING)||!flagSet(r.pairing,PAIRING)||
    !bounded(r.linkedPairs,1000)||
    !deviceOK(r.controller)||!deviceOK(r.aircraft,true))return false;
  const t=r.transport,p=r.pairing,c=r.controller,a=r.aircraft;
  if(t.transportPassed&&!(t.mqttConnected&&t.subscribed&&t.topologyAckEnabled&&
    t.topologyAckConnected&&c.topologyOnline&&a.topologyOnline&&c.osdFresh&&
    a.osdFresh&&a.aircraftConnected&&c.fieldInterface&&a.fieldInterface))return false;
  if(p.independentlyConfirmed&&!(p.listingAvailable&&p.rcPlus2Registered&&p.rcPlus2RecentlyUsed))return false;
  const passed=t.transportPassed&&p.independentlyConfirmed;
  if((r.result==='TRANSPORT_SMOKE_OK')!==passed)return false;
  if(passed&&r.linkedPairs!==1)return false;
  return true;
}
const TITLES={
  'backend-preflight':'Backend-Preflight',
  'runtime-module-check':'Runtime-Modulprüfung',
  'live-transport-smoke':'RC Plus 2 + M4T Live-Transport-Smoke'
};
const LABELS={
  healthApi:'Health-GET erreichbar',devicesApi:'Geräteliste erreichbar',
  shapesApi:'MQTT-Feldformen erreichbar',pairingsApi:'Pairing-GET erreichbar',
  mqttConnected:'MQTT verbunden',subscribed:'Broker-Abonnement aktiv',
  topologyAckEnabled:'Topologie-ACK aktiviert',topologyAckConnected:'ACK-Verbindung vorhanden',
  evaluatorAvailable:'Hardware-Evaluator im Container verfügbar',
  evidenceAvailable:'Evidence-Modul im Container verfügbar'
};
function normalizeHardwareReceipt(input,{origin='operator-file',now=Date.now()}={}){
  if(!validateHardwareReceipt(input,now))throw new TypeError('Ungültiger oder widersprüchlicher Hardware-Nachweis');
  const ageSeconds=Math.max(0,Math.floor((now-Date.parse(input.measuredAt))/1000));
  let checks=[];
  if(input.mode==='backend-preflight'||input.mode==='runtime-module-check'){
    const keys=input.mode==='backend-preflight'?PREFLIGHT:RUNTIME;
    checks=keys.map(k=>({name:LABELS[k],status:input.checks[k]?'PASS':'UNVOLLSTÄNDIG'}));
  }else{
    const x=input;
    const bool=(name,v)=>({name,status:v?'PASS':'NICHT BESTÄTIGT'});
    const measured=(name,v,unit='')=>({name,status:v===null?'NICHT BEOBACHTET':String(v)+unit});
    checks=[
      bool('MQTT verbunden / abonniert',x.transport.mqttConnected&&x.transport.subscribed),
      bool('Topologie-ACK',x.transport.topologyAckEnabled&&x.transport.topologyAckConnected),
      bool('Pairing-Token registriert',x.pairing.rcPlus2Registered),
      bool('Token kürzlich verwendet',x.pairing.rcPlus2RecentlyUsed),
      measured('Eindeutig zugeordnete Paare',x.linkedPairs),
      bool('RC Plus 2: Topologie online',x.controller.topologyOnline),
      bool('RC Plus 2: frische OSD-Daten',x.controller.osdFresh),
      measured('RC Plus 2: OSD-Alter',x.controller.osdAgeSeconds,' s'),
      measured('RC Plus 2: dokumentierte Felder',x.controller.staticFieldsDocumented),
      measured('RC Plus 2: beobachtete Felder',x.controller.staticFieldsObserved),
      bool('Matrice 4T: Topologie online',x.aircraft.topologyOnline),
      bool('Matrice 4T: OSD frisch / verbunden',x.aircraft.osdFresh&&x.aircraft.aircraftConnected),
      measured('Matrice 4T: OSD-Alter',x.aircraft.osdAgeSeconds,' s'),
      measured('Matrice 4T: dokumentierte Felder (vorläufig)',x.aircraft.staticFieldsDocumented),
      measured('Matrice 4T: beobachtete Felder',x.aircraft.staticFieldsObserved),
      measured('M4T: dynamische Gimbaltypen beobachtet',x.aircraft.dynamicGimbalTypesObserved),
      bool('Transport-Gate erfüllt',x.transport.transportPassed),
      bool('Getrenntes Pairing-Gate erfüllt',x.pairing.independentlyConfirmed)
    ];
  }
  return Object.freeze({
    mode:input.mode,title:TITLES[input.mode],origin:origin==='backend-live'?'SkyHub-Backend':'Lokale JSON-Datei',
    measuredAt:input.measuredAt,ageSeconds,
    timeClass:ageSeconds<=20?'AKTUELL':'HISTORISCH',
    result:input.result,checks,
    hardwareAcceptanceComplete:false,flightReady:false,dispatchAllowed:false
  });
}
export {SCHEMA,validateHardwareReceipt,normalizeHardwareReceipt};
