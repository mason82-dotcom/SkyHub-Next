'use strict';
// Live flight control session for ONE pinned DJI RC Plus 2 + Matrice 4E/4T (DJI Cloud API 1.18, see drc-protocol.js).
//
// Safety model (docs/risikoanalyse-drc-matrice4t-2026-11-04.md):
// - During cloud control the RC sticks, return-home and emergency-stop buttons are INVALID (DJI). The device leaves DRC only
//   after one minute without heartbeat. So SkyHub must hand control back actively and early.
// - One operator holds a lease (heartbeat from the browser at least every 500 ms). Lease lost for more than leaseMs:
//   sticks go neutral, a running fly-to is stopped, and after releaseAfterMs DRC is exited and cloud control released,
//   so the pilot at the RC gets sticks and buttons back. The same happens on shutdown and on any unanswered command storm.
// - Stick input older than stickStaleMs is replaced by neutral; sticks are sent at 10 Hz (DJI: 5–10 Hz, no ack).
// - Emergency stop (DRC drone_emergency_stop) is accepted from any authenticated operator, with or without lease.
// - Every command and every fail-safe action goes to the audit log.
const P=require('./drc-protocol');
const PL=require('./drc-payload');

const PHASES=Object.freeze(['idle','auth_pending','authorized','drc_pending','drc_active']);
const DEFAULTS=Object.freeze({replyTimeoutMs:10000,leaseMs:1500,releaseAfterMs:3000,stickHz:10,stickStaleMs:300,heartbeatMs:1000,
  upLinkLostMs:5000,payloadReplyTimeoutMs:5000,dragHz:10,dragStaleMs:300,stickScale:0.5,maxSpeedMs:10,maxHeightAboveTakeoffM:120,maxDistanceM:2000,minHeightAboveTakeoffM:20});

class DrcError extends Error{constructor(message,status=409){super(message);this.status=status;}}

