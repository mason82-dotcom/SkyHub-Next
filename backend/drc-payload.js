'use strict';
// DJI Cloud API 1.18 – payload control (camera, gimbal, zoom, infrared) of a Matrice 4E/4T through a DJI RC Plus 2 over the
// DRC link. No I/O: validated builders for drc/down and allowlisted parsers for the drc/up pushes.
// Source (read 04.11.2026; fields, enums and ranges below are copied from these pages):
//   developer.dji.com/doc/cloud-api-tutorial/en/api-reference/pilot-to-cloud/mqtt/dji-rc-plus-2/remote-control.html
//     drc_camera_*, drc_gimbal_reset, drc_ir_metering_*, drc_camera_state_push, drc_camera_osd_info_push, drc_camera_photo_info_push
//   …/feature-set/pilot-feature-set/drc.html: "For Mavic 3 Enterprise Series and DJI Matrice 4 Series, flight and payload control
//     rights are not distinguished" → the same cloud_control_auth (control_keys ["flight"]) covers the payload.
//   …/mqtt/m4-series/properties.html: payload_index has the format {type-subtype-gimbalindex}
//   …/overview/product-support.html: Matrice 4E camera 88-0-0, Matrice 4T camera 89-0-0 (main gimbal of the aircraft)
// Message: thing/product/{gateway_sn}/drc/down {method,data,seq}; reply on drc/up {method,seq,data:{result}} (non-zero = error).
// The GitHub mirror dji-sdk/Cloud-API-Doc (v1.11.3) still describes the older RC Pro payload API on `services` without the drc_
// prefix; it is NOT used for the RC Plus 2.
const {DrcInputError}=require('./drc-protocol');

const fail=m=>{throw new DrcInputError(m);};
const num=(v,name,min,max)=>{
  if(typeof v!=='number'||!Number.isFinite(v))fail(name+' muss eine Zahl sein');
  if(v<min||v>max)fail(name+' muss zwischen '+min+' und '+max+' liegen');
  return v;
};
const int=(v,name,min,max)=>{num(v,name,min,max);if(!Number.isInteger(v))fail(name+' muss ganzzahlig sein');return v;};
const oneOf=(v,name,list)=>{if(!list.includes(v))fail(name+' muss einer von '+list.join(', ')+' sein');return v;};
const bool=(v,name)=>{if(v===undefined)return false;if(typeof v!=='boolean')fail(name+' muss true oder false sein');return v;};
const round=(v,d)=>Math.round(v*10**d)/10**d;

// Model (domain-type-subtype of the aircraft) → main camera payload and its lenses.
const PAYLOADS=Object.freeze({
  '0-99-0':{payloadIndex:'88-0-0',name:'Matrice 4E Kamera',cameraTypes:['wide','zoom']},
  '0-99-1':{payloadIndex:'89-0-0',name:'Matrice 4T Kamera',cameraTypes:['wide','zoom','ir']}
});
const PAYLOAD_INDEX=/^\d{1,4}-\d{1,4}-\d{1,2}$/;

// Enums from the page (German labels for the UI).
const CAMERA_MODE=Object.freeze({0:'Foto',1:'Video',2:'Smart Low-Light',3:'Panorama',4:'Intervallfoto'});
const GIMBAL_RESET=Object.freeze({0:'Zurücksetzen (Mitte)',1:'nach unten',2:'Schwenk zentrieren',3:'Neigung nach unten'});
const IR_METERING=Object.freeze({0:'aus',1:'Punktmessung',2:'Flächenmessung'});
const FOCUS_MODE=Object.freeze({0:'MF',1:'AFS',2:'AFC'});
const EXPOSURE_MODE=Object.freeze({1:'Automatik',2:'Blendenautomatik (Zeitvorwahl)',3:'Zeitautomatik (Blendenvorwahl)',4:'Manuell'});
// exposure_value is an enum_string "1"…"31" = −5.0 EV … +5.0 EV in thirds, "16" = 0 EV ("255" FIXED is report-only).
const EV=Object.freeze(Object.fromEntries(Array.from({length:31},(_,i)=>{
  const ev=[-5,-4.7,-4.3,-4,-3.7,-3.3,-3,-2.7,-2.3,-2,-1.7,-1.3,-1,-0.7,-0.3,0,0.3,0.7,1,1.3,1.7,2,2.3,2.7,3,3.3,3.7,4,4.3,4.7,5][i];
  return [String(i+1),(ev>0?'+':'')+ev.toFixed(1)+' EV'];
})));
// drc_camera_screen_drag: the page gives rad/s but no range. ASSUMPTION (SkyHub limit, to verify on the ground): ±0.6 rad/s
// (≈ 34 °/s), comparable to the gimbal speed in Pilot 2 with a mid-range dial. Change only after a ground test.
const DRAG_MAX_RAD_S=0.6;

