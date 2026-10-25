'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const path=require('node:path');
const {evaluateHardwareSession,formatReport}=require('../hardware-validation');

const now=1792609000000;
const rc={
  sn:'PRIVATE_RC_SERIAL',role:'gateway',model:{domain:'2',type:144,subType:0},
  modelName:'DJI RC Pro Enterprise',topologyOnline:true,
  children:['PRIVATE_AIR_SERIAL'],lastTelemetryAt:now-1500,
  fresh:true,telemetryTimeVerified:true,topologyTimeVerified:true,
  propertyProfile:{name:'rcPro',confidence:'official-device'},
  propertyObservedAt:{osd:now-1500,state:now-2500},
  propertyFieldObservedAt:{osd:{capacity_percent:now-1500},state:{firmware_version:now-2500}},
  deviceProperties:{osd:{capacity_percent:80},state:{firmware_version:'1.2.3'}},
  telemetry:{battery:80}
};
const air={
  sn:'PRIVATE_AIR_SERIAL',gatewaySn:'PRIVATE_RC_SERIAL',
  role:'subdevice',model:{domain:'0',type:77,subType:2},
  modelName:'Mavic 3M',topologyOnline:true,aircraftConnected:true,
  lastTelemetryAt:now-1200,fresh:true,positionFresh:true,
  propertyProfile:{name:'mavic3m',confidence:'shared-family-three-generic-roots-observed-values-unverified'},
  propertyObservedAt:{osd:now-1200,state:now-4200},
  propertyFieldObservedAt:{osd:{mode_code:now-1200,'battery.capacity_percent':now-1200},
    state:{firmware_version:now-4200}},
  deviceProperties:{osd:{mode_code:4,battery:{capacity_percent:53}},state:{firmware_version:'9.8.7'}},
  telemetry:{battery:53,latitude:49.123456,longitude:8.123456}
};
const health={
  mqtt:true,subscribed:true,topologyReplyEnabled:true,topologyReplySent:4,
  topologyReplyErrors:0,mqttObservedOsdPackets:80,mqttOsdMessages:70,
  mqttValidTelemetryUpdates:60,mqttObservedChannelCounts:{status:5,state:12}
};
const shapes=[
  {channel:'osd',dataKeys:['capacity_percent','mode_code','password',
    'PRIVATE_RC_SERIAL','latitude','longitude']},
  {channel:'state',dataKeys:['firmware_version','PRIVATE_AIR_SERIAL']}
];

test('healthy paired RC Pro Enterprise and Mavic 3M are linked and have current OSD',()=>{
  const report=evaluateHardwareSession([rc,air],health,shapes,now);
  assert.equal(report.linked,true);
  assert.equal(report.controller.seen,true);
  assert.equal(report.aircraft.seen,true);
  assert.equal(report.controller.osdFresh,true);
  assert.equal(report.aircraft.osdFresh,true);
  assert.equal(report.aircraft.aircraftConnected,true);
  assert.equal(report.controller.propertyFields.documented,55);
  assert.equal(report.aircraft.propertyFields.documented,150);
  assert.ok(report.aircraft.propertyFields.freshNames.includes('osd:mode_code'));
  const text=formatReport(report);
  assert.match(text,/RC Pro Enterprise \+ Mavic 3M/);
  assert.match(text,/BESTÄTIGT/);
  assert.doesNotMatch(text,/PRIVATE|49\.123456|8\.123456|9\.8\.7|1\.2\.3|password/);
});

test('missing aircraft, disconnected or stale telemetry are not mistakenly confirmed',()=>{
  const noAircraft=evaluateHardwareSession([rc],health,shapes,now);
  assert.equal(noAircraft.linked,false);
  assert.equal(noAircraft.aircraft.seen,false);
  assert.ok(noAircraft.stages.some(x=>x.status==='NICHT NACHGEWIESEN'));
  const stale=evaluateHardwareSession([rc,{...air,lastTelemetryAt:now-30000,
    fresh:false,aircraftConnected:false}],health,shapes,now);
  assert.equal(stale.linked,true);
  assert.equal(stale.aircraft.osdFresh,false);
  assert.equal(stale.aircraft.aircraftConnected,false);
  assert.ok(stale.stages.some(x=>x.step.includes('M3M verbunden')&&x.status==='NICHT AKTUELL'));
});

