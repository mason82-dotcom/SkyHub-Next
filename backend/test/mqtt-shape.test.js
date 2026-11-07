'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {parseMessage}=require('../dji');
const {createShapeCatalog,createModelShapeCatalog}=require('../mqtt-shape');

const raw=(value)=>Buffer.from(JSON.stringify(value));

test('shape catalog groups by channel, method and field names without values or serials',()=>{
  const catalog=createShapeCatalog();
  const osd=parseMessage('thing/product/5YSZSECRETSN/osd',
    raw({data:{latitude:49.123456,longitude:8.654321,capacity_percent:77}}));
  catalog.record(osd,1000);
  catalog.record(osd,2000);
  catalog.record(parseMessage('sys/product/5YSZSECRETSN/status',
    raw({method:'update_topo',need_reply:1,data:{domain:'2',sub_devices:[]}})),3000);
  const snap=catalog.snapshot();
  assert.equal(snap.length,2);
  assert.deepEqual(snap[1],{channel:'osd',method:null,
    dataKeys:['capacity_percent','latitude','longitude'],count:2,needReply:0,firstAt:1000,lastAt:2000});
  assert.equal(snap[0].method,'update_topo');
  assert.equal(snap[0].needReply,1);
  assert.doesNotMatch(JSON.stringify(snap),/5YSZSECRETSN|49\.12|8\.65|77/);
});
test('shape catalog is bounded and rejects unsafe method names',()=>{
  const catalog=createShapeCatalog(2);
  for(const key of ['a','b','c']){
    catalog.record({channel:'state',method:null,dataKeys:[key]},1);
  }
  assert.equal(catalog.snapshot().length,2);
  const other=createShapeCatalog();
  other.record({channel:'events',method:'x y<script>',dataKeys:[]},1);
  assert.equal(other.snapshot()[0].method,null);
  other.record(null);
  assert.equal(other.snapshot().length,1);
});


test('model-scoped shapes attribute fields using already-verified device topology only',()=>{
  const catalog=createModelShapeCatalog();
  const rc={model:{domain:'2',type:144,subType:0},role:'gateway'};
  const m3m={model:{domain:'0',type:77,subType:2},role:'subdevice',aircraftConnected:true};
  catalog.record({channel:'osd',dataKeys:['capacity_percent','wireless_link','SECRET_RC','latitude']},rc,1000);
  catalog.record({channel:'state',dataKeys:['payloads','wpmz_version','SECRET_M3M']},m3m,2000);
  catalog.record({channel:'osd',dataKeys:['rth_altitude','distance_limit_status','mode_code']},m3m,3000);
  const snapshot=catalog.snapshot();
  assert.equal(snapshot.length,3);
  assert.deepEqual(snapshot.find(e=>e.model==='2:144:0').dataKeys,
    ['capacity_percent','latitude','wireless_link']);
  assert.deepEqual(snapshot.find(e=>e.model==='0:77:2'&&e.channel==='state').dataKeys,
    ['payloads','wpmz_version']);
  assert.deepEqual(snapshot.find(e=>e.model==='0:77:2'&&e.channel==='osd').dataKeys,
    ['distance_limit_status','mode_code','rth_altitude']);
  assert.doesNotMatch(JSON.stringify(snapshot),/SECRET_|sn|latitude:49|longitude:8|http/);
});

test('model scoped fields reject unsupported models, wrong roles and disconnected OSD replay',()=>{
  const catalog=createModelShapeCatalog();
  const valid={model:{domain:'0',type:77,subType:2},role:'subdevice',aircraftConnected:true};
  const packet={channel:'osd',dataKeys:['mode_code','distance_limit_status','privacySecret']};
  for(const device of [
    null,{}, {...valid,role:'gateway'},
    {...valid,model:{domain:'0',type:99,subType:9}},
    {...valid,model:{domain:'0',type:77,subType:0}},
    {...valid,aircraftConnected:false}
  ])catalog.record(packet,device,1000);
  catalog.record({channel:'events',dataKeys:['mode_code']},valid,1000);
  assert.deepEqual(catalog.snapshot(),[]);
  catalog.record(packet,valid,1001);
  assert.deepEqual(catalog.snapshot()[0].dataKeys,['distance_limit_status','mode_code']);
  assert.equal(catalog.snapshot()[0].count,1);
});

test('model scoped field names are bounded by pinned schema and cannot echo keys used as IDs',()=>{
  const catalog=createModelShapeCatalog();
  const rc={model:{domain:'2',type:144,subType:0},role:'gateway'};
  catalog.record({channel:'state',dataKeys:[
    'valid_code','SERIAL1234','operator@secret','__proto__','payloads','live_capacity'
  ]},rc,100);
  const out=JSON.stringify(catalog.snapshot());
  assert.ok(out.includes('live_capacity'));
  assert.ok(!out.includes('SERIAL1234'));
  assert.ok(!out.includes('operator@secret'));
  assert.ok(!out.includes('__proto__'));
  assert.ok(!out.includes('payloads'));
});

test('RC Plus 2 and Matrice 4T are model scoped with their own official profiles',()=>{
  const catalog=createModelShapeCatalog();
  const rc={model:{domain:'2',type:174,subType:0},role:'gateway'};
  const air={model:{domain:'0',type:99,subType:1},role:'subdevice',aircraftConnected:true};
  catalog.record({channel:'osd',dataKeys:['drc_state','wireless_link','SERIAL1234']},rc,100);
  catalog.record({channel:'osd',dataKeys:['position_state','rth_mode','wpmz_version','SERIAL1234']},air,101);
  catalog.record({channel:'osd',dataKeys:['position_state']},{...air,aircraftConnected:false},102);
  catalog.record({channel:'osd',dataKeys:['drc_state']},{...rc,role:'subdevice'},103);
  const snapshot=catalog.snapshot();
  assert.deepEqual(snapshot.find(e=>e.model==='2:174:0').dataKeys,['drc_state','wireless_link']);
  const aircraft=snapshot.find(e=>e.model==='0:99:1');
  assert.deepEqual(aircraft.dataKeys,['position_state','rth_mode','wpmz_version']);
  assert.equal(aircraft.count,1);
  assert.ok(!JSON.stringify(snapshot).includes('SERIAL1234'));
});
