'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {parseMessage} = require('../dji');
const {createRegistry} = require('../registry');
const {deviceProfile,fieldDefinitions,sanitizeKnownProperties,
  sanitizeDeviceProperties,MAX_ARRAY_ITEMS} = require('../dji-properties');
const source = require('../data/dji-cloud-api-118-fields.json');

const models = [
  [{domain:'0',type:77,subType:0},'mavic3','official-family'],
  [{domain:'0',type:77,subType:1},'mavic3','official-family'],
  [{domain:'0',type:77,subType:2},'mavic3m','shared-family-three-generic-roots-observed-values-unverified'],
  [{domain:'0',type:99,subType:1},'matrice4T','shared-aircraft-with-web-extensions-unverified'],
  [{domain:'2',type:144,subType:0},'rcPro','official-device'],
  [{domain:'2',type:174,subType:0},'rcPlus2','official-device-web']
];
// Dock-to-cloud profiles come from the web reference, not from a pinned Git blob.
const DOCK_PROFILES = ['dock1','dock2','dock3','matrice3D','matrice4D'];
const receive = (topic,data,timestamp) => parseMessage(topic,Buffer.from(JSON.stringify({
  timestamp,data
})));
const topo = (time) => parseMessage('sys/product/RC/status',Buffer.from(JSON.stringify({
  method:'update_topo',timestamp:time,data:{
    domain:2,type:144,sub_type:0,
    sub_devices:[{sn:'AIR',domain:0,type:77,sub_type:0}]
  }
})));

test('pinned property tables enumerate all nested fields and preserve provenance',()=>{
  assert.equal(source.profiles.mavic3.fields.length,144);
  assert.equal(source.profiles.mavic3m.fields.length,6);
  assert.equal(source.profiles.mavic3m.extends,'mavic3');
  assert.equal(source.profiles.aircraftCommon.fields.length,162);
  assert.equal(source.profiles.matrice4T.fields.length,202);
  assert.equal(source.profiles.rcPro.fields.length,55);
  assert.equal(source.profiles.rcPlus2.fields.length,54);
  for (const profile of Object.values(source.profiles).filter(p=>!p.extends&&!DOCK_PROFILES.some(n=>source.profiles[n]===p))) {
    if(profile!==source.profiles.rcPlus2) assert.match(profile.source,/dji-sdk\/Cloud-API-Doc\/blob\/4ec6b0c7/);
    else assert.match(profile.source,/developer.dji.com\/doc\/cloud-api-tutorial\/en\/api-reference\/pilot-to-cloud\/mqtt\/dji-rc-plus-2\/properties.html/);
    assert.ok(profile.fields.some(f=>f.path==='latitude' && f.push===0));
    assert.ok(profile.fields.some(f=>f.path==='firmware_version' && f.push===1));
    const seen=new Set(profile.fields.map(f=>f.path));
    assert.equal(seen.size,profile.fields.length);
  }
  assert.ok(source.profiles.mavic3.fields.some(f=>f.path==='battery.batteries.temperature'));
  assert.ok(source.profiles.aircraftCommon.fields.some(f=>f.path==='cameras.ir_zoom_factor'));
  assert.ok(source.profiles.rcPro.fields.some(f=>f.path==='wireless_link.sdr_quality'));
});
test('all six models have documented or explicitly provisional field profiles',()=>{
  for(const [model,name,confidence] of models) {
    assert.deepEqual(deviceProfile(model),{name,confidence});
    const defs=fieldDefinitions(model);
    assert.equal(defs.profile,name);
    assert.equal(defs.confidence,confidence);
    assert.ok(defs.fields.length>=48);
  }
  assert.equal(fieldDefinitions({domain:'0',type:999,subType:0}),null);
});