const coord=(v,name)=>round(num(v,name,0,1),6);           // lens coordinates 0…1, origin upper-left corner
const lens=(v,allowed,list)=>{
  oneOf(v,'camera_type',list);
  if(!allowed.includes(v))fail('Objektiv '+v+' gibt es an dieser Kamera nicht');
  return v;
};

// Commands the operator may send. Each entry: DJI method and a builder (input, ctx) → data. ctx={payloadIndex,cameraTypes}.
// Not offered on purpose: drc_night_lights_state_set and drc_stealth_state_set (beacon / anti-collision lights stay with the pilot),
// drc_photo_storage_set, drc_video_storage_set, drc_video_resolution_set, drc_interval_photo_set, drc_camera_iso_set,
// drc_camera_shutter_set, drc_camera_aperture_value_set, drc_camera_dewarping_set, drc_camera_mechanical_shutter_set,
// drc_camera_focus_value_set, drc_camera_frame_zoom, drc_ir_metering_area_set, drc_linkage_zoom_set (later, set in Pilot 2).
const COMMANDS=Object.freeze({
  camera_mode:{method:'drc_camera_mode_switch',label:'Kameramodus',
    build:(b,c)=>({payload_index:c.payloadIndex,camera_mode:int(b.mode,'camera_mode',0,4)})},
  photo_take:{method:'drc_camera_photo_take',label:'Foto',build:(b,c)=>({payload_index:c.payloadIndex})},
  photo_stop:{method:'drc_camera_photo_stop',label:'Foto stoppen',build:(b,c)=>({payload_index:c.payloadIndex})},
  recording_start:{method:'drc_camera_recording_start',label:'Video starten',build:(b,c)=>({payload_index:c.payloadIndex})},
  recording_stop:{method:'drc_camera_recording_stop',label:'Video stoppen',build:(b,c)=>({payload_index:c.payloadIndex})},
  zoom:{method:'drc_camera_focal_length_set',label:'Zoom',build:(b,c)=>{
    const type=lens(b.cameraType,c.cameraTypes,['ir','wide','zoom']);
    // "Zoom factor, 2-200 for visible light, 2-20 for infrared."
    return {payload_index:c.payloadIndex,camera_type:type,zoom_factor:round(num(b.factor,'zoom_factor',2,type==='ir'?20:200),1)};}},
  aim:{method:'drc_camera_aim',label:'Kamera auf Bildpunkt',build:(b,c)=>({payload_index:c.payloadIndex,
    camera_type:lens(b.cameraType,c.cameraTypes,['ir','wide','zoom']),locked:bool(b.locked,'locked'),x:coord(b.x,'x'),y:coord(b.y,'y')})},
  gimbal_reset:{method:'drc_gimbal_reset',label:'Gimbal',
    build:(b,c)=>({payload_index:c.payloadIndex,reset_mode:int(b.mode,'reset_mode',0,3)})},
  split_screen:{method:'drc_camera_screen_split',label:'Geteilter Bildschirm',build:(b,c)=>{
    if(typeof b.enable!=='boolean')fail('enable muss true oder false sein');
    return {payload_index:c.payloadIndex,enable:b.enable};}},
  ir_metering_mode:{method:'drc_ir_metering_mode_set',label:'Temperaturmessung',build:(b,c)=>{
    if(!c.cameraTypes.includes('ir'))fail('Temperaturmessung nur mit Wärmebildkamera (Matrice 4T)');
    return {payload_index:c.payloadIndex,mode:int(b.mode,'mode',0,2)};}},
  ir_metering_point:{method:'drc_ir_metering_point_set',label:'Messpunkt',build:(b,c)=>{
    if(!c.cameraTypes.includes('ir'))fail('Temperaturmessung nur mit Wärmebildkamera (Matrice 4T)');
    return {payload_index:c.payloadIndex,x:coord(b.x,'x'),y:coord(b.y,'y')};}},
  focus_mode:{method:'drc_camera_focus_mode_set',label:'Fokusmodus',build:(b,c)=>({payload_index:c.payloadIndex,
    camera_type:lens(b.cameraType,c.cameraTypes,['wide','zoom']),focus_mode:int(b.mode,'focus_mode',0,2)})},
  point_focus:{method:'drc_camera_point_focus_action',label:'Fokus auf Bildpunkt',build:(b,c)=>({payload_index:c.payloadIndex,
    camera_type:lens(b.cameraType,c.cameraTypes,['wide','zoom']),x:coord(b.x,'x'),y:coord(b.y,'y')})},
  exposure_mode:{method:'drc_camera_exposure_mode_set',label:'Belichtungsmodus',build:(b,c)=>({payload_index:c.payloadIndex,
    camera_type:lens(b.cameraType,c.cameraTypes,['wide','zoom']),exposure_mode:int(b.mode,'exposure_mode',1,4)})},
  exposure_value:{method:'drc_camera_exposure_set',label:'Belichtungskorrektur',build:(b,c)=>({payload_index:c.payloadIndex,
    camera_type:lens(b.cameraType,c.cameraTypes,['wide','zoom']),exposure_value:String(int(b.value,'exposure_value',1,31))})}
});
// Methods sent by the session itself (gimbal drag at a fixed rate, look-at with an ellipsoid height computed on the server).
const DRAG_METHOD='drc_camera_screen_drag',LOOK_AT_METHOD='drc_camera_look_at';
const METHODS=Object.freeze([...new Set([...Object.values(COMMANDS).map(c=>c.method),DRAG_METHOD,LOOK_AT_METHOD])]);
// Pushes on drc/up.
const PUSHES=Object.freeze(['drc_camera_state_push','drc_camera_osd_info_push','drc_camera_photo_info_push']);

