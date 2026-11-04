'use strict';
// Wiring of the live flight control (DRC) for one pinned DJI RC Plus 2 + Matrice 4E/4T: configuration, a dedicated MQTT
// connection, the registry adapter, the audit trail, the HTTP API and the Socket.IO namespace for lease and sticks.
// Off by default. Control actions need either the home-LAN same-origin access (req.skyhubLan / lanSocket; decision 04.11.2026,
// no token field in the UI) or the DRC token (X-SkyHub-DRC-Token) on top of the normal SkyHub access.
const crypto=require('node:crypto');
const P=require('./drc-protocol');
const PL=require('./drc-payload');
const {createDrcSession,DrcError}=require('./drc-session');

const AUDIT_SCHEMA=`CREATE TABLE IF NOT EXISTS drc_audit(
  id bigserial PRIMARY KEY, at timestamptz NOT NULL DEFAULT now(), gateway text NOT NULL, action text NOT NULL, detail jsonb NOT NULL)`;

function drcConfig(env=process.env){
  if(env.SKYHUB_DRC_ENABLED!=='true')return {enabled:false,issue:null};
  const need=(k,test,msg)=>{if(!test(env[k]))throw new Error(k+': '+msg);return env[k];};
  try{
    const token=need('SKYHUB_DRC_TOKEN',v=>typeof v==='string'&&v.length>=32,'mindestens 32 Zeichen');
    for(const other of ['SKYHUB_VIEW_TOKEN','SKYHUB_MISSION_RELEASE_TOKEN'])
      if(env[other]&&env[other]===token)throw new Error('SKYHUB_DRC_TOKEN muss sich von '+other+' unterscheiden');
    const gateway=need('SKYHUB_DRC_GATEWAY_SN',v=>/^[A-Za-z0-9_-]{4,64}$/.test(v||''),'Seriennummer der RC Plus 2 erwartet');
    const mqttUrl=need('SKYHUB_DRC_MQTT_URL',v=>/^mqtts?:\/\/[^\s]+$/.test(v||''),'mqtt://host:port erwartet');
    const num=(k,def,min,max)=>{
      if(env[k]===undefined||env[k]==='')return def;
      const v=Number(env[k]);if(!Number.isFinite(v)||v<min||v>max)throw new Error(k+' muss zwischen '+min+' und '+max+' liegen');return v;};
    return {enabled:true,issue:null,token,gateway,
      mqtt:{url:mqttUrl,username:need('SKYHUB_DRC_MQTT_USERNAME',v=>!!v,'fehlt'),password:need('SKYHUB_DRC_MQTT_PASSWORD',v=>!!v,'fehlt')},
      // Broker the RC connects to for the DRC link (drc_mode_enter.mqtt_broker), as seen from the RC.
      broker:{address:need('SKYHUB_DRC_BROKER_ADDRESS',v=>/^[A-Za-z0-9.-]+:\d{1,5}$/.test(v||''),'host:port erwartet'),
        username:need('SKYHUB_DRC_BROKER_USERNAME',v=>!!v,'fehlt'),password:need('SKYHUB_DRC_BROKER_PASSWORD',v=>!!v,'fehlt'),
        enableTls:env.SKYHUB_DRC_BROKER_TLS==='true'},
      limits:{maxSpeedMs:num('SKYHUB_DRC_MAX_SPEED_MS',10,1,15),maxHeightAboveTakeoffM:num('SKYHUB_DRC_MAX_HEIGHT_M',120,20,120),
        maxDistanceM:num('SKYHUB_DRC_MAX_DISTANCE_M',2000,50,2000),stickScale:num('SKYHUB_DRC_STICK_SCALE',0.5,0.1,1)},
      userCallsign:(env.SKYHUB_DRC_CALLSIGN||'SkyHub Leitstand').slice(0,40)};
  }catch(err){return {enabled:false,issue:err.message};}
}

