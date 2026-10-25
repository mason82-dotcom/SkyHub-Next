'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {deviceProfile,fieldDefinitions,sanitizeKnownProperties,
  sanitizeDeviceProperties,fieldAvailabilityPolicy}=require('../dji-properties');
const {resolveDeviceModel,category}=require('../catalog');
const source=require('../data/dji-cloud-api-118-fields.json');

const MAP=[
  [{domain:'3',type:1,subType:0},'dock1',117,'DJI Dock'],
  [{domain:'3',type:2,subType:0},'dock2',144,'DJI Dock 2'],
  [{domain:'3',type:3,subType:0},'dock3',152,'DJI Dock 3'],
  [{domain:'0',type:91,subType:0},'matrice3D',201,'Matrice 3D'],
  [{domain:'0',type:91,subType:1},'matrice3D',201,'Matrice 3TD'],
  [{domain:'0',type:100,subType:0},'matrice4D',208,'Matrice 4D'],
  [{domain:'0',type:100,subType:1},'matrice4D',208,'Matrice 4TD']
];

test('dock and dock-aircraft models resolve to their own web-reference profiles',()=>{
  for(const [model,name,count,label] of MAP){
    assert.equal(deviceProfile(model).name,name);
    assert.match(deviceProfile(model).confidence,/^official-(device-web|dock-aircraft-web)$/);
    assert.equal(fieldDefinitions(model).fields.length,count);
    assert.equal(resolveDeviceModel(model),label);
  }
  assert.equal(category('3'),'dock');
  // Matrice 30 is also used handheld with Pilot 2, so it is not mapped to a dock profile.
  assert.equal(deviceProfile({domain:'0',type:67,subType:0}),null);
  assert.equal(deviceProfile({domain:'3',type:9,subType:0}),null);
});

test('dock profiles carry web provenance and a consistent, orphan-free field tree',()=>{
  for(const name of new Set(MAP.map(item=>item[1]))){
    const profile=source.profiles[name];
    assert.match(profile.source,/developer\.dji\.com\/doc\/cloud-api-tutorial\/en\/api-reference\/dock-to-cloud\/mqtt\//);
    assert.equal(profile.verifiedAt,'2026-10-22');
    assert.match(profile.provenance,/not pinned|no hardware observation/);
    const paths=profile.fields.map(f=>f.path);
    assert.equal(new Set(paths).size,paths.length);
    for(const path of paths){
      if(path.includes('.'))assert.ok(paths.includes(path.slice(0,path.lastIndexOf('.'))),path);
    }
    // Envelope rows of the vendor page are not properties.
    assert.ok(!paths.includes('data'));
    for(const field of profile.fields)assert.ok(
      ['int','float','double','text','bool','date','enum','enum_int','enum_string','struct','array'].includes(field.type),
      field.path+' '+field.type);
  }
});

test('dock OSD and state values are decoded on their documented channel and bounded by the schema',()=>{
  const dock=MAP[1][0];
  const input={
    cover_state:1,drone_in_dock:1,rainfall:2,environment_temperature:21.5,wind_speed:3.2,
    height:12.3,latitude:49.1,longitude:8.4,heading:90,
    // out-of-range and unknown values must not pass
    alarm_state:9,emergency_stop_state:7,
    silent_mode:1,air_transfer_enable:true,
    network_state:{type:2,quality:4,rate:1.5},
    unexpected_key:'x'
  };
  const osd=sanitizeDeviceProperties(sanitizeKnownProperties(input,'osd'),'osd',dock);
  assert.equal(osd.cover_state,1);
  assert.equal(osd.drone_in_dock,1);
  assert.equal(osd.rainfall,2);
  assert.equal(osd.environment_temperature,21.5);
  assert.equal(osd.alarm_state,undefined);
  assert.equal(osd.emergency_stop_state,undefined);
  assert.equal(osd.unexpected_key,undefined);
  assert.equal(osd.silent_mode,undefined,'state-channel property must not appear on OSD');
  const state=sanitizeDeviceProperties(sanitizeKnownProperties(input,'state'),'state',dock);
  assert.equal(state.silent_mode,1);
  assert.equal(state.air_transfer_enable,true);
  assert.equal(state.cover_state,undefined);
  // A dock profile never applies to another model.
  assert.equal(sanitizeDeviceProperties(sanitizeKnownProperties(input,'osd'),'osd',
    {domain:'2',type:144,subType:0}).cover_state,undefined);
});

test('dock secrets, identifiers and network configuration never leave the parser',()=>{
  const dock=MAP[2][0];
  const input={
    wireless_link_topo:{secret_code:['SENSITIVE_SECRET'],center_node:{sdr_id:1,sn:'SENSITIVE_SN'},
      leaf_nodes:[{sdr_id:2,sn:'SENSITIVE_SN2',control_source_index:1}]},
    rtcm_info:{mount_point:'SENSITIVE_MOUNT',port:'2101',host:'SENSITIVE_HOST'},
    dongle_infos:[{imei:'SENSITIVE_IMEI',sim_info:{iccid:'SENSITIVE_ICCID'}}],
    live_capacity:{device_list:[{sn:'SENSITIVE_LIVE_SN'}]},
    sub_device:{device_sn:'SENSITIVE_AIRCRAFT',device_model_key:'0-100-0'}
  };
  for(const channel of ['osd','state']){
    const out=sanitizeDeviceProperties(sanitizeKnownProperties(input,channel),channel,dock);
    assert.doesNotMatch(JSON.stringify(out),/SENSITIVE/,channel);
  }
  const secret=source.profiles.dock3.fields.find(f=>f.path==='wireless_link_topo.secret_code');
  assert.equal(secret.privacy,'redacted');
  assert.equal(fieldAvailabilityPolicy(secret,source.profiles.dock3.fields),'redacted');
});

test('a node marked redacted is dropped even when its type would otherwise be safe',()=>{
  const profile=source.profiles.dock3;
  const field=profile.fields.find(f=>f.path==='wireless_link_topo.secret_code');
  const original={type:field.type,privacy:field.privacy};
  const modulePath=require.resolve('../dji-properties');
  try{
    // Give the redacted field a plain integer type and reload the schema trees.
    field.type='int';
    delete require.cache[modulePath];
    const fresh=require('../dji-properties');
    const input={wireless_link_topo:{secret_code:42,center_node:{sdr_id:5}}};
    const out=fresh.sanitizeDeviceProperties(fresh.sanitizeKnownProperties(input,'state'),'state',MAP[2][0]);
    assert.deepEqual(JSON.parse(JSON.stringify(out.wireless_link_topo)),{center_node:{sdr_id:5}});
    // Without the redaction marker the same value would be forwarded.
    delete field.privacy;
    delete require.cache[modulePath];
    const unprotected=require('../dji-properties');
    const leaked=unprotected.sanitizeDeviceProperties(
      unprotected.sanitizeKnownProperties(input,'state'),'state',MAP[2][0]);
    assert.equal(leaked.wireless_link_topo.secret_code,42);
  }finally{
    field.type=original.type;
    field.privacy=original.privacy;
    delete require.cache[modulePath];
    require('../dji-properties');
  }
});
