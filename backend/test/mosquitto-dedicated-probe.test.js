'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {SUBSCRIPTIONS}=require('../mqtt-ingest');
const {aclCases,aclText,DELIVERY_PUBLISH,PROBE_TOPIC}=require('../../scripts/pi-mosquitto-dedicated');

// MQTT topic filter match ("+" one level, "#" the rest) of a concrete topic against a filter.
function matches(filter,topic){
  const f=filter.split('/'),t=topic.split('/');
  for(let i=0;i<f.length;i++){
    if(f[i]==='#')return true;
    if(i>=t.length||(f[i]!=='+'&&f[i]!==t[i]))return false;
  }
  return f.length===t.length;
}
const accounts={reader:{username:'r',password:'x'},ack:{username:'a',password:'x'},pilot:{username:'p',password:'x'}};

test('mosquitto-dedicated probes never publish a topic the SkyHub backend ingests',()=>{
  const topics=[
    ...aclCases(accounts).map(c=>c.topic),
    ...DELIVERY_PUBLISH.ack,...DELIVERY_PUBLISH.pilot
  ];
  assert.ok(topics.length>=9);
  for(const topic of topics){
    for(const filter of SUBSCRIPTIONS){
      assert.equal(matches(filter,topic),false,topic+' would be ingested via '+filter+' and create a ghost device');
    }
  }
});

test('mosquitto-dedicated probe namespace is outside every backend subscription',()=>{
  for(const filter of SUBSCRIPTIONS)assert.equal(matches(filter,PROBE_TOPIC+'/delivery'),false);
});

test('mosquitto-dedicated ACL lets only reader read and only pilot write the probe namespace',()=>{
  const acl=aclText(accounts);
  const block=name=>acl.split('\n\n').find(b=>b.startsWith('user '+name+'\n'))||'';
  assert.match(block('r'),new RegExp('topic read '+PROBE_TOPIC+'/#'));
  assert.doesNotMatch(block('r'),new RegExp('topic write '+PROBE_TOPIC));
  assert.match(block('p'),new RegExp('topic write '+PROBE_TOPIC+'/#'));
  assert.doesNotMatch(block('p'),new RegExp('topic read '+PROBE_TOPIC));
  assert.doesNotMatch(block('a'),new RegExp(PROBE_TOPIC));
});

test('optional DRC accounts: commander reads the RC OSD (drc_state) and never reads services; the DRC link only drc/up+down',()=>{
  const m=require('../../scripts/pi-mosquitto-dedicated.js');
  const base={reader:{username:'r'},ack:{username:'t'},pilot:{username:'p'}};
  assert.doesNotMatch(m.aclText(base),/skyhub_commander|drc_link/);
  const acl=m.aclText({...base,commander:{username:'skyhub_commander',gatewaySn:'SIMRCP2'},drcLink:{username:'skyhub_drc_link',gatewaySn:'SIMRCP2'}});
  const block=name=>acl.split('\n\n').find(b=>b.startsWith('user '+name+'\n'));
  const cmd=block('skyhub_commander');
  assert.match(cmd,/topic read thing\/product\/SIMRCP2\/osd/);
  assert.match(cmd,/topic write thing\/product\/SIMRCP2\/drc\/down/);
  assert.doesNotMatch(cmd,/topic read thing\/product\/SIMRCP2\/services\n/,'must not read services (drc_mode_enter carries the DRC password)');
  assert.equal(block('skyhub_drc_link').trim(),'user skyhub_drc_link\ntopic write thing/product/SIMRCP2/drc/up\ntopic read thing/product/SIMRCP2/drc/down');
});


test('DRC ACL generation fails closed for missing, mismatched or wildcard gateway serials',()=>{
  const roles={
    reader:{username:'r'},ack:{username:'a'},pilot:{username:'p'},
    commander:{username:'cmd',gatewaySn:'SIMRCP2'},
    drcLink:{username:'link',gatewaySn:'SIMRCP2'}
  };
  const render=mod=>aclText({...roles,...mod});
  assert.match(render({}),/thing\/product\/SIMRCP2\/services/);
  assert.doesNotMatch(render({}),/thing\/product\/\+\/drc\/down/);
  assert.throws(()=>render({commander:{username:'cmd'}}),/gatewaySn/);
  assert.throws(()=>render({drcLink:{username:'link',gatewaySn:'OTHER-RC2'}}),/dieselbe RC-Seriennummer/);
  assert.throws(()=>render({commander:{username:'cmd',gatewaySn:'+'},drcLink:{username:'link',gatewaySn:'+'}}),/gatewaySn/);
  assert.throws(()=>render({commander:{username:'cmd',gatewaySn:'SERIAL/other'},drcLink:{username:'link',gatewaySn:'SERIAL/other'}}),/gatewaySn/);
});
