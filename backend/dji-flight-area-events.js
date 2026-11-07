'use strict';

// Isolated DJI Cloud API flight-area event inspection. No MQTT client, publishers,
// storage, device commands, HTTP routes or raw-payload logging.
const {parseTopic,serial}=require('./dji');
const {classifyMessage}=require('./message-guard');

const SCHEMA='skyhub-dji-flight-area-event-v1';
const MAX_BYTES=32768;
const MAX_LOCATIONS=64;
const STATUS=new Set(['wait_sync','switch_fail','synchronizing','synchronized','fail']);
const METHODS=new Set(['flight_areas_sync_progress','flight_areas_drone_location']);
const validObject=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const invalid=reason=>({accepted:false,reason});

function inspectFlightAreaEvent({topic,payload,packet={},expectedGatewaySn,
  expectedFileChecksum=null,now=Date.now()}={}){
  // Optional trusted target hash supports a boolean comparison only.
  // Never return the device-reported checksum or target digest.
  if(expectedFileChecksum!==null &&
      (typeof expectedFileChecksum!=='string' ||
       !/^[0-9a-f]{64}$/i.test(expectedFileChecksum)))
    return invalid('invalid_target_checksum');
  // expectedGatewaySn MUST come from a separate authenticated workspace/device
  // resolver. Supplying the untrusted MQTT envelope value is not authorization.
  if(!serial(expectedGatewaySn))return invalid('unbound_gateway');
  const source=parseTopic(topic);
  if(!source||source.source!=='thing'||source.channel!=='events'||
      source.sn!==expectedGatewaySn)return invalid('invalid_topic');
  if(packet?.retain===true)return invalid('retained');
  if(!Buffer.isBuffer(payload)||payload.length===0||payload.length>MAX_BYTES)
    return invalid('invalid_size');
  let envelope;
  try{envelope=JSON.parse(payload.toString('utf8'));}
  catch(_err){return invalid('malformed');}
  if(!validObject(envelope))return invalid('malformed');
  if(!METHODS.has(envelope.method))return invalid('unsupported_method');
  if(envelope.gateway!==expectedGatewaySn)return invalid('gateway_mismatch');
  if(!Number.isSafeInteger(envelope.timestamp)||
     envelope.timestamp<1e12||envelope.timestamp>1e15)return invalid('invalid_timestamp');
  const fresh=classifyMessage({channel:'events',timestamp:envelope.timestamp},packet,now);
  if(!fresh.accept)return invalid(fresh.reason||'invalid_timestamp');
  if(!validObject(envelope.data))return invalid('invalid_data');
  const data=envelope.data;

  if(envelope.method==='flight_areas_sync_progress'){
    if(!STATUS.has(data.status)||!Number.isInteger(data.reason)||
       data.reason<0||data.reason>13)return invalid('invalid_data');
    if(data.file!==undefined&&data.file!==null &&
       (!validObject(data.file)||
        typeof data.file.name!=='string'||data.file.name.length===0||
        data.file.name.length>255||
        typeof data.file.checksum!=='string'||
        !/^[0-9a-f]{64}$/i.test(data.file.checksum)))return invalid('invalid_file');
    return {
      accepted:true,schema:SCHEMA,kind:'sync_progress',
      status:data.status,reasonCode:data.reason,
      fileReferencePresent:validObject(data.file),
      ...(expectedFileChecksum===null?{}:{
        reportedTargetChecksumMatch:validObject(data.file) &&
          data.file.checksum.toLowerCase()===expectedFileChecksum.toLowerCase()
      }),
      // Device-reported status != an attested object checksum, revision and gateway.
      deviceReportedSynchronized:data.status==='synchronized'&&data.reason===0,
      syncVerified:false,flightReady:false,hardwareVerified:false,
      sourceTimestamp:envelope.timestamp
    };
  }

  if(!Array.isArray(data.drone_locations)||data.drone_locations.length>MAX_LOCATIONS)
    return invalid('invalid_data');
  const locations=[];
  const seen=new Set();
  for(const entry of data.drone_locations){
    if(!validObject(entry)||
       typeof entry.area_id!=='string'||
       !/^[A-Za-z0-9_.:-]{1,128}$/.test(entry.area_id)||
       seen.has(entry.area_id)||
       typeof entry.area_distance!=='number'||
       !Number.isFinite(entry.area_distance)||
       entry.area_distance<0||entry.area_distance>1e7||
       typeof entry.is_in_area!=='boolean')return invalid('invalid_location');
    seen.add(entry.area_id);
    locations.push({
      areaId:entry.area_id,
      distanceMeters:entry.area_distance,
      inArea:entry.is_in_area
    });
  }
  return {
    accepted:true,schema:SCHEMA,kind:'drone_location',
    locations,flightReady:false,hardwareVerified:false,
    sourceTimestamp:envelope.timestamp
  };
}

module.exports={inspectFlightAreaEvent,SCHEMA,MAX_BYTES,MAX_LOCATIONS};
