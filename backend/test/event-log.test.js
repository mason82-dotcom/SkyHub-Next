'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {parseMessage,extractAirsense}=require('../dji');
const {createRegistry}=require('../registry');

const NOW=1792528000000;
const envelope=(topic,body)=>parseMessage(topic,Buffer.from(JSON.stringify(body)));
const hms=(codes,ts)=>envelope('thing/product/AIR01/events',
  {timestamp:ts,data:{event:'hms',method:'hms',output:{codes}}});
const airsense=(entries,ts,sn='AIR01')=>envelope('thing/product/'+sn+'/events',
  {timestamp:ts,method:'airsense_warning',data:entries});
const near=(level,distance)=>({icao:'SECRET-ICAO',warning_level:level,distance,latitude:49.123,longitude:8.456,
  altitude:1200,heading:90.5,relative_altitude:300,vert_trend:0,altitude_type:0});
const methods=registry=>registry.events().map(e=>e.method);

test('a repeating HMS list is recorded once, again when it changes and when it clears',()=>{
  const r=createRegistry();
  let t=NOW;
  const alarm=[{id:370147430,level:2,component_index:0,sensor_index:0}];
  for(let i=0;i<50;i++)r.ingest(hms(alarm,t+=2000),t);
  assert.deepEqual(methods(r),['hms']);
  r.ingest(hms([...alarm,{id:453640193,level:1,component_index:0,sensor_index:0}],t+=2000),t);
  assert.equal(r.events().length,2);
  // The same alerts in a different order are not a change.
  r.ingest(hms([{id:453640193,level:1,component_index:0,sensor_index:0},...alarm],t+=2000),t);
  assert.equal(r.events().length,2);
  // Same code, different severity or index is a change.
  r.ingest(hms([{id:370147430,level:1,component_index:0,sensor_index:0},
    {id:453640193,level:1,component_index:0,sensor_index:0}],t+=2000),t);
  assert.equal(r.events().length,3);
  r.ingest(hms([],t+=2000),t);
  assert.equal(r.events().length,4);
  for(let i=0;i<20;i++)r.ingest(hms([],t+=2000),t);
  assert.equal(r.events().length,4);
  // The device state still follows every message.
  assert.equal(r.get('AIR01',t).hms.length,0);
});

test('a device that never reports an alarm produces no HMS event',()=>{
  const r=createRegistry();
  let t=NOW;
  for(let i=0;i<10;i++)r.ingest(hms([],t+=2000),t);
  assert.deepEqual(r.events(),[]);
});

test('AirSense warnings are summarised and recorded only when the danger level changes',()=>{
  const r=createRegistry();
  let t=NOW;
  const send=entries=>r.ingest(airsense(entries,t+=1000),t);
  for(let i=0;i<100;i++)send([near(1,23284),near(1,25000),near(1,31000)]);
  assert.deepEqual(methods(r),['airsense_warning']);
  send([near(1,23284),near(1,25000)]);          // fewer aircraft, same level
  assert.equal(r.events().length,1);
  send([near(3,900),near(1,25000)]);            // level rises
  assert.equal(r.events().length,2);
  send([near(3,800)]);
  assert.equal(r.events().length,2);
  send([]);                                     // traffic gone
  assert.equal(r.events().length,3);
  for(let i=0;i<30;i++)send([]);
  assert.equal(r.events().length,3);
});

test('the AirSense summary keeps counts and distances but no third-party identity or position',()=>{
  const r=createRegistry();
  const t=NOW+1000;
  r.ingest(airsense([near(2,5000),near(1,800),{warning_level:9,distance:1},null,'x'],t),t);
  const d=r.get('AIR01',t+500);
  assert.deepEqual({count:d.airsense.count,max:d.airsense.maxWarningLevel,nearest:d.airsense.nearestDistanceM},
    {count:2,max:2,nearest:800});
  assert.equal(d.airsense.fresh,true);
  assert.equal(d.airsense.timeVerified,true);
  assert.equal(r.get('AIR01',t+16000).airsense.fresh,false);
  const text=JSON.stringify([d,r.events(),r.snapshot()]);
  // Values and field names of the third-party aircraft must not appear anywhere.
  assert.doesNotMatch(text,/SECRET|49\.123|8\.456|90\.5|1200|icao|altitude_type|vert_trend|relative_altitude/i);
  assert.equal(createRegistry().get('AIR01'),null);
});

test('periodic messages cannot push real events out of the 100-entry log',()=>{
  const r=createRegistry();
  let t=NOW;
  r.ingest(envelope('sys/product/RC01/status',{timestamp:t,method:'update_topo',data:{
    domain:2,type:174,sub_type:0,sub_devices:[{sn:'AIR01',domain:0,type:99,sub_type:1}]}}),t);
  assert.ok(r.events().some(e=>e.method==='update_topo'));
  const alarm=[{id:370147430,level:2,component_index:0,sensor_index:0}];
  for(let i=0;i<500;i++){
    t+=1000;
    r.ingest(airsense([near(1,23284),near(1,25000),near(1,31000)],t),t);
    r.ingest(hms(alarm,t+1),t+1);
  }
  const log=r.events();
  assert.ok(log.some(e=>e.method==='update_topo'),'topology event was evicted');
  assert.ok(log.length<=100);
  assert.equal(log.length,3);   // topology, first airsense, first hms
});

test('AirSense extraction is bounded and ignores malformed entries',()=>{
  assert.equal(extractAirsense({}),null);
  assert.equal(extractAirsense(null),null);
  assert.deepEqual(extractAirsense([]),{count:0,maxWarningLevel:null,nearestDistanceM:null});
  const many=Array.from({length:500},(_,i)=>({warning_level:1,distance:1000+i}));
  assert.equal(extractAirsense(many).count,50);
  assert.deepEqual(extractAirsense([{warning_level:-1},{warning_level:5},{warning_level:1.5},
    {warning_level:'2'},{warning_level:0,distance:-5},{warning_level:0,distance:1e9}]),
    {count:2,maxWarningLevel:0,nearestDistanceM:null});
});

test('AirSense messages from an unknown shape do not become events',()=>{
  const r=createRegistry();
  const t=NOW+1000;
  r.ingest(envelope('thing/product/AIR01/events',{timestamp:t,method:'airsense_warning',data:{unexpected:true}}),t);
  assert.deepEqual(r.events(),[]);
  assert.equal(r.get('AIR01',t).airsense,null);
});