test('two unrelated devices never satisfy the paired topology test',()=>{
  const other={...air,gatewaySn:'OTHER_CONTROLLER_SERIAL'};
  const result=evaluateHardwareSession([rc,other],health,shapes,now);
  assert.equal(result.linked,false);
  assert.ok(result.stages.some(x=>x.step==='RC und M3M zugeordnet'&&x.status!=='BESTÄTIGT'));
  assert.doesNotMatch(formatReport(result),/OTHER_CONTROLLER_SERIAL/);
});

test('unrecognized status/OSD root keys are excluded from printed shape field names',()=>{
  const report=evaluateHardwareSession([rc,air],health,shapes,now);
  assert.ok(report.transport.osdShapeFields.includes('latitude'));
  assert.ok(report.transport.osdShapeFields.includes('mode_code'));
  assert.ok(!report.transport.osdShapeFields.includes('password'));
  assert.ok(!report.transport.stateShapeFields.includes('PRIVATE_AIR_SERIAL'));
  assert.doesNotMatch(JSON.stringify(report),/PRIVATE_RC_SERIAL|PRIVATE_AIR_SERIAL|49\.123456|9\.8\.7/);
});

test('event-triggered state is confirmed even after 16 seconds without a change',()=>{
  const sixteenSecondsAgo=now-16000;
  const rcState={...rc,propertyObservedAt:{osd:now-1500,state:sixteenSecondsAgo}};
  const airState={...air,propertyObservedAt:{osd:now-1200,state:sixteenSecondsAgo}};
  const report=evaluateHardwareSession([rcState,airState],health,shapes,now);
  assert.equal(report.controller.stateAgeSeconds,16);
  assert.equal(report.aircraft.stateAgeSeconds,16);
  assert.ok(report.stages.filter(x=>x.step.includes('State-Daten empfangen'))
    .every(x=>x.status==='BESTÄTIGT'));
  const displayed=formatReport(report);
  assert.match(displayed,/State Alter \(s\): 16/);
  assert.match(displayed,/redigiert: /);
  assert.match(displayed,/nicht typisiert: /);
});

test('Pi hardware-check help does not use Docker or require a connected drone',()=>{
  const file=path.resolve(__dirname,'../../scripts/pi-rc-pro-m3m-check.js');
  const out=spawnSync(process.execPath,[file,'--help'],{encoding:'utf8',timeout:5000});
  assert.equal(out.status,0);
  assert.match(out.stdout,/RC Pro Enterprise \+ Mavic 3M/);
  assert.doesNotMatch(out.stdout,/PRIVATE|192\.168\./);
});

test('legacy backend without new DJI-property API remains transport-valid but field coverage is unknown',()=>{
  const legacyRC={...rc,propertyProfile:undefined,deviceProperties:undefined,
    propertyObservedAt:undefined,propertyFieldObservedAt:undefined};
  const legacyM3M={...air,propertyProfile:undefined,deviceProperties:undefined,
    propertyObservedAt:undefined,propertyFieldObservedAt:undefined};
  const report=evaluateHardwareSession([legacyRC,legacyM3M],health,shapes,now);
  assert.equal(report.linked,true);
  assert.equal(report.controller.osdFresh,true);
  assert.equal(report.aircraft.osdFresh,true);
  assert.equal(report.controller.propertyDiagnosticsAvailable,false);
  assert.equal(report.aircraft.propertyDiagnosticsAvailable,false);
  assert.equal(report.controller.propertyFields.documented,55);
  assert.equal(report.aircraft.propertyFields.documented,150);
  assert.equal(report.controller.propertyFields.observed,null);
  assert.equal(report.aircraft.propertyFields.missing,null);
  assert.ok(report.stages.filter(x=>x.step.includes('State-Daten empfangen'))
    .every(x=>x.status==='NICHT PRÜFBAR'));
  const printed=formatReport(report);
  assert.match(printed,/Feldparser: NICHT PRÜFBAR/);
  assert.match(printed,/beobachtete\/fehlende Pfade: nicht ermittelbar/);
  assert.doesNotMatch(printed,/beobachtet: 0 \| frisch: 0/);
  assert.doesNotMatch(printed,/PRIVATE|49\.123456|8\.123456/);
});