function command(name,body,ctx){
  const c=Object.hasOwn(COMMANDS,name)?COMMANDS[name]:null;
  if(!c)fail('unbekannter Kamerabefehl '+String(name).slice(0,40));
  if(!ctx||!PAYLOAD_INDEX.test(ctx.payloadIndex||''))fail('Kamera des Fluggeräts unbekannt');
  return {method:c.method,label:c.label,data:c.build(body&&typeof body==='object'?body:{},ctx)};
}
// Gimbal drag: normalised operator input [-1, 1] → rad/s, limited by DRAG_MAX_RAD_S. yaw_speed is "effective only when the
// aircraft head is not locked"; SkyHub always sends locked=false here (the aircraft body does not turn).
function drag({pitch=0,yaw=0},ctx,maxRadS=DRAG_MAX_RAD_S){
  num(pitch,'pitch',-1,1);num(yaw,'yaw',-1,1);
  return {payload_index:ctx.payloadIndex,locked:false,pitch_speed:round(pitch*maxRadS,3),yaw_speed:round(yaw*maxRadS,3)};
}
// Look at a point: height is the WGS84 ellipsoid height in [2, 10000] m, step 0.1; lat/lon with 6 decimals.
function lookAt({latitude,longitude,height,locked=false},ctx){
  const lat=num(latitude,'latitude',-90,90),lon=num(longitude,'longitude',-180,180);
  if(lat===0&&lon===0)fail('0/0 ist kein gültiger Zielpunkt');
  return {payload_index:ctx.payloadIndex,locked:bool(locked,'locked'),latitude:round(lat,6),longitude:round(lon,6),
    height:round(num(height,'height (Ellipsoid)',2,10000),1)};
}

