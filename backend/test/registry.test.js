'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {parseMessage}=require('../dji');
const {createRegistry}=require('../registry');

const receive=(topic,message)=>parseMessage(topic,Buffer.from(JSON.stringify(message)));
const topology=(children,ts=1760000000001)=>receive('sys/product/RC123/status',{
  method:'update_topo',timestamp:ts,data:{type:99,sub_type:0,device_secret:'TOPSECRET',nonce:'VERYSECRET',
    sub_devices:children.map(sn=>({sn,type:116,sub_type:1,device_secret:'CHILDSECRET',nonce:'CHILDNONCE'}))}
});

test('a gateway and its aircraft are linked by topology, without any secret exposure',()=>{
  const registry=createRegistry();
  const {updates}=registry.ingest(topology(['AIR01']),1760000001000);
  assert.equal(updates.length,2);
  const [air,gateway]=[registry.get('AIR01'),registry.get('RC123')];
  assert.equal(gateway.role,'gateway');
  assert.equal(air.role,'subdevice');
  assert.equal(air.gatewaySn,'RC123');
  assert.equal(air.topologyOnline,true);
  assert.deepEqual(gateway.children,['AIR01']);
  for(const response of [registry.snapshot(),registry.events(),updates]){
    assert.doesNotMatch(JSON.stringify(response),/TOPSECRET|VERYSECRET|CHILDSECRET|CHILDNONCE/);
  }
});
test('topology empty snapshot marks disconnected child, but does not invent flight status',()=>{
  const registry=createRegistry();
  registry.ingest(topology(['AIR01']),1760000001000);
  registry.ingest(topology([],1760000000002),1760000002000);
  assert.equal(registry.get('AIR01').topologyOnline,false);
  assert.equal(registry.get('AIR01').telemetry.latitude,null);
  assert.deepEqual(registry.get('RC123').children,[]);
});
test('status and state do not make OSD freshness positive',()=>{
  const registry=createRegistry();
  const ts=1760000000001;
  registry.ingest(topology(['AIR01'],ts),1760000001000);
  registry.ingest(receive('thing/product/AIR01/state',{timestamp:ts,data:{mode_code:5,firmware_version:'10.0.1'}}),1760000001001);
  const d=registry.get('AIR01',1760000001002);
  assert.equal(d.modeCode,5);
  assert.equal(d.firmwareVersion,'10.0.1');
  assert.equal(d.fresh,false);
});
test('older OSD cannot overwrite newer telemetry or refresh freshness',()=>{
  const registry=createRegistry();
  registry.ingest(receive('thing/product/AIR01/osd',{timestamp:1760000000200,gateway:'RC123',data:{latitude:49,longitude:8,height:10}}),1760000001000);
  const old=registry.ingest(receive('thing/product/AIR01/osd',{timestamp:1760000000100,gateway:'RC123',data:{latitude:50,longitude:9,height:20}}),1760000001100);
  assert.equal(old.updates.length,0);
  const d=registry.get('AIR01',1760000001100);
  assert.equal(d.telemetry.latitude,49);
  assert.equal(d.lastTelemetryAt,1760000000200);
  assert.equal(d.gatewaySn,'RC123');
});
test('OSD point requires a usable same-packet coordinate pair',()=>{
  const registry=createRegistry();
  let result=registry.ingest(receive('thing/product/AIR01/osd',{data:{latitude:49}}),1760000001000);
  assert.equal(result.point,null);
  result=registry.ingest(receive('thing/product/AIR01/osd',{data:{longitude:8}}),1760000002000);
  assert.equal(result.point,null);
  result=registry.ingest(receive('thing/product/AIR01/osd',{data:{latitude:0,longitude:0,capacity_percent:0}}),1760000003000);
  assert.equal(result.point,null);
  const d=registry.get('AIR01',1760000003001);
  assert.equal(d.positionUnavailable,true);
  assert.equal(d.positionFresh,false);
  assert.equal(d.lastPositionAt,null);
  assert.equal(d.telemetry.latitude,null);
  assert.equal(d.telemetry.longitude,null);
  assert.equal(d.telemetry.battery,0);
  assert.equal(d.fresh,true);
});
test('0/0 preserves the previous fix without extending its freshness',()=>{
  const registry=createRegistry(),ts=1760000000000;
  const osd=(at,data)=>receive('thing/product/AIR01/osd',{timestamp:at,data});
  assert.ok(registry.ingest(osd(ts+1000,{latitude:49.1,longitude:8.4,battery_percentage:40}),ts+1000).point);
  assert.equal(registry.get('AIR01',ts+1001).positionFresh,true);
  const missing=registry.ingest(osd(ts+2000,{latitude:0,longitude:0,battery_percentage:39}),ts+2000);
  assert.equal(missing.point,null);
  let d=registry.get('AIR01',ts+2001);
  assert.equal(d.positionUnavailable,true);
  assert.equal(d.positionFresh,false);
  assert.equal(d.lastPositionAt,ts+1000);
  assert.equal(d.telemetry.latitude,49.1);
  assert.equal(d.telemetry.longitude,8.4);
  assert.equal(d.telemetry.battery,39);
  assert.equal(d.lastTelemetryAt,ts+2000);
  assert.equal(d.fresh,true);
  // One zero coordinate remains valid, only 0/0 is the DJI null placeholder.
  assert.ok(registry.ingest(osd(ts+3000,{latitude:49.2,longitude:0,battery_percentage:38}),ts+3000).point);
  d=registry.get('AIR01',ts+3001);
  assert.equal(d.positionUnavailable,false);
  assert.equal(d.positionFresh,true);
  assert.equal(d.telemetry.longitude,0);
  assert.equal(d.lastPositionAt,ts+3000);
});
test('regular GNSS is accepted when RTK is disabled or absent',()=>{
  const registry=createRegistry(),topic='thing/product/AIR01/osd';
  assert.ok(registry.ingest(receive(topic,{
    data:{latitude:49.2,longitude:8.5,position_state:{is_fixed:0},capacity_percent:25}
  }),1760000001000).point);
  let d=registry.get('AIR01',1760000001001);
  assert.equal(d.positionFresh,true);
  assert.equal(d.telemetry.rtkFixState,0);
  assert.ok(registry.ingest(receive(topic,{data:{latitude:49.3,longitude:8.6}}),1760000002000).point);
  d=registry.get('AIR01',1760000002001);
  assert.equal(d.positionUnavailable,false);
  assert.equal(d.lastPositionAt,1760000002000);
});
test('partial coordinates do not revive a missing GPS fix',()=>{
  const registry=createRegistry(),topic='thing/product/AIR01/osd';
  registry.ingest(receive(topic,{data:{latitude:0,longitude:0}}),1760000001000);
  const result=registry.ingest(receive(topic,{data:{latitude:49,capacity_percent:75}}),1760000002000);
  assert.equal(result.point,null);
  const d=registry.get('AIR01',1760000002001);
  assert.equal(d.positionUnavailable,true);
  assert.equal(d.positionFresh,false);
  assert.equal(d.telemetry.latitude,null);
  assert.equal(d.lastPositionAt,null);
  assert.equal(d.telemetry.battery,75);
});
test('additional RC and aircraft OSD measurements are merged without GPS history writes',()=>{
  const registry=createRegistry();
  const aircraft=receive('thing/product/AIR01/osd',{
    data:{latitude:0,longitude:0,wind_speed:3.2,wind_direction:2,
      total_flight_time:15,total_flight_distance:0}
  });
  const result=registry.ingest(aircraft,1760000001000);
  assert.equal(result.point,null);
  let device=registry.get('AIR01',1760000001001);
  assert.equal(device.telemetry.windSpeed,3.2);
  assert.equal(device.telemetry.windDirectionCode,2);
  assert.equal(device.telemetry.totalFlightTime,15);
  assert.equal(device.telemetry.totalFlightDistance,0);
  assert.equal(device.positionUnavailable,true);
  const rc=receive('thing/product/RC01/osd',{data:{wireless_link:{
    sdr_link_state:1,'4g_link_state':0,'4g_quality':0
  }}});
  registry.ingest(rc,1760000002000);
  device=registry.get('RC01',1760000002001);
  assert.equal(device.telemetry.sdrLinkState,1);
  assert.equal(device.telemetry.fourGLinkState,0);
  assert.equal(device.telemetry.fourGLinkQuality,0);
  assert.equal(device.lastPositionAt,null);
});
test('empty OSD does not pretend to be fresh telemetry',()=>{
  const registry=createRegistry();
  registry.ingest(receive('thing/product/AIR01/osd',{data:{}}),1760000001000);
  assert.equal(registry.get('AIR01',1760000001001).fresh,false);
});

