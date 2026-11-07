'use strict';
// Offline, value-free evaluator for DJI RC Pro Enterprise + Mavic 3M.
// Input comes from existing, authorized read-only backend endpoints.
// Never print serial numbers, GPS coordinates, measurement values or secrets.
const {summarizeTelemetryFields}=require('./telemetry-field-profile');
const {classifyM3MGaps,GROUPS}=require('./m3m-gap-classifier');
const catalog=require('./data/dji-cloud-api-118-fields.json');
// Never echo unrecognized MQTT property keys: a producer can encode an ID
// or arbitrary secret as an object key. Show only documented root names.
const knownShapeKeys=new Set(['app_version','mode_code','sub_devices','domain',
  'type','sub_type','thing_version','list','data','timestamp','firmware_version']);
for(const p of Object.values(catalog.profiles)){
  for(const f of p.fields){
    if(!f.path.includes('.'))knownShapeKeys.add(f.path);
  }
}

const RC='2:144:0',M3M='0:77:2';
const keyOf=d=>d?.model&&[d.model.domain,d.model.type,d.model.subType].join(':');
const age=(at,now)=>Number.isFinite(at)&&at<=now?Math.round((now-at)/1000):null;
function statusLabel(valid,observed){
  return valid?'BESTÄTIGT':observed?'NICHT AKTUELL':'NICHT NACHGEWIESEN';
}
function isObject(x){return x!==null&&typeof x==='object'&&!Array.isArray(x);}
function hasPropertyDiagnostics(device){
  // Version gate: a previous backend can supply real topology, osd and
  // telemetry values, but not the 1.18 sanitized property snapshots.
  // Never interpret an absent interface as 0 out of N DJI fields.
  return isObject(device?.propertyProfile) &&
    typeof device.propertyProfile.name==='string' &&
    isObject(device.deviceProperties?.osd) &&
    isObject(device.deviceProperties?.state) &&
    isObject(device.propertyObservedAt) &&
    isObject(device.propertyFieldObservedAt?.osd) &&
    isObject(device.propertyFieldObservedAt?.state);
}
function rootGapSummary(audit){
  const observed=new Set(audit.observedDocumented);
  const missing=audit.notObservedDocumented;
  const absentRoots=[],nestedUnderSeenRoot=[],nestedWithAbsentRoot=[];
  for(const label of missing){
    const split=label.indexOf(':');
    if(split<0)continue;
    const channel=label.slice(0,split),field=label.slice(split+1);
    const dot=field.indexOf('.');
    if(dot<0){absentRoots.push(label);continue;}
    const root=channel+':'+field.slice(0,dot);
    if(observed.has(root))nestedUnderSeenRoot.push(label);
    else nestedWithAbsentRoot.push(label);
  }
  return {
    absentRoots:absentRoots.sort(),
    nestedUnderSeenRoot:nestedUnderSeenRoot.sort(),
    nestedWithAbsentRoot:nestedWithAbsentRoot.sort()
  };
}
// These are documented by DJI for a generic aircraft, not in the pinned
// Mavic 3 family table. The MQTT shape catalog is BACKEND-WIDE, so this
// must not be presented as evidence that the M3M produced these keys.
const GENERIC_AIRCRAFT_CANDIDATES=Object.freeze([
  'distance_limit_status','rth_altitude','rc_lost_action',
  'payloads','wpmz_version'
]);