test('M3M overlay inherits 144 DJI Mavic-3 roots and adds only 6 sourced extensions',()=>{
  const model=models[2][0],defs=fieldDefinitions(model);
  assert.equal(defs.profile,'mavic3m');
  assert.equal(defs.inheritedFrom,'mavic3');
  assert.equal(defs.fields.length,150);
  assert.match(defs.source,/dji-sdk\/Cloud-API-Doc\/blob\/4ec6b0c7/);
  assert.match(defs.extensionSource,/developer\.dji\.com\/doc\/cloud-api-tutorial/);
  assert.match(defs.extensionEvidence,/real Mavic 3M.*proved three root names/);
  assert.equal(defs.extensionStatus,'root-names-and-typed-values-hardware-accepted-semantics-unverified');
  for(const field of ['mode_code','battery.capacity_percent','cameras.recording_state',
    'distance_limit_status','distance_limit_status.distance_limit','rth_altitude','rc_lost_action'])
    assert.ok(defs.fields.some(item=>item.path===field),field);
  assert.equal(new Set(defs.fields.map(f=>f.path)).size,defs.fields.length);
  assert.equal(fieldDefinitions(models[0][0]).fields.length,144);
  assert.equal(fieldDefinitions(models[1][0]).fields.length,144);
});

test('M3M generic Aircraft OSD extensions are parsed read-only with strict DJI limits',()=>{
  const m3m=models[2][0],e=models[0][0],t=models[1][0];
  const raw={mode_code:4,
    distance_limit_status:{state:1,distance_limit:250,is_near_distance_limit:0,
      user_note:'SECRET_OPERATOR'},
    rth_altitude:120,rc_lost_action:2,secret:'SECRET_DEVICE'};
  const known=sanitizeKnownProperties(raw,'osd');
  const out=sanitizeDeviceProperties(known,'osd',m3m);
  assert.deepEqual(JSON.parse(JSON.stringify(out.distance_limit_status)),
    {state:1,distance_limit:250,is_near_distance_limit:0});
  assert.equal(out.rth_altitude,120);
  assert.equal(out.rc_lost_action,2);
  assert.equal(out.mode_code,4);
  assert.doesNotMatch(JSON.stringify(out),/SECRET/);
  assert.equal(sanitizeDeviceProperties(known,'osd',e).rth_altitude,undefined);
  assert.equal(sanitizeDeviceProperties(known,'osd',t).rc_lost_action,undefined);
  const invalid=sanitizeDeviceProperties(sanitizeKnownProperties({
    distance_limit_status:{state:3,distance_limit:9000,is_near_distance_limit:65535},
    rth_altitude:501,rc_lost_action:65535
  },'osd'),'osd',m3m);
  assert.equal(invalid.distance_limit_status,undefined);
  assert.equal(invalid.rth_altitude,undefined);
  assert.equal(invalid.rc_lost_action,undefined);
  assert.equal(sanitizeDeviceProperties(known,'state',m3m).rth_altitude,undefined);
});


test('M3M verified topology routes new generic OSD properties only to its own registry device',()=>{
  const now=1792611000000,registry=createRegistry();
  const status=parseMessage('sys/product/RC/status',Buffer.from(JSON.stringify({
    timestamp:now-2000,method:'update_topo',data:{
      domain:2,type:144,sub_type:0,
      sub_devices:[{sn:'M3M_DEVICE',domain:0,type:77,sub_type:2}]
    }
  })));
  registry.ingest(status,now-2000);
  const payload=receive('thing/product/M3M_DEVICE/osd',{
    mode_code:4,battery:{capacity_percent:55},
    distance_limit_status:{state:1,distance_limit:300,is_near_distance_limit:0},
    rth_altitude:125,rc_lost_action:1,
    credential:'DANGEROUS_SECRET',sn:'PRIVATE_SERIAL'
  },now-1000);
  registry.ingest(payload,now-1000);
  const d=registry.get('M3M_DEVICE',now);
  assert.equal(d.propertyProfile.name,'mavic3m');
  assert.equal(d.deviceProperties.osd.rth_altitude,125);
  assert.equal(d.deviceProperties.osd.rc_lost_action,1);
  assert.equal(d.deviceProperties.osd.distance_limit_status.distance_limit,300);
  assert.equal(d.propertyFieldObservedAt.osd.rth_altitude,now-1000);
  assert.equal(d.propertyFieldObservedAt.osd['distance_limit_status.distance_limit'],now-1000);
  assert.doesNotMatch(JSON.stringify(d.deviceProperties),/PRIVATE_SERIAL|DANGEROUS_SECRET/);
});

