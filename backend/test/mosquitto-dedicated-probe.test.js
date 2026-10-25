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
