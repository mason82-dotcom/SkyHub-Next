'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {parseTopic,parseMessage,extractTelemetry,extractTopology,fresh}=require('../dji');

test('DJI topics: status only under sys, state/OSD under thing',()=>{
  assert.deepEqual(parseTopic('sys/product/RC123/status'),{source:'sys',sn:'RC123',channel:'status'});
  assert.equal(parseTopic('thing/product/RC123/status'),null);
  assert.equal(parseTopic('sys/product/RC123/osd'),null);
  assert.equal(parseTopic('thing/product/RC123/services'),null);
});
test('DJI 1.18 OSD nested data and relative/absolute height stay distinct',()=>{
  const msg=Buffer.from(JSON.stringify({data:{
    latitude:49.1,longitude:8.4,height:420,elevation:120,mode_code:5,
    battery:{batteries:[{capacity_percent:76}]},horizontal_speed:6.5,vertical_speed:-1.2
  }}));
  const result=parseMessage('thing/product/AIR/osd',msg);
  assert.deepEqual(result.telemetry,{
    latitude:49.1,longitude:8.4,altitude:120,heightEllipsoid:420,
    battery:76,heading:null,horizontalSpeed:6.5,verticalSpeed:-1.2,
    attitudePitch:null,attitudeRoll:null,homeDistance:null,remainingFlightTime:null,
    gpsSatellites:null,rtkSatellites:null,rtkFixState:null,positionQuality:null,
    linkQuality:null,
    windSpeed:null,windDirectionCode:null,totalFlightTime:null,totalFlightDistance:null,
    sdrLinkState:null,fourGLinkState:null,fourGLinkQuality:null
  });
  assert.equal(result.state.modeCode,5);
});
test('height alone must not be mislabeled as altitude relative to takeoff',()=>{
  const data=extractTelemetry({height:420,latitude:0,longitude:0,capacity_percent:0});
  assert.equal(data.altitude,null);
  assert.equal(data.heightEllipsoid,420);
  assert.equal(data.latitude,0);
  assert.equal(data.battery,0);
});
test('out-of-range readings are unknown rather than zero',()=>{
  const data=extractTelemetry({latitude:95,longitude:181,capacity_percent:105,horizontal_speed:-1});
  assert.equal(data.latitude,null);
  assert.equal(data.longitude,null);
  assert.equal(data.battery,null);
  assert.equal(data.horizontalSpeed,null);
});
test('state with firmware is supported',()=>{
  const value=parseMessage('thing/product/RC/state',
    Buffer.from('{"data":{"firmware_version":"1.0.0"}}'));
  assert.equal(value.telemetry,null);
  assert.equal(value.state.firmwareVersion,'1.0.0');
});
test('Pilot 2 topology allowlists domain and version, excluding secrets',()=>{
  const d=extractTopology({
    domain:'3',type:119,sub_type:0,thing_version:'1.1.2',device_secret:'TOPSECRET',nonce:'DANGER',
    sub_devices:[{sn:'AIR01',domain:'0',type:60,sub_type:0,index:'A',thing_version:'1.1.2',
      device_secret:'CHILDSECRET',nonce:'CHILDNONCE'}]
  });
  assert.equal(d.model.domain,'3');
  assert.equal(d.model.thingVersion,'1.1.2');
  assert.equal(d.children[0].index,'A');
  assert.equal(d.children[0].model.domain,'0');
  assert.doesNotMatch(JSON.stringify(d),/secret|nonce/i);
});
test('HMS produces a minimal safe alert summary',()=>{
  const m=parseMessage('thing/product/Dock/events',Buffer.from(JSON.stringify({
    method:'hms',data:{list:[{
      code:'0x16100083',level:2,module:3,device_type:'0-67-0',imminent:1,
      args:{private:'DANGER'}
    }]}
  })));
  assert.deepEqual(m.hms,[{code:'0x16100083',level:2,module:3,deviceType:'0-67-0',imminent:1,
    componentIndex:null,sensorIndex:null}]);
  assert.doesNotMatch(JSON.stringify(m),/DANGER/);
});
test('OSD freshness expires after 15 seconds',()=>{
  assert.equal(fresh(null,50000),false);
  assert.equal(fresh(35001,50000),true);
  assert.equal(fresh(35000,50000),false);
});
test('invalid and oversized MQTT envelopes are rejected',()=>{
  assert.throws(()=>parseMessage('thing/product/RC/osd',Buffer.from('{')),SyntaxError);
  assert.throws(()=>parseMessage('thing/product/RC/osd',Buffer.alloc(131073)),/length/);
});
test('aircraft OSD GNSS/RTK, attitude, home distance and remaining flight time',()=>{
  const data=extractTelemetry({
    attitude_pitch:-3.5,attitude_roll:1.2,home_distance:142.7,
    battery:{capacity_percent:64,remain_flight_time:1180},
    position_state:{gps_number:21,rtk_number:34,is_fixed:2,quality:10}
  });
  assert.equal(data.attitudePitch,-3.5);
  assert.equal(data.attitudeRoll,1.2);
  assert.equal(data.homeDistance,142.7);
  assert.equal(data.remainingFlightTime,1180);
  assert.equal(data.gpsSatellites,21);
  assert.equal(data.rtkSatellites,34);
  assert.equal(data.rtkFixState,2);
  assert.equal(data.positionQuality,10);
  assert.equal(data.battery,64);
});
test('RC OSD link quality and battery; implausible quality values stay unknown',()=>{
  const rc=extractTelemetry({capacity_percent:88,wireless_link:{sdr_quality:4,dongle_number:0}});
  assert.equal(rc.battery,88);
  assert.equal(rc.linkQuality,4);
  const bad=extractTelemetry({wireless_link:{sdr_quality:9},
    position_state:{gps_number:-1,is_fixed:7,quality:1.5},battery:{remain_flight_time:-5}});
  assert.equal(bad.linkQuality,null);
  assert.equal(bad.gpsSatellites,null);
  assert.equal(bad.rtkFixState,null);
  assert.equal(bad.positionQuality,null);
  assert.equal(bad.remainingFlightTime,null);
});
test('DJI aircraft wind and flight statistics use bounded read-only parsing',()=>{
  const t=extractTelemetry({wind_speed:4.75,wind_direction:8,
    total_flight_time:7200.5,total_flight_distance:18340,
    battery:{capacity_percent:78},imei:'PRIVATE'});
  assert.equal(t.windSpeed,4.75);
  assert.equal(t.windDirectionCode,8);
  assert.equal(t.totalFlightTime,7200.5);
  assert.equal(t.totalFlightDistance,18340);
  assert.equal(t.battery,78);
  assert.ok(!Object.hasOwn(t,'imei'));
  const bad=extractTelemetry({wind_speed:-1,wind_direction:360,
    total_flight_time:Infinity,total_flight_distance:-40});
  assert.equal(bad.windSpeed,null);
  assert.equal(bad.windDirectionCode,null);
  assert.equal(bad.totalFlightTime,null);
  assert.equal(bad.totalFlightDistance,null);
});
test('DJI RC SDR and 4G link status reject invalid or sentinel values',()=>{
  const valid=extractTelemetry({wireless_link:{
    sdr_link_state:1,'4g_link_state':0,'4g_quality':3,sdr_quality:4
  }});
  assert.equal(valid.sdrLinkState,1);
  assert.equal(valid.fourGLinkState,0);
  assert.equal(valid.fourGLinkQuality,3);
  assert.equal(valid.linkQuality,4);
  const invalid=extractTelemetry({wireless_link:{
    sdr_link_state:65535,'4g_link_state':2,'4g_quality':65535
  }});
  assert.equal(invalid.sdrLinkState,null);
  assert.equal(invalid.fourGLinkState,null);
  assert.equal(invalid.fourGLinkQuality,null);
});
test('data key shape exposes field names only, never values',()=>{
  const m=parseMessage('thing/product/RC/state',Buffer.from(JSON.stringify({
    need_reply:1,data:{live_capacity:{x:'SECRETVALUE'},'bad key':1,firmware_version:'1.0'}
  })));
  assert.deepEqual(m.dataKeys,['firmware_version','live_capacity']);
  assert.equal(m.needReply,true);
  assert.doesNotMatch(JSON.stringify(m.dataKeys),/SECRETVALUE/);
  assert.deepEqual(parseMessage('thing/product/RC/osd',Buffer.from('{"data":[1]}')).dataKeys,[]);
});
test('Pilot 2 HMS (event/method inside data, decimal id) as observed on a Mavic 3M',()=>{
  const m=parseMessage('thing/product/AIR01/events',Buffer.from(JSON.stringify({
    timestamp:1792528000000,
    data:{event:'hms',method:'hms',output:{codes:[
      {id:370147430,level:2,component_index:0,sensor_index:0},
      {id:440536001,level:1,component_index:1,sensor_index:2,secret:'DANGER'},
      {id:-5,level:2},{id:'0x1',level:2},null
    ]}}
  })));
  assert.equal(m.method,'hms');
  assert.deepEqual(m.hms,[
    {code:'0x16100066',level:2,module:null,deviceType:null,imminent:null,componentIndex:0,sensorIndex:0},
    {code:'0x1A420BC1',level:1,module:null,deviceType:null,imminent:null,componentIndex:1,sensorIndex:2}
  ]);
  assert.doesNotMatch(JSON.stringify(m),/DANGER/);
});
test('dock HMS keeps only component/sensor index from args and normalises the code',()=>{
  const m=parseMessage('thing/product/Dock/events',Buffer.from(JSON.stringify({
    method:'hms',data:{list:[{code:'0x1610abc',level:0,args:{component_index:1,sensor_index:0,x:'DANGER'}}]}
  })));
  assert.equal(m.hms[0].code,'0x01610ABC');
  assert.equal(m.hms[0].componentIndex,1);
  assert.doesNotMatch(JSON.stringify(m),/DANGER/);
});
test('events without HMS are not misread as HMS',()=>{
  const m=parseMessage('thing/product/AIR01/events',Buffer.from(JSON.stringify({
    data:{event:'other',method:'hms',output:{codes:[{id:1,level:2}]}}})));
  assert.equal(m.method,null);
  assert.equal(m.hms,null);
});

