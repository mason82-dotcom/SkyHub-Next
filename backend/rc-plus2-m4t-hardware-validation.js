'use strict';

// DJI Cloud API 1.18 read-only acceptance: RC Plus 2 Enterprise + Matrice 4T.
// Never expose device serial numbers, tokens, coordinates or telemetry values.
const {summarizeTelemetryFields}=require('./telemetry-field-profile');
const catalog=require('./data/dji-cloud-api-118-fields.json');

const CONTROLLER='2:174:0';
const AIRCRAFT='0:99:1';
const MAX_AGE_MS=15000;
const allowedShapeKeys=new Set(['app_version','mode_code','sub_devices',
  'domain','type','sub_type','thing_version','list','data','timestamp',
  'firmware_version']);
for(const profile of Object.values(catalog.profiles)){
  for(const field of profile.fields){
    if(!field.path.includes('.'))allowedShapeKeys.add(field.path);
  }
}

const isObject=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const modelKey=d=>d?.model&&[d.model.domain,d.model.type,d.model.subType].join(':');
function ageSeconds(value,now){
  return Number.isFinite(value)&&value<=now&&value>=0?
    Math.floor((now-value)/1000):null;
}
function hasFieldInterface(device,profileName){
  return device?.propertyProfile?.name===profileName&&
    isObject(device.deviceProperties?.osd)&&
    isObject(device.deviceProperties?.state)&&
    isObject(device.propertyObservedAt)&&
    isObject(device.propertyFieldObservedAt?.osd)&&
    isObject(device.propertyFieldObservedAt?.state);
}
function observedStatus(ok,observed){
  return ok?'BESTÄTIGT':observed?'NICHT AKTUELL':'NICHT NACHGEWIESEN';
}
function summarizeDevice(device,now,profileName,expectedCount){
  if(!device)return {
    seen:false,topologyOnline:false,osdFresh:false,osdAgeSeconds:null,
    aircraftConnected:false,fieldInterface:false,stateObserved:false,
    stateAgeSeconds:null,profileConfidence:null,expectedCount,
    fields:null,dynamicFields:null
  };
  const fieldInterface=hasFieldInterface(device,profileName);
  const [audit]=summarizeTelemetryFields([device],now);
  const osdAgeSeconds=ageSeconds(device.lastTelemetryAt,now);
  const stateAgeSeconds=fieldInterface?
    ageSeconds(device.propertyObservedAt.state,now):null;
  return {
    seen:true,topologyOnline:device.topologyOnline===true,
    osdFresh:device.topologyOnline===true&&device.fresh===true&&
      osdAgeSeconds!==null&&osdAgeSeconds<MAX_AGE_MS/1000,
    osdAgeSeconds,
    aircraftConnected:device.aircraftConnected===true,
    fieldInterface,
    stateObserved:stateAgeSeconds!==null,stateAgeSeconds,
    profileConfidence:fieldInterface?audit.documentedConfidence:null,
    expectedCount,
    fields:fieldInterface?{
      documented:audit.documentedTotal,
      inspectable:audit.documentedInspectableTotal,
      observed:audit.observedDocumented.length,
      fresh:audit.freshDocumented.length,
      stale:audit.staleDocumented.length,
      missing:audit.notObservedDocumented.length,
      redacted:audit.redactedDocumented.length,
      unsupported:audit.unsupportedDocumented.length,
      freshNames:audit.freshDocumented.slice(0,40),
      observedNames:audit.observedDocumented.slice(0,40)
    }:null,
    dynamicFields:fieldInterface?{
      documented:audit.dynamicDocumentedTotal,
      observed:audit.observedDynamic.length,
      fresh:audit.freshDynamic.length,
      observedNames:audit.observedDynamic.slice(0,12)
    }:null
  };
}
function pairingSummary(pairings,now){
  // Treat unavailable endpoint as unknown, not as 'no controllers paired'.
  if(!isObject(pairings)||!Array.isArray(pairings.devices)||
     !Array.isArray(pairings.pending)){
    return {available:false,rcPlus2Paired:null,rcProPaired:null,
      rcPlus2RecentlyUsed:null,rcPlus2Pending:null};
  }
  // Pilot 2 also emits the observed upper-case model label "DJI RC PLUS 2".
  // Use exact allowlisted labels only: no substring or generic case-folded match.
  const plusModels=new Set([
    'DJI RC Plus 2 Enterprise','DJI RC Plus 2','DJI RC PLUS 2'
  ]);
  const plusModel=name=>typeof name==='string'&&plusModels.has(name);
  const proModel=name=>name==='DJI RC Pro Enterprise';
  const plus=pairings.devices.filter(d=>isObject(d)&&plusModel(d.model)).slice(0,200);
  const pro=pairings.devices.filter(d=>isObject(d)&&proModel(d.model)).slice(0,200);
  return {
    available:true,rcPlus2Paired:plus.length,rcProPaired:pro.length,
    // Token verification means recent Pilot-2 bootstrap, NOT MQTT connection.
    rcPlus2RecentlyUsed:plus.filter(d=>Number.isFinite(d.lastUsedAt)&&
      d.lastUsedAt<=now&&now-d.lastUsedAt<30*60*1000).length,
    rcPlus2Pending:pairings.pending.filter(d=>isObject(d)&&plusModel(d.model)).length
  };
}
function linked(rc,air){
  return typeof rc?.sn==='string'&&rc.sn.length>0&&
    typeof air?.sn==='string'&&air.sn.length>0&&
    air.gatewaySn===rc.sn&&Array.isArray(rc.children)&&
    rc.children.includes(air.sn);
}
function evaluateHardwareSession(devices,health,shapes,now=Date.now(),pairings=null){
  const all=Array.isArray(devices)?devices.slice(0,200):[];
  const gateways=all.filter(d=>modelKey(d)===CONTROLLER&&d.role==='gateway');
  const aircraft=all.filter(d=>modelKey(d)===AIRCRAFT&&d.role==='subdevice');
  const pairs=[];
  for(const gateway of gateways){
    for(const child of aircraft){
      if(linked(gateway,child))pairs.push({gateway,child});
    }
  }
  // Multiple simultaneously linked target pairs cannot be distinguished
  // without publishing serials. Fail closed instead of accepting one at random.
  const unambiguous=pairs.length===1;
  const rc=unambiguous?pairs[0].gateway:gateways.length===1?gateways[0]:null;
  const m4t=unambiguous?pairs[0].child:aircraft.length===1?aircraft[0]:null;
  const controller=summarizeDevice(rc,now,'rcPlus2',54);
  const drone=summarizeDevice(m4t,now,'matrice4T',202);
  const shapeList=Array.isArray(shapes)?shapes:[];
  const shapeKeys=channel=>[...new Set(shapeList.filter(s=>s?.channel===channel)
    .flatMap(s=>Array.isArray(s.dataKeys)?s.dataKeys:[])
    .filter(k=>typeof k==='string'&&allowedShapeKeys.has(k)))].sort().slice(0,60);
  const pairing=pairingSummary(pairings,now);
  const transport={
    topologyAckConnected:health?.topologyReplyConnected===true,
    mqttConnected:health?.mqtt===true,
    subscribed:health?.subscribed===true,
    topologyAckEnabled:health?.topologyReplyEnabled===true,
    topologyAckSent:Number.isSafeInteger(health?.topologyReplySent)?
      health.topologyReplySent:null,
    topologyAckErrors:Number.isSafeInteger(health?.topologyReplyErrors)?
      health.topologyReplyErrors:null,
    osdPackets:Number.isSafeInteger(health?.mqttObservedOsdPackets)?
      health.mqttObservedOsdPackets:null,
    osdAccepted:Number.isSafeInteger(health?.mqttOsdMessages)?
      health.mqttOsdMessages:null,
    osdShapeFields:shapeKeys('osd'),
    stateShapeFields:shapeKeys('state')
  };
  // pushMode=1 records an event, not a periodic heartbeat. Preserve evidence
  // of an older State arrival while field-level freshness stays independent.
  const stateStatus=device=>!device.seen?'NICHT NACHGEWIESEN':
    !device.fieldInterface?'NICHT PRÜFBAR':
    device.stateObserved?'BESTÄTIGT':'NICHT NACHGEWIESEN';
  const stages=[
    {step:'MQTT verbunden und abonniert',
      status:observedStatus(transport.mqttConnected&&transport.subscribed,transport.mqttConnected)},
    {step:'Topologie-Antwort (update_topo/status_reply) eingeschaltet',
      status:transport.topologyAckEnabled&&transport.topologyAckConnected?
        'BESTÄTIGT':transport.topologyAckEnabled?'NICHT AKTUELL':'NICHT NACHGEWIESEN'},
    {step:'RC Plus 2: SkyHub-Geräte-Token registriert',
      status:!pairing.available?'NICHT PRÜFBAR':
        pairing.rcPlus2Paired>0?'BESTÄTIGT':'NICHT NACHGEWIESEN'},
    {step:'RC Plus 2: Geräte-Token in letzten 30 Min verwendet',
      status:!pairing.available?'NICHT PRÜFBAR':
        pairing.rcPlus2RecentlyUsed>0?'BESTÄTIGT':'NICHT AKTUELL'},
    {step:'RC Plus 2 (2:174:0) als Gateway erkannt',
      status:observedStatus(controller.topologyOnline,controller.seen)},
    {step:'Matrice 4T (0:99:1) als Subdevice erkannt',
      status:observedStatus(drone.topologyOnline,drone.seen)},
    {step:'RC Plus 2 und M4T eindeutig verknüpft',
      status:pairs.length>1?'MEHRDEUTIG':
        observedStatus(unambiguous,gateways.length>0&&aircraft.length>0)},
    {step:'RC Plus 2: aktuelle OSD-Daten (<15 s)',
      status:observedStatus(controller.osdFresh,controller.osdAgeSeconds!==null)},
    {step:'M4T: verbunden und aktuelle OSD-Daten (<15 s)',
      status:observedStatus(drone.aircraftConnected&&drone.osdFresh,
        drone.osdAgeSeconds!==null)},
    {step:'RC Plus 2: DJI-1.18-Feldparser verfügbar',
      status:controller.fieldInterface?'BESTÄTIGT':'NICHT PRÜFBAR'},
    {step:'M4T: DJI-1.18-Feldparser verfügbar',
      status:drone.fieldInterface?'BESTÄTIGT':'NICHT PRÜFBAR'},
    {step:'RC Plus 2: State-Felder beobachtet (optional)',
      status:stateStatus(controller)},
    {step:'M4T: State-Felder beobachtet (optional)',
      status:stateStatus(drone)}
  ];
  const transportPassed=transport.mqttConnected&&transport.subscribed&&
    transport.topologyAckEnabled&&transport.topologyAckConnected&&unambiguous&&
    controller.topologyOnline&&drone.topologyOnline&&
    controller.osdFresh&&drone.osdFresh&&drone.aircraftConnected&&
    controller.fieldInterface&&drone.fieldInterface&&
    controller.fields.documented===54&&drone.fields.documented===202;
  const pairingConfirmed=pairing.available&&pairing.rcPlus2Paired>0&&
    pairing.rcPlus2RecentlyUsed>0;
  const passed=transportPassed&&pairingConfirmed;
  return {
    target:'DJI RC Plus 2 Enterprise + Matrice 4T',
    mode:'read-only',passed:Boolean(passed),transportPassed:Boolean(transportPassed),
    pairingConfirmed:Boolean(pairingConfirmed),pairing,
    candidateCount:{controllers:gateways.length,aircraft:aircraft.length,
      linkedPairs:pairs.length},
    transport,controller,aircraft:drone,stages,
    notes:[
      'Erfolg bestätigt nur aktuellen MQTT-/Topologie-/OSD-Smoketest und Parser-Verfügbarkeit.',
      'State wird bei Änderung publiziert und muss am Boden nicht alle 15 Sekunden eintreffen.',
      'MQTT-Zähler und Feldformen sind backendweit; sie belegen keine bestimmte RC.',
      'RC Plus 2: offiziell dokumentiertes Web-Feldprofil mit 54 statischen Pfaden.',
      'M4T: 202 vorläufige generische Feldpfade plus neun dynamische Gimbal-Feldtypen; keine vollständige gerätespezifische DJI-1.18-Freigabe.',
      'Nicht beobachtete Felder sind kein Beweis fehlender Hardware-Unterstützung.',
      'Ein registrierter und kürzlich verwendeter Token belegt keine eindeutige physische RC-Identität: DJI Pilot 2 WebView-Modell stammt aus dem User-Agent.',
      'Nur separat gekoppeltes SkyHub-Geräte-Token ist prüfbar; DJI-Benutzerkonten können nicht aus diesem Audit abgeleitet werden.',
      'Kein Flug, Pairing, MQTT-Publish, Neustart oder Container-Deployment durch diese Prüfung.'
    ]
  };
}
function formatReport(r){
  const lines=[
    '=== RC Plus 2 Enterprise + Matrice 4T – Cloud API 1.18 Hardware-Smoketest (nur Lesen) ===',
    'MQTT: '+r.transport.mqttConnected+' | Abonniert: '+r.transport.subscribed+
      ' | Topologie-ACK aktiv: '+r.transport.topologyAckEnabled+
      ' | ACK-Publisher verbunden: '+r.transport.topologyAckConnected,
    'Topologie-ACK gesendet: '+(r.transport.topologyAckSent??'n/v')+
      ' | Fehler: '+(r.transport.topologyAckErrors??'n/v'),
    'OSD-Pakete backendweit: '+(r.transport.osdPackets??'n/v')+
      ' | akzeptiert: '+(r.transport.osdAccepted??'n/v'),
    'SkyHub-Geräte-Tokens: '+(!r.pairing.available?'NICHT PRÜFBAR':
      'RC Plus 2 gekoppelt '+r.pairing.rcPlus2Paired+
      ' | zuletzt 30 Min verwendet '+r.pairing.rcPlus2RecentlyUsed+
      ' | RC Pro vorhanden '+r.pairing.rcProPaired+
      ' | ausstehende RC Plus 2 '+r.pairing.rcPlus2Pending),
    'Kandidaten: RC '+r.candidateCount.controllers+
      ', Aircraft '+r.candidateCount.aircraft+
      ', verknüpfte Paare '+r.candidateCount.linkedPairs,
    ...r.stages.map(s=>s.status.padEnd(18)+' '+s.step)
  ];
  for(const [name,dev] of [
    ['RC Plus 2',r.controller],['Matrice 4T',r.aircraft]
  ]){
    lines.push('--- '+name+' ---');
    if(!dev.seen){lines.push('Zielmodell in aktueller Topologie nicht erkannt');continue;}
    lines.push('OSD-Alter (s): '+(dev.osdAgeSeconds??'unbekannt')+
      ' | State-Alter (s): '+(dev.stateAgeSeconds??'nicht beobachtet'));
    if(!dev.fieldInterface){
      lines.push('DJI-Feldparser: NICHT PRÜFBAR; keine Feldfehlanzahl ableitbar.');
      lines.push('Im Katalog erwartete statische Pfade: '+dev.expectedCount);
      continue;
    }
    lines.push('Profilvertrauen: '+dev.profileConfidence);
    lines.push('Statische Felder: '+dev.fields.documented+
      ' | auswertbar: '+dev.fields.inspectable+
      ' | beobachtet: '+dev.fields.observed+
      ' | frisch: '+dev.fields.fresh+
      ' | veraltet: '+dev.fields.stale+
      ' | nicht beobachtet: '+dev.fields.missing+
      ' | redigiert: '+dev.fields.redacted+
      ' | untypisiert: '+dev.fields.unsupported);
    if(dev.dynamicFields?.documented){
      lines.push('Dynamische Gimbal-Feldtypen: '+dev.dynamicFields.documented+
        ' | beobachtet: '+dev.dynamicFields.observed+
        ' | frisch: '+dev.dynamicFields.fresh);
      lines.push('Gimbal-Feldnamen: '+(dev.dynamicFields.observedNames.join(', ')||'keine'));
    }
    lines.push('Aktuelle Feldnamen (max. 40): '+(dev.fields.freshNames.join(', ')||'keine'));
    lines.push('Beobachtete Feldnamen (max. 40): '+(dev.fields.observedNames.join(', ')||'keine'));
  }
  lines.push('Dokumentierte OSD-Rootfelder backendweit: '+
    (r.transport.osdShapeFields.join(', ')||'keine'));
  lines.push('Dokumentierte State-Rootfelder backendweit: '+
    (r.transport.stateShapeFields.join(', ')||'keine'));
  lines.push('Transport-/Feldparser-Smoke: '+
    (r.transportPassed?'BESTANDEN':'UNVOLLSTÄNDIG'));
  lines.push('Pilot-2-Geräte-Token: '+
    (r.pairingConfirmed?'BESTÄTIGT':r.pairing.available?'NICHT BESTÄTIGT':'NICHT PRÜFBAR'));
  lines.push('Gesamtabnahme: '+(r.passed?'BESTANDEN':'UNVOLLSTÄNDIG'));
  for(const note of r.notes)lines.push('Hinweis: '+note);
  lines.push('Keine Seriennummern, Codes, Tokens, Koordinaten oder Messwerte ausgegeben.');
  return lines.join('\n');
}
module.exports={evaluateHardwareSession,formatReport};
