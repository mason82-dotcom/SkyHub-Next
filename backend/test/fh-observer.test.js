'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createFhObserver}=require('../fh-observer');
const device={sn:'AIR01',gatewaySn:'RC01',role:'subdevice',aircraftConnected:true};
const sample=(at,code,mode=null)=>({sn:'AIR01',channel:'osd',timestamp:at,
 telemetry:code===null?null:{rtkFixState:code,gpsSatellites:16,rtkSatellites:23},
 state:{modeCode:mode}});
test('RTK transitions only on verified fixed-state changes',()=>{
 const o=createFhObserver({clock:()=>100000});
 o.observe(sample(99990,1),device,100000);o.observe(sample(99991,2),device,100000);
 o.observe(sample(99992,2),device,100000);o.observe(sample(99993,1),device,100000);
 assert.deepEqual(o.events('rtk').map(x=>x.type),['rtk-lost','rtk-acquired']);
 assert.equal(o.rtk(110000)[0].stale,true);
});
test('out-of-order and unverified source timestamps cannot create fix alarms',()=>{
 const o=createFhObserver();
 o.observe(sample(99990,2),device,100000);
 o.observe(sample(99989,1),device,100000);
 o.observe({...sample(99993,1),timestamp:null},device,100000);
 assert.equal(o.events('rtk').length,0);
 assert.equal(o.observe(sample(100,1),device,100000),false);
});
test('observed flights start and end once, idle and timeout handled',()=>{
 const o=createFhObserver({clock:()=>100000});
 o.observe(sample(99990,null,0),device,100000);
 o.observe(sample(99991,null,5),device,100000);
 o.observe(sample(99992,null,5),device,100000);
 assert.equal(o.flights(100000).length,1);
 o.observe(sample(99993,null,0),device,100000);
 assert.equal(o.flights(100000).length,0);
 assert.equal(o.metrics().flightEnds,1);
 o.observe(sample(99994,null,3),device,100000);
 o.expire(140000);o.expire(140001);
 assert.equal(o.metrics(140001).flightEnds,2);
});
test('MSDK is topology-bound, numeric allowlisted, never authorizes control',()=>{
 const o=createFhObserver({clock:()=>100000});
 o.observe(sample(99999,2),device,100000);
 assert.equal(o.observeMsdk({aircraftSn:'AIR01',gatewaySn:'WRONG',sampledAt:99999,values:{battery:50}},100000),false);
 assert.equal(o.observeMsdk({aircraftSn:'AIR01',gatewaySn:'RC01',sampledAt:99999,values:{flightControl:1}},100000),false);
 assert.equal(o.observeMsdk({aircraftSn:'AIR01',gatewaySn:'RC01',sampledAt:99999,values:{battery:50}},100000),true);
 assert.equal(o.sources('AIR01',100000).fields.battery.selected.source,'msdk-v5');
 assert.doesNotMatch(JSON.stringify(o.metrics()),/AIR01|RC01/);
});
test('DJI (0,0) placeholder never becomes a selected position from either source',()=>{
 const o=createFhObserver({clock:()=>100000});
 o.observe({sn:'AIR01',channel:'osd',timestamp:99990,
   telemetry:{latitude:0,longitude:0,battery:80},state:{modeCode:0}},device,100000);
 let f=o.sources('AIR01',100000).fields;
 assert.equal(f.latitude,undefined);assert.equal(f.longitude,undefined);
 assert.equal(f.battery.selected.value,80);
 assert.equal(o.observeMsdk({aircraftSn:'AIR01',gatewaySn:'RC01',sampledAt:99995,
   values:{latitude:0,longitude:0,battery:79}},100000),true);
 f=o.sources('AIR01',100000).fields;
 assert.equal(f.latitude,undefined);
 o.observe({sn:'AIR01',channel:'osd',timestamp:99996,
   telemetry:{latitude:49.1,longitude:8.4},state:{modeCode:0}},device,100000);
 assert.equal(o.sources('AIR01',100000).fields.latitude.selected.value,49.1);
});
test('POI (mode 20) and aerial RTK fixing (18) are observed as flight, dock site evaluation (19) is not',()=>{
 for(const [mode,flying] of [[18,true],[19,false],[20,true]]){
  const o=createFhObserver({clock:()=>100000});
  o.observe(sample(99990,null,mode),device,100000);
  assert.equal(o.flights(100000).length,flying?1:0,'mode '+mode);
 }
});