test('nested camera, GNSS, battery, RC link and stream fields survive read-only filter',()=>{
  const input={
    cameras:[{zoom_factor:3.5,ir_zoom_factor:2,recording_state:1,
      payload_index:'66-0-0',sn:'PRIVATE_CAMERA',url:'https://private.invalid'}],
    position_state:{gps_number:19,is_fixed:2,quality:3},
    battery:{capacity_percent:42,remain_flight_time:800,
      batteries:[{temperature:31.5,voltage:15430,sn:'PRIVATE_BATTERY'}]},
    country:'DE', control_source:'SECRET_OPERATOR',
    device_secret:'SECRET_DEVICE',nonce:'SECRET_NONCE'
  };
  const known=sanitizeKnownProperties(input,'osd');
  const m3=sanitizeDeviceProperties(known,'osd',models[0][0]);
  assert.equal(m3.cameras[0].zoom_factor,3.5);
  assert.equal(m3.cameras[0].payload_index,'66-0-0');
  assert.equal(m3.position_state.gps_number,19);
  assert.equal(m3.battery.batteries[0].temperature,31.5);
  assert.equal(m3.battery.batteries[0].voltage,15430);
  for (const raw of ['PRIVATE_CAMERA','PRIVATE_BATTERY','SECRET_OPERATOR','SECRET_DEVICE','SECRET_NONCE','private.invalid'])
    assert.doesNotMatch(JSON.stringify(known),new RegExp(raw));
  assert.equal(sanitizeDeviceProperties(known,'osd',models[4][0]).cameras,undefined);
});
test('state and OSD fields cannot be interchanged or promoted to live telemetry',()=>{
  const rc=models[4][0];
  const state={live_capacity:{
    available_video_number:2,device_list:[{sn:'PRIVATE_SERIAL',
      available_video_number:3,camera_list:[{camera_index:'66-0-0',available_video_number:1}]}]
  },firmware_version:'1.2.3',latitude:49.1,nonce:'SECRET'};
  const filtered=sanitizeDeviceProperties(sanitizeKnownProperties(state,'state'),'state',rc);
  assert.equal(filtered.live_capacity.available_video_number,2);
  assert.equal(filtered.firmware_version,'1.2.3');
  assert.equal(filtered.latitude,undefined);
  assert.doesNotMatch(JSON.stringify(filtered),/PRIVATE_SERIAL|SECRET/);
  assert.equal(sanitizeKnownProperties(state,'osd').firmware_version,undefined);
});
test('arrays, unrecognized fields, invalid numbers and arbitrary text are bounded',()=>{
  const items=Array.from({length:1000},(_,i)=>({
    remain_photo_num:i, payload_index:'bad-token',
    sn:'LEAK', firmware_version:'A'.repeat(400)
  }));
  const known=sanitizeKnownProperties({cameras:items,battery:{
    capacity_percent:Infinity},track_id:'TOPSECRET',
    dongle_infos:[{imei:'SENSITIVE',eid:'SENSITIVE'}]},'osd');
  const result=sanitizeDeviceProperties(known,'osd',models[0][0]);
  assert.equal(result.cameras.length,MAX_ARRAY_ITEMS);
  assert.equal(result.cameras[7].remain_photo_num,7);
  assert.equal(result.cameras[0].payload_index,undefined);
  assert.equal(result.battery,undefined);
  assert.doesNotMatch(JSON.stringify(known),/LEAK|TOPSECRET|SENSITIVE/);
});
test('topology drives model-specific extraction, separated channel timestamps and disconnected replay',()=>{
  const registry=createRegistry(),now=1792600000000;
  registry.ingest(topo(now-2000),now-2000);
  registry.ingest(receive('thing/product/AIR/osd',{
    mode_code:4,latitude:49.2,longitude:8.6,
    cameras:[{zoom_factor:6,recording_state:1}],
    battery:{capacity_percent:60,batteries:[{temperature:27.5,sn:'PRIVATE_BATTERY'}]},
    nonce:'PRIVATE_NONCE'
  },now-1000),now-1000);
  let device=registry.get('AIR',now);
  assert.equal(device.deviceProperties.osd.cameras[0].zoom_factor,6);
  assert.equal(device.deviceProperties.osd.battery.batteries[0].temperature,27.5);
  assert.equal(device.propertyObservedAt.osd,now-1000);
  assert.equal(device.propertyObservedAt.state,null);
  assert.equal(device.propertyProfile.name,'mavic3');
  assert.doesNotMatch(JSON.stringify(device),/PRIVATE_BATTERY|PRIVATE_NONCE/);

  registry.ingest(receive('thing/product/AIR/state',{
    firmware_version:'5.6.7',mode_code_reason:4
  },now-500),now-500);
  device=registry.get('AIR',now);
  assert.equal(device.deviceProperties.state.firmware_version,'5.6.7');
  assert.equal(device.propertyObservedAt.state,now-500);
  assert.equal(device.propertyObservedAt.osd,now-1000);

  registry.ingest(receive('thing/product/AIR/osd',{
    mode_code:14,cameras:[{zoom_factor:30}],battery:{capacity_percent:3}
  },now-200),now-200);
  device=registry.get('AIR',now);
  assert.equal(device.aircraftConnected,false);
  assert.equal(device.deviceProperties.osd.cameras[0].zoom_factor,6);
  assert.equal(device.propertyObservedAt.osd,now-1000);
  assert.equal(device.telemetry.battery,60);
});