test('aircraft OSD with mode_code 14 (not connected) is not treated as fresh telemetry',()=>{
  const {parseMessage}=require('../dji');
  const registry=createRegistry();
  const now=1792528000000;
  const topo=parseMessage('sys/product/RC01/status',Buffer.from(JSON.stringify({
    timestamp:now-5000,method:'update_topo',
    data:{domain:'2',type:144,sub_type:0,sub_devices:[{sn:'AIR01',domain:'0',type:77,sub_type:2}]}})));
  registry.ingest(topo,now-5000);
  const osd=(ts,mode,battery)=>parseMessage('thing/product/AIR01/osd',Buffer.from(JSON.stringify({
    timestamp:ts,data:{latitude:49.1,longitude:8.4,battery:{capacity_percent:battery},mode_code:mode}})));
  const live=registry.ingest(osd(now-3000,0,40),now-3000);
  assert.ok(live.point);
  assert.equal(registry.get('AIR01',now-2900).aircraftConnected,true);
  const off=registry.ingest(osd(now-1000,14,34),now-1000);
  assert.equal(off.point,null);
  const d=registry.get('AIR01',now);
  assert.equal(d.aircraftConnected,false);
  assert.equal(d.modeCode,14);
  assert.equal(d.telemetry.battery,40);
  assert.equal(d.lastTelemetryAt,now-3000);
  assert.equal(registry.get('AIR01',now+13000).fresh,false);
  registry.ingest(osd(now+1000,0,33),now+1000);
  assert.equal(registry.get('AIR01',now+1000).aircraftConnected,true);
  assert.equal(registry.get('AIR01',now+1000).telemetry.battery,33);
  // The RC (controller) has no mode_code and is never marked as a disconnected aircraft.
  assert.equal(registry.get('RC01',now).aircraftConnected,null);
});