// Reports accepted, typed read-only properties, never their values. The
// model-scoped MQTT root catalog proves a field name was seen, while this
// separately checks what the versioned sanitizing parser accepted.
// An old backend without the M3M overlay must not report missing DJI values.
const M3M_EXTENSION_PATHS=Object.freeze([
  'distance_limit_status','distance_limit_status.state',
  'distance_limit_status.distance_limit',
  'distance_limit_status.is_near_distance_limit',
  'rth_altitude','rc_lost_action'
]);
function acceptedPath(root,path){
  let cursor=root;
  for(const component of path.split('.')){
    if(!isObject(cursor)||!Object.hasOwn(cursor,component))return false;
    cursor=cursor[component];
  }
  return cursor!==null&&cursor!==undefined;
}
function m3mExtensionAudit(device,now){
  const capable=hasPropertyDiagnostics(device)&&
    device?.propertyProfile?.name==='mavic3m';
  if(!capable)return {available:false,accepted:0,fresh:0,stale:0,
    unobserved:null,fields:[]};
  const data=device.deviceProperties.osd;
  const times=device.propertyFieldObservedAt.osd;
  const fields=M3M_EXTENSION_PATHS.map(path=>{
    const at=times[path];
    const seen=acceptedPath(data,path)&&
      Number.isFinite(at)&&at>0&&at<=now;
    const state=!seen?'NICHT BEOBACHTET':
      now-at<15000?'FRISCH':'HISTORISCH';
    return {path,status:state};
  });
  return {available:true,
    accepted:fields.filter(f=>f.status!=='NICHT BEOBACHTET').length,
    fresh:fields.filter(f=>f.status==='FRISCH').length,
    stale:fields.filter(f=>f.status==='HISTORISCH').length,
    unobserved:fields.filter(f=>f.status==='NICHT BEOBACHTET').length,
    fields};
}
// Catalog-filtered, value-free state path coverage. Snapshot values and
// serials never enter the result. State event arrival is not the same as
// a currently fresh property; do not erase historical observations.
function statePathSummary(audit){
  const stateOnly=key=>audit[key].filter(path=>path.startsWith('state:'));
  const observed=stateOnly('observedDocumented');
  const fresh=stateOnly('freshDocumented');
  const stale=stateOnly('staleDocumented');
  const missing=stateOnly('notObservedDocumented');
  const redacted=stateOnly('redactedDocumented');
  const unsupported=stateOnly('unsupportedDocumented');
  return {documented:observed.length+missing.length+redacted.length+unsupported.length,
    observed:observed.length,fresh:fresh.length,stale:stale.length,
    notObserved:missing.length,redacted:redacted.length,unsupported:unsupported.length,
    observedNames:observed.slice(0,48),
    missingRootNames:missing.filter(path=>!path.slice(6).includes('.')).slice(0,48)};
}
function deviceSummary(device,now){
  if(!device)return {seen:false,modelConfirmed:false,role:null,topologyOnline:null,
    osdFresh:false,osdAgeSeconds:null,stateObserved:false,stateAgeSeconds:null,
    propertyDiagnosticsAvailable:false,stateFields:null,
    propertyFields:{documented:0,inspectable:null,observed:null,fresh:null,stale:null,
      missing:null,redacted:null,untyped:null,observedNames:[],freshNames:[]}};
  const capable=hasPropertyDiagnostics(device);
  const [audit]=summarizeTelemetryFields([device],now);
  const rootGaps=capable?rootGapSummary(audit):null;
  const m3mGapGroups=capable&&keyOf(device)===M3M?
    classifyM3MGaps(audit.notObservedDocumented):null;
  const stateAge=capable?age(device.propertyObservedAt?.state,now):null;
  return {
    seen:true,modelConfirmed:true,
    role:device.role==='gateway'?'gateway':device.role==='subdevice'?'subdevice':'other',
    topologyOnline:device.topologyOnline===true,
    osdFresh:device.fresh===true&&age(device.lastTelemetryAt,now)!==null&&age(device.lastTelemetryAt,now)<15,
    osdAgeSeconds:age(device.lastTelemetryAt,now),
    stateObserved:stateAge!==null,
    stateAgeSeconds:stateAge,
    propertyDiagnosticsAvailable:capable,
    stateFields:capable?statePathSummary(audit):null,
    aircraftConnected:device.aircraftConnected===true,
    positionFixFresh:device.positionFresh===true,
    fieldProfileConfidence:device.propertyProfile?.confidence??null,
    propertyFields:{
      documented:audit.documentedTotal,
      inspectable:capable?audit.documentedInspectableTotal:null,
      observed:capable?audit.observedDocumented.length:null,
      fresh:capable?audit.freshDocumented.length:null,
      stale:capable?audit.staleDocumented.length:null,
      missing:capable?audit.notObservedDocumented.length:null,
      redacted:capable?audit.redactedDocumented.length:null,
      untyped:capable?audit.unsupportedDocumented.length:null,
      observedNames:capable?audit.observedDocumented.slice(0,60):[],
      freshNames:capable?audit.freshDocumented.slice(0,60):[],
      missingRoots:rootGaps?.absentRoots??null,
      missingNestedUnderObservedRoot:rootGaps?.nestedUnderSeenRoot??null,
      missingNestedWithAbsentRoot:rootGaps?.nestedWithAbsentRoot??null,
      m3mGapGroups
    }
  };
}
// Classify observation layers without collecting raw MQTT payloads, IDs or
// per-device values. The backend health counts are process-local; per-model
// shape counts start at backend boot too and require confirmed topology.
const DROP_REASON_KEYS=Object.freeze([
  'malformed','retained','stale','future','invalid','duplicate',
  'missing_timestamp_after_verified'
]);
// Reject reasons are process-wide in current backend. Attribute them to State
// ONLY if all other known channels had zero missed deliveries and the total
// received-minus-accepted equals the sum of bounded rejection reasons.
function stateDropEvidence(health){
  const o=health?.mqttObservedChannelCounts;
  const a=health?.mqttChannelCounts;
  const raw=health?.mqttDroppedByReason;
  if(!isObject(o)||!isObject(a)||!isObject(raw))
    return {available:false,attributed:false,stateNotAccepted:null,
      totalUnaccepted:null,reasons:[]};
  const channels=['osd','state','status','events','services_reply'];
  if(channels.some(c=>!Number.isSafeInteger(o[c])||o[c]<0||
      !Number.isSafeInteger(a[c])||a[c]<0||a[c]>o[c]))
    return {available:false,attributed:false,stateNotAccepted:null,
      totalUnaccepted:null,reasons:[]};
  const reasons=[];
  for(const reason of DROP_REASON_KEYS){
    const count=raw[reason];
    if(count!==undefined){
      if(!Number.isSafeInteger(count)||count<0)
        return {available:false,attributed:false,stateNotAccepted:null,
          totalUnaccepted:null,reasons:[]};
      if(count>0)reasons.push({reason,count});
    }
  }
  const stateNotAccepted=o.state-a.state;
  const totalUnaccepted=channels.reduce((v,c)=>v+o[c]-a[c],0);
  const totalReasons=reasons.reduce((sum,item)=>sum+item.count,0);
  const allKnownReasons=Object.keys(raw).every(x=>DROP_REASON_KEYS.includes(x));
  const otherChannelsFull=channels.every(c=>c==='state'||o[c]===a[c]);
  const totalRejected=health?.mqttRejectedMessages;
  const validRejected=Number.isSafeInteger(totalRejected)&&totalRejected>=0;
  const attributed=otherChannelsFull&&allKnownReasons&&validRejected&&
    totalRejected===totalUnaccepted&&totalReasons===totalUnaccepted;
  return {available:true,attributed,stateNotAccepted,totalUnaccepted,
    reasons:reasons.sort((x,y)=>x.reason.localeCompare(y.reason))};
}
function stateChannelEvidence(health,modelShapes,controller,aircraft){
  const raw=health?.mqttObservedChannelCounts?.state;
  const accepted=health?.mqttChannelCounts?.state;
  const observed=Number.isSafeInteger(raw)&&raw>=0?raw:null;
  const passed=Number.isSafeInteger(accepted)&&accepted>=0?accepted:null;
  const available=Array.isArray(modelShapes);
  const countFor=model=>available?modelShapes.reduce((sum,item)=>
    item&&item.channel==='state'&&item.model===model&&
      Number.isSafeInteger(item.count)&&item.count>0?
      sum+item.count:sum,0):null;
  const rc=countFor(RC),m3m=countFor(M3M);
  let status='NICHT PRUEFBAR';
  if(observed===0)status='KEIN STATE-TOPIC BEOBACHTET';
  else if(observed>0&&passed===0)status='STATE-TOPIC BEOBACHTET, NICHT ANGENOMMEN';
  else if(passed>0&&available&&rc===0&&m3m===0)
    status='STATE ANGENOMMEN, NICHT RC/M3M ZUGEORDNET';
  else if(passed>0&&available&&(rc>0||m3m>0))
    status='STATE MODELLBEZOGEN BEOBACHTET';
  else if(passed>0)status='STATE ANGENOMMEN, MODELLZUORDNUNG UNBEKANNT';
  return {status,observed,accepted:passed,
    modelScopedAvailable:available,
    modelRc:rc,modelM3m:m3m,
    rcTypedPropertiesObserved:controller.stateObserved,
    m3mTypedPropertiesObserved:aircraft.stateObserved};
}
function evaluateHardwareSession(devices,health,shapes,now=Date.now(),modelShapes=null){
  const list=Array.isArray(devices)?devices:[];
  const rc=list.find(d=>keyOf(d)===RC&&d.role==='gateway');
  const air=list.find(d=>keyOf(d)===M3M&&d.role==='subdevice');
  const linked=Boolean(rc&&air&&rc.sn&&air.gatewaySn===rc.sn&&
    Array.isArray(rc.children)&&rc.children.includes(air.sn));
  const counts=health?.mqttObservedChannelCounts??{};
  const shapeList=Array.isArray(shapes)?shapes:[];
  const shapeKeys=channel=>[...new Set(shapeList.filter(s=>s?.channel===channel)
    .flatMap(s=>Array.isArray(s.dataKeys)?s.dataKeys:[])
    .filter(k=>typeof k==='string'&&knownShapeKeys.has(k)))].sort().slice(0,70);
  const transport={
    mqttConnected:health?.mqtt===true,subscribed:health?.subscribed===true,
    ackEnabled:health?.topologyReplyEnabled===true,
    ackSent:Number.isSafeInteger(health?.topologyReplySent)?health.topologyReplySent:null,
    ackErrors:Number.isSafeInteger(health?.topologyReplyErrors)?health.topologyReplyErrors:null,
    osdPackets:Number.isSafeInteger(health?.mqttObservedOsdPackets)?health.mqttObservedOsdPackets:null,
    osdAccepted:Number.isSafeInteger(health?.mqttOsdMessages)?health.mqttOsdMessages:null,
    telemetryUpdates:Number.isSafeInteger(health?.mqttValidTelemetryUpdates)?health.mqttValidTelemetryUpdates:null,
    statusPackets:Number.isSafeInteger(counts.status)?counts.status:null,
    statePackets:Number.isSafeInteger(counts.state)?counts.state:null,
    osdShapeFields:shapeKeys('osd'),
    stateShapeFields:shapeKeys('state')
  };
  transport.genericAircraftCandidatesInBackendShapes=
    GENERIC_AIRCRAFT_CANDIDATES.filter(key=>
      transport.osdShapeFields.includes(key)||transport.stateShapeFields.includes(key));
  // Optional evidence from the new backend endpoint. Strictly bind to
  // pinned model keys and documented roots; never echo arbitrary device keys.
  const modelScopeAvailable=Array.isArray(modelShapes);
  const scopedRoots=(model,channel)=>{
    const profile=model===RC?'rcPro':'mavic3';
    const allowed=new Set(catalog.profiles[profile].fields
      .filter(field=>!field.path.includes('.')).map(field=>field.path));
    if(model===M3M)for(const key of GENERIC_AIRCRAFT_CANDIDATES)allowed.add(key);
    return modelScopeAvailable?[...new Set(modelShapes
      .filter(item=>item&&item.model===model&&item.channel===channel&&
        Number.isSafeInteger(item.count)&&item.count>0&&Array.isArray(item.dataKeys))
      .flatMap(item=>item.dataKeys)
      .filter(key=>typeof key==='string'&&allowed.has(key)))].sort():[];
  };
  transport.modelScopeAvailable=modelScopeAvailable;
  transport.rcModelOsdRoots=scopedRoots(RC,'osd');
  transport.rcModelStateRoots=scopedRoots(RC,'state');
  transport.m3mModelOsdRoots=scopedRoots(M3M,'osd');
  transport.m3mModelStateRoots=scopedRoots(M3M,'state');
  transport.m3mConfirmedGenericAircraftRoots=
    GENERIC_AIRCRAFT_CANDIDATES.filter(root=>
      transport.m3mModelOsdRoots.includes(root)||transport.m3mModelStateRoots.includes(root));
  transport.globalCandidateRootsNotAttributedToM3M=
    transport.genericAircraftCandidatesInBackendShapes.filter(root=>
      !transport.m3mConfirmedGenericAircraftRoots.includes(root));
  const controller=deviceSummary(rc,now);
  const aircraft=deviceSummary(air,now);
  const m3mExtensions=m3mExtensionAudit(air,now);
  const stateEvidence=stateChannelEvidence(health,modelShapes,controller,aircraft);
  const stateDrops=stateDropEvidence(health);
  // DJI pushMode=1 is event-driven: state is pushed on change, unlike
  // fixed-frequency OSD. A state packet that is 16 s old is evidence that
  // the channel works, not an indication of failed controller/aircraft.
  const stateStatus=d=>
    !d.seen?'NICHT NACHGEWIESEN':
    !d.propertyDiagnosticsAvailable?'NICHT PRÜFBAR':
    d.stateObserved?'BESTÄTIGT':'NICHT NACHGEWIESEN';
  const stages=[
    {step:'DJI-MQTT verbunden und abonniert',status:statusLabel(transport.mqttConnected&&transport.subscribed,transport.mqttConnected)},
    {step:'RC Pro Enterprise per Topologie erkannt',status:statusLabel(controller.seen&&controller.topologyOnline,controller.seen)},
    {step:'Mavic 3M per Topologie erkannt',status:statusLabel(aircraft.seen&&aircraft.topologyOnline,aircraft.seen)},
    {step:'RC und M3M zugeordnet',status:statusLabel(linked,Boolean(rc&&air))},
    {step:'RC sendet aktuelle OSD-Telemetrie',status:statusLabel(controller.osdFresh,controller.osdAgeSeconds!==null)},
    {step:'M3M verbunden und mit aktueller OSD-Telemetrie',status:statusLabel(aircraft.aircraftConnected&&aircraft.osdFresh,aircraft.osdAgeSeconds!==null)},
    {step:'RC State-Daten empfangen (bei Änderung)',status:stateStatus(controller)},
    {step:'M3M State-Daten empfangen (bei Änderung)',status:stateStatus(aircraft)}
  ];
  return {target:'DJI RC Pro Enterprise + Mavic 3M',mode:'nur Lesen',
    transport,controller,aircraft,m3mExtensions,stateEvidence,stateDrops,linked,stages,
    notes:[
      'MQTT- und Shape-Zähler gelten backendweit, nicht individuell für die RC/M3M.',
      'Globale MQTT-Shapes erlauben keine Gerätezuordnung. Nur der optionale modellbezogene Katalog nach akzeptiertem Paket und bestätigter Topologie kann Rootfelder der M3M zurechnen.',
      'Nicht beobachtet ist kein Beweis für eine von DJI nicht unterstützte Eigenschaft.',
      'M3M (0:77:2): drei generische OSD-Rootnamen und sechs typisierte Feldpfade auf echter Hardware vom Parser angenommen; die konkreten Werte, Grenzfälle und sicherheitsrelevanten Funktionen sind nicht unabhängig validiert.',
      'DJI State (pushMode 1) wird bei Zustandsänderung gesendet. Ältere State-Zeitstempel bedeuten nicht automatisch einen Kommunikationsfehler.',
      'Ohne deviceProperties, propertyProfile und propertyFieldObservedAt kann der Container keine feldgenaue 1.18-Abnahme liefern.',
      'Ein Hardwaretest erfordert echte, zeitnahe Pilot-2-MQTT-Meldungen; synthetische Tests sind kein Ersatz.'
    ]};
}
function formatReport(r){
  const lines=[
    '=== RC Pro Enterprise + Mavic 3M – Hardwareabnahme (nur Lesen) ===',
    'MQTT verbunden: '+r.transport.mqttConnected+' | Abos bestätigt: '+r.transport.subscribed,
    'Topo-Antwort aktiv: '+r.transport.ackEnabled+' | gesendet: '+(r.transport.ackSent??'n/v')+
      ' | Fehler: '+(r.transport.ackErrors??'n/v'),
    'MQTT OSD beobachtet: '+(r.transport.osdPackets??'n/v')+
      ' | übernommen: '+(r.transport.osdAccepted??'n/v')+
      ' | verwertbare Telemetrie: '+(r.transport.telemetryUpdates??'n/v'),
    'Status-/State-Pakete (backendweit): '+(r.transport.statusPackets??'n/v')+' / '+(r.transport.statePackets??'n/v'),
    ...r.stages.map(x=>x.status.padEnd(17)+' '+x.step)
  ];
  for(const [title,d] of [['RC Pro Enterprise',r.controller],['Mavic 3M',r.aircraft]]){
    lines.push('--- '+title+' ---');
    if(!d.seen){lines.push('Gerät nicht in der aktuellen Topologie nachgewiesen');continue;}
    lines.push('OSD Alter (s): '+(d.osdAgeSeconds??'nicht beobachtet')+
      ' | State Alter (s): '+(d.stateAgeSeconds??'nicht beobachtet'));
    if(!d.propertyDiagnosticsAvailable){
      lines.push('Feldparser: NICHT PRÜFBAR (laufendes Backend stellt die DJI-1.18-Schnittstelle nicht bereit).');
      lines.push('Dokumentierte Pfade im Testkatalog: '+d.propertyFields.documented+
        ' | beobachtete/fehlende Pfade: nicht ermittelbar.');
      continue;
    }
    lines.push('Feldparser: verfügbar');
    lines.push('Dokumentierte Pfade: '+d.propertyFields.documented+
      ' | beobachtet: '+d.propertyFields.observed+
      ' | frisch: '+d.propertyFields.fresh+
      ' | veraltet: '+d.propertyFields.stale+
      ' | nicht beobachtet: '+d.propertyFields.missing+
      ' | redigiert: '+d.propertyFields.redacted+
      ' | nicht typisiert: '+d.propertyFields.untyped);
    lines.push('Frische Feldnamen (max. 60): '+(d.propertyFields.freshNames.join(', ')||'keine'));
    lines.push('Beobachtete Feldnamen (max. 60): '+(d.propertyFields.observedNames.join(', ')||'keine'));
    const p=d.propertyFields;
    lines.push('Nicht beobachtete Rootfelder ('+p.missingRoots.length+'): '+(p.missingRoots.join(', ')||'keine'));
    lines.push('Nicht beobachtete Unterfelder trotz beobachtetem Root ('+
      p.missingNestedUnderObservedRoot.length+'), erste 40: '+
      (p.missingNestedUnderObservedRoot.slice(0,40).join(', ')||'keine'));
    lines.push('Nicht beobachtete Unterfelder ohne beobachtetes Root ('+
      p.missingNestedWithAbsentRoot.length+'); keine unabhängige Sensor-Nichtverfügbarkeit ableiten.');
  }
  lines.push('--- DJI State-Feldabdeckung je Geraet (nur validierte Feldnamen) ---');
  for(const [name,device] of [['RC Pro',r.controller],['M3M',r.aircraft]]){
    const sf=device?.stateFields;
    if(!sf){lines.push(name+': NICHT PRUEFBAR');continue;}
    lines.push(name+': dokumentiert='+sf.documented+' | beobachtet='+sf.observed+
      ' | frisch='+sf.fresh+' | historisch='+sf.stale+
      ' | nicht beobachtet='+sf.notObserved+' | redigiert='+sf.redacted+
      ' | nicht typisiert='+sf.unsupported);
    lines.push(name+' beobachtete State-Feldnamen: '+(sf.observedNames.join(', ')||'keine'));
    lines.push(name+' fehlende State-Rootnamen: '+(sf.missingRootNames.join(', ')||'keine'));
  }
  const state=r.stateEvidence;
  lines.push('--- DJI State-Kanalanalyse (nur Zaehlwerte, keine Nutzdaten) ---');
  lines.push('State auf MQTT-Topic beobachtet: '+(state.observed??'nicht ermittelbar')+
    ' | nach Pruefung angenommen: '+(state.accepted??'nicht ermittelbar'));
  lines.push('State-MQTT-Modellzuordnung: '+
    (state.modelScopedAvailable?'verfuegbar':'NICHT VERFUEGBAR')+
    ' | RC: '+(state.modelRc??'n/v')+' | M3M: '+(state.modelM3m??'n/v'));
  lines.push('State-Status: '+state.status);
  lines.push('Geraeteseitige typisierte State-Feldannahme: RC '+
    (state.rcTypedPropertiesObserved?'ja':'nein')+
    ' | M3M '+(state.m3mTypedPropertiesObserved?'ja':'nein'));
  lines.push('HINWEIS: State wird bei Aenderung gesendet. 0 empfangene State-Topics sind kein Beweis eines Defekts, sollten bei laengerem Betrieb jedoch geprueft werden.');
  const drop=r.stateDrops;
  if(drop?.available){
    lines.push('State-Pakete nicht angenommen (Differenz): '+drop.stateNotAccepted);
    lines.push('Backendweit verworfene Nachrichten nach Grund: '+
      (drop.reasons.map(item=>item.reason+'='+item.count).join(', ')||'keine'));
    lines.push('Ablehnungsgruende dem State-Kanal zurechenbar: '+
      (drop.attributed?'JA (alle anderen beobachteten Kanaele vollstaendig angenommen, Bilanz stimmt)':
        'NEIN (backendweite Statistik reicht nicht fuer genaue Zuordnung)'));
  }else{
    lines.push('Ablehnungsgruende: NICHT PRUEFBAR (backendweite Metrik unvollstaendig).');
  }
  lines.push('--- M3M-Feldluecken nach Kamerafunktion und MQTT-Kanal (nur Namen) ---');
  const gaps=r.aircraft?.propertyFields?.m3mGapGroups;
  if(!gaps){
    lines.push('M3M-Feldluecken-Klassifikation: NICHT PRUEFBAR (Feldschnittstelle nicht vorhanden).');
  }else{
    lines.push('M3M klassifizierte, nicht beobachtete auswertbare Pfade: '+gaps.classified);
    for(const {key} of GROUPS)
      lines.push('  '+gaps.groups[key].label+': '+gaps.groups[key].count);
    lines.push('  Hinweis: NIR-Multispektralkanaele sind KEINE thermische Waermebildmessung.');
    lines.push('  Alle Pfade bleiben im 150-Feld-Schema enthalten. Keine Kompatibilitaet allein aus Abwesenheit ableiten.');
  }
  lines.push('--- M3M-Erweiterung: typisierte OSD-Wertannahme (ohne Werte) ---');
  if(!r.m3mExtensions?.available){
    lines.push('M3M-150-Feldparser: NICHT AKTIV (nur Rootnamen-Nachweis, keine Werteprüfung).');
  }else{
    lines.push('M3M-150-Feldparser: verfügbar; gültig übernommene Felder: '+
      r.m3mExtensions.accepted+' / '+M3M_EXTENSION_PATHS.length+
      ' | frisch: '+r.m3mExtensions.fresh+
      ' | historisch: '+r.m3mExtensions.stale+
      ' | nicht übernommen: '+r.m3mExtensions.unobserved);
    for(const field of r.m3mExtensions.fields)
      lines.push(field.status.padEnd(17)+' osd:'+field.path);
    lines.push('HINWEIS: Keine Annahme bedeutet auch: Feld fehlt, hat keinen gültigen Typ oder wurde vom Filter verworfen; keine Ursache ableitbar.');
  }
  lines.push('Bekannte MQTT OSD-Rootfelder (backendweit): '+(r.transport.osdShapeFields.join(', ')||'keine'));
  lines.push('Bekannte MQTT State-Rootfelder (backendweit): '+(r.transport.stateShapeFields.join(', ')||'keine'));
  lines.push('Generische Aircraft-Erweiterungen in MQTT-Shapes (nur backendweit): '+
    (r.transport.genericAircraftCandidatesInBackendShapes.join(', ')||'keine'));
  if(!r.transport.modelScopeAvailable){
    lines.push('Modellbezogene MQTT-Feldzuordnung: NICHT VERFÜGBAR (erfordert separates Backend-Update).');
    lines.push('Kein M3M-Nachweis für die globalen Erweiterungs-Rootfelder.');
  }else{
    lines.push('Modellbezogene MQTT-Feldzuordnung: verfügbar, ab Backend-Start erfasst.');
    lines.push('RC Pro OSD/State-Rootfelder: '+
      (r.transport.rcModelOsdRoots.join(', ')||'keine')+' / '+
      (r.transport.rcModelStateRoots.join(', ')||'keine'));
    lines.push('M3M OSD/State-Rootfelder: '+
      (r.transport.m3mModelOsdRoots.join(', ')||'keine')+' / '+
      (r.transport.m3mModelStateRoots.join(', ')||'keine'));
    lines.push('Generische Aircraft-Rootfelder durch M3M-MQTT konkret nachgewiesen: '+
      (r.transport.m3mConfirmedGenericAircraftRoots.join(', ')||'keine'));
    lines.push('Backendweit bekannte Kandidaten OHNE M3M-Zuordnungsnachweis: '+
      (r.transport.globalCandidateRootsNotAttributedToM3M.join(', ')||'keine'));
  }
  lines.push(...r.notes.map(x=>'Hinweis: '+x));
  lines.push('Keine Geräte-IDs, Koordinaten, Messwerte oder Zugangsdaten ausgegeben.');
  return lines.join('\n');
}
module.exports={evaluateHardwareSession,formatReport};
