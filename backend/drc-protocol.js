'use strict';
// DJI Cloud API 1.18 – Pilot live flight controls for DJI RC Plus 2 + Matrice 4E/4T (no I/O, pure builders and parsers).
// Source (read 04.11.2026, every field and range below is from these pages):
//   developer.dji.com/doc/cloud-api-tutorial/en/feature-set/pilot-feature-set/drc.html
//   …/api-reference/pilot-to-cloud/mqtt/dji-rc-plus-2/drc.html            (services, events, osd_info_push)
//   …/api-reference/pilot-to-cloud/mqtt/dji-rc-plus-2/remote-control.html (heart_beat, stick_control, stop, landings)
// Topics (pilot-to-cloud/mqtt/topic-definition): services, services_reply, events, events_reply, drc/up, drc/down use the
// gateway (RC) serial; osd and state use the serial of the device that owns the property ({device_sn}).
// Services: thing/product/{gateway_sn}/services  {tid,bid,timestamp,method,data} → services_reply {…,data:{result}}
// Events with need_reply=1 MUST be answered on events_reply {tid,bid,timestamp,method,data:{result:0}} or the RC resends them.
// DRC:      thing/product/{gateway_sn}/drc/down  {method,data,seq}               ← drc/up {method,data,seq}
// Matrice 4: flight and payload control; Mavic 3E series: payload only (no flight methods are offered for it here).
const crypto=require('node:crypto');

const SERVICES=Object.freeze(['cloud_control_auth_request','cloud_control_release','drc_mode_enter','drc_mode_exit',
  'takeoff_to_point','fly_to_point','fly_to_point_stop','fly_to_point_update','return_home','return_home_cancel']);
const DRC_DOWN=Object.freeze(['heart_beat','stick_control','drone_emergency_stop','drc_force_landing','drc_emergency_landing',
  'drc_initial_state_subscribe']);
const EVENTS=Object.freeze(['cloud_control_auth_notify','fly_to_point_progress','takeoff_to_point_progress','return_home_info',
  'joystick_invalid_notify','drc_status_notify']);
// RC Plus 2 + Matrice 4 only (Product Support: RC Plus 2 = 2-174-0, Matrice 4E = 0-99-0, Matrice 4T = 0-99-1).
const GATEWAY_MODEL='2-174-0';
const FLIGHT_AIRCRAFT=Object.freeze({'0-99-0':'Matrice 4E','0-99-1':'Matrice 4T'});
const STICK=Object.freeze({min:364,max:1684,neutral:1024,span:660});     // stick_control: 1024±660
const JOYSTICK_INVALID=Object.freeze({0:'Fernsteuerung getrennt',1:'Rückkehr wegen niedrigem Akku',2:'Landung wegen niedrigem Akku',
  3:'Nähe zu einer Flugverbotszone',4:'Fernsteuerung hat die Kontrolle übernommen (z. B. Rückkehr ausgelöst)'});

class DrcInputError extends Error{constructor(message){super(message);this.status=400;}}
const fail=m=>{throw new DrcInputError(m);};
const num=(v,name,min,max)=>{
  if(typeof v!=='number'||!Number.isFinite(v))fail(name+' muss eine Zahl sein');
  if(v<min||v>max)fail(name+' muss zwischen '+min+' und '+max+' liegen');
  return v;
};
const int=(v,name,min,max)=>{num(v,name,min,max);if(!Number.isInteger(v))fail(name+' muss ganzzahlig sein');return v;};
const round=(v,d)=>Math.round(v*10**d)/10**d;
const uuid=()=>crypto.randomUUID();

function serviceMessage(method,data,{tid=uuid(),bid=uuid(),timestamp=Date.now()}={}){
  if(!SERVICES.includes(method))throw new TypeError('unknown service '+method);
  return {tid,bid,timestamp,method,data:data??{}};
}
function drcMessage(method,data,seq){
  if(!DRC_DOWN.includes(method))throw new TypeError('unknown DRC method '+method);
  if(!Number.isSafeInteger(seq)||seq<0)throw new TypeError('seq must be a non-negative integer');
  return {method,data:data??{},seq};
}

