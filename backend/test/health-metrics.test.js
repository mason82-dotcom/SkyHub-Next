'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {renderHealthMetrics}=require('../health-metrics');

const sample={
  status:'online',mqtt:true,subscribed:true,redis:true,devices:4,readOnly:true,mqttBrokerPort:1884,
  topologyReplyLastAt:null,mqttLastConnectedAt:1793848411212,trackWriteErrors:2,
  mqttDroppedByReason:{stale:3,'bad reason with spaces':1},
  mqttChannelCounts:{osd:5,state:0},
  tileCache:{enabled:true,tiles:879,bytes:13611323,lastAt:null},
  pilotMediaUpload:{grants:1,grantFailures:0,proxy:{forwarded:0,lastAt:null}},
  gatewaySerial:'1581F5BKD2290001ABCD'
};

function parse(text){
  const values=new Map();
  for(const line of text.trim().split('\n')){
    if(line.startsWith('#'))continue;
    const i=line.lastIndexOf(' ');
    values.set(line.slice(0,i),Number(line.slice(i+1)));
  }
  return values;
}

test('health snapshot becomes Prometheus gauges with snake_case names',()=>{
  const m=parse(renderHealthMetrics(sample));
  assert.equal(m.get('skyhub_online'),1);
  assert.equal(m.get('skyhub_mqtt'),1);
  assert.equal(m.get('skyhub_redis'),1);
  assert.equal(m.get('skyhub_devices'),4);
  assert.equal(m.get('skyhub_track_write_errors'),2);
  assert.equal(m.get('skyhub_tile_cache_tiles'),879);
  assert.equal(m.get('skyhub_tile_cache_enabled'),1);
  assert.equal(m.get('skyhub_pilot_media_upload_grants'),1);
});

test('epoch-millisecond fields are exported in seconds, null timestamps are omitted',()=>{
  const m=parse(renderHealthMetrics(sample));
  assert.equal(m.get('skyhub_mqtt_last_connected_at_timestamp_seconds'),1793848411.212);
  assert.equal(m.has('skyhub_topology_reply_last_at_timestamp_seconds'),false);
  assert.equal(m.has('skyhub_tile_cache_last_at_timestamp_seconds'),false);
});

test('count maps become labels; only safe label values are kept',()=>{
  const m=parse(renderHealthMetrics(sample));
  assert.equal(m.get('skyhub_mqtt_channel_counts{channel="osd"}'),5);
  assert.equal(m.get('skyhub_mqtt_dropped_by_reason{reason="stale"}'),3);
  assert.equal([...m.keys()].some(k=>k.includes('spaces')),false);
});

test('strings and nested objects deeper than one level never leak into the output',()=>{
  const text=renderHealthMetrics(sample);
  assert.equal(text.includes('1581F5BKD2290001ABCD'),false);
  assert.equal(text.includes('gateway_serial'),false);
  assert.equal(text.includes('proxy'),false);
});

test('degraded or missing snapshot reports skyhub_online 0 and stays valid text',()=>{
  assert.equal(parse(renderHealthMetrics({status:'degraded'})).get('skyhub_online'),0);
  assert.equal(renderHealthMetrics(null),'# TYPE skyhub_online gauge\nskyhub_online 0\n');
});

test('every sample line is preceded by exactly one TYPE line per metric family',()=>{
  const lines=renderHealthMetrics(sample).trim().split('\n');
  const types=lines.filter(l=>l.startsWith('# TYPE ')).map(l=>l.split(' ')[2]);
  assert.equal(new Set(types).size,types.length);
  for(const line of lines.filter(l=>!l.startsWith('#'))){
    assert.match(line,/^[a-z_][a-z0-9_]*(\{[a-z_]+="[A-Za-z0-9_.:-]+"\})? -?[0-9.e+-]+$/);
  }
});