test('Wayline progress exposes bounded reported state but never mission IDs or coordinates',()=>{
  const raw={timestamp:1792528000001,method:'flighttask_progress',
    data:{result:0,output:{status:'failed',
      progress:{current_step:26,percent:65},
      ext:{flight_id:'PRIVATE_MISSION_X',track_id:'PRIVATE_TRACK_X',
        break_point:{break_reason:517,latitude:49.1234,longitude:8.5678,
          device_secret:'PRIVATE_GPS_X'}}}}};
  const result=parseMessage('thing/product/DOCK/events',Buffer.from(JSON.stringify(raw)));
  assert.deepEqual(result.missionReport,{
    reportedStatus:'failed',progressPercent:65,currentStep:26,breakReason:517
  });
  assert.equal(result.mediaReport,null);
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE_MISSION_X|PRIVATE_TRACK_X|PRIVATE_GPS_X|49\.1234|8\.5678/);
});

test('mission summary does not invent progress for malformed or unknown DJI states',()=>{
  const parse=data=>parseMessage('thing/product/DOCK/events',Buffer.from(JSON.stringify({
    method:'flighttask_progress',data
  }))).missionReport;
  assert.equal(parse({result:1,output:{status:'ok',progress:{current_step:35,percent:100}}}),null);
  assert.equal(parse({result:0,output:{status:'unknown',progress:{current_step:35,percent:100}}}),null);
  assert.equal(parse({result:0,output:{status:'ok',progress:{current_step:35,percent:101}}}),null);
  assert.equal(parse({result:0,output:{status:'ok',progress:{current_step:35,percent:5.5}}}),null);
  assert.equal(parse({result:0,output:{status:'ok',progress:null}}),null);
});

