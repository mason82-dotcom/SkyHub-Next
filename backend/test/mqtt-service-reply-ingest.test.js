'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {createMqttMetrics}=require('../mqtt-metrics');
const {createMqttIngest}=require('../mqtt-ingest');

const topic='thing/product/TEST-RC/services_reply';
function reply(data={result:0},other={}){
  return Buffer.from(JSON.stringify({
    tid:'ba029d48-44bd-4682-8a6f-574d7729d86f',
    bid:'bf8f7198-513a-462c-a3d9-b450ed8dadb3',
    method:'flighttask_prepare',
    timestamp:Date.now()-1000,data,...other
  }));
}

function isolated(t){
  let deviceWrites=0,uiEmits=0,redisWrites=0,shapeWrites=0;
  const client=new EventEmitter();
  client.end=()=>{};
  client.subscribe=(_topics,_options,done)=>done(null,_topics.map(topic=>({topic,qos:0})));
  let connections=0;
  const mqttConnect=()=>{
    connections++;
    if(connections>1)throw new Error('Unexpected second MQTT publisher');
    return client;
  };
  const mqttStats=createMqttMetrics();
  const registry={
    ingest(){deviceWrites++;return {updates:[],event:null,point:null};},
    get(){return null;}
  };
  const ingest=createMqttIngest({
    broker:{url:'mqtt://localhost:1884'},env:{},
    registry,io:{emit(){uiEmits++;}},redis:{set(){redisWrites++;return Promise.resolve();}},
    topologyStore:{save(){throw new Error('unexpected topology persistence');}},
    trackRecorder:{record(){throw new Error('unexpected track write');}},
    trackRecordingEnabled:false,pool:null,mqttStats,mqttConnect,
    mqttShapes:{record(){shapeWrites++;}},
    mqttModelShapes:{record(){shapeWrites++;}}
  });
  return {client,ingest,mqttStats,counts:()=>({deviceWrites,uiEmits,redisWrites,shapeWrites,connections})};
}

test('valid passive services_reply counts without changing devices or broadcasting',t=>{
  const f=isolated(t);
  f.client.emit('connect');
  f.client.emit('message',topic,reply({
    result:0,output:{security_token:'NO-LOG-OR-STORE',secret_key:'PRIVATE'}
  }),{retain:false});
  const s=f.mqttStats.snapshot();
  assert.equal(f.ingest.state.subscribed,true);
  assert.equal(s.mqttServiceReplyValidated,1);
  assert.equal(s.mqttServiceReplyRejected,0);
  assert.equal(s.mqttAcceptedMessages,1);
  assert.equal(s.mqttChannelCounts.services_reply,1);
  assert.equal(s.mqttOsdMessages,0);
  assert.equal(s.mqttValidTelemetryUpdates,0);
  assert.deepEqual(f.counts(),{deviceWrites:0,uiEmits:0,redisWrites:0,shapeWrites:0,connections:1});
  assert.doesNotMatch(JSON.stringify(s),/NO-LOG-OR-STORE|PRIVATE|TEST-RC|ba029d48/i);
  f.ingest.stop();
});

test('invalid replies fail closed, including wrong topic identity and missing transactions',t=>{
  const f=isolated(t);
  const bad=[
    Buffer.from('{broken'),
    reply({result:0},{tid:null}),
    reply({result:0},{gateway:'OTHER-RC'}),
    reply({result:0},{timestamp:Date.now()-600000}),
    reply({result:0},{data:{hidden:'PRIVATE'}}),
    Buffer.alloc(131073)
  ];
  for(const data of bad)f.client.emit('message',topic,data,{retain:false});
  const s=f.mqttStats.snapshot();
  assert.equal(s.mqttServiceReplyValidated,0);
  assert.equal(s.mqttServiceReplyRejected,bad.length);
  assert.equal(s.mqttRejectedMessages,bad.length);
  assert.equal(s.mqttDroppedByReason.malformed,bad.length);
  assert.equal(s.mqttChannelCounts.services_reply,0);
  assert.equal(s.mqttLastMessageAt,null);
  assert.equal(f.counts().deviceWrites,0);
  assert.equal(f.counts().uiEmits,0);
  assert.equal(f.counts().shapeWrites,0);
  f.ingest.stop();
});

test('retained services_reply is rejected without creating device freshness',t=>{
  const f=isolated(t);
  f.client.emit('message',topic,reply(),{retain:true});
  const s=f.mqttStats.snapshot();
  assert.equal(s.mqttServiceReplyRejected,1);
  assert.equal(s.mqttDroppedByReason.retained,1);
  assert.equal(s.mqttAcceptedMessages,0);
  assert.equal(s.mqttLastTelemetryAt,null);
  assert.equal(f.counts().deviceWrites,0);
  f.ingest.stop();
});

test('ordinary DJI events continue to use the existing registry path unchanged',t=>{
  const f=isolated(t);
  f.client.emit('message','thing/product/TEST-RC/events',
    Buffer.from(JSON.stringify({method:'hms',timestamp:Date.now()-1000,data:{list:[]}})),
    {retain:false});
  assert.equal(f.counts().deviceWrites,1);
  assert.equal(f.counts().shapeWrites,1);
  assert.equal(f.mqttStats.snapshot().mqttServiceReplyValidated,0);
  assert.equal(f.mqttStats.snapshot().mqttChannelCounts.events,1);
  f.ingest.stop();
});