test('read-only event history marks mission and media reports as unverified',()=>{
  const registry=createRegistry();
  const start=1792528000000;
  const mission=receive('thing/product/DOCK03/events',{
    timestamp:start,method:'flighttask_progress',data:{result:0,
      output:{status:'canceled',progress:{current_step:0,percent:0},
        ext:{flight_id:'PRIVATE_FLIGHT_X',break_point:{break_reason:1281}}}}
  });
  const missionEvent=registry.ingest(mission,start).event;
  assert.deepEqual(missionEvent.missionReport,{
    reportedStatus:'canceled',progressPercent:0,currentStep:0,breakReason:1281
  });
  assert.equal(Object.hasOwn(missionEvent,'mediaReport'),false);
  const callback=receive('thing/product/DOCK03/events',{
    timestamp:start+1,method:'file_upload_callback',data:{file:{
      name:'PRIVATE_IMAGE_X.JPG',object_key:'PRIVATE_OBJECT_KEY_X',
      ext:{flight_id:'PRIVATE_FLIGHT_X'},metadata:{token:'PRIVATE_TOKEN_X'}}}
  });
  const mediaEvent=registry.ingest(callback,start+1).event;
  assert.deepEqual(mediaEvent.mediaReport,{
    kind:'file_metadata_report',storageVerification:'not_checked'
  });
  assert.equal(Object.hasOwn(mediaEvent,'missionReport'),false);
  assert.equal(registry.events().length,2);
  for (const value of [registry.events(),registry.snapshot()]) {
    assert.doesNotMatch(JSON.stringify(value),/PRIVATE_IMAGE_X|PRIVATE_OBJECT_KEY_X|PRIVATE_FLIGHT_X|PRIVATE_TOKEN_X/);
  }
  const stale=registry.ingest(callback,start+2);
  assert.equal(stale.dropReason,'duplicate');
  assert.equal(registry.events().length,2);
});