test('RC Plus 2 stream capabilities preserve safe lens enums, not identifiers',()=>{
  const payload={
    live_capacity:{available_video_number:1,device_list:[{
      sn:'SECRET_AIRCRAFT',camera_list:[{
        camera_index:'89-0-0',video_list:[{
          video_index:'0',
          video_type:'zoom',
          switchable_video_types:['wide','zoom','ir','SECRET_LINK','normal','infrared',
            'https://untrusted.example','visible','thermal','fpv']
        }]
      }]
    }]},
    live_status:[{video_id:'SECRET_AIRCRAFT/89-0-0/0',video_type:'wide',
      video_quality:2,status:1,error_status:0}]
  };
  const known=sanitizeKnownProperties(payload,'state');
  const rc=sanitizeDeviceProperties(known,'state',models[5][0]);
  const camera=rc.live_capacity.device_list[0].camera_list[0];
  assert.equal(camera.camera_index,'89-0-0');
  assert.equal(camera.video_list[0].video_index,'0');
  assert.equal(camera.video_list[0].video_type,'zoom');
  assert.deepEqual(camera.video_list[0].switchable_video_types,
    ['wide','zoom','ir','normal','infrared','visible']);
  assert.equal(rc.live_status[0].video_type,'wide');
  assert.equal(rc.live_status[0].status,1);
  const safe=JSON.stringify(rc);
  for(const forbidden of ['SECRET_AIRCRAFT','SECRET_LINK','untrusted.example'])
    assert.doesNotMatch(safe,new RegExp(forbidden));
  assert.equal(sanitizeKnownProperties(payload,'osd').live_capacity,undefined);
});
test('missing reconnect mode code does not revive disconnected aircraft or stale properties',()=>{
  const registry=createRegistry(),now=1792602000000;
  registry.ingest(topo(now-4000),now-4000);
  const send=(ms,data)=>registry.ingest(receive('thing/product/AIR/osd',data,ms),ms);
  send(now-3000,{mode_code:4,battery:{capacity_percent:78},
    cameras:[{remain_photo_num:12}],latitude:49.12,longitude:8.23});
  send(now-2000,{mode_code:14,battery:{capacity_percent:50},
    cameras:[{remain_photo_num:9}],latitude:49.13,longitude:8.24});
  const update=send(now-1000,{battery:{capacity_percent:20},
    cameras:[{remain_photo_num:4}],latitude:49.14,longitude:8.25});
  assert.equal(update.point,null);
  let device=registry.get('AIR',now);
  assert.equal(device.aircraftConnected,false);
  assert.equal(device.telemetry.battery,78);
  assert.equal(device.deviceProperties.osd.cameras[0].remain_photo_num,12);
  assert.equal(device.propertyObservedAt.osd,now-3000);
  send(now-100,{mode_code:4,battery:{capacity_percent:19},
    cameras:[{remain_photo_num:3}]});
  device=registry.get('AIR',now);
  assert.equal(device.aircraftConnected,true);
  assert.equal(device.telemetry.battery,19);
  assert.equal(device.deviceProperties.osd.cameras[0].remain_photo_num,3);
});
test('DJI null position and partial coordinate updates preserve prior accepted raw position',()=>{
  const registry=createRegistry(),now=1792604000000;
  registry.ingest(topo(now-5000),now-5000);
  const send=(ms,data)=>registry.ingest(receive('thing/product/AIR/osd',data,ms),ms);
  send(now-4000,{mode_code:4,latitude:49.1,longitude:8.2,wind_speed:2});
  send(now-3000,{mode_code:4,latitude:0,longitude:0,wind_speed:3});
  let d=registry.get('AIR',now);
  assert.equal(d.deviceProperties.osd.latitude,49.1);
  assert.equal(d.deviceProperties.osd.longitude,8.2);
  assert.equal(d.deviceProperties.osd.wind_speed,3);
  send(now-2000,{mode_code:4,latitude:50.3,wind_speed:4});
  d=registry.get('AIR',now);
  assert.equal(d.deviceProperties.osd.latitude,49.1);
  assert.equal(d.deviceProperties.osd.longitude,8.2);
  assert.equal(d.deviceProperties.osd.wind_speed,4);
  send(now-1000,{mode_code:4,latitude:50.3,longitude:9.4});
  d=registry.get('AIR',now);
  assert.equal(d.deviceProperties.osd.latitude,50.3);
  assert.equal(d.deviceProperties.osd.longitude,9.4);
});