test('partial DJI property interface is not treated as a complete field audit',()=>{
  const incomplete={...air,propertyFieldObservedAt:undefined};
  const report=evaluateHardwareSession([rc,incomplete],health,shapes,now);
  assert.equal(report.aircraft.propertyDiagnosticsAvailable,false);
  assert.equal(report.aircraft.propertyFields.observed,null);
  assert.equal(report.controller.propertyDiagnosticsAvailable,true);
  assert.ok(report.stages.some(x=>x.step.includes('M3M State-Daten')&&x.status==='NICHT PRÜFBAR'));
});


test('missing DJI root fields and absent nested paths are counted separately',()=>{
  const report=evaluateHardwareSession([rc,air],health,shapes,now);
  for(const d of [report.controller,report.aircraft]){
    const p=d.propertyFields;
    assert.equal(p.missingRoots.length+p.missingNestedUnderObservedRoot.length+
      p.missingNestedWithAbsentRoot.length,p.missing);
  }
  assert.ok(report.aircraft.propertyFields.missingNestedUnderObservedRoot
    .includes('osd:battery.remain_flight_time'));
  assert.ok(report.aircraft.propertyFields.missingRoots.includes('osd:wind_speed'));
  // The root was observed, so its missing child is not an absent root.
  assert.ok(!report.aircraft.propertyFields.missingRoots.includes('osd:battery'));
  assert.match(formatReport(report),/Nicht beobachtete Rootfelder/);
  assert.doesNotMatch(formatReport(report),/PRIVATE_RC_SERIAL|PRIVATE_AIR_SERIAL/);
});

test('backend-wide generic aircraft property extensions are not misattributed to M3M',()=>{
  const found=[
    {channel:'osd',dataKeys:['distance_limit_status','rth_altitude','rc_lost_action']},
    {channel:'state',dataKeys:['payloads','wpmz_version']}
  ];
  const report=evaluateHardwareSession([rc,air],health,found,now);
  assert.deepEqual(report.transport.genericAircraftCandidatesInBackendShapes,
    ['distance_limit_status','rth_altitude','rc_lost_action','payloads','wpmz_version']);
  assert.ok(report.notes.some(x=>x.includes('Globale MQTT-Shapes erlauben keine Gerätezuordnung')));
  assert.match(formatReport(report),/Kein M3M-Nachweis/);
  assert.equal(report.aircraft.propertyFields.documented,150);
  assert.ok(!report.aircraft.propertyFields.observedNames.includes('state:payloads'));
});

test('older backend yields no speculative missing-root classifications',()=>{
  const old={...air,propertyProfile:undefined,deviceProperties:undefined,
    propertyObservedAt:undefined,propertyFieldObservedAt:undefined};
  const result=evaluateHardwareSession([rc,old],health,shapes,now);
  assert.equal(result.aircraft.propertyFields.missingRoots,null);
  assert.equal(result.aircraft.propertyFields.missingNestedUnderObservedRoot,null);
  assert.equal(result.aircraft.propertyFields.missingNestedWithAbsentRoot,null);
  assert.doesNotMatch(formatReport(result),/PRIVATE_AIR_SERIAL/);
});


