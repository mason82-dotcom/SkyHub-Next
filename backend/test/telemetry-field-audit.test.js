'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const path=require('node:path');
const {summarizeTelemetryFields,GATEWAY_FIELDS,AIRCRAFT_FIELDS}=require('../telemetry-field-profile');
test('RC five-field inventory does not mislabel aircraft-only fields as missing',()=>{
  const [rc]=summarizeTelemetryFields([{role:'gateway',modelName:'DJI RC Pro Enterprise',
    fresh:true,positionFresh:true,telemetry:{
      latitude:49.1,longitude:8.4,heightEllipsoid:120,battery:80,linkQuality:4
    }}]);
  assert.deepEqual(rc.observed,GATEWAY_FIELDS);
  assert.deepEqual(rc.notObserved,[]);
  assert.equal(rc.typicalTotal,5);
  assert.ok(rc.notApplicable.includes('horizontalSpeed'));
  assert.ok(!JSON.stringify(rc).includes('49.1'));
});
test('Mavic snapshot reports two missing GNSS coordinates, not RC SDR quality',()=>{
  const [air]=summarizeTelemetryFields([{role:'subdevice',deviceCategory:'aircraft',
    modelName:'Mavic 3M',fresh:true,positionFresh:false,positionUnavailable:true,
    telemetry:{altitude:0,heightEllipsoid:5,battery:50,heading:90,
      horizontalSpeed:0,verticalSpeed:0,attitudePitch:0,attitudeRoll:0,
      homeDistance:0,remainingFlightTime:400,gpsSatellites:12,
      rtkSatellites:0,rtkFixState:0,positionQuality:3
    }}]);
  assert.equal(air.typicalTotal,16);
  assert.equal(air.observed.length,14);
  assert.deepEqual(air.notObserved,['latitude','longitude']);
  assert.ok(air.notApplicable.includes('linkQuality'));
  assert.equal(air.positionUnavailable,true);
  assert.ok(AIRCRAFT_FIELDS.includes('rtkFixState'));
});
test('optional DJI values are distinguished from typical and not applicable',()=>{
  const report=summarizeTelemetryFields([
    {role:'gateway',telemetry:{sdrLinkState:0,fourGLinkState:1,fourGLinkQuality:3}},
    {deviceCategory:'aircraft',telemetry:{windSpeed:0,windDirectionCode:8}}
  ]);
  assert.deepEqual(report[0].extraObserved,['sdrLinkState','fourGLinkState','fourGLinkQuality']);
  assert.deepEqual(report[1].extraObserved,['windSpeed','windDirectionCode']);
  assert.ok(report[0].notApplicable.includes('windSpeed'));
  assert.ok(report[1].notApplicable.includes('sdrLinkState'));
});
test('inventory exposes no raw values or device serials',()=>{
  const report=summarizeTelemetryFields([{sn:'SENSITIVE_SERIAL',
    gatewaySn:'RC_SECRET',modelName:'SENSITIVE_MODEL',role:'gateway',
    telemetry:{latitude:49.998899,longitude:8.123456,battery:60}}]);
  assert.doesNotMatch(JSON.stringify(report),/SENSITIVE_SERIAL|RC_SECRET|SENSITIVE_MODEL|49.998899|8.123456/);
});
test('privacy-safe telemetry audit help does not contact Docker',()=>{
  const cli=path.resolve(__dirname,'../../scripts/pi-telemetry-fields-check.js');
  const out=spawnSync(process.execPath,[cli,'--help'],{encoding:'utf8',timeout:5000});
  assert.equal(out.status,0);
  assert.match(out.stdout,/Nur empfangene Feldnamen/);
  assert.doesNotMatch(out.stdout,/latitude.*[0-9]/);
});