function tokenOk(presented,secret){
  if(typeof presented!=='string'||!presented)return false;
  const a=crypto.createHash('sha256').update(presented).digest(),b=crypto.createHash('sha256').update(secret).digest();
  return crypto.timingSafeEqual(a,b);
}

// Model key domain-type-subtype. dji-rc-plus-2/device (1.18) lists update_topo WITHOUT domain; a missing domain is only
// filled in for the exact RC Plus 2 (type 174 → 2) and Matrice 4 (type 99 → 0), never guessed for anything else.
function modelKey(model,role){
  if(!model)return null;
  let domain=model.domain===null||model.domain===undefined?null:String(model.domain);
  if(domain===null&&role==='gateway'&&model.type===174)domain='2';
  if(domain===null&&role==='aircraft'&&model.type===99)domain='0';
  return [domain,model.type,model.subType].join('-');
}
// Registry → what the session needs about the aircraft behind the pinned RC.
function aircraftFromRegistry(registry,gateway){
  return ()=>{
    const rc=registry.get(gateway);
    if(!rc)return null;
    if(modelKey(rc.model,'gateway')!==P.GATEWAY_MODEL)return null;     // only an RC Plus 2 may be controlled
    const child=registry.snapshot().find(d=>d.gatewaySn===gateway&&d.sn!==gateway&&modelKey(d.model,'aircraft')?.startsWith('0-'));
    if(!child||!child.online||child.aircraftConnected===false)return null;
    const t=child.telemetry||{};
    // m4-series/properties: OSD object {type-subtype-gimbalindex} with gimbal_pitch/roll/yaw, payload_index, zoom_factor.
    const g=(child.deviceProperties?.osd?.payload_gimbals||[]).find(x=>x&&typeof x.payload_index==='string')||null;
    return {sn:child.sn,modelKey:modelKey(child.model,'aircraft'),modelName:child.modelName,
      payloadIndex:g?g.payload_index:null,
      gimbal:g?{pitch:g.gimbal_pitch??null,roll:g.gimbal_roll??null,yaw:g.gimbal_yaw??null,zoomFactor:g.zoom_factor??null}:null,
      heightEllipsoid:t.heightEllipsoid,heightAboveTakeoff:t.altitude,modeCode:child.modeCode,
      position:Number.isFinite(t.latitude)&&Number.isFinite(t.longitude)&&child.positionFresh?{latitude:t.latitude,longitude:t.longitude}:null,
      home:child.home||null};
  };
}

