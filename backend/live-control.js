'use strict';
// Livestream on demand over MQTT (DJI Cloud API 1.18, pilot-to-cloud):
//   …/mqtt/dji-rc-plus-2/live.html and …/mqtt/rc-pro/live.html
//   thing/product/{gateway_sn}/services  live_start_push {url_type, url, video_id, video_quality}
//                                       live_stop_push {video_id} · live_set_quality {video_id, video_quality}
//                                       live_lens_change {video_id, video_type}   (RC Pro only; the RC Plus 2 changes the
//                                       lens with drc_live_lens_change on drc/down, i.e. only in live control → drc-payload.js)
//   → services_reply {tid, bid, method, data:{result}} (non-zero = error)
//   state (push mode 1): live_capacity {device_list[{sn, camera_list[{camera_index, video_list[{video_index, video_type,
//                        switchable_video_types}]}]}]} and live_status [{video_id, video_type, video_quality, status, error_status}]
// video_id = {aircraft sn}/{camera_index type-subtype-gimbalindex}/{video_index}.
// Pilot 2 accepts cloud requests only with the liveshare publish type video-on-demand or video-demand-aux-manual (jsbridge);
// SkyHub uses video-demand-aux-manual so the pilot can still change or stop the stream on the RC.
// Only RTMP (url_type 1) to SkyHub's own MediaMTX relay (live-stream.js); no external streaming targets.
const crypto=require('node:crypto');

const QUALITY=Object.freeze({0:'Automatisch',1:'Flüssig (960×540)',2:'SD (1280×720, 1 Mbit/s)',3:'HD (1280×720, 1,5 Mbit/s)',4:'Full HD (1920×1080, 3 Mbit/s)'});
const VIDEO_ID=/^[A-Za-z0-9_-]{4,64}\/\d{1,4}-\d{1,4}-\d{1,2}\/[a-z]{1,16}-\d{1,2}$/;
const LENS=['wide','zoom','ir'];
// RC Pro uses live_lens_change on services; video_type values from the RC Pro page: normal / wide / zoom / ir.
const RC_PRO_LENS=['normal','wide','zoom','ir'];
// overview/product-support: DJI RC Plus 2 Enterprise 2-174-0, DJI RC Pro Enterprise 2-144-0 (Mavic 3 Enterprise series).
const GATEWAY_MODELS=Object.freeze({'2-174-0':'rc-plus-2','2-144-0':'rc-pro'});

class LiveControlError extends Error{constructor(message,status=409){super(message);this.status=status;}}

function liveControlConfig(env=process.env,liveSettings){
  if(env.SKYHUB_LIVE_CONTROL_ENABLED!=='true')return {enabled:false,issue:null};
  if(!liveSettings||!liveSettings.enabled)return {enabled:false,issue:'SKYHUB_LIVE_CONTROL_ENABLED braucht den Livestream-Relay (SKYHUB_LIVE_ENABLED)'};
  const url=env.SKYHUB_LIVE_CONTROL_MQTT_URL||env.SKYHUB_DRC_MQTT_URL,user=env.SKYHUB_LIVE_CONTROL_MQTT_USERNAME||env.SKYHUB_DRC_MQTT_USERNAME,
    pass=env.SKYHUB_LIVE_CONTROL_MQTT_PASSWORD||env.SKYHUB_DRC_MQTT_PASSWORD;
  if(!/^mqtts?:\/\/\S+$/.test(url||'')||!user||!pass)return {enabled:false,issue:'MQTT-Zugang mit Senderecht auf services fehlt (SKYHUB_DRC_MQTT_* oder SKYHUB_LIVE_CONTROL_MQTT_*)'};
  return {enabled:true,issue:null,mqtt:{url,username:user,password:pass}};
}