function createDrcSession({gateway,publishService,publishDrc,publishEventsReply=()=>{},aircraft,broker,limits={},audit=()=>{},onChange=()=>{},
  clock={now:()=>Date.now(),setInterval,clearInterval,setTimeout,clearTimeout},userId='skyhub',userCallsign='SkyHub Leitstand'}){
  if(typeof gateway!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(gateway))throw new Error('DRC: gateway serial required');
  const L={...DEFAULTS,...limits};
  const s={phase:'idle',lease:null,lastStick:null,stickSending:false,seq:0,pending:new Map(),lastUpHeartbeat:null,latencyMs:null,
    osd:null,flyTo:null,takeoff:null,returnHome:null,joystickInvalid:null,failsafe:null,lastError:null,
    pendingDrc:new Map(),camera:{state:null,lens:null,photo:null,lastCommand:null},lastDrag:null};
  let stickTimer=null,heartbeatTimer=null,leaseTimer=null,releaseTimer=null,dragTimer=null;

  const now=()=>clock.now();
  const log=(action,detail={})=>audit({ts:new Date(now()).toISOString(),gateway,action,...detail});
  function setPhase(phase,why){
    if(s.phase===phase)return;
    log('phase',{from:s.phase,to:phase,why});
    s.phase=phase;
    if(phase==='drc_pending'||phase==='drc_active')startHeartbeat();else stopHeartbeat();
    if(phase!=='drc_active'){stopSticks();stopDrag(false);rejectPendingDrc('DRC-Kanal beendet');}
    changed();
  }
  const changed=()=>onChange(snapshot());

  // --- requests with reply ------------------------------------------------------------------------------------------------
  function service(method,data){
    const msg=P.serviceMessage(method,data,{timestamp:now()});
    return new Promise((resolve,reject)=>{
      const timer=clock.setTimeout(()=>{s.pending.delete(msg.tid);reject(new DrcError(method+': keine Antwort der Fernsteuerung',504));},L.replyTimeoutMs);
      s.pending.set(msg.tid,{method,resolve,reject,timer});
      try{publishService(gateway,msg);}
      catch(err){clock.clearTimeout(timer);s.pending.delete(msg.tid);reject(new DrcError(method+': Senden fehlgeschlagen ('+err.message+')',502));}
    }).then(reply=>{
      if(reply.result!==0)throw new DrcError(method+': von der Fernsteuerung abgelehnt (result '+reply.result+')',502);
      return reply;
    });
  }
  function drc(method,data){
    s.seq=(s.seq+1)%Number.MAX_SAFE_INTEGER;
    publishDrc(gateway,P.drcMessage(method,data,s.seq));
    return s.seq;
  }
  // DRC command with a reply on drc/up, matched by seq AND method (payload commands: data.result, non-zero = error).
  function drcRequest(method,data){
    return new Promise((resolve,reject)=>{
      let seq;
      try{seq=drc(method,data);}catch(err){reject(new DrcError(method+': Senden fehlgeschlagen ('+err.message+')',502));return;}
      const timer=clock.setTimeout(()=>{s.pendingDrc.delete(seq);reject(new DrcError(method+': keine Antwort des Fluggeräts',504));},L.payloadReplyTimeoutMs);
      s.pendingDrc.set(seq,{method,resolve,reject,timer});
    }).then(reply=>{
      if(reply.result!==0)throw new DrcError(method+': vom Fluggerät abgelehnt (result '+reply.result+')',502);
      return reply;
    });
  }
  function rejectPendingDrc(why){
    for(const [seq,p] of s.pendingDrc){clock.clearTimeout(p.timer);p.reject(new DrcError(p.method+': '+why,409));s.pendingDrc.delete(seq);}
  }

  // --- heartbeat (both directions, 1 Hz) --------------------------------------------------------------------------------
  function startHeartbeat(){
    if(heartbeatTimer)return;
    heartbeatTimer=clock.setInterval(()=>{try{drc('heart_beat',P.heartBeat(now()));}catch(err){s.lastError='Herzschlag: '+err.message;}},L.heartbeatMs);
  }
  function stopHeartbeat(){if(heartbeatTimer){clock.clearInterval(heartbeatTimer);heartbeatTimer=null;}}

  // --- operator lease and fail-safe -------------------------------------------------------------------------------------
  function acquire(operator){
    if(typeof operator!=='string'||!operator)throw new DrcError('Bediener-Kennung fehlt',400);
    const t=now();
    if(s.lease&&s.lease.operator!==operator&&s.lease.expiresAt>t)throw new DrcError('Ein anderer Bediener steuert gerade');
    const fresh=!s.lease||s.lease.operator!==operator;
    s.lease={operator,expiresAt:t+L.leaseMs};
    if(s.failsafe&&s.failsafe.pending){clock.clearTimeout(releaseTimer);releaseTimer=null;s.failsafe={...s.failsafe,pending:false,cancelled:true};
      log('failsafe-cancelled',{operator});}
    if(!leaseTimer)leaseTimer=clock.setInterval(checkLease,Math.max(100,Math.floor(L.leaseMs/3)));
    if(fresh){log('lease',{operator});changed();}
  }
  const holds=operator=>Boolean(s.lease&&s.lease.operator===operator&&s.lease.expiresAt>now());
  function requireLease(operator){if(!holds(operator))throw new DrcError('Keine Steuerberechtigung: Bediener-Lease fehlt oder abgelaufen',423);}
  function checkLease(){
    if(!s.lease||s.lease.expiresAt>now())return;
    const operator=s.lease.operator;
    s.lease=null;
    clock.clearInterval(leaseTimer);leaseTimer=null;
    log('lease-lost',{operator});
    triggerFailsafe('Bediener nicht mehr verbunden');
  }
  function triggerFailsafe(reason){
    if(s.phase==='idle'||s.phase==='auth_pending')return;
    s.lastStick=null;
    s.failsafe={reason,at:now(),pending:true};
    log('failsafe',{reason});
    if(s.phase==='drc_active'){try{drc('stick_control',P.NEUTRAL);}catch{}}
    stopDrag(true);
    if((s.flyTo&&s.flyTo.active)||(s.takeoff&&s.takeoff.active))service('fly_to_point_stop',{}).catch(err=>log('failsafe-flyto-stop-failed',{error:err.message}));
    clock.clearTimeout(releaseTimer);
    releaseTimer=clock.setTimeout(()=>{releaseTimer=null;if(s.failsafe?.pending)handBack('Fail-safe: '+reason);},L.releaseAfterMs);
    changed();
  }
  // Give control back to the RC: exit DRC, release cloud control. Errors are logged, the local state is reset regardless.
  async function handBack(why){
    log('hand-back',{why});
    stopSticks();stopDrag(true);
    const steps=[];
    if(s.phase==='drc_active'||s.phase==='drc_pending')steps.push(service('drc_mode_exit',{}).catch(err=>log('hand-back-exit-failed',{error:err.message})));
    if(s.phase!=='idle')steps.push(service('cloud_control_release',P.authRelease()).catch(err=>log('hand-back-release-failed',{error:err.message})));
    await Promise.all(steps);
    if(s.failsafe)s.failsafe={...s.failsafe,pending:false,done:now()};
    s.flyTo=null;
    setPhase('idle',why);
  }

  // --- sticks ----------------------------------------------------------------------------------------------------------
  function startSticks(){
    if(stickTimer)return;
    stickTimer=clock.setInterval(()=>{
      if(s.phase!=='drc_active'){stopSticks();return;}
      const fresh=s.lastStick&&now()-s.lastStick.at<=L.stickStaleMs&&holds(s.lastStick.operator);
      try{drc('stick_control',fresh?s.lastStick.value:P.NEUTRAL);}catch(err){s.lastError='Knüppel: '+err.message;}
      // Neutral for a short while after the last input, then stop sending (the aircraft brakes without input).
      if(!fresh&&(!s.lastStick||now()-s.lastStick.at>L.stickStaleMs+1000))stopSticks();
    },Math.round(1000/L.stickHz));
  }
  function stopSticks(){if(stickTimer){clock.clearInterval(stickTimer);stickTimer=null;}}
  function stickInput(operator,vector){
    requireLease(operator);
    if(s.phase!=='drc_active')throw new DrcError('Knüppelsteuerung erst im Live-Steuermodus');
    if(s.joystickInvalid)throw new DrcError('Knüppelsteuerung gesperrt: '+s.joystickInvalid.text);
    s.lastStick={operator,at:now(),value:P.stick(vector,L.stickScale)};
    startSticks();
  }

  // --- payload: camera, gimbal, zoom (Matrice 4E/4T, drc-payload.js) --------------------------------------------------
  function payloadCtx(a){
    const ctx=PL.payloadContext(a.modelKey,a.payloadIndex);
    if(!ctx)throw new DrcError('Kamerasteuerung für '+(a.modelName||a.modelKey||'?')+' nicht verfügbar');
    return ctx;
  }
  function requirePayload(operator){
    requireLease(operator);
    if(s.phase!=='drc_active')throw new DrcError('Kamera und Gimbal erst im Live-Steuermodus');
    return payloadCtx(aircraftState());
  }
  async function payload(operator,name,body){
    const ctx=requirePayload(operator);
    const cmd=PL.command(name,body,ctx);
    log('command',{operator,method:cmd.method,data:cmd.data});
    s.camera.lastCommand={label:cmd.label,status:'gesendet',at:now()};changed();
    try{await drcRequest(cmd.method,cmd.data);}
    catch(err){s.camera.lastCommand={label:cmd.label,status:'Fehler: '+err.message,at:now()};changed();throw err;}
    s.camera.lastCommand={label:cmd.label,status:'OK',at:now()};changed();
    return {method:cmd.method};
  }
  // Camera looks at a map point. heightAboveTakeoff is relative to the take-off point (0 = ground there); DJI wants the WGS84
  // ellipsoid height, computed like for fly_to_point from the current OSD height and elevation.
  async function lookAt(operator,{latitude,longitude,heightAboveTakeoff=0,locked=false}){
    const ctx=requirePayload(operator);
    const a=aircraft();
    if(typeof heightAboveTakeoff!=='number'||!Number.isFinite(heightAboveTakeoff)||heightAboveTakeoff<-200||heightAboveTakeoff>1500)
      throw new DrcError('Höhe des Blickziels über Start zwischen -200 und 1500 m',400);
    if(!Number.isFinite(a.heightEllipsoid)||!Number.isFinite(a.heightAboveTakeoff))
      throw new DrcError('Ellipsoidhöhe des Fluggeräts unbekannt: Telemetrie (height, elevation) fehlt');
    const height=Math.round((a.heightEllipsoid-a.heightAboveTakeoff+heightAboveTakeoff)*10)/10;
    const data=PL.lookAt({latitude,longitude,height,locked},ctx);
    log('command',{operator,method:PL.LOOK_AT_METHOD,target:{latitude:data.latitude,longitude:data.longitude,heightAboveTakeoff,ellipsoid:height},locked:data.locked});
    s.camera.lastCommand={label:'Blick auf Punkt',status:'gesendet',at:now()};changed();
    await drcRequest(PL.LOOK_AT_METHOD,data);
    s.camera.lastCommand={label:'Blick auf Punkt',status:'OK',at:now()};changed();
  }
  // Gimbal drag (drc_camera_screen_drag) is a speed command. ASSUMPTION (page gives no rate): sent at dragHz while the operator
  // holds a direction, like the sticks; after dragStaleMs without input one zero-speed message stops the gimbal.
  function gimbalDrag(operator,vector){
    const ctx=requirePayload(operator);
    s.lastDrag={operator,at:now(),value:PL.drag(vector||{},ctx)};
    startDrag();
  }
  function startDrag(){
    if(dragTimer)return;
    dragTimer=clock.setInterval(()=>{
      const d=s.lastDrag;
      if(s.phase!=='drc_active'||!d){stopDrag(false);return;}
      if(now()-d.at<=L.dragStaleMs&&holds(d.operator)){try{drc(PL.DRAG_METHOD,d.value);}catch(err){s.lastError='Gimbal: '+err.message;}}
      else stopDrag(true);
    },Math.round(1000/L.dragHz));
  }
  function stopDrag(sendZero){
    if(dragTimer){clock.clearInterval(dragTimer);dragTimer=null;}
    const d=s.lastDrag;s.lastDrag=null;
    if(sendZero&&d&&s.phase==='drc_active'){try{drc(PL.DRAG_METHOD,{...d.value,pitch_speed:0,yaw_speed:0});}catch{}}
  }

  // --- preconditions ---------------------------------------------------------------------------------------------------
  function aircraftState(){
    const a=aircraft();
    if(!a)throw new DrcError('Fluggerät an '+gateway+' nicht verbunden');
    if(!P.FLIGHT_AIRCRAFT[a.modelKey])throw new DrcError('Fluggerät '+(a.modelName||a.modelKey||'?')+' unterstützt keine Cloud-Flugsteuerung (nur Matrice 4E/4T)');
    return a;
  }
  function targetChecks(a,{latitude,longitude,heightAboveTakeoff}){
    if(heightAboveTakeoff>L.maxHeightAboveTakeoffM)throw new DrcError('Höhe über Start höchstens '+L.maxHeightAboveTakeoffM+' m',400);
    if(heightAboveTakeoff<L.minHeightAboveTakeoffM)throw new DrcError('Höhe über Start mindestens '+L.minHeightAboveTakeoffM+' m (DJI steigt sonst ohnehin auf 20 m)',400);
    const ref=a.home||a.position;
    if(ref&&Number.isFinite(ref.latitude)){
      const d=distance(ref,{latitude,longitude});
      if(d>L.maxDistanceM)throw new DrcError('Ziel '+Math.round(d)+' m entfernt, erlaubt '+L.maxDistanceM+' m',400);
    }
  }

  // --- public commands -----------------------------------------------------------------------------------------------
  async function requestAuthorization(operator){
    acquire(operator);
    aircraftState();
    if(s.phase!=='idle')throw new DrcError('Autorisierung läuft bereits oder ist erteilt');
    setPhase('auth_pending','Anfrage an die Fernsteuerung');
    log('command',{operator,method:'cloud_control_auth_request'});
    try{await service('cloud_control_auth_request',P.authRequest({userId,userCallsign}));}
    catch(err){setPhase('idle','Anfrage fehlgeschlagen');throw err;}
    // The decision arrives as cloud_control_auth_notify (pop-up on the RC).
  }
  async function enterLiveControl(operator){
    requireLease(operator);
    if(s.phase!=='authorized')throw new DrcError('Erst Autorisierung durch den Piloten an der Fernsteuerung');
    setPhase('drc_pending','DRC-Kanal wird aufgebaut');
    log('command',{operator,method:'drc_mode_enter'});
    try{await service('drc_mode_enter',P.drcEnter(broker()));}
    catch(err){setPhase('authorized','DRC-Kanal fehlgeschlagen');throw err;}
    s.joystickInvalid=null;
    setPhase('drc_active','drc_mode_enter bestätigt');
    try{drc('drc_initial_state_subscribe',{});}catch{}
  }
  async function exitLiveControl(operator){
    requireLease(operator);
    log('command',{operator,method:'drc_mode_exit'});
    stopSticks();
    await service('drc_mode_exit',{});
    setPhase('authorized','Live-Steuermodus beendet');
  }
  async function release(operator,why='Bediener gibt Kontrolle zurück'){
    if(operator)log('command',{operator,method:'cloud_control_release'});
    await handBack(why);
    s.lease=null;
    if(leaseTimer){clock.clearInterval(leaseTimer);leaseTimer=null;}
  }
  async function flyTo(operator,{latitude,longitude,heightAboveTakeoff,maxSpeed}){
    requireLease(operator);
    if(s.phase!=='drc_active'&&s.phase!=='authorized')throw new DrcError('Erst Autorisierung');
    const a=aircraftState();
    targetChecks(a,{latitude,longitude,heightAboveTakeoff});
    const speed=Math.min(maxSpeed??L.maxSpeedMs,L.maxSpeedMs);
    const height=P.ellipsoidTarget({heightAboveTakeoff,currentEllipsoid:a.heightEllipsoid,currentAboveTakeoff:a.heightAboveTakeoff});
    const data=P.flyTo({maxSpeed:Math.round(speed),target:{latitude,longitude,height}});
    log('command',{operator,method:'fly_to_point',target:{latitude,longitude,heightAboveTakeoff,ellipsoid:height},maxSpeed:data.max_speed});
    await service('fly_to_point',data);
    s.flyTo={id:data.fly_to_id,active:true,status:'gesendet',target:{latitude,longitude,heightAboveTakeoff}};
    changed();
    return s.flyTo;
  }
  async function flyToStop(operator){
    if(!holds(operator)&&!s.lease)acquire(operator);
    log('command',{operator,method:'fly_to_point_stop'});
    await service('fly_to_point_stop',{});
    if(s.flyTo)s.flyTo={...s.flyTo,active:false,status:'gestoppt'};
    if(s.takeoff&&s.takeoff.active)s.takeoff={...s.takeoff,active:false,status:'gestoppt'};
    changed();
  }
  async function takeoff(operator,{latitude,longitude,heightAboveTakeoff,rthAltitude,maxSpeed}){
    requireLease(operator);
    if(s.phase!=='authorized'&&s.phase!=='drc_active')throw new DrcError('Erst Autorisierung');
    const a=aircraftState();
    if(Number.isFinite(a.heightAboveTakeoff)&&a.heightAboveTakeoff>2)throw new DrcError('Fluggerät ist bereits in der Luft: Zielanflug benutzen');
    // DJI mode_code (M4 properties): 0 = Standby, 17 = Live flight Controls (entering DRC on the ground may report 17).
    // Take-off only from one of these AND on the ground (height above take-off checked above).
    if(![0,17].includes(a.modeCode))throw new DrcError('Abheben nur aus Standby oder Live-Steuerung am Boden (mode_code 0/17), aktuell '+(a.modeCode??'unbekannt'));
    if(!Number.isFinite(a.heightAboveTakeoff))throw new DrcError('Höhe über Start unbekannt: Abheben nicht sicher prüfbar');
    targetChecks({...a,home:a.position},{latitude,longitude,heightAboveTakeoff});
    const rth=Math.round(rthAltitude??Math.max(heightAboveTakeoff,30));
    if(rth>L.maxHeightAboveTakeoffM)throw new DrcError('Rückkehrhöhe höchstens '+L.maxHeightAboveTakeoffM+' m',400);
    const height=P.ellipsoidTarget({heightAboveTakeoff,currentEllipsoid:a.heightEllipsoid,currentAboveTakeoff:a.heightAboveTakeoff??0});
    const data=P.takeoff({target:{latitude,longitude,height},securityTakeoffHeight:20,rthAltitude:rth,rthMode:1,rcLostAction:2,
      commanderModeLostAction:1,commanderFlightMode:1,commanderFlightHeight:heightAboveTakeoff,
      maxSpeed:Math.round(Math.min(maxSpeed??L.maxSpeedMs,L.maxSpeedMs))});
    log('command',{operator,method:'takeoff_to_point',target:{latitude,longitude,heightAboveTakeoff},rthAltitude:rth});
    await service('takeoff_to_point',data);
    s.takeoff={id:data.flight_id,status:'gesendet',active:true};
    changed();
  }
  async function returnHome(operator){
    // Return home is a safety action: allowed for any authenticated operator while cloud control is held.
    if(s.phase==='idle'||s.phase==='auth_pending')throw new DrcError('Keine Cloud-Kontrolle: Rückkehr an der Fernsteuerung auslösen');
    log('command',{operator,method:'return_home'});
    stopSticks();
    await service('return_home',{});
    s.returnHome={status:'ausgelöst',at:now()};
    changed();
  }
  async function returnHomeCancel(operator){
    requireLease(operator);
    log('command',{operator,method:'return_home_cancel'});
    await service('return_home_cancel',{});
    s.returnHome={status:'abgebrochen (schwebt)',at:now()};
    changed();
  }
  function emergencyStop(operator){
    // DRC drone_emergency_stop: needs the DRC channel. Any authenticated operator, lease not required.
    if(s.phase!=='drc_active'&&s.phase!=='drc_pending')throw new DrcError('Not-Stopp braucht den Live-Steuermodus: sonst an der Fernsteuerung bremsen');
    log('command',{operator,method:'drone_emergency_stop'});
    s.lastStick=null;
    drc('drone_emergency_stop',{});
    changed();
  }
  function landing(operator,kind){
    requireLease(operator);
    if(s.phase!=='drc_active')throw new DrcError('Landung erst im Live-Steuermodus');
    const method=kind==='emergency'?'drc_emergency_landing':'drc_force_landing';
    log('command',{operator,method});
    s.lastStick=null;
    drc(method,{});
  }

  // --- upstream handling -------------------------------------------------------------------------------------------
  function onUp(m){
    if(!m||m.gateway!==gateway)return;
    if(m.channel==='services_reply'){
      const p=s.pending.get(m.tid);
      if(!p||p.method!==m.method)return;           // replies are matched by tid AND method
      clock.clearTimeout(p.timer);s.pending.delete(m.tid);p.resolve(m);
      return;
    }
    if(m.channel==='drc/up'){
      if(m.method==='heart_beat'){s.lastUpHeartbeat=now();if(Number.isFinite(m.timestamp))s.latencyMs=Math.max(0,now()-m.timestamp);}
      else if(m.method==='osd_info_push')s.osd={...m.osd,at:now()};
      else if(m.push){
        const key=m.method==='drc_camera_state_push'?'state':m.method==='drc_camera_osd_info_push'?'lens':'photo';
        s.camera={...s.camera,[key]:{...m.push,at:now()}};changed();
      }else{
        const p=m.seq!==null?s.pendingDrc.get(m.seq):null;
        if(p&&p.method===m.method){clock.clearTimeout(p.timer);s.pendingDrc.delete(m.seq);p.resolve(m);}
        else if(m.result!==null&&m.result!==0)log('drc-rejected',{method:m.method,result:m.result});
      }
      return;
    }
    if(m.channel==='state'||m.channel==='osd'){
      if(m.drcState===0&&(s.phase==='drc_active'||s.phase==='drc_pending'))setPhase('authorized','Fernsteuerung meldet DRC getrennt');
      return;
    }
    if(m.channel==='events'){
      // need_reply=1 (fly_to_point_progress, takeoff_to_point_progress, joystick_invalid_notify, …): acknowledge or the RC resends.
      const ack=P.eventsReply(m,now());
      if(ack){try{publishEventsReply(gateway,ack);}catch(err){s.lastError='events_reply: '+err.message;}}
      if(m.method==='cloud_control_auth_notify'){
        if(m.status==='ok'&&s.phase==='auth_pending')setPhase('authorized','Pilot hat zugestimmt');
        else if(m.status!=='ok'){log('auth-denied',{status:m.status});setPhase('idle','Autorisierung '+(m.status||'abgelehnt'));}
      }else if(m.method==='joystick_invalid_notify'){
        s.joystickInvalid={reason:m.reason,text:m.text,at:now()};s.lastStick=null;stopSticks();
        log('joystick-invalid',{reason:m.reason,text:m.text});changed();
      }else if(m.method==='fly_to_point_progress'&&s.flyTo&&(!m.id||m.id===s.flyTo.id)){
        const done=['wayline_ok','wayline_failed','wayline_cancel'].includes(m.status);
        s.flyTo={...s.flyTo,status:m.status,active:!done,remainingDistance:m.remainingDistance,remainingTime:m.remainingTime,path:m.path};
        changed();
      }else if(m.method==='takeoff_to_point_progress'){
        const over=['task_finish','wayline_ok','wayline_failed','wayline_cancel'].includes(m.status);
        s.takeoff={...(s.takeoff||{}),status:m.status,active:!over,remainingDistance:m.remainingDistance,path:m.path};changed();
      }else if(m.method==='return_home_info'){
        s.returnHome={...(s.returnHome||{}),path:m.path,at:now()};changed();
      }
    }
  }

  function snapshot(){
    const t=now();
    return {gateway,phase:s.phase,operator:s.lease&&s.lease.expiresAt>t?s.lease.operator:null,
      upLink:s.lastUpHeartbeat===null?'unbekannt':t-s.lastUpHeartbeat>L.upLinkLostMs?'verloren':'ok',latencyMs:s.latencyMs,
      osd:s.osd,flyTo:s.flyTo,takeoff:s.takeoff,returnHome:s.returnHome,joystickInvalid:s.joystickInvalid,failsafe:s.failsafe,
      sticksActive:Boolean(stickTimer),gimbalDragActive:Boolean(dragTimer),camera:s.camera,limits:{maxSpeedMs:L.maxSpeedMs,maxHeightAboveTakeoffM:L.maxHeightAboveTakeoffM,
        minHeightAboveTakeoffM:L.minHeightAboveTakeoffM,maxDistanceM:L.maxDistanceM,stickScale:L.stickScale},lastError:s.lastError};
  }
  async function shutdown(){
    if(s.phase!=='idle')await handBack('SkyHub wird beendet');
    for(const p of s.pending.values())clock.clearTimeout(p.timer);
    s.pending.clear();
    for(const p of s.pendingDrc.values())clock.clearTimeout(p.timer);
    s.pendingDrc.clear();
    [stickTimer,heartbeatTimer,leaseTimer,dragTimer].forEach(t=>t&&clock.clearInterval(t));
    if(releaseTimer)clock.clearTimeout(releaseTimer);
  }
  return {acquire,holds,requestAuthorization,enterLiveControl,exitLiveControl,release,flyTo,flyToStop,takeoff,returnHome,
    returnHomeCancel,emergencyStop,landing,stickInput,payload,lookAt,gimbalDrag,onUp,snapshot,shutdown,triggerFailsafe};
}

function distance(a,b){
  const R=6371008.8,rad=Math.PI/180,dLat=(b.latitude-a.latitude)*rad,dLon=(b.longitude-a.longitude)*rad;
  const h=Math.sin(dLat/2)**2+Math.cos(a.latitude*rad)*Math.cos(b.latitude*rad)*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.min(1,Math.sqrt(h)));
}

module.exports={createDrcSession,DrcError,DEFAULTS,PHASES};
