'use strict';
const {randomUUID}=require('node:crypto');
const FIELDS=Object.freeze({
 latitude:[-90,90],longitude:[-180,180],altitude:[-2000,30000],
 heightEllipsoid:[-2000,30000],battery:[0,100],heading:[-360,360],
 horizontalSpeed:[0,300],verticalSpeed:[-200,200],gpsSatellites:[0,255],
 rtkSatellites:[0,255],rtkFixState:[0,3],positionQuality:[0,255]
});
const FLYING=new Set([3,4,5,6,7,8,9,10,11,12,15,16,17,18]);
const STATES=['not_started','fixing','fixed','failed'];
const SAFE_ID=/^[A-Za-z0-9_-]{1,100}$/;
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
function numericValues(values){
 if(!values||typeof values!=='object'||Array.isArray(values))return null;
 const result=Object.create(null);
 for(const [key,value] of Object.entries(values)){
  if(!own(FIELDS,key)||!Number.isFinite(value)||
    value<FIELDS[key][0]||value>FIELDS[key][1])return null;
  result[key]=value;
 }
 if(own(result,'latitude')!==own(result,'longitude'))return null;
 return result;
}
// FC0 observer: no persistence, MQTT publisher, commands or SDK control.
function createFhObserver({clock=Date.now,maxDevices=128,maxEvents=256,
 rtkStaleMs=5000,flightTimeoutMs=30000}={}){
 if(!Number.isInteger(maxDevices)||maxDevices<1||maxDevices>1000||
 !Number.isInteger(maxEvents)||maxEvents<1||maxEvents>2000)
  throw new RangeError('Invalid observer bounds');
 const records=new Map(),history=[];
 const counts={accepted:0,ignored:0,rtkTransitions:0,flightStarts:0,
 flightEnds:0,deviceEvictions:0,msdkAccepted:0};
 function emit(event){
  history.unshift(Object.freeze(event));
  if(history.length>maxEvents)history.length=maxEvents;
 }
 function record(sn,gatewaySn,at){
  let r=records.get(sn);
  if(!r){
   if(records.size>=maxDevices){
    const victim=[...records.values()].sort((a,b)=>a.lastSeen-b.lastSeen)[0];
    records.delete(victim.sn);counts.deviceEvictions++;
   }
   r={sn,gatewaySn,lastSeen:at,rtk:null,modeAt:-1,flight:null,sources:new Map()};
   records.set(sn,r);
  }
  if(gatewaySn&&SAFE_ID.test(gatewaySn))r.gatewaySn=gatewaySn;
  r.lastSeen=Math.max(r.lastSeen,at);
  return r;
 }
 function sourceValues(r,source,values,at,verified){
  const clean=numericValues(values);
  if(!clean)return false;
  for(const [key,value] of Object.entries(clean)){
   let bySource=r.sources.get(key);
   if(!bySource){bySource=new Map();r.sources.set(key,bySource);}
   const old=bySource.get(source);
   if(!old||at>old.at)bySource.set(source,{value,at,verified:!!verified});
  }
  return true;
 }
 function closeFlight(r,at,reason){
  if(!r.flight)return;
  const f=r.flight;r.flight=null;counts.flightEnds++;
  emit({type:'flight-ended',deviceSn:r.sn,at:Math.max(at,f.startedAt),
    reason,sessionId:f.sessionId});
 }
 function expire(now=clock()){
  for(const r of records.values()){
   if(r.flight&&now-r.flight.lastAt>flightTimeoutMs)
    closeFlight(r,r.flight.lastAt+flightTimeoutMs,'telemetry_timeout');
  }
 }
 function observe(msg,device,at=clock()){
  if(!msg||!device||!SAFE_ID.test(msg.sn||'')||msg.sn!==device.sn||
  device.role==='gateway'||!['osd','state'].includes(msg.channel)||
  !Number.isFinite(at)){counts.ignored++;return false;}
  const sampleAt=Number.isSafeInteger(msg.timestamp)?msg.timestamp:at;
  if(sampleAt>at+2000||sampleAt<at-30000){counts.ignored++;return false;}
  const r=record(msg.sn,device.gatewaySn,at);
  if(device.aircraftConnected===false||msg.state?.modeCode===14){
   closeFlight(r,at,'device_disconnected');counts.accepted++;return true;
  }
  if(msg.telemetry){
   const values=Object.fromEntries(Object.entries(msg.telemetry)
     .filter(([k,v])=>own(FIELDS,k)&&Number.isFinite(v)&&
      v>=FIELDS[k][0]&&v<=FIELDS[k][1]));
   // Position pairs must originate from one valid packet.
   if(own(values,'latitude')!==own(values,'longitude')){
    delete values.latitude;delete values.longitude;
   }
   sourceValues(r,'dji-cloud',values,sampleAt,msg.timestamp!==null);
   const code=msg.telemetry.rtkFixState;
   if(Number.isInteger(code)&&code>=0&&code<=3&&
     (!r.rtk||sampleAt>r.rtk.at)){
    const old=r.rtk,verified=msg.timestamp!==null;
    r.rtk={code,at:sampleAt,verified,
     gpsSatellites:msg.telemetry.gpsSatellites??null,
     rtkSatellites:msg.telemetry.rtkSatellites??null};
    if(old&&old.verified&&verified&&(old.code===2)!==(code===2)){
     counts.rtkTransitions++;
     emit({type:code===2?'rtk-acquired':'rtk-lost',deviceSn:r.sn,
       at:sampleAt,previous:STATES[old.code],current:STATES[code]});
    }
   }
  }
  const mode=msg.state?.modeCode;
  if(Number.isInteger(mode)&&sampleAt>r.modeAt){
   if(r.flight&&sampleAt-r.flight.lastAt>flightTimeoutMs)
    closeFlight(r,r.flight.lastAt+flightTimeoutMs,'telemetry_timeout');
   r.modeAt=sampleAt;
   if(FLYING.has(mode)){
    if(!r.flight){
     r.flight={sessionId:randomUUID(),deviceSn:r.sn,
       gatewaySn:r.gatewaySn||null,startedAt:sampleAt,lastAt:sampleAt,
       modeCode:mode,kind:'observed_flight',flightTaskId:null};
     counts.flightStarts++;
     emit({type:'flight-started',deviceSn:r.sn,at:sampleAt,
       sessionId:r.flight.sessionId});
    }else{r.flight.modeCode=mode;r.flight.lastAt=sampleAt;}
   }else if(r.flight&&[0,1,2,13,14].includes(mode))
    closeFlight(r,sampleAt,mode===14?'device_disconnected':'standby');
  }
  counts.accepted++;return true;
 }
 function observeMsdk({aircraftSn,gatewaySn,values,sampledAt},at=clock()){
  const r=records.get(aircraftSn);
  if(!r||at-r.lastSeen>15000||!gatewaySn||r.gatewaySn!==gatewaySn||
   !Number.isSafeInteger(sampledAt)||sampledAt>at+2000||
   sampledAt<at-10000||sampledAt<r.lastSeen-30000)return false;
  const clean=numericValues(values);
  if(!clean||Object.keys(clean).length===0)return false;
  sourceValues(r,'msdk-v5',clean,sampledAt,true);counts.msdkAccepted++;return true;
 }
 function rtk(now=clock()){
  return [...records.values()].filter(r=>r.rtk).map(r=>({
    deviceSn:r.sn,gatewaySn:r.gatewaySn||null,
    fixState:STATES[r.rtk.code],fixed:r.rtk.code===2,
    sampledAt:r.rtk.at,timeVerified:r.rtk.verified,
    stale:now-r.rtk.at>rtkStaleMs||now<r.rtk.at,
    ageMs:Math.max(0,now-r.rtk.at),
    gpsSatellites:r.rtk.gpsSatellites,rtkSatellites:r.rtk.rtkSatellites
   })).sort((a,b)=>a.deviceSn.localeCompare(b.deviceSn));
 }
 function flights(now=clock()){
  expire(now);
  return [...records.values()].filter(r=>r.flight)
   .map(r=>({...r.flight})).sort((a,b)=>a.deviceSn.localeCompare(b.deviceSn));
 }
 function events(kind,limit=100){
  const n=Number.isInteger(limit)?Math.min(Math.max(limit,1),100):100;
  return history.filter(e=>!kind||e.type.startsWith(kind)).slice(0,n).map(e=>({...e}));
 }
 function sources(sn,now=clock()){
  const r=records.get(sn);if(!r)return null;
  const fields=Object.create(null);
  for(const [key,bySource] of r.sources){
   const candidates=[...bySource.entries()].map(([source,s])=>({
    source,value:s.value,sampledAt:s.at,verified:s.verified,
    stale:now-s.at>rtkStaleMs||now<s.at
   }));
   const eligible=candidates.filter(s=>s.verified&&!s.stale)
    .sort((a,b)=>b.sampledAt-a.sampledAt||a.source.localeCompare(b.source));
   fields[key]={selected:eligible[0]||null,sources:candidates};
  }
  return {deviceSn:sn,gatewaySn:r.gatewaySn||null,fields};
 }
 function metrics(now=clock()){
  expire(now);
  return {...counts,trackedDevices:records.size,
   activeFlights:[...records.values()].filter(r=>r.flight).length};
 }
 return Object.freeze({observe,observeMsdk,rtk,flights,events,sources,metrics,expire});
}
module.exports={createFhObserver,numericValues,FLYING};
