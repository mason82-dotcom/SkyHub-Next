'use strict';
// Home point (DJI 1.18 aircraft properties home_latitude/home_longitude, pushmode 1 = state) for the DRC distance limit.
const test=require('node:test');
const assert=require('node:assert/strict');
const {parseMessage}=require('../dji');
const {createRegistry}=require('../registry');

const receive=(channel,sn,timestamp,data,method)=>parseMessage(
  (channel==='status'?'sys':'thing')+'/product/'+sn+'/'+channel,Buffer.from(JSON.stringify({timestamp,method,data})));

test('home point from state is kept; 0/0 and disconnected replay are ignored',()=>{
  const now=1793800000000,registry=createRegistry();
  registry.ingest(receive('status','RC01',now-5000,{domain:'2',type:174,sub_type:0,sub_devices:[{sn:'AIR01',domain:'0',type:99,sub_type:1}]},'update_topo'),now-5000);
  registry.ingest(receive('osd','AIR01',now-4000,{mode_code:0,latitude:49.1,longitude:8.5}),now-4000);
  assert.equal(registry.get('AIR01',now).home,null);
  registry.ingest(receive('state','AIR01',now-3000,{home_latitude:49.1001,home_longitude:8.5002}),now-3000);
  assert.deepEqual({...registry.get('AIR01',now).home,at:undefined},{latitude:49.1001,longitude:8.5002,at:undefined});
  registry.ingest(receive('state','AIR01',now-2000,{home_latitude:0,home_longitude:0}),now-2000);
  assert.equal(registry.get('AIR01',now).home.latitude,49.1001,'0/0 placeholder is not taken over');
  registry.ingest(receive('osd','AIR01',now-1000,{mode_code:14}),now-1000);            // aircraft not connected
  registry.ingest(receive('state','AIR01',now-500,{home_latitude:48,home_longitude:7}),now-500);
  assert.equal(registry.get('AIR01',now).home.latitude,49.1001,'replay of a disconnected aircraft is ignored');
});