test('model-scoped MQTT attribution distinguishes actual M3M roots from backend-wide candidates',()=>{
  const perModel=[
    {model:'2:144:0',channel:'osd',count:15,dataKeys:['wireless_link','capacity_percent','SECRET_DEVICE']},
    {model:'0:77:2',channel:'osd',count:12,dataKeys:['mode_code','rth_altitude','distance_limit_status','GPS_SECRET']},
    {model:'0:77:2',channel:'state',count:4,dataKeys:['payloads','wpmz_version']},
    {model:'0:99:1',channel:'state',count:3,dataKeys:['rc_lost_action']}
  ];
  const global=[
    {channel:'osd',dataKeys:['rth_altitude','distance_limit_status','rc_lost_action']},
    {channel:'state',dataKeys:['payloads','wpmz_version']}
  ];
  const report=evaluateHardwareSession([rc,air],health,global,now,perModel);
  assert.equal(report.transport.modelScopeAvailable,true);
  assert.deepEqual(report.transport.rcModelOsdRoots,['capacity_percent','wireless_link']);
  assert.deepEqual(report.transport.m3mModelOsdRoots,['distance_limit_status','mode_code','rth_altitude']);
  assert.deepEqual(report.transport.m3mModelStateRoots,['payloads','wpmz_version']);
  assert.deepEqual(report.transport.m3mConfirmedGenericAircraftRoots,
    ['distance_limit_status','rth_altitude','payloads','wpmz_version']);
  assert.deepEqual(report.transport.globalCandidateRootsNotAttributedToM3M,['rc_lost_action']);
  assert.match(formatReport(report),/konkret nachgewiesen/);
  assert.doesNotMatch(JSON.stringify(report),/GPS_SECRET|SECRET_DEVICE/);
});

test('old backend has no model attribution, even when global MQTT shapes mention candidate fields',()=>{
  const global=[
    {channel:'osd',dataKeys:['rth_altitude','distance_limit_status']},
    {channel:'state',dataKeys:['payloads']}
  ];
  const report=evaluateHardwareSession([rc,air],health,global,now);
  assert.equal(report.transport.modelScopeAvailable,false);
  assert.deepEqual(report.transport.m3mConfirmedGenericAircraftRoots,[]);
  assert.match(formatReport(report),/NICHT VERFÜGBAR/);
  assert.match(formatReport(report),/Kein M3M-Nachweis/);
});

test('model attribution is strictly whitelisted and ignores spoofed or unsupported model keys',()=>{
  const modelShapes=[
    {model:'0:77:2',channel:'osd',count:1,
      dataKeys:['mode_code','rth_altitude','SERIAL_FROM_INPUT','__proto__']},
    {model:'0:77:2',channel:'state',count:0,dataKeys:['payloads']},
    {model:'2:144:0',channel:'state',count:1,dataKeys:['payloads','live_capacity']},
    {model:'0:77:2',channel:'events',count:1,dataKeys:['rth_altitude']},
    {model:'ANY_SECRET',channel:'osd',count:1,dataKeys:['mode_code']}
  ];
  const report=evaluateHardwareSession([rc,air],health,[],now,modelShapes);
  assert.deepEqual(report.transport.m3mModelOsdRoots,['mode_code','rth_altitude']);
  assert.deepEqual(report.transport.m3mModelStateRoots,[]);
  assert.deepEqual(report.transport.rcModelStateRoots,['live_capacity']);
  assert.doesNotMatch(JSON.stringify(report),/SERIAL_FROM_INPUT|ANY_SECRET|__proto__/);
});


test('M3M extension audit has no value claims while only the old Pi profile is deployed',()=>{
  const report=evaluateHardwareSession([rc,{...air,propertyProfile:{name:'mavic3',
    confidence:'shared-family-unverified'}}],health,shapes,now);
  assert.equal(report.aircraft.seen,true);
  assert.equal(report.m3mExtensions.available,false);
  assert.equal(report.m3mExtensions.unobserved,null);
  assert.deepEqual(report.m3mExtensions.fields,[]);
  assert.match(formatReport(report),/M3M-150-Feldparser: NICHT AKTIV/);
});

