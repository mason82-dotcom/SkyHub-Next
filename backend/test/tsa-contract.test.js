'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {buildTopologyList,osdMessage,topologyMessage,isOnline,deviceEntry,modelKey}=require('../tsa-contract');

const device=(over={})=>({
  sn:'AIR01',role:'subdevice',gatewaySn:'RC01',children:[],
  model:{domain:'0',type:99,subType:1},modelName:'Matrice 4T',
  topologyOnline:true,fresh:true,aircraftConnected:true,positionFresh:true,lastPositionAt:1000,
  telemetry:{latitude:49.1,longitude:8.4,heightEllipsoid:160.5,heading:-90.1,altitude:12.3,
    horizontalSpeed:2.5,verticalSpeed:-0.5},
  ...over
});
const rc=(over={})=>device({sn:'RC01',role:'gateway',gatewaySn:null,children:['AIR01'],
  model:{domain:'2',type:174,subType:0},modelName:'DJI RC Plus 2 Enterprise',...over});

test('model keys follow the DJI domain-type-sub_type form and reject unknown models',()=>{
  assert.deepEqual(modelKey({domain:'0',type:99,subType:1}),{key:'0-99-1',domain:'0',type:'99',sub_type:'1'});
  assert.deepEqual(modelKey({domain:2,type:'174',subType:0}),{key:'2-174-0',domain:'2',type:'174',sub_type:'0'});
  for(const bad of [null,{},{domain:null,type:1,subType:1},{domain:'0',type:-1,subType:0},
    {domain:'x',type:1,subType:1},{domain:'0',type:1.5,subType:0}])assert.equal(modelKey(bad),null);
});

test('a device is online only with topology, fresh OSD and a connected aircraft',()=>{
  assert.equal(isOnline(device()),true);
  assert.equal(isOnline(device({topologyOnline:null})),false);   // never reported
  assert.equal(isOnline(device({topologyOnline:false})),false);
  assert.equal(isOnline(device({fresh:false})),false);           // restored topology, silent device
  assert.equal(isOnline(device({aircraftConnected:false})),false);
  assert.equal(isOnline(null),false);
});

test('the topology list groups aircraft under their remote controller in the DJI shape',()=>{
  const out=buildTopologyList([device(),rc()]);
  assert.equal(out.code,0);
  assert.equal(out.message,'success');
  assert.equal(out.data.list.length,1);
  const [group]=out.data.list;
  assert.deepEqual(group.parents.map(p=>p.sn),['RC01']);
  assert.deepEqual(group.hosts.map(h=>h.sn),['AIR01']);
  assert.deepEqual(group.hosts[0],{
    sn:'AIR01',device_model:{key:'0-99-1',domain:'0',type:'99',sub_type:'1'},online_status:true,
    device_callsign:'Matrice 4T',user_id:'',user_callsign:''});
  assert.equal(group.parents[0].device_model.key,'2-174-0');
});

test('children are found by gatewaySn even if the gateway list is incomplete; strays stay visible',()=>{
  const out=buildTopologyList([device({gatewaySn:'RC01'}),rc({children:[]}),
    device({sn:'LOOSE',gatewaySn:null,role:'unknown'})]);
  const groups=out.data.list;
  assert.equal(groups.length,2);
  assert.deepEqual(groups[0].hosts.map(h=>h.sn),['AIR01']);
  assert.deepEqual(groups[1],{hosts:[deviceEntry(device({sn:'LOOSE',gatewaySn:null,role:'unknown'}))],parents:[]});
});

test('devices without a known model are left out; offline devices stay listed as offline',()=>{
  const out=buildTopologyList([device({model:{domain:null,type:null,subType:null}}),
    rc({children:['AIR01']}),device({sn:'AIR02',fresh:false})]);
  assert.deepEqual(out.data.list[0].hosts.map(h=>[h.sn,h.online_status]),[['AIR02',false]]);
  assert.deepEqual(buildTopologyList(null).data.list,[]);
});

test('the topology list never contains tokens, telemetry or credentials',()=>{
  const text=JSON.stringify(buildTopologyList([
    device({telemetry:{latitude:49.123456,longitude:8.654321},token:'SECRET-TOKEN',password:'PW'}),rc()]));
  assert.doesNotMatch(text,/SECRET|PW|49\.123|8\.654|latitude|longitude|telemetry/);
});

test('device_osd carries position and motion with DJI field names',()=>{
  const m=osdMessage(device(),1792528000000);
  assert.deepEqual(m,{biz_code:'device_osd',version:'1.0',timestamp:1792528000000,data:{sn:'AIR01',host:{
    latitude:49.1,longitude:8.4,height:160.5,attitude_head:-90.1,elevation:12.3,
    horizontal_speed:2.5,vertical_speed:-0.5}}});
});

test('device_osd needs a fresh, valid position and omits missing values',()=>{
  const t=1792528000000;
  assert.equal(osdMessage(device({positionFresh:false}),t),null);
  assert.equal(osdMessage(null,t),null);
  assert.equal(osdMessage(device({telemetry:{latitude:0,longitude:0}}),t),null);        // DJI placeholder
  assert.equal(osdMessage(device({telemetry:{latitude:49.1,longitude:null}}),t),null);
  assert.equal(osdMessage(device({telemetry:{latitude:91,longitude:8}}),t),null);
  assert.equal(osdMessage(device({telemetry:{latitude:49.1,longitude:181}}),t),null);
  assert.equal(osdMessage(device({telemetry:{latitude:0,longitude:8.4}}),t).data.host.latitude,0);
  const sparse=osdMessage(device({telemetry:{latitude:49.1,longitude:8.4,heading:NaN}}),t);
  assert.deepEqual(Object.keys(sparse.data.host).sort(),['latitude','longitude']);
});

test('topology push messages are empty envelopes with the documented biz codes',()=>{
  const t=1792528000000;
  assert.deepEqual(topologyMessage('online',t),{biz_code:'device_online',version:'1.0',timestamp:t,data:{}});
  assert.equal(topologyMessage('offline',t).biz_code,'device_offline');
  assert.equal(topologyMessage('topology',t).biz_code,'device_update_topo');
  assert.throws(()=>topologyMessage('osd',t));
  assert.throws(()=>topologyMessage('nope',t));
  assert.throws(()=>topologyMessage('online','now'));
});
