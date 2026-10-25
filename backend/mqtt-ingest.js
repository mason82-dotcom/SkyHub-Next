'use strict';
const mqtt=require('mqtt');
const {parseMessage}=require('./dji');
const {classifyMessage}=require('./message-guard');
const {createStatusReply}=require('./topology-ack');
const {deviceCachePayload}=require('./device-cache');

const SUBSCRIPTIONS=[
  'sys/product/+/status','thing/product/+/osd','thing/product/+/state',
  'thing/product/+/events','thing/product/+/services_reply'
];

// Read-only DJI MQTT ingest plus the optional, ACL-restricted status_reply publisher.
function createMqttIngest({broker,env,registry,io,redis,topologyStore,trackRecorder,
  trackRecordingEnabled,pool,mqttStats,mqttShapes,mqttModelShapes,onTopologyChanged=null}){
  const ackEnabled=env.SKYHUB_TOPOLOGY_ACK_ENABLED==='true';
  const ackUser=env.SKYHUB_TOPOLOGY_ACK_MQTT_USER||'';
  const ackPassword=env.SKYHUB_TOPOLOGY_ACK_MQTT_PASSWORD||'';
  // A dedicated, ACL-restricted publisher is required; read-only credentials remain unchanged.
  if(ackEnabled && (!ackUser || !ackPassword ||
      ackUser.startsWith('REPLACE_') || ackPassword.startsWith('REPLACE_'))){
    throw new Error('dedicated publisher credentials are required');
  }
  const ack={enabled:ackEnabled,connected:false,sent:0,failed:0,skipped:0,lastAt:null,
    // Last successful status_reply per gateway, so Pilot 2 can detect an unacknowledged session.
    acks:new Map(),client:null};
  const state={connected:false,subscribed:false};

  function publishAck(parsed,payload,observedAt){
    const reply=createStatusReply(parsed,payload,observedAt);
    if(reply && ack.client && ack.connected){
      ack.client.publish(reply.topic,reply.payload,{qos:1,retain:false},err=>{
        if(err){ack.failed++;console.error('[topology ack] publish failed');return;}
        ack.sent++;ack.lastAt=Date.now();
        if(ack.acks.size>=200 && !ack.acks.has(parsed.sn))
          ack.acks.delete(ack.acks.keys().next().value);
        ack.acks.set(parsed.sn,ack.lastAt);
      });
    }else{
      // Without status_reply Pilot 2 keeps resending update_topo and withholds OSD.
      ack.skipped++;
      console.error('[topology ack] skipped: '+(reply?'publisher not connected':'reply validation failed'));
    }
  }

  function onMessage(topic,payload,packet){
    // Passive transport diagnostics, without recording device IDs or payloads.
    mqttStats.observed(topic);
    // A retained MQTT delivery is not evidence of a currently connected DJI device.
    if(packet?.retain===true){mqttStats.rejected('retained');return;}
    try {
      const parsed=parseMessage(topic,payload);
      if(!parsed)return;
      const observedAt=Date.now();
      mqttShapes.record(parsed,observedAt);
      const decision=classifyMessage(parsed,packet,observedAt);
      if(!decision.accept){mqttStats.rejected(decision.reason);return;}
      const result=registry.ingest(parsed,observedAt);
      if(result.dropReason){mqttStats.rejected(result.dropReason);return;}
      mqttStats.accepted(parsed,result,observedAt);
      // Only count already validated packets and confirmed topology models.
      // Nothing from raw DJI identifiers or payload values enters this catalog.
      if(['osd','state'].includes(parsed.channel)){
        const device=registry.get(parsed.sn,observedAt);
        mqttModelShapes.record(parsed,device&&{
          model:device.model,role:device.role,
          aircraftConnected:device.aircraftConnected
        },observedAt);
      }
      // DJI topology acknowledgement is a protocol reply, never a flight command.
      // Only send for a validated, accepted, non-retained update_topo message.
      if(ack.enabled && parsed.channel==='status' && parsed.topology)
        publishAck(parsed,payload,observedAt);
      for(const item of result.updates){
        io.emit('device_update',item);
        redis.set('skyhub:device:'+item.sn,JSON.stringify(deviceCachePayload(item)),'EX',3600)
          .catch(err=>console.error('[redis write]',err.message));
      }
      if(result.event)io.emit('device_event',result.event);
      if(result.topologyChanged){
        if(onTopologyChanged)onTopologyChanged();
        topologyStore.save(registry.topologyRecords(result.updates.map(item=>item.sn)))
          .catch(err=>console.error('[redis topology]',err.message));
      }
      // Persist only movement or a 60 s heartbeat, never 0/0 without a fix (track-policy.js).
      if(pool && trackRecordingEnabled && result.point){
        const sampleAt=parsed.timestamp===null?observedAt:Math.min(parsed.timestamp,observedAt);
        const t=parsed.telemetry;
        trackRecorder.record(result.point,sampleAt,{sourceTs:sampleAt,timeVerified:parsed.timestamp!==null,
          heightEllipsoid:t.heightEllipsoid,gpsSatellites:t.gpsSatellites,rtkSatellites:t.rtkSatellites,
          rtkFixState:t.rtkFixState,positionQuality:t.positionQuality});
      }
    }catch(_err){
      // Parsing errors may contain snippets of sensitive DJI messages. Never log them.
      mqttStats.rejected('malformed');
      console.error('[mqtt message rejected] malformed DJI message');
    }
  }

  const base={protocolVersion:5,reconnectPeriod:3000,connectTimeout:10000};
  const options={...base,clientId:'skyhub_next_readonly_'+process.pid};
  if(env.MQTT_USER)options.username=env.MQTT_USER;
  if(env.MQTT_PASSWORD)options.password=env.MQTT_PASSWORD;
  const client=mqtt.connect(broker.url,options);
  if(ack.enabled){
    ack.client=mqtt.connect(broker.url,{...base,clientId:'skyhub_next_topology_ack_'+process.pid,
      username:ackUser,password:ackPassword});
    ack.client.on('connect',()=>{ack.connected=true;});
    ack.client.on('close',()=>{ack.connected=false;});
    ack.client.on('error',()=>{ack.failed++;console.error('[topology ack] broker connection failed');});
  }
  client.on('connect',()=>{
    state.connected=true;
    mqttStats.connected();
    state.subscribed=false;
    console.log('[mqtt] connected; subscribing read-only');
    client.subscribe(SUBSCRIPTIONS,{qos:0},(err,granted)=>{
      state.subscribed=!err && Array.isArray(granted) && granted.length===SUBSCRIPTIONS.length &&
        granted.every(item=>item.qos!==128);
      if(!state.subscribed)console.error('[mqtt subscribe] subscriptions not confirmed');
    });
  });
  client.on('close',()=>{state.connected=false;state.subscribed=false;mqttStats.disconnected();});
  client.on('error',err=>console.error('[mqtt]',err.message));
  client.on('message',onMessage);

  return {
    state,ack,
    stop(){client.end(true);if(ack.client)ack.client.end(true);}
  };
}
module.exports={createMqttIngest,SUBSCRIPTIONS};