// --- Services (data builders with the documented ranges) ---------------------------------------------------------
function authRequest({userId,userCallsign}){
  if(typeof userId!=='string'||!userId||userId.length>64)fail('user_id fehlt');
  if(typeof userCallsign!=='string'||!userCallsign||userCallsign.length>64)fail('user_callsign fehlt');
  return {user_id:userId,user_callsign:userCallsign,control_keys:['flight']};   // "To request flight control … fill in flight"
}
const authRelease=()=>({control_keys:['flight']});
function drcEnter({address,clientId,username,password,expireTime,enableTls,osdFrequency=10,hsiFrequency=1}){
  if(typeof address!=='string'||!/^[A-Za-z0-9.-]+:\d{1,5}$/.test(address))fail('Broker-Adresse host:port erwartet');
  if(typeof clientId!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(clientId))fail('client_id ungültig');
  if(typeof username!=='string'||!username||typeof password!=='string'||!password)fail('Broker-Zugangsdaten fehlen');
  return {mqtt_broker:{address,client_id:clientId,username,password,expire_time:int(expireTime,'expire_time',1,2**31-1),
    enable_tls:Boolean(enableTls)},osd_frequency:int(osdFrequency,'osd_frequency',1,30),hsi_frequency:int(hsiFrequency,'hsi_frequency',1,30)};
}
function point(p,heightMin,heightMax){
  if(!p||typeof p!=='object')fail('Zielpunkt fehlt');
  const latitude=num(p.latitude,'latitude',-90,90),longitude=num(p.longitude,'longitude',-180,180);
  if(latitude===0&&longitude===0)fail('0/0 ist kein gültiger Zielpunkt');
  // "Precision up to 6 decimal places"; height step 0.1 m, ellipsoid height (WGS84).
  return {latitude:round(latitude,6),longitude:round(longitude,6),height:round(num(p.height,'height (Ellipsoid)',heightMin,heightMax),1)};
}
function flyTo({flyToId=uuid(),maxSpeed,target}){
  return {fly_to_id:flyToId,max_speed:int(maxSpeed,'max_speed',0,15),points:[point(target,2,10000)]};   // only 1 target point
}
function flyToUpdate({maxSpeed,target}){
  // DJI documents max_speed here as [-4, 5] m/s; values outside are refused rather than clamped.
  return {max_speed:int(maxSpeed,'max_speed',-4,5),points:[point(target,2,10000)]};
}
function takeoff({target,securityTakeoffHeight,rthAltitude,rthMode=1,rcLostAction=2,commanderModeLostAction=1,
  commanderFlightMode=1,commanderFlightHeight,maxSpeed,flightId=uuid(),flightSafetyAdvanceCheck=false}){
  const t=point(target,2,1500);
  return {
    target_latitude:t.latitude,target_longitude:t.longitude,target_height:t.height,
    security_takeoff_height:round(num(securityTakeoffHeight,'security_takeoff_height',20,1500),1),
    rth_mode:int(rthMode,'rth_mode',0,1),                       // 0 intelligent, 1 preset altitude
    rth_altitude:int(rthAltitude,'rth_altitude',2,1500),
    rc_lost_action:int(rcLostAction,'rc_lost_action',0,2),      // 0 hover, 1 land, 2 return home
    commander_mode_lost_action:int(commanderModeLostAction,'commander_mode_lost_action',0,1),
    commander_flight_mode:int(commanderFlightMode,'commander_flight_mode',0,1),
    commander_flight_height:round(num(commanderFlightHeight,'commander_flight_height',2,3000),1),
    flight_id:flightId,max_speed:int(maxSpeed,'max_speed',1,15),
    flight_safety_advance_check:Boolean(flightSafetyAdvanceCheck)
  };
}

// --- DRC channel ----------------------------------------------------------------------------------------------------------
// Stick input from the operator is a normalised vector in [-1, 1]; scale limits the deflection (default half stick).
function stick({roll=0,pitch=0,throttle=0,yaw=0},scale=0.5){
  const s=num(scale,'scale',0,1);
  const ch=(v,name)=>{num(v,name,-1,1);return Math.max(STICK.min,Math.min(STICK.max,Math.round(STICK.neutral+v*s*STICK.span)));};
  return {roll:ch(roll,'roll'),pitch:ch(pitch,'pitch'),throttle:ch(throttle,'throttle'),yaw:ch(yaw,'yaw')};
}
const NEUTRAL=Object.freeze({roll:1024,pitch:1024,throttle:1024,yaw:1024});
const heartBeat=(timestamp=Date.now())=>({timestamp});