function createDrcRuntime({config,registry,pool,io,express,mqttConnect,socketAuth,lanSocket=()=>false,log=console}){
  const audit=entry=>{
    const {gateway,action,...detail}=entry;
    log.log('[drc] '+JSON.stringify(entry));
    if(pool)pool.query('INSERT INTO drc_audit(gateway,action,detail) VALUES ($1,$2,$3)',[gateway,action,JSON.stringify(detail)])
      .catch(err=>log.error('[drc] audit:',err.message));
  };
  if(pool)pool.query(AUDIT_SCHEMA).catch(err=>log.error('[drc] audit schema:',err.message));
  const gw=config.gateway;
  const topics={services:`thing/product/${gw}/services`,drcDown:`thing/product/${gw}/drc/down`,eventsReply:`thing/product/${gw}/events_reply`};
  const client=mqttConnect(config.mqtt.url,{username:config.mqtt.username,password:config.mqtt.password,
    clientId:'skyhub-drc-'+crypto.randomBytes(4).toString('hex'),reconnectPeriod:2000,clean:true});
  let connected=false;
  const publish=(topic,msg,qos)=>{
    if(!connected)throw new Error('Broker nicht verbunden');
    client.publish(topic,JSON.stringify(msg),{qos,retain:false});
  };
  const nsp=io.of('/drc');
  let lastEmit=0,pendingEmit=null;
  const broadcast=()=>{
    const t=Date.now();
    if(t-lastEmit<200){if(!pendingEmit)pendingEmit=setTimeout(()=>{pendingEmit=null;broadcast();},200);return;}
    lastEmit=t;nsp.emit('drc',status());
  };
  const session=createDrcSession({gateway:gw,aircraft:aircraftFromRegistry(registry,gw),limits:config.limits,audit,
    onChange:broadcast,userCallsign:config.userCallsign,
    // services and events_reply: QoS 1 (must arrive); DRC down (sticks 10 Hz, heartbeat): QoS 0 as DJI's latency-oriented link.
    publishService:(g,m)=>publish(topics.services,m,1),
    publishDrc:(g,m)=>publish(topics.drcDown,m,0),
    publishEventsReply:(g,m)=>publish(topics.eventsReply,m,1),
    broker:()=>({...config.broker,clientId:('drc-'+gw).slice(0,64),expireTime:Math.floor(Date.now()/1000)+3600})});
  client.on('connect',()=>{
    connected=true;
    // osd of the RC: drc_state is pushMode 0 (dji-rc-plus-2/properties, 1.18). Only the RC's own serial, not the aircraft's.
    client.subscribe([`thing/product/${gw}/services_reply`,`thing/product/${gw}/events`,`thing/product/${gw}/osd`,`thing/product/${gw}/state`,
      `thing/product/${gw}/drc/up`],{qos:0},
      err=>{if(err)log.error('[drc] subscribe failed:',err.message);});
    broadcast();
  });
  client.on('close',()=>{if(connected){connected=false;audit({gateway:gw,action:'broker-disconnected'});broadcast();}});
  client.on('error',err=>log.error('[drc] broker:',err.message));
  client.on('message',(topic,payload)=>session.onUp(P.parseUp(topic,payload)));

  function status(){
    const a=aircraftFromRegistry(registry,gw)();
    return {...session.snapshot(),broker:connected?'verbunden':'getrennt',
      aircraft:a?{sn:a.sn,model:a.modelName,modeCode:a.modeCode,heightAboveTakeoff:a.heightAboveTakeoff,position:a.position,home:a.home,
        gimbal:a.gimbal,payload:(()=>{const c=PL.payloadContext(a.modelKey,a.payloadIndex);return c?{name:c.name,cameraTypes:c.cameraTypes}:null;})()}:null};
  }

  // --- HTTP API -----------------------------------------------------------------------------------------------------------
  const router=express.Router();
  router.use((req,res,next)=>{
    res.set('Cache-Control','no-store');
    if(req.skyhubLan!==true&&!tokenOk(req.get('X-SkyHub-DRC-Token'),config.token)){
      audit({gateway:gw,action:'denied',path:req.path});
      return res.status(403).json({error:'Live-Steuerung nur im Heimnetz über die SkyHub-Seite (oder mit Steuer-Token)'});
    }
    const op=req.get('X-SkyHub-Operator');
    if(req.method!=='GET'&&!/^[A-Za-z0-9_-]{8,64}$/.test(op||''))return res.status(400).json({error:'Bediener-Kennung fehlt'});
    req.operator=op;
    // Who sent it: access path (home LAN without token, or token) and client address, for every command.
    if(req.method!=='GET')audit({gateway:gw,action:'request',path:req.path,operator:op,via:req.skyhubLan===true?'lan':'token',
      from:String(req.ip||req.socket?.remoteAddress||'?').slice(0,64)});
    next();
  });
  const act=fn=>async(req,res)=>{
    try{const out=await fn(req);res.json({ok:true,...(out&&typeof out==='object'?{result:out}:{}),status:status()});}
    catch(err){
      const code=err instanceof DrcError||err instanceof P.DrcInputError?err.status:500;
      if(code===500)log.error('[drc]',err);
      res.status(code).json({error:code===500?'Interner Fehler':err.message,status:status()});
    }
  };
  const body=req=>req.body&&typeof req.body==='object'?req.body:{};
  router.get('/status',(req,res)=>res.json(status()));
  router.post('/auth/request',act(req=>session.requestAuthorization(req.operator)));
  router.post('/release',act(req=>session.release(req.operator)));
  router.post('/live/enter',act(req=>session.enterLiveControl(req.operator)));
  router.post('/live/exit',act(req=>session.exitLiveControl(req.operator)));
  router.post('/flyto',act(req=>{const b=body(req);return session.flyTo(req.operator,{latitude:b.latitude,longitude:b.longitude,
    heightAboveTakeoff:b.heightAboveTakeoff,maxSpeed:b.maxSpeed});}));
  router.post('/flyto/stop',act(req=>session.flyToStop(req.operator)));
  router.post('/takeoff',act(req=>{const b=body(req);
    if(b.confirm!=='ABHEBEN')throw new DrcError('Abheben muss mit confirm="ABHEBEN" bestätigt werden',400);
    return session.takeoff(req.operator,{latitude:b.latitude,longitude:b.longitude,heightAboveTakeoff:b.heightAboveTakeoff,
      rthAltitude:b.rthAltitude,maxSpeed:b.maxSpeed});}));
  router.post('/return-home',act(req=>session.returnHome(req.operator)));
  router.post('/return-home/cancel',act(req=>session.returnHomeCancel(req.operator)));
  // Camera / gimbal (drc-payload.js COMMANDS); look-at uses a map point and a height above take-off.
  router.post('/payload/look-at',act(req=>{const b=body(req);return session.lookAt(req.operator,{latitude:b.latitude,longitude:b.longitude,
    heightAboveTakeoff:b.heightAboveTakeoff,locked:b.locked});}));
  router.post('/payload/:command',act(req=>session.payload(req.operator,req.params.command,body(req))));
  router.post('/emergency-stop',act(req=>session.emergencyStop(req.operator)));
  router.post('/landing',act(req=>{const b=body(req);
    if(!['force','emergency'].includes(b.kind))throw new DrcError('kind force oder emergency',400);
    if(b.confirm!=='LANDEN')throw new DrcError('Landung muss mit confirm="LANDEN" bestätigt werden',400);
    return session.landing(req.operator,b.kind);}));

  // --- Socket.IO: lease keep-alive and sticks (high rate, no HTTP overhead) --------------------------------------------
  if(typeof socketAuth==='function')nsp.use(socketAuth);           // normal SkyHub access first, then the DRC token
  nsp.use((socket,next)=>(lanSocket(socket.request)||tokenOk(socket.handshake.auth?.drcToken,config.token))&&
    /^[A-Za-z0-9_-]{8,64}$/.test(socket.handshake.auth?.operator||'')?next():next(new Error('Unauthorized')));
  nsp.on('connection',socket=>{
    const op=socket.handshake.auth.operator;
    audit({gateway:gw,action:'socket',operator:op,from:String(socket.handshake.headers['x-forwarded-for']||socket.handshake.address||'?').slice(0,64)});
    socket.emit('drc',status());
    socket.on('lease',(ack)=>{
      try{session.acquire(op);if(typeof ack==='function')ack({ok:true});}
      catch(err){if(typeof ack==='function')ack({ok:false,error:err.message});}
    });
    socket.on('stick',(v)=>{
      try{session.acquire(op);session.stickInput(op,v||{});}
      catch(err){socket.emit('drc-error',err.message);}
    });
    socket.on('gimbal',(v)=>{
      try{session.acquire(op);session.gimbalDrag(op,v&&typeof v==='object'?{pitch:v.pitch,yaw:v.yaw}:{});}
      catch(err){socket.emit('drc-error',err.message);}
    });
    socket.on('emergency-stop',()=>{try{session.emergencyStop(op);}catch(err){socket.emit('drc-error',err.message);}});
    // A closing socket does not release immediately: the lease timeout and fail-safe decide (brief reconnects survive).
  });

  async function shutdown(){
    try{await Promise.race([session.shutdown(),new Promise(r=>setTimeout(r,1500))]);}finally{client.end(true);}
  }
  return {router,status,session,shutdown};
}

module.exports={drcConfig,createDrcRuntime,aircraftFromRegistry,modelKey,tokenOk,AUDIT_SCHEMA};