test('WGS84 Southern and Western coordinates are kept despite DJI float-table typo',()=>{
  for(const model of [models[0][0],models[3][0],models[4][0]]) {
    const filtered=sanitizeDeviceProperties(sanitizeKnownProperties({
      latitude:-33.8568,longitude:-151.2153
    },'osd'),'osd',model);
    assert.equal(filtered.latitude,-33.8568);
    assert.equal(filtered.longitude,-151.2153);
    const bad=sanitizeDeviceProperties(sanitizeKnownProperties({
      latitude:91,longitude:-181
    },'osd'),'osd',model);
    assert.equal(bad.latitude,undefined);
    assert.equal(bad.longitude,undefined);
  }
});

test('official RC Plus 2 web schema has seven documented additions to legacy RC Pro',()=>{
  const profile=source.profiles.rcPlus2;
  const properties=profile.fields.map(item=>item.path);
  assert.equal(profile.sourceEdition,'2025-09-03');
  for(const name of [
    'wireless_link.4g_link_state','wireless_link.4g_quality',
    'wireless_link.4g_uav_quality','wireless_link.4g_gnd_quality',
    'wireless_link.4g_freq_band','cloud_control_auth','drc_state'
  ])assert.ok(properties.includes(name));
  assert.ok(!properties.includes('country'));
  assert.equal(profile.fields.find(f=>f.path==='cloud_control_auth').privacy,'redacted');
});
test('RC Plus 2 genuine 4G link and DRC state are decoded on their documented channel',()=>{
  const model=models[5][0];
  const input={
    wireless_link:{'4g_link_state':1,'4g_quality':4,
      '4g_uav_quality':3,'4g_gnd_quality':2,'4g_freq_band':1800,
      'private_imei':'SENSITIVE'},
    drc_state:2,cloud_control_auth:['flight','SENSITIVE_SECRET'],
    capacity_percent:75
  };
  const osd=sanitizeDeviceProperties(sanitizeKnownProperties(input,'osd'),'osd',model);
  assert.equal(osd.wireless_link['4g_link_state'],1);
  assert.equal(osd.wireless_link['4g_quality'],4);
  assert.equal(osd.wireless_link['4g_uav_quality'],3);
  assert.equal(osd.wireless_link['4g_gnd_quality'],2);
  assert.equal(osd.wireless_link['4g_freq_band'],1800);
  assert.equal(osd.drc_state,2);
  assert.equal(osd.capacity_percent,75);
  assert.equal(osd.cloud_control_auth,undefined);
  assert.doesNotMatch(JSON.stringify(osd),/SENSITIVE/);
  const state=sanitizeDeviceProperties(sanitizeKnownProperties(input,'state'),'state',model);
  assert.equal(state.drc_state,undefined);
  assert.equal(state.cloud_control_auth,undefined);
});