// live_capacity (state) → flat list of selectable streams of the aircraft behind a gateway.
function streamsFromCapacity(capacity){
  const out=[];
  for(const dev of Array.isArray(capacity?.device_list)?capacity.device_list:[]){
    if(typeof dev?.sn!=='string')continue;
    for(const cam of Array.isArray(dev.camera_list)?dev.camera_list:[]){
      if(typeof cam?.camera_index!=='string')continue;
      for(const v of Array.isArray(cam.video_list)?cam.video_list:[]){
        if(typeof v?.video_index!=='string')continue;
        const id=dev.sn+'/'+cam.camera_index+'/'+v.video_index;
        if(!VIDEO_ID.test(id))continue;
        out.push({videoId:id,sn:dev.sn,cameraIndex:cam.camera_index,videoIndex:v.video_index,videoType:typeof v.video_type==='string'?v.video_type:null,
          switchable:Array.isArray(v.switchable_video_types)?v.switchable_video_types.filter(x=>typeof x==='string').slice(0,8):[]});
      }
    }
  }
  return out;
}
function statusList(live){
  return (Array.isArray(live)?live:[]).filter(x=>x&&typeof x.video_id==='string').map(x=>({videoId:x.video_id,
    videoType:typeof x.video_type==='string'?x.video_type:null,quality:Number.isInteger(x.video_quality)?x.video_quality:null,
    live:x.status===1,error:Number.isInteger(x.error_status)&&x.error_status!==0?x.error_status:null}));
}

function modelKeyOf(m){return m&&m.domain!==undefined&&m.domain!==null?[m.domain,m.type,m.subType].join('-'):m&&m.type===174?'2-174-0':null;}