test('all six DJI device families expose value-free documented field coverage',()=>{
  const ids=[
    ['Mavic 3E','0',77,0,144],['Mavic 3T','0',77,1,144],
    ['Mavic 3M','0',77,2,150],['Matrice 4T','0',99,1,202],
    ['DJI RC Pro Enterprise','2',144,0,55],
    ['DJI RC Plus 2 Enterprise','2',174,0,54]
  ];
  for(const [name,domain,type,subType,total] of ids){
    const [report]=summarizeTelemetryFields([{
      model:{domain,type,subType},modelName:name,
      role:domain==='2'?'gateway':'subdevice',
      deviceCategory:domain==='2'?'controller':'aircraft',
      deviceProperties:{
        osd:{latitude:49.12345,battery:{capacity_percent:55}},
        state:{firmware_version:'1.2.3'}
      }
    }]);
    assert.equal(report.model,name);
    assert.equal(report.documentedTotal,total);
    assert.ok(report.observedDocumented.includes('osd:latitude'));
    assert.ok(report.observedDocumented.includes('state:firmware_version'));
    assert.ok(!JSON.stringify(report).includes('49.12345'));
    assert.ok(!JSON.stringify(report).includes('1.2.3'));
    assert.doesNotMatch(JSON.stringify(report), /\\"capacity_percent\\"\\s*:\\s*55/);
  }
});

test('redacted and unsupported array fields are excluded from missing-field counts',()=>{
  const [rc]=summarizeTelemetryFields([{
    model:{domain:'2',type:174,subType:0},modelName:'DJI RC Plus 2 Enterprise',
    role:'gateway',deviceProperties:{state:{live_capacity:{
      device_list:[{camera_list:[{video_list:[{video_index:'0',
        video_type:'wide',switchable_video_types:['wide','zoom']}]}]}]
    }},osd:{}}
  }]);
  assert.equal(rc.documentedTotal,54);
  assert.ok(rc.documentedInspectableTotal<rc.documentedTotal);
  assert.ok(rc.redactedDocumented.includes('state:live_capacity.device_list.sn'));
  assert.ok(rc.redactedDocumented.includes('state:live_status.video_id'));
  assert.ok(!rc.notObservedDocumented.includes('state:live_status.video_id'));
  assert.ok(rc.observedDocumented.includes(
    'state:live_capacity.device_list.camera_list.video_list.switchable_video_types'));
  assert.ok(rc.observedDocumented.includes(
    'state:live_capacity.device_list.camera_list.video_list.video_index'));
  assert.equal(rc.observedDocumented.length+rc.notObservedDocumented.length+
    rc.redactedDocumented.length+rc.unsupportedDocumented.length,54);
  assert.ok(rc.redactedDocumented.includes('state:cloud_control_auth'));
});


test('dynamic gimbal inventory reports only field names, not payload indices or values',()=>{
  const [r]=summarizeTelemetryFields([{
    model:{domain:'0',type:99,subType:1},modelName:'Matrice 4T',deviceCategory:'aircraft',
    deviceProperties:{osd:{payload_gimbals:[{payload_index:'89-0-0',
      gimbal_pitch:12.345,measure_target_distance:55.7}]},state:{}}
  }]);
  assert.equal(r.dynamicDocumentedTotal,9);
  assert.deepEqual(r.observedDynamic,['gimbal_pitch','measure_target_distance']);
  assert.ok(r.notObservedDynamic.includes('gimbal_yaw'));
  const asJson=JSON.stringify(r);
  assert.doesNotMatch(asJson,/89-0-0|12.345|55.7/);
  assert.equal(summarizeTelemetryFields([{
    model:{domain:'0',type:77,subType:2},deviceProperties:{osd:{},state:{}}
  }])[0].dynamicDocumentedTotal,0);
});


test('audit records sources and marks generic Matrice 4T property extensions unverified',()=>{
  const [d]=summarizeTelemetryFields([{
    model:{domain:'0',type:99,subType:1},
    modelName:'Matrice 4T',
    deviceCategory:'aircraft',
    deviceProperties:{osd:{},state:{}}
  }]);
  assert.equal(d.documentedTotal,202);
  assert.match(d.documentedSource,/Cloud-API-Doc/);
  assert.match(d.documentedExtensionSource,/aircraft\/properties\.html/);
  assert.equal(d.documentedExtensionEdition,'2024-06-28');
  assert.match(d.documentedConfidence,/unverified/);
  assert.ok(d.redactedDocumented.includes('state:psdk_widget_values.psdk_sn'));
  assert.ok(d.redactedDocumented.includes('state:psdk_widget_values.speaker.play_file_name'));
  assert.ok(d.redactedDocumented.includes('state:psdk_ui_resource.object_key'));
  assert.ok(d.notObservedDocumented.includes('state:psdk_widget_values.speaker.play_volume'));
  assert.equal(d.observedDocumented.length+d.notObservedDocumented.length+
    d.redactedDocumented.length+d.unsupportedDocumented.length,202);
});