test('M3M extension audit reports accepted typed fields and age, never their values',()=>{
  const obsAt=now-1200,oldAt=now-40000;
  const extended={...air,
    propertyProfile:{name:'mavic3m',
      confidence:'shared-family-three-generic-roots-observed-values-unverified'},
    deviceProperties:{osd:{
      mode_code:4, rth_altitude:125, rc_lost_action:1,
      distance_limit_status:{state:1,distance_limit:300,is_near_distance_limit:0}
    },state:{}},
    propertyFieldObservedAt:{osd:{
      rth_altitude:obsAt,rc_lost_action:oldAt,
      distance_limit_status:obsAt,
      'distance_limit_status.state':obsAt,
      'distance_limit_status.distance_limit':obsAt,
      'distance_limit_status.is_near_distance_limit':obsAt
    },state:{}}
  };
  const report=evaluateHardwareSession([rc,extended],health,shapes,now);
  assert.equal(report.m3mExtensions.available,true);
  assert.equal(report.m3mExtensions.accepted,6);
  assert.equal(report.m3mExtensions.fresh,5);
  assert.equal(report.m3mExtensions.stale,1);
  assert.equal(report.m3mExtensions.unobserved,0);
  assert.deepEqual(report.m3mExtensions.fields.map(f=>f.path),[
    'distance_limit_status','distance_limit_status.state',
    'distance_limit_status.distance_limit','distance_limit_status.is_near_distance_limit',
    'rth_altitude','rc_lost_action'
  ]);
  const output=formatReport(report);
  assert.match(output,/HISTORISCH\s+osd:rc_lost_action/);
  assert.doesNotMatch(output,/125|300|PRIVATE|SECRET|49\.123456|8\.123456/);
  assert.doesNotMatch(JSON.stringify(report),/125|300|PRIVATE|SECRET|49\.123456/);
});

test('typed M3M fields without accepted times or value are not reported as valid',()=>{
  const input={...air,propertyProfile:{name:'mavic3m'},
    deviceProperties:{osd:{rth_altitude:75,
      distance_limit_status:{state:1}},state:{}},
    propertyFieldObservedAt:{osd:{rth_altitude:now-2000,
      distance_limit_status:now-2000,
      'distance_limit_status.state':now+5000},state:{}}
  };
  const report=evaluateHardwareSession([rc,input],health,shapes,now);
  assert.equal(report.m3mExtensions.available,true);
  assert.equal(report.m3mExtensions.accepted,2);
  assert.equal(report.m3mExtensions.fresh,2);
  assert.equal(report.m3mExtensions.unobserved,4);
  assert.equal(report.m3mExtensions.fields.find(x=>x.path==='distance_limit_status.state').status,
    'NICHT BEOBACHTET');
  assert.equal(report.m3mExtensions.fields.find(x=>x.path==='rc_lost_action').status,
    'NICHT BEOBACHTET');
});

test('M3M gap audit reports each missing path exactly once and no hardware settings',()=>{
  const report=evaluateHardwareSession([rc,air],health,shapes,now);
  const p=report.aircraft.propertyFields;
  assert.ok(p.m3mGapGroups);
  assert.equal(p.m3mGapGroups.classified,p.missing);
  assert.equal(Object.values(p.m3mGapGroups.groups).reduce((n,g)=>n+g.count,0),p.missing);
  assert.ok(p.m3mGapGroups.groups.thermalCamera.count>0);
  assert.ok(p.m3mGapGroups.groups.zoomCamera.count>0);
  const printed=formatReport(report);
  assert.match(printed,/M3M-Feldluecken nach Kamerafunktion/);
  assert.match(printed,/KEINE thermische Waermebildmessung/);
  assert.doesNotMatch(printed,/PRIVATE_AIR_SERIAL|PRIVATE_RC_SERIAL|49\\.123456|8\\.123456/);
});

test('missing M3M on an older backend is not invented as camera capability data',()=>{
  const oldAir={...air,propertyProfile:undefined,deviceProperties:undefined,
    propertyObservedAt:undefined,propertyFieldObservedAt:undefined};
  const report=evaluateHardwareSession([rc,oldAir],health,shapes,now);
  assert.equal(report.aircraft.propertyFields.m3mGapGroups,null);
  assert.match(formatReport(report),/M3M-Feldluecken-Klassifikation: NICHT PRUEFBAR/);
});