function createLiveControl({config,liveSettings,registry,mqttConnect,express,audit=()=>{},timeoutMs=10000,log=console}){
  const pending=new Map();               // tid → {resolve, reject, timer, method, gateway}
  const client=mqttConnect(config.mqtt.url,{username:config.mqtt.username,password:config.mqtt.password,
    clientId:'skyhub-live-'+crypto.randomBytes(4).toString('hex'),reconnectPeriod:3000,clean:true});
  let connected=false;
  client.on('connect',()=>{connected=true;client.subscribe('thing/product/+/services_reply',{qos:1},err=>{if(err)log.error('[live control] subscribe:',err.message);});});
  client.on('close',()=>{connected=false;});
  client.on('error',err=>log.error('[live control] broker:',err.message));
  client.on('message',(topic,payload)=>{
    const m=/^thing\/product\/([A-Za-z0-9_-]{1,64})\/services_reply$/.exec(topic);
    if(!m)return;
    let msg;try{msg=JSON.parse(payload.toString('utf8'));}catch{return;}
    const p=msg&&pending.get(msg.tid);
    if(!p||p.gateway!==m[1]||p.method!==msg.method)return;
    pending.delete(msg.tid);clearTimeout(p.timer);
    const result=msg.data&&Number.isInteger(msg.data.result)?msg.data.result:null;
    if(result===0)p.resolve({result});else p.reject(new LiveControlError('Pilot 2 lehnt ab (Code '+result+')',502));
  });

  function gateways(){
    const all=registry.snapshot();
    return all.filter(d=>!d.gatewaySn&&GATEWAY_MODELS[modelKeyOf(d.model)]).map(g=>{
      const st=g.deviceProperties?.state||{};
      const aircraft=all.find(d=>d.gatewaySn===g.sn&&d.sn!==g.sn);
      return {sn:g.sn,model:g.modelName,kind:GATEWAY_MODELS[modelKeyOf(g.model)],online:Boolean(g.online),
        aircraft:aircraft?{sn:aircraft.sn,model:aircraft.modelName,online:Boolean(aircraft.online)}:null,
        streams:streamsFromCapacity(st.live_capacity),status:statusList(st.live_status)};
    });
  }
  function gatewayFor(sn){
    const g=gateways().find(x=>x.sn===sn);
    if(!g)throw new LiveControlError('Fernsteuerung unbekannt',404);
    if(!g.online)throw new LiveControlError('Fernsteuerung nicht verbunden');
    return g;
  }
  function stream(g,videoId){
    if(typeof videoId!=='string'||!VIDEO_ID.test(videoId))throw new LiveControlError('video_id ungültig',400);
    // Only streams the RC announced in live_capacity (the aircraft behind this RC).
    if(!g.streams.some(s=>s.videoId===videoId))throw new LiveControlError('Diese Kamera meldet die Fernsteuerung nicht (live_capacity)');
    return videoId;
  }
  const quality=q=>{if(!Number.isInteger(q)||!(q in QUALITY))throw new LiveControlError('Qualität 0–4',400);return q;};

  function service(gateway,method,data,operator){
    if(!connected)return Promise.reject(new LiveControlError('MQTT-Broker nicht verbunden',503));
    const tid=crypto.randomUUID(),bid=crypto.randomUUID();
    audit({gateway,action:'live',method,operator,data:method==='live_start_push'?{...data,url:'rtmp://…/pilot (Zugangsdaten verborgen)'}:data});
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{pending.delete(tid);reject(new LiveControlError('Keine Antwort von Pilot 2 ('+method+')',504));},timeoutMs);
      pending.set(tid,{resolve,reject,timer,method,gateway});
      client.publish('thing/product/'+gateway+'/services',JSON.stringify({tid,bid,timestamp:Date.now(),method,data}),{qos:1});
    });
  }
  const rtmpUrl=()=>liveSettings.rtmpOrigin+'/pilot?user=skyhub-pilot&pass='+liveSettings.publishPass;

  async function start(gw,{videoId,videoQuality=0},operator){
    const g=gatewayFor(gw);
    const others=g.status.filter(s=>s.live&&s.videoId!==videoId);
    if(others.length)throw new LiveControlError('Es läuft schon ein Stream ('+others[0].videoId+'); erst stoppen – der Relay hat nur einen Kanal');
    return service(g.sn,'live_start_push',{url_type:1,url:rtmpUrl(),video_id:stream(g,videoId),video_quality:quality(videoQuality)},operator);
  }
  async function stop(gw,{videoId},operator){
    const g=gatewayFor(gw);
    if(typeof videoId!=='string'||!VIDEO_ID.test(videoId))throw new LiveControlError('video_id ungültig',400);
    return service(g.sn,'live_stop_push',{video_id:videoId},operator);
  }
  async function setQuality(gw,{videoId,videoQuality},operator){
    const g=gatewayFor(gw);
    return service(g.sn,'live_set_quality',{video_id:stream(g,videoId),video_quality:quality(videoQuality)},operator);
  }
  async function lens(gw,{videoId,videoType},operator){
    const g=gatewayFor(gw);
    if(g.kind!=='rc-pro')throw new LiveControlError('Objektivwechsel mit der RC Plus 2 nur in der Live-Steuerung (drc_live_lens_change)');
    const s=g.streams.find(x=>x.videoId===stream(g,videoId));
    if(!RC_PRO_LENS.includes(videoType))throw new LiveControlError('Objektiv: '+RC_PRO_LENS.join(', '),400);
    if(s.switchable.length&&!s.switchable.includes(videoType))throw new LiveControlError('Objektiv '+videoType+' für diesen Stream nicht umschaltbar');
    return service(g.sn,'live_lens_change',{video_id:videoId,video_type:videoType},operator);
  }

  const router=express.Router();
  router.use((req,res,next)=>{res.set('Cache-Control','no-store');next();});
  router.get('/',(req,res)=>res.json({broker:connected?'verbunden':'getrennt',qualities:QUALITY,gateways:gateways()}));
  const act=fn=>async(req,res)=>{
    const op=req.get('X-SkyHub-Operator');
    if(!/^[A-Za-z0-9_-]{8,64}$/.test(op||''))return res.status(400).json({error:'Bediener-Kennung fehlt'});
    const b=req.body&&typeof req.body==='object'?req.body:{};
    try{await fn(String(b.gateway||''),b,op);res.json({ok:true,gateways:gateways()});}
    catch(err){
      const code=err instanceof LiveControlError?err.status:500;
      if(code===500)log.error('[live control]',err);
      res.status(code).json({error:code===500?'Interner Fehler':err.message});
    }
  };
  router.post('/start',act((g,b,op)=>start(g,{videoId:b.videoId,videoQuality:b.videoQuality??0},op)));
  router.post('/stop',act((g,b,op)=>stop(g,{videoId:b.videoId},op)));
  router.post('/quality',act((g,b,op)=>setQuality(g,{videoId:b.videoId,videoQuality:b.videoQuality},op)));
  router.post('/lens',act((g,b,op)=>lens(g,{videoId:b.videoId,videoType:b.videoType},op)));

  return {router,gateways,start,stop,setQuality,lens,shutdown:()=>{for(const p of pending.values())clearTimeout(p.timer);client.end(true);}};
}

module.exports={liveControlConfig,createLiveControl,streamsFromCapacity,statusList,QUALITY,LiveControlError,LENS};