test('media priority and callback are only unverified metadata reports',()=>{
  const topic='thing/product/DOCK/events';
  const parse=(method,data)=>parseMessage(topic,Buffer.from(JSON.stringify({method,data})));
  const priority=parse('highest_priority_upload_flighttask_media',{
    flight_id:'PRIVATE_FLIGHT_ID_X',sts_token:'PRIVATE_STS_X'});
  assert.deepEqual(priority.mediaReport,{kind:'upload_priority_report',storageVerification:'not_checked'});
  assert.doesNotMatch(JSON.stringify(priority),/PRIVATE_FLIGHT_ID_X|PRIVATE_STS_X/);
  const callback=parse('file_upload_callback',{file:{
    name:'PRIVATE_IMAGE_001.JPG',object_key:'PRIVATE_OBJECT_KEY_X',
    ext:{flight_id:'PRIVATE_FLIGHT_ID_X'},metadata:{
      shoot_position:{lat:49.9999,lng:8.9999},token:'PRIVATE_STS_X'
    }
  }});
  assert.deepEqual(callback.mediaReport,{kind:'file_metadata_report',storageVerification:'not_checked'});
  assert.equal(callback.missionReport,null);
  assert.doesNotMatch(JSON.stringify(callback),/PRIVATE_IMAGE_001|PRIVATE_OBJECT_KEY_X|PRIVATE_FLIGHT_ID_X|PRIVATE_STS_X|49\.9999|8\.9999/);
  assert.equal(parse('file_upload_callback',{file:{name:'x.jpg'}}).mediaReport,null);
  assert.equal(parse('unknown_media',{file:{name:'x.jpg'}}).mediaReport,null);
});