test('State channel diagnostics distinguish zero deliveries from rejected and accepted messages',()=>{
  const cases=[
    {observed:0,accepted:0,status:'KEIN STATE-TOPIC BEOBACHTET'},
    {observed:7,accepted:0,status:'STATE-TOPIC BEOBACHTET, NICHT ANGENOMMEN'},
    {observed:9,accepted:2,status:'STATE ANGENOMMEN, NICHT RC/M3M ZUGEORDNET'}
  ];
  for(const c of cases){
    const h={...health,
      mqttObservedChannelCounts:{...health.mqttObservedChannelCounts,state:c.observed},
      mqttChannelCounts:{state:c.accepted}};
    const r=evaluateHardwareSession([rc,air],h,shapes,now,[]);
    assert.equal(r.stateEvidence.observed,c.observed);
    assert.equal(r.stateEvidence.accepted,c.accepted);
    assert.equal(r.stateEvidence.status,c.status);
    assert.equal(r.stateEvidence.modelRc,0);
    assert.equal(r.stateEvidence.modelM3m,0);
    assert.match(formatReport(r),/State auf MQTT-Topic beobachtet/);
    assert.doesNotMatch(formatReport(r),/PRIVATE_AIR_SERIAL|PRIVATE_RC_SERIAL/);
  }
});

test('State model evidence shows accepted packets separately from typed property acceptance',()=>{
  const h={...health,mqttChannelCounts:{state:4}};
  const modelShapes=[
    {channel:'state',model:'2:144:0',count:1,dataKeys:['live_capacity','PRIVATE_RC_SERIAL']},
    {channel:'state',model:'0:77:2',count:2,dataKeys:['firmware_version','PRIVATE_AIR_SERIAL']},
    {channel:'state',model:'unknown',count:999,dataKeys:['SECRET_TOKEN']}
  ];
  const noTypedAir={...air,propertyObservedAt:{...air.propertyObservedAt,state:null}};
  const r=evaluateHardwareSession([rc,noTypedAir],h,shapes,now,modelShapes);
  assert.equal(r.stateEvidence.status,'STATE MODELLBEZOGEN BEOBACHTET');
  assert.equal(r.stateEvidence.modelRc,1);
  assert.equal(r.stateEvidence.modelM3m,2);
  assert.equal(r.stateEvidence.rcTypedPropertiesObserved,true);
  assert.equal(r.stateEvidence.m3mTypedPropertiesObserved,false);
  assert.match(formatReport(r),/Geraeteseitige typisierte State-Feldannahme: RC ja \| M3M nein/);
  assert.doesNotMatch(JSON.stringify(r),/PRIVATE|SECRET_TOKEN|unknown/);
});

test('State channel diagnostics remain non-speculative with older backend or incomplete health',()=>{
  const h={...health,mqttChannelCounts:{state:3}};
  const report=evaluateHardwareSession([rc,air],h,shapes,now);
  assert.equal(report.stateEvidence.modelScopedAvailable,false);
  assert.equal(report.stateEvidence.modelRc,null);
  assert.equal(report.stateEvidence.status,'STATE ANGENOMMEN, MODELLZUORDNUNG UNBEKANNT');
  const unavailable=evaluateHardwareSession([rc,air],{},[],now);
  assert.equal(unavailable.stateEvidence.status,'NICHT PRUEFBAR');
  assert.match(formatReport(unavailable),/State-Status: NICHT PRUEFBAR/);
});


test('realistic state-only rejected delta is attributed only with a complete balanced breakdown',()=>{
  const h={...health,
    mqttObservedChannelCounts:{osd:2052,state:18,status:2,events:1026,services_reply:0},
    mqttChannelCounts:{osd:2052,state:13,status:2,events:1026,services_reply:0},
    mqttRejectedMessages:5,
    mqttDroppedByReason:{duplicate:3,stale:2}
  };
  const report=evaluateHardwareSession([rc,air],h,shapes,now,[]);
  assert.deepEqual(report.stateDrops,{
    available:true,attributed:true,stateNotAccepted:5,totalUnaccepted:5,
    reasons:[{reason:'duplicate',count:3},{reason:'stale',count:2}]
  });
  assert.match(formatReport(report),/State-Pakete nicht angenommen \(Differenz\): 5/);
  assert.match(formatReport(report),/Ablehnungsgruende dem State-Kanal zurechenbar: JA/);
  assert.doesNotMatch(JSON.stringify(report),/PRIVATE_RC_SERIAL|PRIVATE_AIR_SERIAL|SECRET/);
});

