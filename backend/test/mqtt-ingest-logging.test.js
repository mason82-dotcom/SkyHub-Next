'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const EventEmitter=require('node:events');

// Replace the mqtt module before mqtt-ingest loads it: two fake clients (read-only, topology ack).
const clients=[];
const fake={connect(url,opts){
  const c=new EventEmitter();
  c.opts=opts;
  c.subscribe=(topics,o,cb)=>cb(null,topics.map(topic=>({topic,qos:0})));
  c.publish=()=>{};c.end=()=>{};
  clients.push(c);return c;
}};
const resolved=require.resolve('mqtt');
require.cache[resolved]={id:resolved,filename:resolved,loaded:true,exports:fake};
const {createMqttIngest}=require('../mqtt-ingest');
const {createMqttMetrics}=require('../mqtt-metrics');

function capture(fn){
  const logs=[],errors=[];
  const {log,error}=console;
  console.log=(...a)=>logs.push(a.join(' '));
  console.error=(...a)=>errors.push(a.join(' '));
  try{fn();}finally{console.log=log;console.error=error;}
  return {logs,errors};
}
function ingest(env){
  clients.length=0;
  return createMqttIngest({broker:{url:'mqtt://127.0.0.1:1884'},env,registry:{},io:{},redis:{},topologyStore:{},
    trackRecorder:{},trackRecordingEnabled:false,pool:null,mqttStats:createMqttMetrics(),
    mqttShapes:{},mqttModelShapes:{}});
}

test('connection state changes are logged once, retries during an outage stay silent',()=>{
  const ing=ingest({});
  const [client]=clients;
  let out=capture(()=>client.emit('connect'));
  assert.deepEqual(out.logs,['[mqtt] connected; subscribing read-only','[mqtt] subscribed to 5 read-only topics']);
  assert.equal(ing.state.connected&&ing.state.subscribed,true);

  out=capture(()=>client.emit('close'));
  assert.equal(out.errors.length,1);
  assert.match(out.errors[0],/connection lost; reconnecting every 3 s/);
  assert.equal(ing.state.connected,false);

  // mqtt.js emits "close" again for every failed retry: no new log line.
  out=capture(()=>{client.emit('close');client.emit('close');});
  assert.deepEqual([out.logs,out.errors],[[],[]]);

  // Recovery is logged again.
  out=capture(()=>client.emit('connect'));
  assert.equal(out.logs.length,2);
  ing.stop();
});

test('a refused subscription is reported as an error, not as success',()=>{
  const ing=ingest({});
  const [client]=clients;
  client.subscribe=(topics,o,cb)=>cb(null,topics.map(topic=>({topic,qos:128})));
  const out=capture(()=>client.emit('connect'));
  assert.equal(out.logs.some(l=>l.includes('subscribed to')),false);
  assert.ok(out.errors.some(l=>l.includes('subscriptions not confirmed')));
  assert.equal(ing.state.subscribed,false);
  ing.stop();
});

test('topology ack publisher logs connect and disconnect transitions only',()=>{
  const ing=ingest({SKYHUB_TOPOLOGY_ACK_ENABLED:'true',SKYHUB_TOPOLOGY_ACK_MQTT_USER:'topology',
    SKYHUB_TOPOLOGY_ACK_MQTT_PASSWORD:'x'.repeat(24)});
  const ackClient=clients[1];
  assert.ok(ackClient,'ack publisher client exists');
  let out=capture(()=>ackClient.emit('connect'));
  assert.deepEqual(out.logs,['[topology ack] publisher connected']);
  out=capture(()=>ackClient.emit('connect'));
  assert.deepEqual(out.logs,[]);
  out=capture(()=>ackClient.emit('close'));
  assert.deepEqual(out.errors,['[topology ack] publisher disconnected']);
  out=capture(()=>{ackClient.emit('close');ackClient.emit('close');});
  assert.deepEqual([out.logs,out.errors],[[],[]]);
  assert.equal(ing.ack.connected,false);
  ing.stop();
});