test('at the device limit, a flood of invented serials cannot evict topology-confirmed devices',()=>{
  const registry=createRegistry(4);
  registry.ingest(topology(['AIR01']),1760000001000);
  for(let i=0;i<60;i++){
    // A forged `gateway` field makes the serial a "subdevice", but no gateway vouched for it.
    registry.ingest(receive(`thing/product/FAKE${i}/osd`,{timestamp:1760000002000+i,gateway:'FAKEGW',
      data:{latitude:1,longitude:1}}),1760000003000+i);
  }
  assert.equal(registry.count(),4);
  assert.equal(registry.get('RC123')?.role,'gateway');
  assert.equal(registry.get('AIR01')?.role,'subdevice');
  assert.equal(registry.get('FAKE0')?.sn,undefined);
  assert.equal(registry.get('FAKE59')?.role,'subdevice');
});
test('eviction removes the least recently seen unconfirmed device, not the oldest inserted one',()=>{
  const registry=createRegistry(3);
  registry.ingest(topology([]),1760000001000);
  const osd=(sn,ts)=>receive(`thing/product/${sn}/osd`,{timestamp:ts,data:{latitude:1,longitude:1}});
  registry.ingest(osd('OLD01',1760000002000),1760000002000);
  registry.ingest(osd('OLD02',1760000003000),1760000003000);
  registry.ingest(osd('OLD01',1760000004000),1760000004000); // OLD01 inserted first, but seen again
  registry.ingest(osd('NEW01',1760000005000),1760000005000);
  assert.equal(registry.count(),3);
  assert.ok(registry.get('RC123'));
  assert.ok(registry.get('OLD01'),'recently active device stays');
  assert.equal(registry.get('OLD02')?.sn,undefined,'least recently seen device goes');
  assert.ok(registry.get('NEW01'));
});
test('when only confirmed devices remain, the least recently seen one is evicted instead of refusing',()=>{
  const registry=createRegistry(2);
  registry.ingest(topology(['AIR01']),1760000001000); // RC123 seen, AIR01 never seen directly
  registry.ingest(receive('thing/product/NEW01/osd',{timestamp:1760000002000,data:{latitude:1,longitude:1}}),1760000002000);
  assert.equal(registry.count(),2);
  assert.equal(registry.get('RC123')?.role,'gateway');
  assert.equal(registry.get('AIR01')?.sn,undefined);
  assert.ok(registry.get('NEW01'));
});

test('online needs fresh OSD: a stale topology fact alone never reads as connected',()=>{
  const registry=createRegistry();
  const t0=1760000001000;
  registry.ingest(topology(['AIR01']),t0);
  // Topology says online, but no telemetry has arrived yet.
  assert.equal(registry.get('AIR01',t0).topologyOnline,true);
  assert.equal(registry.get('AIR01',t0).online,false);
  registry.ingest(receive('thing/product/AIR01/osd',{timestamp:t0,gateway:'RC123',
    data:{latitude:49,longitude:8,height:10}}),t0+500);
  assert.equal(registry.get('AIR01',t0+1000).online,true);
  // Telemetry stops; the retained topology fact stays true, `online` does not.
  const later=registry.get('AIR01',t0+60000);
  assert.equal(later.topologyOnline,true);
  assert.equal(later.online,false);
  // A topology revocation always wins over fresh data.
  registry.ingest(topology([],t0+2),t0+1500);
  assert.equal(registry.get('AIR01',t0+2000).online,false);
});
