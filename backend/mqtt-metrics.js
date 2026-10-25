'use strict';
const {parseTopic}=require('./dji');

// Read-only, serial-number-free metrics for the public health endpoint.
// MQTT subscription success is distinct from receipt of valid DJI telemetry.
function createMqttMetrics() {
  const channels=Object.freeze(['osd','state','status','events','services_reply']);
  const counts=Object.fromEntries(channels.map(channel=>[channel,0]));
  const observedCounts=Object.fromEntries(channels.map(channel=>[channel,0]));
  const drops=Object.create(null);
  const state={
    lastConnectedAt:null,lastDisconnectedAt:null,lastMessageAt:null,
    lastOsdAt:null,lastTelemetryAt:null,
    accepted:0,rejected:0,unverifiedTime:0,osdMessages:0,validTelemetryUpdates:0,
    observedPackets:0,observedOsdPackets:0,lastObservedOsdAt:null,
    serviceReplyValidated:0,serviceReplyRejected:0
  };
  return {
    // Count allowlisted MQTT topic deliveries BEFORE JSON and replay filtering.
    // This distinguishes absent OSD traffic from malformed or rejected OSD.
    observed(topic,at=Date.now()) {
      const meta=parseTopic(topic);
      if(!meta || !Object.hasOwn(observedCounts,meta.channel))return;
      state.observedPackets++;
      observedCounts[meta.channel]++;
      if(meta.channel==='osd'){
        state.observedOsdPackets++;
        state.lastObservedOsdAt=at;
      }
    },
    connected(at=Date.now()) { state.lastConnectedAt=at; },
    disconnected(at=Date.now()) { state.lastDisconnectedAt=at; },
    rejected(reason='malformed') {
      state.rejected++;
      const safe=['malformed','retained','stale','future','invalid','duplicate',
        'missing_timestamp_after_verified'].includes(reason)?reason:'invalid';
      drops[safe]=(drops[safe]||0)+1;
    },
    serviceReplyValidated() {state.serviceReplyValidated++;},
    serviceReplyRejected() {state.serviceReplyRejected++;},
    accepted(message,result,at=Date.now()) {
      if(!message || !Object.hasOwn(counts,message.channel) || result?.dropReason)return;
      state.accepted++;
      if (message.timestamp===null) state.unverifiedTime++;
      state.lastMessageAt=at;
      counts[message.channel]++;
      if(message.channel!=='osd')return;
      state.osdMessages++;
      state.lastOsdAt=at;
      // The registry updates lastTelemetryAt only for a nonempty, valid
      // OSD payload and ignores delayed/stale packets.
      const sampleAt=message.timestamp===null?at:Math.min(message.timestamp,at);
      if(Array.isArray(result?.updates) &&
         result.updates.some(item=>item.sn===message.sn && item.lastTelemetryAt===sampleAt)){
        state.validTelemetryUpdates++;
        state.lastTelemetryAt=at;
      }
    },
    snapshot() {
      return {
        mqttLastConnectedAt:state.lastConnectedAt,
        mqttLastDisconnectedAt:state.lastDisconnectedAt,
        mqttLastMessageAt:state.lastMessageAt,
        mqttLastOsdAt:state.lastOsdAt,
        mqttLastTelemetryAt:state.lastTelemetryAt,
        mqttAcceptedMessages:state.accepted,
        mqttRejectedMessages:state.rejected,
        mqttTimestampUnverifiedMessages:state.unverifiedTime,
        mqttDroppedByReason:{...drops},
        mqttObservedPackets:state.observedPackets,
        mqttObservedOsdPackets:state.observedOsdPackets,
        mqttLastObservedOsdAt:state.lastObservedOsdAt,
        mqttObservedChannelCounts:{...observedCounts},
        mqttServiceReplyValidated:state.serviceReplyValidated,
        mqttServiceReplyRejected:state.serviceReplyRejected,
        mqttOsdMessages:state.osdMessages,
        mqttValidTelemetryUpdates:state.validTelemetryUpdates,
        mqttChannelCounts:{...counts}
      };
    }
  };
}
module.exports={createMqttMetrics};