test('Matrice 4T provisional aircraft schema exposes six sourced read-only candidates',()=>{
  const profile=source.profiles.matrice4T;
  assert.match(profile.extensionSource,/pilot-to-cloud\/mqtt\/aircraft\/properties\.html/);
  assert.equal(profile.extensionSourceEdition,'2024-06-28');
  const paths=profile.fields.map(item=>item.path);
  for(const path of ['distance_limit_status','distance_limit_status.state',
    'distance_limit_status.distance_limit','distance_limit_status.is_near_distance_limit',
    'rth_altitude','rc_lost_action']) assert.ok(paths.includes(path),path);
  const model=models[3][0];
  const osd=sanitizeDeviceProperties(sanitizeKnownProperties({
    distance_limit_status:{state:1,distance_limit:8000,is_near_distance_limit:0},
    rth_altitude:120,rc_lost_action:2,device_secret:'PRIVATE'
  },'osd'),'osd',model);
  assert.equal(osd.distance_limit_status.distance_limit,8000);
  assert.equal(osd.rth_altitude,120);
  assert.equal(osd.rc_lost_action,2);
  assert.doesNotMatch(JSON.stringify(osd),/PRIVATE/);
  const invalid=sanitizeDeviceProperties(sanitizeKnownProperties({
    distance_limit_status:{state:1,distance_limit:9000},
    rth_altitude:501,rc_lost_action:65535
  },'osd'),'osd',model);
  assert.equal(invalid.distance_limit_status.distance_limit,undefined);
  assert.equal(invalid.rth_altitude,undefined);
  // Unknown enum codes and DJI 65535 sentinels are rejected, not treated
  // as valid RC-loss actions.
  assert.equal(invalid.rc_lost_action,undefined);
});

test('M4T generic aircraft 2024 reference preserves bounded RID and commander states',()=>{
  const model=models[3][0];
  const osd=sanitizeDeviceProperties(sanitizeKnownProperties({
    rid_state:true, latitude:-33.1,longitude:-150.2,
    device_secret:'HIDDEN'
  },'osd'),'osd',model);
  assert.equal(osd.rid_state,true);
  assert.equal(osd.latitude,-33.1);
  assert.equal(osd.longitude,-150.2);
  const state=sanitizeDeviceProperties(sanitizeKnownProperties({
    payloads:[{payload_index:'89-0-0',firmware_version:'03.01.200',
      sn:'PAYLOAD_SERIAL',control_source:'SECRET_OPERATOR'}],
    wpmz_version:'1.0.2', current_rth_mode:1,
    commander_mode_lost_action:0,current_commander_flight_mode:1,
    commander_flight_height:25.5,home_latitude:-33.2,home_longitude:-150.1,
    device_secret:'HIDDEN'
  },'state'),'state',model);
  assert.equal(state.payloads[0].payload_index,'89-0-0');
  assert.equal(state.payloads[0].firmware_version,'03.01.200');
  assert.equal(state.payloads[0].sn,undefined);
  assert.equal(state.payloads[0].control_source,undefined);
  assert.equal(state.wpmz_version,'1.0.2');
  assert.equal(state.current_rth_mode,1);
  assert.equal(state.commander_flight_height,25.5);
  assert.equal(state.home_latitude,-33.2);
  assert.equal(state.home_longitude,-150.1);
  assert.doesNotMatch(JSON.stringify(state),/PAYLOAD_SERIAL|SECRET_OPERATOR|HIDDEN/);
  assert.equal(sanitizeDeviceProperties(sanitizeKnownProperties({
    rid_state:3, current_rth_mode:99,commander_flight_height:5000
  },'osd'),'osd',model).rid_state,undefined);
});
test('dynamic keyed DJI gimbal OSD accepts validated numerical values only for provisional M4T',()=>{
  const values={
    '89-0-0':{gimbal_pitch:-28.4,gimbal_yaw:17.8,gimbal_roll:2.2,
      measure_target_longitude:-150.12,measure_target_latitude:-34.12,
      measure_target_altitude:165.2,measure_target_distance:88.9,
      measure_target_error_state:0, zoom_factor:9.2,
      sn:'VERY_SECRET_SN',unrecognized:'TOP_SECRET'},
    'malicious_key':{gimbal_pitch:77},'1-2-3':{password:'TOP_SECRET'},
    '9999-1-2':{gimbal_pitch:3}
  };
  const known=sanitizeKnownProperties(values,'osd');
  const t=sanitizeDeviceProperties(known,'osd',models[3][0]);
  assert.equal(t.payload_gimbals.length,1);
  const g=t.payload_gimbals[0];
  assert.equal(g.payload_index,'89-0-0');
  assert.equal(g.gimbal_pitch,-28.4);
  assert.equal(g.measure_target_latitude,-34.12);
  assert.equal(g.measure_target_longitude,-150.12);
  assert.equal(g.measure_target_error_state,0);
  assert.doesNotMatch(JSON.stringify(known),/VERY_SECRET_SN|TOP_SECRET|malicious_key/);
  for(const other of [models[0][0],models[2][0],models[4][0],models[5][0]]){
    assert.equal(sanitizeDeviceProperties(known,'osd',other).payload_gimbals,undefined);
  }
});
test('dynamic gimbal rejects sentinels, incomplete target coordinates and unsafe caller-provided objects',()=>{
  const model=models[3][0];
  const clean=sanitizeDeviceProperties(sanitizeKnownProperties({
    '89-0-0':{gimbal_pitch:65535,measure_target_latitude:-35,measure_target_error_state:99,
      zoom_factor:7.0}
  },'osd'),'osd',model).payload_gimbals[0];
  assert.equal(clean.gimbal_pitch,undefined);
  assert.equal(clean.measure_target_latitude,undefined);
  assert.equal(clean.measure_target_error_state,undefined);
  assert.equal(clean.zoom_factor,7);
  const forged=sanitizeDeviceProperties({
    payload_gimbals:[{payload_index:'89-0-0',gimbal_pitch:2,sn:'SECRET',token:'HIDDEN'}]
  },'osd',model).payload_gimbals;
  assert.equal(forged[0].gimbal_pitch,2);
  assert.doesNotMatch(JSON.stringify(forged),/SECRET|HIDDEN/);
  const invalid=sanitizeDeviceProperties({payload_gimbals:[{payload_index:'__proto__',password:'HIDDEN'}]},'osd',model);
  assert.equal(invalid.payload_gimbals,undefined);
});