// Payload context for the aircraft: the payload_index observed in OSD wins if it is well-formed, else the documented default.
function payloadContext(modelKey,observedIndex){
  const p=PAYLOADS[modelKey];
  if(!p)return null;
  const idx=typeof observedIndex==='string'&&PAYLOAD_INDEX.test(observedIndex)&&observedIndex.split('-')[0]===p.payloadIndex.split('-')[0]
    ?observedIndex:p.payloadIndex;
  return {payloadIndex:idx,name:p.name,cameraTypes:[...p.cameraTypes]};
}

// --- parsers (field by field, unknown fields dropped) ------------------------------------------------------------------
const f=v=>typeof v==='number'&&Number.isFinite(v)?v:null;
const i=v=>Number.isInteger(v)?v:null;
const b=v=>v===true||v===1?true:v===false||v===0?false:null;
const s=(v,n=32)=>typeof v==='string'?v.slice(0,n):null;
const obj=v=>v&&typeof v==='object'&&!Array.isArray(v)?v:{};
function parsePush(method,d){
  d=obj(d);
  if(method==='drc_camera_state_push'){
    const c=obj(d.camera_state),m=obj(d.media_storage);
    const list=v=>Array.isArray(v)?v.filter(x=>['current','vision','ir'].includes(x)).slice(0,3):null;
    return {payloadIndex:s(d.payload_index),cameraMode:i(c.camera_mode),intervalS:i(c.interval_photo_interval),
      videoResolution:s(c.video_resolution,4),linkageZoom:b(c.linkage_zoom_state),photoSize:i(c.photo_size),recordTimeS:i(c.record_time),
      recording:i(c.recording_state)===1,capturing:i(c.photo_state)===1,remainPhotos:i(c.remain_photo_num),
      remainRecordS:i(c.remain_record_duration),photoStorage:list(m.photo_storage_settings),videoStorage:list(m.video_storage_settings)};
  }
  if(method==='drc_camera_osd_info_push'){
    const w=obj(d.wide_lense),z=obj(d.zoom_lense),r=obj(d.ir_lense),t=obj(d.measure_target),lv=obj(obj(d.liveview).liveview_world_region);
    return {payloadIndex:s(d.payload_index),
      wide:{exposureMode:i(w.wide_exposure_mode),iso:i(w.wide_iso),shutter:i(w.wide_shutter_speed),exposureValue:i(w.wide_exposure_value),
        aperture:i(w.wide_aperture_value)},
      zoom:{exposureMode:i(z.zoom_exposure_mode),iso:i(z.zoom_iso),shutter:i(z.zoom_shutter_speed),exposureValue:i(z.zoom_exposure_value),
        focusMode:i(z.zoom_focus_mode),focusValue:i(z.zoom_focus_value),factor:f(z.zoom_factor),aperture:i(z.zoom_aperture_value)},
      ir:{zoomFactor:f(r.ir_zoom_factor),splitScreen:b(r.screen_split_enable),gainMode:i(r.thermal_gain_mode),
        tempMin:f(r.thermal_global_temperature_min),tempMax:f(r.thermal_global_temperature_max)},
      target:{latitude:f(t.measure_target_latitude),longitude:f(t.measure_target_longitude),altitude:f(t.measure_target_altitude),
        distance:f(t.measure_target_distance),errorState:i(t.measure_target_error_state)},
      liveview:{left:f(lv.left),top:f(lv.top),right:f(lv.right),bottom:f(lv.bottom)}};
  }
  if(method==='drc_camera_photo_info_push'){
    const p=obj(d.progress);
    return {status:['fail','in_progress','ok'].includes(d.status)?d.status:null,result:i(d.result),countdownS:i(d.countdown_time),
      step:i(p.current_step),percent:i(p.percent)};
  }
  return null;
}

module.exports={PAYLOADS,COMMANDS,METHODS,PUSHES,DRAG_METHOD,LOOK_AT_METHOD,DRAG_MAX_RAD_S,CAMERA_MODE,GIMBAL_RESET,IR_METERING,
  FOCUS_MODE,EXPOSURE_MODE,EV,command,drag,lookAt,payloadContext,parsePush};
