'use strict';

// Local, offline-only flight-area sync evidence state machine.
// No MQTT subscriptions/publishers, HTTP, timers, database or filesystem access.
// The expected gateway MUST be provided by a separately authenticated resolver.
const {serial}=require('./dji');
const {inspectFlightAreaEvent}=require('./dji-flight-area-events');

const SCHEMA='skyhub-dji-flight-area-sync-monitor-v1';
const DEFAULT_TIMEOUT_MS=300000;
const MIN_TIMEOUT_MS=10000;
const MAX_TIMEOUT_MS=3600000;
const SHA256=/^[a-f0-9]{64}$/i;
const isTime=n=>Number.isSafeInteger(n)&&n>=1e12&&n<=1e15;
const rejected=reason=>({accepted:false,reason});

function createFlightAreaSyncMonitor({expectedGatewaySn,timeoutMs=DEFAULT_TIMEOUT_MS}={}){
  if(!serial(expectedGatewaySn))throw new TypeError('Authenticated gateway binding required');
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<MIN_TIMEOUT_MS||
     timeoutMs>MAX_TIMEOUT_MS)throw new RangeError('Invalid sync monitor timeout');

  let target=null;
  let phase='no_target';
  let lastSourceTimestamp=null;
  let reportStatus=null;
  let reportReason=null;
  let reportedTargetChecksumMatch=null;
  let acceptedEvents=0;

  function snapshot(now){
    if(!isTime(now))throw new TypeError('Invalid monitor clock');
    if(target && ['target_configured','device_waiting','device_syncing'].includes(phase)
       && now>target.startedAt+timeoutMs){
      phase='timed_out';
    }
    return {
      schema:SCHEMA,
      phase,
      targetRevision:target?target.revision:null,
      // Neither configuring a target nor a DJI status event proves dispatch.
      commandDispatched:false,
      deviceStatus:reportStatus,
      deviceReasonCode:reportReason,
      deviceReportedTargetMatch:reportedTargetChecksumMatch===true,
      sourceTimestamp:lastSourceTimestamp,
      acceptedEvents,
      revisionVerified:false,
      syncVerified:false,
      flightReady:false,
      hardwareVerified:false
    };
  }

  function configureTarget({revision,sha256,at}={}){
    if(!Number.isSafeInteger(revision)||revision<=0||
       typeof sha256!=='string'||!SHA256.test(sha256)||
       !isTime(at))return rejected('invalid_target');
    if(target){
      if(revision<target.revision)return rejected('revision_rollback');
      if(revision===target.revision){
        if(sha256.toLowerCase()!==target.sha256)return rejected('revision_conflict');
        return {accepted:true,changed:false,state:snapshot(at)};
      }
      if(at<target.startedAt)return rejected('clock_rollback');
    }

    target={revision,sha256:sha256.toLowerCase(),startedAt:at};
    phase='target_configured';
    lastSourceTimestamp=null;
    reportStatus=null;
    reportReason=null;
    reportedTargetChecksumMatch=null;
    acceptedEvents=0;
    return {accepted:true,changed:true,state:snapshot(at)};
  }

  function observe({topic,payload,packet={},at}={}){
    if(!isTime(at))return rejected('invalid_clock');
    if(!target)return rejected('no_target');
    // Deadline is fixed when configuring the target. A stream of intermediate
    // events cannot indefinitely extend it or revive a timed-out attempt.
    snapshot(at);
    if(['timed_out','device_reported_target','device_reported_unmatched',
      'device_failed'].includes(phase))return rejected('terminal');

    const event=inspectFlightAreaEvent({
      topic,payload,packet,expectedGatewaySn,
      expectedFileChecksum:target.sha256,now:at
    });
    if(!event.accepted)return rejected(event.reason);
    if(event.kind!=='sync_progress')return rejected('not_sync_event');
    if(event.sourceTimestamp<target.startedAt)return rejected('before_target');
    if(lastSourceTimestamp!==null&&event.sourceTimestamp<=lastSourceTimestamp){
      return rejected(event.sourceTimestamp===lastSourceTimestamp?'duplicate':'out_of_order');
    }

    lastSourceTimestamp=event.sourceTimestamp;
    reportStatus=event.status;
    reportReason=event.reasonCode;
    // Checksum equality during wait/failure is NOT successful device reporting.
    reportedTargetChecksumMatch=event.status==='synchronized' &&
      event.reasonCode===0 && event.reportedTargetChecksumMatch===true;
    acceptedEvents++;
    if(event.status==='fail'||event.status==='switch_fail'||event.reasonCode!==0)
      phase='device_failed';
    else if(event.status==='wait_sync')phase='device_waiting';
    else if(event.status==='synchronizing')phase='device_syncing';
    else if(event.status==='synchronized')
      phase=event.reportedTargetChecksumMatch?'device_reported_target':'device_reported_unmatched';

    return {accepted:true,state:snapshot(at)};
  }

  return Object.freeze({configureTarget,observe,snapshot});
}

module.exports={
  createFlightAreaSyncMonitor,SCHEMA,DEFAULT_TIMEOUT_MS,
  MIN_TIMEOUT_MS,MAX_TIMEOUT_MS
};