test('empty dynamic DJI target-only entries are ignored and arrays are bounded',()=>{
  const data={'89-0-0':{measure_target_latitude:40},
    '89-0-1':{measure_target_longitude:4},
    '89-0-2':{gimbal_roll:1}};
  for(let i=3;i<20;i++)data['89-0-'+i]={gimbal_roll:i};
  const properties=sanitizeKnownProperties(data,'osd');
  const d=sanitizeDeviceProperties(properties,'osd',models[3][0]);
  assert.equal(d.payload_gimbals.length,MAX_ARRAY_ITEMS);
  assert.equal(d.payload_gimbals[0].payload_index,'89-0-2');
  assert.equal(d.payload_gimbals[0].gimbal_roll,1);
  assert.equal(d.payload_gimbals[0].measure_target_latitude,undefined);
  const source=fieldDefinitions(models[3][0]);
  assert.ok(source.dynamicPayload.fields.includes('measure_target_error_state'));
  assert.ok(source.dynamicPayload.source.includes('aircraft/properties.html'));
  assert.equal(fieldDefinitions(models[0][0]).dynamicPayload,null);
});


test('PSDK widget and speaker telemetry is bounded and privacy-redacted on M4T candidates',()=>{
  const model=models[3][0];
  const raw={
    psdk_ui_resource:[
      {psdk_index:0,psdk_ready:1,object_key:'SECRET_OSS_RESOURCE'},
      {psdk_index:2,psdk_ready:42,object_key:'s3://secret'}
    ],
    psdk_widget_values:[{
      psdk_index:0,psdk_name:'SECRET_NAME',psdk_sn:'SECRET_SN',
      psdk_version:'SECRET_VERSION',psdk_lib_version:'SECRET_LIB',
      speaker:{
        work_mode:0,play_mode:1,play_volume:63,system_state:99,
        play_file_name:'SECRET_AUDIO.MP3',play_file_md5:'SECRET_MD5'
      },
      values:[{index:0,value:-5},{index:1,value:0},{index:2,value:2147483647},
        {index:3,value:'SECRET_VALUE'}],
      unknown_host:'SECRET_HOST'
    }]
  };
  const known=sanitizeKnownProperties(raw,'state');
  const accepted=sanitizeDeviceProperties(known,'state',model);
  assert.equal(accepted.psdk_ui_resource[0].psdk_ready,1);
  assert.equal(accepted.psdk_ui_resource[1].psdk_index,2);
  assert.equal(accepted.psdk_ui_resource[1].psdk_ready,undefined);
  const widget=accepted.psdk_widget_values[0];
  assert.equal(widget.psdk_index,0);
  assert.equal(widget.speaker.play_volume,63);
  assert.equal(widget.speaker.system_state,99);
  assert.deepEqual(widget.values.map(item=>item.value),[-5,0,2147483647]);
  for(const secret of ['SECRET_OSS_RESOURCE','SECRET_NAME','SECRET_SN',
    'SECRET_VERSION','SECRET_LIB','SECRET_AUDIO','SECRET_MD5',
    'SECRET_VALUE','SECRET_HOST','s3://'])
    assert.ok(!JSON.stringify(known).includes(secret),secret);
  assert.equal(sanitizeDeviceProperties(known,'state',models[0][0]).psdk_widget_values,undefined);
  assert.equal(sanitizeDeviceProperties(known,'state',models[5][0]).psdk_widget_values,undefined);
  assert.equal(sanitizeDeviceProperties(known,'osd',model).psdk_widget_values,undefined);
});