// --- Parsing of upstream messages ----------------------------------------------------------------------------------------
function parseTopic(topic){
  // For state the serial is the device's own ({device_sn}); drc_state is a property of the RC, so it equals the gateway serial.
  const m=/^thing\/product\/([A-Za-z0-9_-]{1,64})\/(services_reply|events|state|drc\/up)$/.exec(String(topic||''));
  return m?{gateway:m[1],channel:m[2]}:null;
}
function finite(v){return typeof v==='number'&&Number.isFinite(v)?v:null;}
function pathPoints(list){
  return Array.isArray(list)?list.slice(0,500).map(p=>({latitude:finite(p?.latitude),longitude:finite(p?.longitude),height:finite(p?.height)}))
    .filter(p=>p.latitude!==null&&p.longitude!==null):[];
}
// Returns a small, typed object or null. Unknown methods are ignored; values are copied field by field.
function parseUp(topic,payload){
  const t=parseTopic(topic);
  if(!t)return null;
  let msg;
  try{msg=typeof payload==='string'||Buffer.isBuffer(payload)?JSON.parse(String(payload)):payload;}catch{return null;}
  if(!msg||typeof msg!=='object'||Array.isArray(msg))return null;
  const d=msg.data&&typeof msg.data==='object'?msg.data:{};
  const base={gateway:t.gateway,channel:t.channel,method:typeof msg.method==='string'?msg.method:null};
  if(t.channel==='services_reply'){
    if(!SERVICES.includes(base.method)||typeof msg.tid!=='string')return null;
    return {...base,tid:msg.tid,result:Number.isInteger(d.result)?d.result:null,status:typeof d.output?.status==='string'?d.output.status:null};
  }
  if(t.channel==='drc/up'){
    const seq=Number.isSafeInteger(msg.seq)?msg.seq:null;
    if(base.method==='osd_info_push'){
      const o={};
      for(const k of ['attitude_head','latitude','longitude','height','speed_x','speed_y','speed_z','gimbal_pitch','gimbal_roll','gimbal_yaw'])
        o[k]=finite(d[k]);
      return {...base,seq,osd:o};
    }
    if(base.method==='heart_beat')return {...base,seq,timestamp:finite(d.timestamp)};
    if(DRC_DOWN.includes(base.method))return {...base,seq,result:Number.isInteger(d.result)?d.result:null};
    return null;
  }
  if(t.channel==='events'){
    if(!EVENTS.includes(base.method))return null;
    const out={...base,result:Number.isInteger(d.result)?d.result:null,needReply:msg.need_reply===1,
      tid:typeof msg.tid==='string'?msg.tid.slice(0,64):null,bid:typeof msg.bid==='string'?msg.bid.slice(0,64):null};
    if(base.method==='cloud_control_auth_notify')out.status=typeof d.output?.status==='string'?d.output.status:null;
    if(base.method==='fly_to_point_progress'||base.method==='takeoff_to_point_progress'){
      out.status=typeof d.status==='string'?d.status:null;
      out.id=typeof (d.fly_to_id??d.flight_id)==='string'?(d.fly_to_id??d.flight_id):null;
      out.remainingDistance=finite(d.remaining_distance);out.remainingTime=finite(d.remaining_time);
      out.path=pathPoints(d.planned_path_points);
    }
    if(base.method==='return_home_info'){out.path=pathPoints(d.planned_path_points);out.id=typeof d.flight_id==='string'?d.flight_id:null;}
    if(base.method==='joystick_invalid_notify'){out.reason=Number.isInteger(d.reason)?d.reason:null;out.text=JOYSTICK_INVALID[d.reason]||'unbekannter Grund';}
    if(base.method==='drc_status_notify')out.drcState=Number.isInteger(d.drc_state)?d.drc_state:null;
    return out;
  }
  if(t.channel==='state'){
    if(Number.isInteger(d.drc_state)&&[0,1,2].includes(d.drc_state))return {...base,drcState:d.drc_state};
    return null;
  }
  return null;
}

// Height conversion. fly_to_point and takeoff_to_point targets are WGS84 ellipsoid heights; operators think in metres above
// take-off. take-off ellipsoid height = current ellipsoid height − current height above take-off (DJI OSD height/elevation).
function ellipsoidTarget({heightAboveTakeoff,currentEllipsoid,currentAboveTakeoff}){
  num(heightAboveTakeoff,'Höhe über Start',2,1500);
  if(finite(currentEllipsoid)===null||finite(currentAboveTakeoff)===null)
    fail('Ellipsoidhöhe des Fluggeräts unbekannt: Telemetrie (height, elevation) fehlt');
  return round(currentEllipsoid-currentAboveTakeoff+heightAboveTakeoff,1);
}

// events_reply for an event with need_reply=1 (topic-definition: events_reply struct, data.result 0 = received).
function eventsReply(event,timestamp=Date.now()){
  if(!event||!event.needReply||typeof event.tid!=='string'||!event.method)return null;
  return {tid:event.tid,bid:event.bid||event.tid,timestamp,method:event.method,data:{result:0}};
}

module.exports={eventsReply,SERVICES,DRC_DOWN,EVENTS,GATEWAY_MODEL,FLIGHT_AIRCRAFT,STICK,NEUTRAL,JOYSTICK_INVALID,DrcInputError,
  serviceMessage,drcMessage,authRequest,authRelease,drcEnter,flyTo,flyToUpdate,takeoff,stick,heartBeat,parseTopic,parseUp,ellipsoidTarget};