test('rejection breakdown is not assigned to State when other channels also had drops',()=>{
  const h={...health,
    mqttObservedChannelCounts:{osd:20,state:18,status:2,events:10,services_reply:0},
    mqttChannelCounts:{osd:19,state:13,status:2,events:10,services_reply:0},
    mqttRejectedMessages:6,
    mqttDroppedByReason:{duplicate:3,stale:3}
  };
  const report=evaluateHardwareSession([rc,air],h,shapes,now,[]);
  assert.equal(report.stateDrops.available,true);
  assert.equal(report.stateDrops.stateNotAccepted,5);
  assert.equal(report.stateDrops.totalUnaccepted,6);
  assert.equal(report.stateDrops.attributed,false);
  assert.match(formatReport(report),/Ablehnungsgruende dem State-Kanal zurechenbar: NEIN/);
});

test('malformed or unavailable rejected metadata never leaks extra reason names',()=>{
  const h={...health,
    mqttObservedChannelCounts:{osd:20,state:8,status:0,events:0,services_reply:0},
    mqttChannelCounts:{osd:20,state:3,status:0,events:0,services_reply:0},
    mqttRejectedMessages:5,
    mqttDroppedByReason:{'SECRET_PAYLOAD_XYZ':5}
  };
  const r=evaluateHardwareSession([rc,air],h,shapes,now);
  assert.equal(r.stateDrops.attributed,false);
  assert.equal(r.stateDrops.reasons.length,0);
  assert.doesNotMatch(JSON.stringify(r),/SECRET_PAYLOAD_XYZ/);
  assert.equal(evaluateHardwareSession([rc,air],health,shapes,now).stateDrops.available,false);
});


test('RC and M3M expose documented State field coverage without values or serials',()=>{
  const report=evaluateHardwareSession([rc,air],health,shapes,now);
  const rcState=report.controller.stateFields;
  const m3State=report.aircraft.stateFields;
  assert.ok(rcState.documented>0);
  assert.ok(m3State.documented>0);
  assert.equal(rcState.observed,1);
  assert.equal(m3State.observed,1);
  assert.equal(rcState.fresh,1);
  assert.equal(m3State.fresh,1);
  assert.ok(rcState.observedNames.includes('state:firmware_version'));
  assert.ok(m3State.observedNames.includes('state:firmware_version'));
  for(const sf of [rcState,m3State]){
    assert.equal(sf.documented,
      sf.observed+sf.notObserved+sf.redacted+sf.unsupported);
    assert.equal(sf.observed,sf.fresh+sf.stale);
    assert.ok(sf.observedNames.every(s=>s.startsWith('state:')));
    assert.ok(sf.missingRootNames.every(s=>
      s.startsWith('state:')&&!s.slice(6).includes('.')));
  }
  const printed=formatReport(report);
  assert.match(printed,/--- DJI State-Feldabdeckung je Geraet/);
  assert.match(printed,/M3M beobachtete State-Feldnamen: state:firmware_version/);
  assert.doesNotMatch(printed,/PRIVATE_RC_SERIAL|PRIVATE_AIR_SERIAL|9\.8\.7|1\.2\.3/);
});

test('missing State property diagnostics cannot be counted as absent DJI capabilities',()=>{
  const older={...air,propertyProfile:undefined,deviceProperties:undefined,
    propertyObservedAt:undefined,propertyFieldObservedAt:undefined};
  const report=evaluateHardwareSession([rc,older],health,shapes,now);
  assert.equal(report.aircraft.stateFields,null);
  assert.match(formatReport(report),/M3M: NICHT PRUEFBAR/);
});
