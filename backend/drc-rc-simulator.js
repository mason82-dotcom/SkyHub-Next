'use strict';
// Simulated DJI Pilot 2 on an RC Plus 2 with a Matrice 4T, for the DRC flow (DJI Cloud API 1.18 topics and payloads).
// For development, tests and MQTTX debugging only: it answers services, approves cloud control (or refuses), sends heartbeats,
// OSD and progress events, and moves a point-mass "aircraft". It never talks to real hardware.
//   const sim=createRcSimulator({gateway,aircraftSn,publish:(topic,msg)=>…}); sim.receive(topic,msg)
const crypto=require('node:crypto');

function createRcSimulator({gateway='SIMRCP2',aircraftSn='SIMM4T',publish,approve=true,start={latitude:49.1,longitude:8.5,ellipsoid:150},
  clock={now:()=>Date.now(),setInterval,clearInterval,setTimeout}}){
  const uuid=()=>crypto.randomUUID();
  const ac={latitude:start.latitude,longitude:start.longitude,takeoffEllipsoid:start.ellipsoid,elevation:0,mode:0,heading:0,
    target:null,flyToId:null,speed:5,returning:false,stick:null,stickAt:0};
  const home={latitude:start.latitude,longitude:start.longitude};
  let drcState=0,timer=null,upSeq=0,tick=0;
  // Matrice 4T camera 89-0-0 (product-support). Gimbal angles in degrees, drag speeds in rad/s.
  const PAYLOAD='89-0-0';
  const cam={mode:0,recording:false,recordStart:0,photos:0,zoom:{wide:2,zoom:2,ir:2},split:false,irMode:0,
    pitch:0,yaw:0,drag:null,dragAt:0};
  const up=(channel,msg,sn=gateway)=>publish(`thing/product/${sn}/${channel}`,msg);
  const reply=(m,result=0)=>up('services_reply',{tid:m.tid,bid:m.bid,timestamp:clock.now(),method:m.method,data:{result,output:{status:'ok'}}});
  const event=(method,data,needReply=1)=>up('events',{tid:uuid(),bid:uuid(),timestamp:clock.now(),method,need_reply:needReply,gateway,data});
  const state=data=>up('state',{tid:uuid(),bid:uuid(),timestamp:clock.now(),gateway,data},gateway);
  // dji-rc-plus-2/properties: drc_state is pushMode 0 → RC OSD (0.5 Hz), not state.
  const rcOsd=()=>up('osd',{tid:uuid(),bid:uuid(),timestamp:clock.now(),gateway,data:{drc_state:drcState,capacity_percent:80}},gateway);
  const drcReply=(m,result=0)=>up('drc/up',{method:m.method,seq:m.seq,data:{result}});
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const R=6371008.8,rad=Math.PI/180;
  function step(dt){
    if(ac.returning){ac.target={latitude:home.latitude,longitude:home.longitude,height:ac.takeoffEllipsoid+30};}
    if(ac.target){
      const dN=(ac.target.latitude-ac.latitude)*rad*R,dE=(ac.target.longitude-ac.longitude)*rad*R*Math.cos(ac.latitude*rad);
      const dU=(ac.target.height-ac.takeoffEllipsoid)-ac.elevation,dist=Math.hypot(dN,dE,dU),move=Math.min(dist,ac.speed*dt);
      if(dist>0.5){
        ac.latitude+=dN/dist*move/R/rad;ac.longitude+=dE/dist*move/R/rad/Math.cos(ac.latitude*rad);ac.elevation+=dU/dist*move;
        ac.heading=Math.round(Math.atan2(dE,dN)/rad);
        if(ac.flyToId)event(ac.takeoff?'takeoff_to_point_progress':'fly_to_point_progress',{fly_to_id:ac.flyToId,flight_id:ac.flyToId,status:'wayline_progress',result:0,remaining_distance:+(dist-move).toFixed(1),
          remaining_time:+((dist-move)/ac.speed).toFixed(1),planned_path_points:[{latitude:ac.target.latitude,longitude:ac.target.longitude,height:ac.target.height}]});
      }else{
        if(ac.flyToId)event(ac.takeoff?'takeoff_to_point_progress':'fly_to_point_progress',{fly_to_id:ac.flyToId,flight_id:ac.flyToId,status:ac.takeoff?'task_finish':'wayline_ok',result:0,remaining_distance:0,remaining_time:0});
        ac.takeoff=false;
        if(ac.returning){ac.elevation=0;ac.mode=0;ac.returning=false;}
        ac.target=null;ac.flyToId=null;
      }
    }else if(ac.stick&&clock.now()-ac.stickAt<1000){
      const k=v=>(v-1024)/660*10;            // full stick ≈ 10 m/s
      const vN=k(ac.stick.pitch),vE=k(ac.stick.roll),vU=k(ac.stick.throttle)/2;
      ac.latitude+=vN*dt/R/rad;ac.longitude+=vE*dt/R/rad/Math.cos(ac.latitude*rad);ac.elevation=Math.max(0,ac.elevation+vU*dt);
      ac.heading=(ac.heading+Math.round(k(ac.stick.yaw)*3*dt))%360;
    }
    if(cam.drag&&clock.now()-cam.dragAt<1000){
      cam.pitch=clamp(cam.pitch+cam.drag.pitch_speed*dt/rad,-90,35);cam.yaw=clamp(cam.yaw+cam.drag.yaw_speed*dt/rad,-180,180);
    }
    const height=+(ac.takeoffEllipsoid+ac.elevation).toFixed(2);
    up('osd',{tid:uuid(),bid:uuid(),timestamp:clock.now(),gateway,data:{latitude:+ac.latitude.toFixed(7),longitude:+ac.longitude.toFixed(7),
      height,elevation:+ac.elevation.toFixed(2),attitude_head:ac.heading,horizontal_speed:ac.target?ac.speed:0,vertical_speed:0,
      mode_code:drcState===2?17:ac.mode,home_latitude:home.latitude,home_longitude:home.longitude,
      [PAYLOAD]:{payload_index:PAYLOAD,gimbal_pitch:+cam.pitch.toFixed(1),gimbal_roll:0,gimbal_yaw:+cam.yaw.toFixed(1),zoom_factor:cam.zoom.zoom}}},aircraftSn);
    if(++tick%10===0)rcOsd();
    if(drcState===2){
      up('drc/up',{method:'osd_info_push',seq:++upSeq,data:{latitude:ac.latitude,longitude:ac.longitude,height,attitude_head:ac.heading,speed_x:0,speed_y:0,speed_z:0,
        gimbal_pitch:+cam.pitch.toFixed(1),gimbal_roll:0,gimbal_yaw:+cam.yaw.toFixed(1)}});
      if(tick%5===0){
        up('drc/up',{method:'drc_camera_state_push',seq:++upSeq,data:{payload_index:PAYLOAD,camera_state:{camera_mode:cam.mode,
          recording_state:cam.recording?1:0,record_time:cam.recording?Math.round((clock.now()-cam.recordStart)/1000):0,photo_state:0,
          remain_photo_num:9999-cam.photos,remain_record_duration:7200,video_resolution:'1',photo_size:0,linkage_zoom_state:false},
          media_storage:{photo_storage_settings:['current'],video_storage_settings:['current']}}});
        up('drc/up',{method:'drc_camera_osd_info_push',seq:++upSeq,data:{payload_index:PAYLOAD,wide_lense:{wide_exposure_mode:1,wide_iso:0,
          wide_exposure_value:16},zoom_lense:{zoom_exposure_mode:1,zoom_focus_mode:2,zoom_factor:cam.zoom.zoom},
          ir_lense:{ir_zoom_factor:cam.zoom.ir,screen_split_enable:cam.split,thermal_global_temperature_min:4.5,thermal_global_temperature_max:38.2}}});
      }
    }
  }
  function receive(topic,raw){
    const msg=typeof raw==='string'||Buffer.isBuffer(raw)?JSON.parse(String(raw)):raw;
    if(topic===`thing/product/${gateway}/services`){
      const d=msg.data||{};
      switch(msg.method){
        case 'cloud_control_auth_request':
          reply(msg);
          clock.setTimeout(()=>event('cloud_control_auth_notify',{result:0,output:{status:approve?'ok':'failed'}},0),300);
          return;
        case 'cloud_control_release':reply(msg);return;
        case 'drc_mode_enter':reply(msg);drcState=2;rcOsd();return;
        case 'drc_mode_exit':reply(msg);drcState=0;rcOsd();return;
        case 'fly_to_point':{
          const p=d.points&&d.points[0];
          if(!p){reply(msg,1);return;}
          ac.target=p;ac.flyToId=d.fly_to_id;ac.speed=Math.max(1,d.max_speed||5);ac.mode=3;reply(msg);return;}
        case 'fly_to_point_stop':reply(msg);if(ac.flyToId)event(ac.takeoff?'takeoff_to_point_progress':'fly_to_point_progress',{fly_to_id:ac.flyToId,flight_id:ac.flyToId,status:'wayline_cancel',result:0});
          ac.target=null;ac.flyToId=null;ac.takeoff=false;return;
        case 'fly_to_point_update':reply(msg);if(d.points&&d.points[0])ac.target=d.points[0];return;
        case 'takeoff_to_point':reply(msg);ac.mode=4;ac.target={latitude:d.target_latitude,longitude:d.target_longitude,height:d.target_height};
          ac.speed=d.max_speed||5;ac.flyToId=d.flight_id;ac.takeoff=true;return;
        case 'return_home':reply(msg);ac.returning=true;ac.flyToId=null;ac.mode=9;
          event('return_home_info',{flight_id:uuid(),planned_path_points:[{latitude:home.latitude,longitude:home.longitude,height:ac.takeoffEllipsoid+30}]});return;
        case 'return_home_cancel':reply(msg);ac.returning=false;ac.target=null;ac.mode=3;return;
        default:reply(msg,1);return;
      }
    }
    if(topic===`thing/product/${gateway}/drc/down`){
      if(drcState!==2)return;
      if(msg.method==='heart_beat')up('drc/up',{method:'heart_beat',seq:msg.seq,data:{timestamp:msg.data&&msg.data.timestamp}});
      else if(msg.method==='stick_control'){ac.stick=msg.data;ac.stickAt=clock.now();}
      else if(['drone_emergency_stop','drc_force_landing','drc_emergency_landing'].includes(msg.method)){
        ac.target=null;ac.flyToId=null;ac.stick=null;
        if(msg.method!=='drone_emergency_stop'){ac.elevation=0;ac.mode=0;}
        up('drc/up',{method:msg.method,seq:msg.seq,data:{result:0}});
      }else if(msg.method==='drc_initial_state_subscribe')drcReply(msg);
      else if(msg.method&&msg.method.startsWith('drc_')){
        const d=msg.data||{};
        if(msg.method!=='drc_camera_screen_drag'&&d.payload_index!==PAYLOAD){drcReply(msg,1);return;}
        switch(msg.method){
          case 'drc_camera_screen_drag':cam.drag=d;cam.dragAt=clock.now();return;          // no reply needed for the stream
          case 'drc_camera_mode_switch':cam.mode=d.camera_mode;break;
          case 'drc_camera_photo_take':cam.photos++;
            up('drc/up',{method:'drc_camera_photo_info_push',seq:++upSeq,data:{status:'ok',result:0,countdown_time:0}});break;
          case 'drc_camera_recording_start':if(cam.mode!==1){drcReply(msg,1);return;}cam.recording=true;cam.recordStart=clock.now();break;
          case 'drc_camera_recording_stop':cam.recording=false;break;
          case 'drc_camera_focal_length_set':cam.zoom[d.camera_type]=d.zoom_factor;break;
          case 'drc_gimbal_reset':if(d.reset_mode===0){cam.pitch=0;cam.yaw=0;}else if(d.reset_mode===1||d.reset_mode===3)cam.pitch=-90;else cam.yaw=0;break;
          case 'drc_camera_screen_split':cam.split=d.enable;break;
          case 'drc_ir_metering_mode_set':cam.irMode=d.mode;break;
          case 'drc_camera_look_at':cam.pitch=-45;break;
          default:break;
        }
        drcReply(msg);
      }
    }
  }
  return {
    receive,
    start(hz=5){if(!timer){timer=clock.setInterval(()=>step(1/hz),1000/hz);step(0);}},
    stop(){if(timer){clock.clearInterval(timer);timer=null;}},
    state:()=>({...ac,drcState,camera:{...cam},home:{...home},heightEllipsoid:ac.takeoffEllipsoid+ac.elevation}),
    // Topology for SkyHub's registry: RC Plus 2 (2-174-0) with a Matrice 4T (0-99-1) as sub-device (sys/product/{gateway}/status).
    announce(){publish(`sys/product/${gateway}/status`,{tid:uuid(),bid:uuid(),timestamp:clock.now(),method:'update_topo',
      data:{domain:'2',type:174,sub_type:0,device_secret:'x',nonce:'x',thing_version:'1.1.2',
        sub_devices:[{sn:aircraftSn,domain:'0',type:99,sub_type:1,index:'A',device_secret:'x',nonce:'x',thing_version:'1.1.2'}]}});},
    gateway,aircraftSn
  };
}
module.exports={createRcSimulator};