test('PSDK enum ranges and nested list bounds prevent invalid states and excessive arrays',()=>{
  const model=models[3][0];
  const raw={
    psdk_ui_resource:Array.from({length:20},(_,i)=>({
      psdk_index:i,psdk_ready:i%2
    })),
    psdk_widget_values:[{
      psdk_index:0,
      speaker:{work_mode:8,play_mode:-1,play_volume:101,system_state:5},
      values:Array.from({length:20},(_,i)=>({index:i,value:i}))
    }]
  };
  const got=sanitizeDeviceProperties(sanitizeKnownProperties(raw,'state'),'state',model);
  assert.equal(got.psdk_ui_resource.length,MAX_ARRAY_ITEMS);
  assert.equal(got.psdk_widget_values[0].values.length,MAX_ARRAY_ITEMS);
  assert.deepEqual(got.psdk_widget_values[0].speaker,undefined);
});

test('ranging sensor errors invalidate target coordinates and distance but keep gimbal attitude',()=>{
  const model=models[3][0];
  for(const state of [1,2,3]){
    const raw={'89-0-0':{
      measure_target_error_state:state,
      measure_target_latitude:49.123,
      measure_target_longitude:8.321,
      measure_target_altitude:200,
      measure_target_distance:20,
      gimbal_pitch:15.5,
      zoom_factor:2
    }};
    const got=sanitizeDeviceProperties(sanitizeKnownProperties(raw,'osd'),'osd',model);
    assert.equal(got.payload_gimbals.length,1);
    const v=got.payload_gimbals[0];
    assert.equal(v.measure_target_error_state,state);
    assert.equal(v.measure_target_latitude,undefined);
    assert.equal(v.measure_target_longitude,undefined);
    assert.equal(v.measure_target_altitude,undefined);
    assert.equal(v.measure_target_distance,undefined);
    assert.equal(v.gimbal_pitch,15.5);
  }
  const ok=sanitizeDeviceProperties(sanitizeKnownProperties({'89-0-0':{
    measure_target_error_state:0,measure_target_latitude:49.1,
    measure_target_longitude:8.2,measure_target_distance:20
  }},'osd'),'osd',model);
  assert.equal(ok.payload_gimbals[0].measure_target_latitude,49.1);
  assert.equal(ok.payload_gimbals[0].measure_target_distance,20);
});


test('field-definition endpoint exposes both pinned and web-only extension provenance',()=>{
  const m=fieldDefinitions(models[3][0]);
  assert.equal(m.fields.length,202);
  assert.match(m.source,/dji-sdk\/Cloud-API-Doc\/blob\/4ec6b0c7/);
  assert.equal(m.extensionSource,
    'https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/pilot-to-cloud/mqtt/aircraft/properties.html');
  assert.equal(m.extensionSourceEdition,'2024-06-28');
  assert.equal(m.extensionVerifiedAt,'2026-10-21');
  assert.match(m.provenance,/generic|Generic|aircraft/i);
  assert.equal(m.dynamicPayload.fields.length,9);
  const rc=fieldDefinitions(models[5][0]);
  assert.equal(rc.fields.length,54);
  assert.equal(rc.sourceEdition,'2025-09-03');
  assert.equal(rc.extensionSource,null);
  const mavic=fieldDefinitions(models[0][0]);
  assert.equal(mavic.extensionSource,null);
  assert.equal(mavic.sourceEdition,null);
});
