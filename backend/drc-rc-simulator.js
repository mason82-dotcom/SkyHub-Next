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
  let drcState=0,timer=null,upSeq=0;
  const up=(channel,msg,sn=gateway)=>publish(`thing/product/${sn}/${channel}`,msg);
  const reply=(m,result=0)=>up('services_reply',{tid:m.tid,bid:m.bid,timestamp:clock.now(),method:m.method,data:{result,output:{status:'ok'}}});
  const event=(method,data,needReply=1)=>up('events',{tid:uuid(),bid:uuid(),timestamp:clock.now(),method,need_reply:needReply,gateway,data});
  const state=data=>up('state',{tid:uuid(),bid:uuid(),timestamp:clock.now(),gateway,data},gateway);
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
    const height=+(ac.takeoffEllipsoid+ac.elevation).toFixed(2);
    up('osd',{tid:uuid(),bid:uuid(),timestamp:clock.now(),gateway,data:{latitude:+ac.latitude.toFixed(7),longitude:+ac.longitude.toFixed(7),
      height,elevation:+ac.elevation.toFixed(2),attitude_head:ac.heading,horizontal_speed:ac.target?ac.speed:0,vertical_speed:0,
      mode_code:drcState===2?17:ac.mode,home_latitude:home.latitude,home_longitude:home.longitude}},aircraftSn);
    if(drcState===2){
      up('drc/up',{method:'osd_info_push',seq:++upSeq,data:{latitude:ac.latitude,longitude:ac.longitude,height,attitude_head:ac.heading,speed_x:0,speed_y:0,speed_z:0}});
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
        case 'drc_mode_enter':reply(msg);drcState=2;state({drc_state:2});return;
        case 'drc_mode_exit':reply(msg);drcState=0;state({drc_state:0});return;
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
      }else if(msg.method==='drc_initial_state_subscribe')up('drc/up',{method:msg.method,seq:msg.seq,data:{result:0}});
    }
  }
  return {
    receive,
    start(hz=5){if(!timer){timer=clock.setInterval(()=>step(1/hz),1000/hz);step(0);}},
    stop(){if(timer){clock.clearInterval(timer);timer=null;}},
    state:()=>({...ac,drcState,home:{...home},heightEllipsoid:ac.takeoffEllipsoid+ac.elevation}),
    // Topology for SkyHub's registry: RC Plus 2 (2-174-0) with a Matrice 4T (0-99-1) as sub-device (sys/product/{gateway}/status).
    announce(){publish(`sys/product/${gateway}/status`,{tid:uuid(),bid:uuid(),timestamp:clock.now(),method:'update_topo',
      data:{domain:'2',type:174,sub_type:0,device_secret:'x',nonce:'x',thing_version:'1.1.2',
        sub_devices:[{sn:aircraftSn,domain:'0',type:99,sub_type:1,index:'A',device_secret:'x',nonce:'x',thing_version:'1.1.2'}]}});},
    gateway,aircraftSn
  };
}
module.exports={createRcSimulator};
