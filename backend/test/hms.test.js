'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {describeHms}=require('../hms-catalog');
const {parseMessage}=require('../dji');
const {createRegistry}=require('../registry');

const now=1792528000000;
const hmsEvent=(codes,timestamp)=>parseMessage('thing/product/AIR01/events',Buffer.from(JSON.stringify({
  timestamp,data:{event:'hms',method:'hms',output:{codes}}})));

test('HMS codes observed on the Mavic 3M resolve to German text with English fallback',()=>{
  const rtk=describeHms({code:'0x16100066'},{domain:'0'});
  assert.match(rtk.de,/RTK-Signal schwach/);
  assert.match(rtk.en,/RTK signal weak/);
  assert.equal(describeHms({code:'0xFFFFFFFF'},{domain:'0'}),null);
  assert.equal(describeHms(null),null);
});

test('in-the-sky variant is used only while the aircraft is flying',()=>{
  const ground=describeHms({code:'0x16100091'},{domain:'0',modeCode:0});
  const air=describeHms({code:'0x16100091'},{domain:'0',modeCode:3});
  assert.ok(ground && air);
  assert.notEqual(ground.en,air.en);
});

test('component placeholders are counted from 1',()=>{
  const texts=require('../data/hms-texts.json');
  const key=Object.keys(texts).find(k=>k.startsWith('fpv_tip_') && /%component_index/.test(texts[k].en||''));
  const text=describeHms({code:key.slice(8,18),componentIndex:1},{domain:'0'});
  assert.doesNotMatch(text.en,/%component_index/);
  assert.match(text.en,/2/);
});

test('registry keeps the latest complete HMS list with freshness and texts',()=>{
  const registry=createRegistry();
  registry.ingest(hmsEvent([{id:370147430,level:2,component_index:0,sensor_index:0},
    {id:453640193,level:1,component_index:0,sensor_index:0}],now-1000),now);
  let d=registry.get('AIR01',now);
  assert.equal(d.hms.length,2);
  assert.equal(d.hms[0].code,'0x16100066');
  assert.match(d.hms[0].text.de,/RTK/);
  assert.equal(d.hmsFresh,true);
  assert.equal(d.hmsTimeVerified,true);
  // HMS is not telemetry: it must not make OSD look fresh.
  assert.equal(d.fresh,false);
  registry.ingest(hmsEvent([],now+1000),now+2000);
  d=registry.get('AIR01',now+2000);
  assert.deepEqual(d.hms,[]);
  assert.equal(registry.get('AIR01',now+40000).hmsFresh,false);
});

test('an older HMS list cannot replace a newer one',()=>{
  const registry=createRegistry();
  registry.ingest(hmsEvent([],now),now);
  const result=registry.ingest(hmsEvent([{id:370147430,level:2}],now-5000),now+100);
  assert.equal(result.dropReason,'duplicate');
  assert.deepEqual(registry.get('AIR01',now+100).hms,[]);
});

test('named placeholders follow the documented DJI copy rules',()=>{
  const texts=require('../data/hms-texts.json');
  const find=(prefix,pattern)=>Object.keys(texts).find(k=>k.startsWith(prefix) && pattern.test(texts[k].en||''));
  const battery=Object.keys(texts).find(k=>k.startsWith('fpv_tip_')&&/%battery_index/.test(texts[k].en||'')&&/%battery_index/.test(texts[k].de||''));
  const left=describeHms({code:battery.slice(8,18),sensorIndex:0,componentIndex:0},{domain:'0'});
  const right=describeHms({code:battery.slice(8,18),sensorIndex:1,componentIndex:0},{domain:'0'});
  assert.match(left.en,/left/);
  assert.match(right.en,/right/);
  assert.match(left.de,/links/);
  assert.match(right.de,/rechts/);
  // %index is sensor_index + 1, not the component index.
  const indexed=find('fpv_tip_',/%index/);
  const text=describeHms({code:indexed.slice(8,18),sensorIndex:2,componentIndex:0},{domain:'0'});
  assert.doesNotMatch(text.en,/%index/);
  assert.match(text.en,/\b3\b/);
});

test('dock placeholders use the dock rules and unknown templates never reach the operator',()=>{
  const texts=require('../data/hms-texts.json');
  const original={...texts};
  const patch=(key,value)=>{texts[key]=value;};
  try{
    patch('dock_tip_0xDEAD0001',{en:'Dock %dock_cover_index cover stuck',de:'Dock-Abdeckung %dock_cover_index klemmt'});
    patch('dock_tip_0xDEAD0002',{en:'Charging rod %charging_rod_index error',de:'Ladestab %charging_rod_index Fehler'});
    patch('dock_tip_0xDEAD0003',{en:'Dock %1$s cover and channel %d unknown %lidar_index',de:null});
    const cover0=describeHms({code:'0xDEAD0001',sensorIndex:0},{domain:'3'});
    const cover1=describeHms({code:'0xDEAD0001',sensorIndex:1},{domain:'3'});
    assert.equal(cover0.en,'Dock left cover stuck');
    assert.equal(cover1.de,'Dock-Abdeckung rechts klemmt');
    for(const [index,en] of [[0,'front'],[1,'back'],[2,'left'],[3,'right']]){
      assert.equal(describeHms({code:'0xDEAD0002',sensorIndex:index},{domain:'3'}).en,'Charging rod '+en+' error');
    }
    assert.equal(describeHms({code:'0xDEAD0002',sensorIndex:4},{domain:'3'}).en,'Charging rod ? error');
    assert.equal(describeHms({code:'0xDEAD0002'},{domain:'3'}).en,'Charging rod ? error');
    const unknown=describeHms({code:'0xDEAD0003',sensorIndex:0},{domain:'3'});
    assert.equal(unknown.en,'Dock ? cover and channel ? unknown ?');
    assert.equal(unknown.de,null);
    assert.doesNotMatch(unknown.en,/%/);
  }finally{
    for(const key of Object.keys(texts))if(!(key in original))delete texts[key];
  }
});

test('no shipped HMS text shows a raw placeholder after substitution',()=>{
  const texts=require('../data/hms-texts.json');
  for(const [key,entry] of Object.entries(texts)){
    for(const lang of ['de','en']){
      if(!entry[lang])continue;
      const domain=key.startsWith('dock_')?'3':'0';
      const out=describeHms({code:key.slice(key.indexOf('0x'),key.indexOf('0x')+10),sensorIndex:0,componentIndex:0},
        {domain,modeCode:key.endsWith('_in_the_sky')?3:0});
      // A literal percent sign ("unter 20 %") is fine; template tokens are not.
      if(out&&out[lang])assert.doesNotMatch(out[lang],/%(?:\d+\$)?(?:\.\d+)?[sdf]|%[a-z]+_index|%alarmid|%index/,key+' '+lang);
    }
  }
});
