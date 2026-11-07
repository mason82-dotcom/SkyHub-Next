(function(){
  'use strict';
  const el=id=>document.getElementById(id);
  // Paired device token: stored only in this Pilot 2 WebView, like the DJI demo's auto-login.
  const TOKEN_KEY='skyhub.pilot.deviceToken';
  const REBUILD_KEY='skyhub.pilot.lastRebuildAt';
  const RECONNECT_KEY='skyhub.pilot.lastReconnectAt';
  const SERIAL=/^[\w.-]{1,100}$/;
  let ready=false,connecting=false;
  let mqttLogin=null; // Kept only in WebView memory for an explicit retry.
  let lastConfig=null,sessionToken=null,pairingTimer=null;
  // Shown above the new pairing code when the old pairing predates the workspace binding (bootstrap answers 409).
  const REPAIR_NOTE='Diese Kopplung stammt aus der Zeit vor der Arbeitsbereich-Bindung und erlaubt keinen Datenzugriff mehr.';
  let repairNote='';
  let tsaState=null; // null: not requested, otherwise a short German status for the diagnostics
  let mediaState=null; // same for the media synchronisation
  let waylineState=null; // same for the DJI wayline library (mission module)
  let liveState=null; // same for the livestream (liveshare module)
  const memory=Object.create(null);
  const isTls=location.protocol==='https:';
  // Optional diagnostics relay (server switch SKYHUB_PILOT_DIAGNOSTICS_ENABLED, see backend/pilot-diagnostics.js).
  // DJI Pilot 2 blocks WebView debugging, so the page reports its own steps to the SkyHub log. Sent are only: status texts,
  // JSBridge method names with result codes, callback names, own request paths with HTTP status, JS errors.
  // NEVER bridge arguments, callback payloads, tokens, pairing codes or credentials. Entries wait until the server says on.
  let diagOn=null,diagTimer=null;
  const diagQueue=[];
  // The global fetch is not patched; this page's own calls go through the local fetch() below (function scope).
  const nativeFetch=typeof globalThis.fetch==='function'?globalThis.fetch.bind(globalThis):null;
  function diag(level,kind,msg){
    if(diagOn===false)return;
    if(diagQueue.length<200)diagQueue.push({t:Date.now(),level,kind,msg:String(msg).slice(0,300)});
    if(diagOn&&!diagTimer)diagTimer=setTimeout(flushDiag,level==='error'?200:1500);
  }
  function flushDiag(){
    diagTimer=null;
    if(!diagOn||!diagQueue.length)return;
    const entries=diagQueue.splice(0,40);
    const headers={'Content-Type':'application/json'};
    if(sessionToken)headers.Authorization='Bearer '+sessionToken;
    if(!nativeFetch)return;
    nativeFetch('/api/pilot/diagnostics',{method:'POST',cache:'no-store',keepalive:true,headers,
      body:JSON.stringify({page:'pilot-login',entries})}).catch(()=>{});
    if(diagQueue.length)diagTimer=setTimeout(flushDiag,1000);
  }
  function setDiagnostics(on){
    diagOn=on===true;
    if(!diagOn){diagQueue.length=0;return;}
    diag('info','step','Diagnose an · '+navigator.userAgent.replace(/\s+/g,' ').slice(0,160));
    flushDiag();
  }
  // Own requests of this page: path without query, long ids shortened, plus status and duration.
  const safePath=url=>{try{const u=new URL(url,location.href);
    return u.pathname.split('/').map(p=>p.length>16?p.slice(0,4)+'…':p).join('/');}catch(_){return '?';}};
  function fetch(input,init){
    const url=typeof input==='string'?input:(input&&input.url)||'',method=(init&&init.method)||'GET',start=Date.now();
    const path=safePath(url);
    if(path==='/api/pilot/diagnostics')return nativeFetch(input,init);
    return nativeFetch(input,init).then(r=>{diag(r.ok?'info':'warn','fetch',method+' '+path+' → '+r.status+' ('+(Date.now()-start)+' ms)');return r;},
      e=>{diag('error','fetch',method+' '+path+' → Netzwerkfehler '+(e&&e.name||''));throw e;});
  }
  if(typeof window.addEventListener==='function'){
    window.addEventListener('error',e=>diag('error','js',(e.message||'Fehler')+' @'+safePath(e.filename||'')+':'+(e.lineno||0)));
    window.addEventListener('unhandledrejection',e=>diag('error','js','Promise: '+String(e.reason&&e.reason.message||e.reason).slice(0,200)));
  }
  function status(text){
    el('result').textContent=text;
    // The pairing code is a short-lived secret: report only that it was shown.
    diag('info','step',/pi-pilot-pair/.test(text)?'Kopplungscode angezeigt (Code nicht übertragen)':text);
  }
  function storageGet(key){
    try{const value=window.localStorage?window.localStorage.getItem(key):null;return value??memory[key]??null;}
    catch(_){return memory[key]??null;}
  }
  function storageSet(key,value){
    memory[key]=value;
    try{if(window.localStorage)window.localStorage.setItem(key,value);}catch(_){}
  }
  function storageDelete(key){
    delete memory[key];
    try{if(window.localStorage)window.localStorage.removeItem(key);}catch(_){}
  }
  // Pilot 2 reloads this page on its own; throttle automatic recovery across reloads.
  function throttled(key,intervalMs){
    const last=Number(storageGet(key));
    const now=Date.now();
    if(Number.isFinite(last) && now-last>=0 && now-last<intervalMs)return false;
    storageSet(key,String(now));
    return true;
  }
  function parseBridge(value){
    let result=value;
    if(typeof result==='string'){
      try{result=JSON.parse(result);}catch{return {ok:false,message:'Ungültige DJI-Bridge-Antwort'};}
    }
    if(result && typeof result==='object' && typeof result.code==='number')
      return {ok:result.code===0,code:result.code,data:result.data};
    return {ok:false,message:'Unerwartete DJI-Bridge-Antwort'};
  }
  function invoke(method,...args){
    if(!window.djiBridge || typeof window.djiBridge[method]!=='function')
      throw new Error('DJI JSBridge-Funktion fehlt: '+method);
    const outcome=parseBridge(window.djiBridge[method](...args));
    // Method name and result code only; the arguments may contain license, keys or MQTT credentials.
    diag(outcome.ok?'info':'warn','bridge',method+(args.length&&typeof args[0]==='string'&&/^[a-z]{2,12}$/.test(args[0])?'('+args[0]+')':'')+
      ' → '+(outcome.ok?'OK':'Code '+(Number.isFinite(outcome.code)?outcome.code:'?')+(outcome.message?' '+outcome.message:'')));
    if(!outcome.ok)throw new Error(method+': DJI Bridge-Code '+(Number.isFinite(outcome.code)?outcome.code:'unbekannt'));
    return outcome.data;
  }
  // Never log, render or export callback payloads or credentials.
  function parseBooleanState(value){
    let parsed=value;
    if(typeof parsed==='string'){
      try{parsed=JSON.parse(parsed.trim());}catch(_){return {state:null,code:null};}
    }
    if(typeof parsed==='boolean')return {state:parsed,code:null};
    if(parsed && typeof parsed==='object' && !Array.isArray(parsed)){
      // A failed JSBridge call cannot be treated as an online/offline state.
      if(typeof parsed.code==='number' && parsed.code!==0){
        const safeCode=Number.isSafeInteger(parsed.code) && parsed.code>=0 &&
          parsed.code<=999999 ? parsed.code : null;
        return {state:null,code:safeCode};
      }
      if(typeof parsed.data==='boolean')return {state:parsed.data,code:null};
    }
    return {state:null,code:null};
  }
  function decodeMqttState(value){return parseBooleanState(value).state;}
  // true/false when DJI answers clearly, otherwise null.
  function bridgeBoolean(method,...args){
    const bridge=window.djiBridge;
    if(!bridge || typeof bridge[method]!=='function')return null;
    try{return parseBooleanState(bridge[method](...args)).state;}catch(_){return null;}
  }
  function describe(result){
    if(result.code!==null)return 'DJI-Fehlercode '+result.code;
    if(result.state===true)return 'ja';
    if(result.state===false)return 'nein';
    return 'Antwort nicht auswertbar';
  }
  function readBridgeStatus(method,...args){
    if(!window.djiBridge || typeof window.djiBridge[method]!=='function')
      return 'Schnittstelle nicht verfügbar';
    try{return describe(parseBooleanState(window.djiBridge[method](...args)));}
    catch(_){return 'Statusabfrage fehlgeschlagen';}
  }
  function refreshDiagnostics(){
    const target=el('diagnostics');
    if(!target)return;
    // Read only three DJI APIs. Never call thingGetConfigs (contains credentials).
    target.textContent=[
      'SkyHub-Seite geladen: ja',
      'DJI Pilot 2 JSBridge: '+(window.djiBridge?'verfügbar':'nicht verfügbar'),
      'DJI-Lizenz geprüft: '+readBridgeStatus('platformIsVerified'),
      'Thing-Modul geladen: '+readBridgeStatus('platformIsComponentLoaded','thing'),
      'MQTT verbunden (DJI): '+readBridgeStatus('thingGetConnectState'),
      ...(tsaState===null?[]:['Lagebild (TSA): '+tsaState+' · WebSocket verbunden: '+readBridgeStatus('wsGetConnectState')]),
      ...(mediaState===null?[]:['Medien-Synchronisation: '+mediaState+
        ' · Medien-Modul geladen: '+readBridgeStatus('platformIsComponentLoaded','media')+
        ' · Fotos automatisch: '+readBridgeStatus('mediaGetAutoUploadPhoto')+
        ' · Videos automatisch: '+readBridgeStatus('mediaGetAutoUploadVideo')]),
      ...(liveState===null?[]:['Livestream: '+liveState+
        ' · Liveshare-Modul geladen: '+readBridgeStatus('platformIsComponentLoaded','liveshare')]),
      ...(waylineState===null?[]:['Wayline-Bibliothek: '+waylineState+
        ' · Mission-Modul geladen: '+readBridgeStatus('platformIsComponentLoaded','mission')]),
      'Gerät gekoppelt: '+(storageGet(TOKEN_KEY)?'ja':'nein')
    ].join('\n');
    diag('info','step','Status: '+target.textContent.replace(/\n/g,' · '));
  }
  function show(id,visible){
    const node=el(id);
    if(!node)return;
    node.hidden=!visible;
    node.disabled=!visible;
  }
  function showRetry(enabled){show('retry',enabled);}
  function canRetry(){
    return Boolean(mqttLogin && window.djiBridge &&
      typeof window.djiBridge.thingConnect==='function');
  }
  function remoteControllerSerial(){
    try{
      const result=parseBridge(window.djiBridge.platformGetRemoteControllerSN());
      return result.ok && typeof result.data==='string' && SERIAL.test(result.data)?result.data:null;
    }catch(_){return null;}
  }
  // Pilot 2 only publishes OSD after SkyHub acknowledged update_topo with status_reply.
  async function checkSession(allowRebuild){
    if(!sessionToken)return;
    const sn=remoteControllerSerial();
    if(!sn){status('DJI MQTT: VERBUNDEN. RC-Kennung nicht abrufbar, Topologie nicht prüfbar.');return;}
    let session;
    try{
      const response=await fetch('/api/pilot/session?gateway='+encodeURIComponent(sn),{
        cache:'no-store',headers:{'Authorization':'Bearer '+sessionToken}
      });
      if(!response.ok)return;
      session=await response.json();
    }catch(_){return;}
    if(session.topologyReplyEnabled!==true){
      status('DJI MQTT: VERBUNDEN. Topologie-Bestätigung ist im SkyHub deaktiviert.');
      return;
    }
    // Fresh OSD also proves an acknowledged session (e.g. after a SkyHub restart).
    const osd=Number.isFinite(session.lastTelemetryAt) && Date.now()-session.lastTelemetryAt<15000;
    if(Number.isFinite(session.topologyAckAt) || osd){
      show('rebuild',false);
      status('DJI MQTT: VERBUNDEN · '+(Number.isFinite(session.topologyAckAt)?'Topologie bestätigt':'Sitzung aktiv')+
        (osd?' · OSD empfangen.':' · noch kein aktuelles OSD.'));
      return;
    }
    if(allowRebuild && throttled(REBUILD_KEY,600000)){rebuildSession();return;}
    show('rebuild',Boolean(lastConfig));
    status('DJI MQTT: VERBUNDEN, aber Topologie nicht bestätigt. Ohne Bestätigung sendet Pilot 2 kein OSD.');
  }
  function loadThing(config){
    invoke('platformLoadComponent','thing',JSON.stringify({
      host:config.mqtt.host,username:config.mqtt.username,
      password:config.mqtt.password,connectCallback:'skyhubPilotMqttState'
    }));
  }
  // Situation awareness: DJI needs the api and ws modules before tsa, and the cloud (thing)
  // module before all of them. Only requested when the server enables it; a failure here must
  // never affect the MQTT connection. The device token is passed to the bridge only.
  function loadTsa(config){
    const tsa=config&&config.tsa;
    if(!tsa||typeof tsa.apiHost!=='string'||typeof tsa.wsHost!=='string'||!sessionToken)return;
    try{
      if(bridgeBoolean('platformIsComponentLoaded','api')!==true)
        invoke('platformLoadComponent','api',JSON.stringify({host:tsa.apiHost,token:sessionToken}));
      if(bridgeBoolean('platformIsComponentLoaded','ws')!==true)
        invoke('platformLoadComponent','ws',JSON.stringify({
          host:tsa.wsHost,token:sessionToken,connectCallback:'skyhubPilotWsState'}));
      if(bridgeBoolean('platformIsComponentLoaded','tsa')!==true)
        invoke('platformLoadComponent','tsa','{}');
      // Map elements (jsbridge map module, after cloud + ws): Pilot 2 then reads the element groups over the api module and
      // receives map_element_* pushes on the ws connection.
      const map=config.map;
      if(map&&typeof map.userName==='string'&&bridgeBoolean('platformIsComponentLoaded','map')!==true)
        invoke('platformLoadComponent','map',JSON.stringify({userName:map.userName.slice(0,32),elementPreName:String(map.elementPreName||'PILOT').slice(0,16)}));
      tsaState='Module geladen'+(map?' (mit Kartenelementen)':'');
    }catch(e){tsaState='nicht geladen ('+e.message+')';}
    refreshDiagnostics();
  }
  // Media synchronisation, MANUAL only: automatic uploads stay switched off. With the api and
  // media modules loaded, files selected in the Pilot 2 album can be uploaded to SkyHub; Pilot 2
  // then asks for temporary credentials (STS) and reports each file. The settings are re-applied
  // on every load, so an automatic upload switched on in Pilot 2 is turned off again.
  // The device token goes to the bridge only.
  const MEDIA_SETTINGS=Object.freeze({autoUploadPhoto:false,autoUploadPhotoType:0,autoUploadVideo:false});
  function loadMedia(config){
    const media=config&&config.media;
    if(!media||typeof media.apiHost!=='string'||!sessionToken)return;
    try{
      if(bridgeBoolean('platformIsComponentLoaded','api')!==true)
        invoke('platformLoadComponent','api',JSON.stringify({host:media.apiHost,token:sessionToken}));
      if(bridgeBoolean('platformIsComponentLoaded','media')!==true)
        invoke('platformLoadComponent','media',JSON.stringify(MEDIA_SETTINGS));
      // Pilot 2 rejects a setter that changes nothing (e.g. code 615012), so only switch off what
      // Pilot 2 reports as on; a rejected setter never marks the module as not loaded.
      const off=[];
      for(const [getter,setter] of [['mediaGetAutoUploadPhoto','mediaSetAutoUploadPhoto'],
        ['mediaGetAutoUploadVideo','mediaSetAutoUploadVideo']]){
        if(bridgeBoolean(getter)===true){
          try{invoke(setter,false);}catch(_){off.push(setter);}
        }
      }
      const photo=bridgeBoolean('mediaGetAutoUploadPhoto'),video=bridgeBoolean('mediaGetAutoUploadVideo');
      mediaState=photo===true||video===true?
        'geladen, ACHTUNG automatischer Upload noch an'+(off.length?' ('+off.join(', ')+' abgelehnt)':''):
        'bereit, nur manueller Upload (automatischer Upload aus)';
    }catch(e){mediaState='nicht geladen ('+e.message+')';}
    refreshDiagnostics();
  }
  // Wayline library: DJI loads the 'mission' module after 'api'. Pilot 2 then lists SkyHub's
  // validated KMZ files in its wayline library and downloads them via short-lived links.
  // Uploads from Pilot 2 are refused by SkyHub. No flight task is created by this module.
  function loadWayline(config){
    const wayline=config&&config.wayline;
    if(!wayline||typeof wayline.apiHost!=='string'||!sessionToken)return;
    try{
      if(bridgeBoolean('platformIsComponentLoaded','api')!==true)
        invoke('platformLoadComponent','api',JSON.stringify({host:wayline.apiHost,token:sessionToken}));
      if(bridgeBoolean('platformIsComponentLoaded','mission')!==true)
        invoke('platformLoadComponent','mission','{}');
      waylineState='Modul geladen (nur Liste/Download)';
    }catch(e){waylineState='nicht geladen ('+e.message+')';}
    refreshDiagnostics();
  }
  // Livestream: DJI's liveshare module streams RTMP to the SkyHub relay. Publish type
  // "video-by-manual": only the pilot starts/stops (here or in Pilot 2). With SkyHub's live control the server sends
  // "video-demand-aux-manual": SkyHub may request the stream, the pilot can still change or stop it.
  // The RTMP URL carries the publish password and is never displayed or stored.
  const LIVE_STATUS=['getrennt','verbunden','LIVE'];
  function liveStatusText(raw){
    let s=raw;
    if(typeof s==='string'){try{s=JSON.parse(s);}catch(_){return null;}}
    if(s&&typeof s==='object'&&typeof s.data==='string'){try{s=JSON.parse(s.data);}catch(_){return null;}}
    if(!s||typeof s!=='object'||!Number.isInteger(s.status))return null;
    const label=LIVE_STATUS[s.status]||'unbekannt';
    const extra=[];
    if(Number.isFinite(s.fps)&&s.fps>=0)extra.push(Math.round(s.fps)+' fps');
    if(Number.isFinite(s.videoBitRate)&&s.videoBitRate>=0)extra.push(Math.round(s.videoBitRate)+' kbit/s');
    if(Number.isFinite(s.dropRate)&&s.dropRate>=0)extra.push('Verlust '+s.dropRate+' %');
    return {living:s.status===2,text:'Status: '+label+(extra.length?' · '+extra.join(' · '):'')};
  }
  function renderLive(raw){
    const parsed=liveStatusText(raw);
    if(!parsed)return;
    el('liveState').textContent=parsed.text;
    show('liveStart',!parsed.living);
    show('liveStop',parsed.living);
  }
  window.skyhubLiveStatus=function(arg){
    const parsed=liveStatusText(arg);
    diag('info','callback','skyhubLiveStatus'+(parsed?' → '+parsed.text:''));
    renderLive(arg);
  };
  function loadLive(config){
    const live=config&&config.live;
    if(!live||typeof live.rtmpUrl!=='string'||!/^rtmp:\/\/[^/?#]+\/pilot\?/.test(live.rtmpUrl))return;
    try{
      if(bridgeBoolean('platformIsComponentLoaded','liveshare')!==true)
        invoke('platformLoadComponent','liveshare',JSON.stringify({
          videoPublishType:live.publishType==='video-demand-aux-manual'?'video-demand-aux-manual':'video-by-manual',statusCallback:'skyhubLiveStatus'}));
      // Type 2 = RTMP (DJI liveshare types: 1 Agora, 2 RTMP, 3 RTSP, 4 GB28181).
      invoke('liveshareSetConfig',2,JSON.stringify({url:live.rtmpUrl}));
      liveState='bereit (Start durch den Piloten)';
      el('livePanel').hidden=false;
      show('liveStart',true);
      try{renderLive(window.djiBridge.liveshareGetStatus());}catch(_){/* status follows via callback */}
    }catch(e){liveState='nicht geladen ('+e.message+')';}
    refreshDiagnostics();
  }
  function startLive(){
    try{invoke('liveshareStartLive');el('liveState').textContent='Livestream wird gestartet ...';}
    catch(e){el('liveState').textContent='Start fehlgeschlagen: '+e.message;}
  }
  function stopLive(){
    try{invoke('liveshareStopLive');el('liveState').textContent='Livestream wird beendet ...';}
    catch(e){el('liveState').textContent='Stopp fehlgeschlagen: '+e.message;}
  }
  window.skyhubPilotWsState=function(_callbackResult){
    // The callback payload is intentionally ignored; the state is queried instead.
    diag('info','callback','skyhubPilotWsState');
    refreshDiagnostics();
  };
  // A new MQTT session makes Pilot 2 publish update_topo again, which SkyHub acknowledges.
  function rebuildSession(){
    if(!lastConfig || !window.djiBridge)return;
    show('rebuild',false);
    status('Cloud-Sitzung wird neu aufgebaut ...');
    try{
      if(typeof window.djiBridge.platformUnloadComponent==='function')
        window.djiBridge.platformUnloadComponent('thing');
      loadThing(lastConfig);
      setTimeout(()=>window.skyhubPilotMqttState(),4000);
    }catch(e){status('Neuaufbau fehlgeschlagen: '+e.message);show('rebuild',true);}
  }
  window.skyhubPilotMqttState=function(_callbackResult){
    // The callback payload is intentionally ignored. Query the current state.
    diag('info','callback','skyhubPilotMqttState');
    refreshDiagnostics();
    try{
      const bridge=window.djiBridge;
      if(!bridge || typeof bridge.thingGetConnectState!=='function'){
        status('DJI MQTT: Statusabfrage nicht verfügbar.');
        showRetry(canRetry());
        return;
      }
      const state=decodeMqttState(bridge.thingGetConnectState());
      if(state===true){
        mqttLogin=null;
        showRetry(false);
        status('DJI MQTT: VERBUNDEN. OSD-Empfang im SkyHub prüfen.');
        // update_topo follows the MQTT login within seconds; then show acknowledgement.
        if(sessionToken)setTimeout(()=>checkSession(false),12000);
      }else if(state===false){
        showRetry(canRetry());
        status('DJI MQTT: NICHT VERBUNDEN. Erneuten Verbindungsversuch anbieten.');
      }else{
        showRetry(canRetry());
        status('DJI MQTT: Bridge-Rückgabe nicht eindeutig. Keine Verbindung bestätigt.');
      }
    }catch(_){
      showRetry(canRetry());
      status('DJI MQTT: Statusabfrage fehlgeschlagen.');
    }
  };
  // Button handler; the automatic handshake calls reconnectMqtt directly.
  function retryMqtt(){
    if(connecting || !canRetry())return;
    connecting=true;
    try{reconnectMqtt();}finally{connecting=false;}
  }
  function reconnectMqtt(){
    showRetry(false);
    status('DJI MQTT: Erneuter Verbindungsversuch gestartet ...');
    try{
      const value=window.djiBridge.thingConnect(
        mqttLogin.username,mqttLogin.password,'skyhubPilotMqttState');
      let result=value;
      if(typeof result==='string'){
        try{result=JSON.parse(result);}catch(_){}
      }
      if(result===false || (result && typeof result==='object' &&
          typeof result.code==='number' && result.code!==0)){
        status('DJI MQTT: Wiederverbindung von DJI Bridge abgelehnt.');
        showRetry(true);
      }
      // A successful function return is only request acceptance, not MQTT online.
      // Recheck even when DJI Pilot 2 does not invoke the callback.
      else setTimeout(()=>window.skyhubPilotMqttState(),4000);
    }catch(_){
      status('DJI MQTT: Wiederverbindung fehlgeschlagen.');
      showRetry(true);
    }
  }
  // Idempotent: Pilot 2 reopens and reloads this page, so never reload a working module.
  async function handshake(token){
    status('Sichere Bootstrap-Konfiguration wird angefordert ...');
    const response=await fetch('/api/pilot/bootstrap',{
      method:'POST',cache:'no-store',
      headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json'},
      body:'{}'
    });
    if(response.status===401)return 'unauthorized';
    // Paired before SkyHub bound devices to the workspace: valid token, but no data access. Pair again.
    if(response.status===409){
      let code='';try{code=(await response.json()).code;}catch(_){code='';}
      if(code==='repair_required')return 'repair';
    }
    // Do not echo backend exception text or any potential credentials.
    if(!response.ok)throw new Error('Bootstrap fehlgeschlagen (HTTP '+response.status+').');
    const config=await response.json();
    sessionToken=token;
    lastConfig=config;
    showLogPanel();
    if(bridgeBoolean('platformIsVerified')!==true){
      status('Prüfe DJI Cloud API Lizenz ...');
      invoke('platformVerifyLicense',config.appId,config.appKey,config.license);
    }
    status('Registriere Arbeitsbereich ...');
    invoke('platformSetWorkspaceId',config.workspaceId);
    invoke('platformSetInformation',config.platformName,config.workspaceName,config.description);
    // Kept in memory only to support reconnects.
    mqttLogin={username:config.mqtt.username,password:config.mqtt.password};
    showRetry(false);
    if(bridgeBoolean('platformIsComponentLoaded','thing')!==true){
      status('Lade DJI Cloud-Modul ...');
      loadThing(config);
      loadTsa(config);
      loadMedia(config);
      loadWayline(config);
      loadLive(config);
      refreshDiagnostics();
      status('DJI Cloud-Modul geladen. MQTT-Verbindungsstatus wird geprüft ...');
      setTimeout(()=>window.skyhubPilotMqttState(),4000);
      return 'loaded';
    }
    loadTsa(config);
    loadMedia(config);
    loadWayline(config);
    loadLive(config);
    refreshDiagnostics();
    const state=bridgeBoolean('thingGetConnectState');
    if(state===true){
      mqttLogin=null;
      status('DJI MQTT: VERBUNDEN. Topologie-Bestätigung wird geprüft ...');
      // Allow a just-started session time for update_topo before any rebuild.
      await checkSession(false);
      setTimeout(()=>checkSession(true),15000);
      return 'connected';
    }
    if(canRetry() && throttled(RECONNECT_KEY,60000)){reconnectMqtt();return 'reconnecting';}
    showRetry(canRetry());
    status('DJI MQTT: NICHT VERBUNDEN. Automatischer Versuch lief bereits, bitte manuell erneut verbinden.');
    return 'disconnected';
  }
  function stopPairing(){
    if(pairingTimer!==null){clearTimeout(pairingTimer);pairingTimer=null;}
    show('pairing',false);
  }
  async function startPairing(){
    stopPairing();
    show('pairNew',false);
    try{
      const response=await fetch('/api/pilot/pair',{
        method:'POST',cache:'no-store',headers:{'Content-Type':'application/json'},body:'{}'
      });
      if(!response.ok)throw new Error('HTTP '+response.status);
      const pairing=await response.json();
      if(!/^\d{6}$/.test(pairing.code||''))throw new Error('ungültige Antwort');
      el('pairCode').textContent=pairing.code.slice(0,3)+' '+pairing.code.slice(3);
      show('pairing',true);
      status((repairNote?repairNote+' ':'')+'Gerät noch nicht gekoppelt. Code auf dem Pi bestätigen: node scripts/pi-pilot-pair.js '+pairing.code);
      pollPairing(pairing.pairingId);
    }catch(e){
      show('pairNew',true);
      status('Kopplung nicht möglich ('+e.message+').');
    }
  }
  function pollPairing(id){
    pairingTimer=setTimeout(async()=>{
      pairingTimer=null;
      try{
        const response=await fetch('/api/pilot/pair/'+encodeURIComponent(id),{cache:'no-store'});
        if(!response.ok)throw new Error('HTTP '+response.status);
        const result=await response.json();
        if(result.status==='pending')return pollPairing(id);
        if(result.status==='approved' && /^[0-9a-f]{64}$/.test(result.deviceToken||'')){
          storageSet(TOKEN_KEY,result.deviceToken);
          stopPairing();
          show('unpair',true);
          return connectWithToken(result.deviceToken);
        }
        // Pilot 2 runs a second page instance; it may already have received the token.
        const stored=storageGet(TOKEN_KEY);
        stopPairing();
        if(stored){show('unpair',true);return connectWithToken(stored);}
        show('pairNew',true);
        status('Kopplungscode abgelaufen. Bitte neuen Code anfordern.');
      }catch(_){pollPairing(id);}
    },2000);
  }
  async function connectWithToken(token){
    if(connecting)return;
    connecting=true;
    try{
      const outcome=await handshake(token);
      if(outcome==='unauthorized'||outcome==='repair'){
        storageDelete(TOKEN_KEY);
        show('unpair',false);
        repairNote=outcome==='repair'?REPAIR_NOTE:'';
        status(outcome==='repair'?REPAIR_NOTE+' Neue Kopplung wird gestartet ...':
          'Kopplung ungültig oder widerrufen. Neue Kopplung wird gestartet ...');
        connecting=false;
        return startPairing();
      }
    }catch(e){status('Verbindung noch nicht bestätigt: '+e.message);}
    finally{connecting=false;}
  }
  async function init(){
    try{
      const response=await fetch('/api/pilot/status',{cache:'no-store'});
      if(!response.ok)throw new Error('HTTP '+response.status);
      const data=await response.json();
      setDiagnostics(data.diagnostics===true);
      ready=data.configured===true;
      el('headline').textContent=ready?'Plattform vorbereitet':'Pilot-2-Onboarding noch deaktiviert';
      el('details').textContent=ready?
        'Gekoppelte Fernsteuerungen verbinden sich beim Öffnen dieser Seite automatisch.':
        'Noch erforderliche Konfiguration: '+(data.missing||[]).join(', ');
      el('security').hidden=isTls;
      if(!isTls)el('security').textContent='HTTPS fehlt. Aus Sicherheitsgründen werden keine Zugangsdaten über unverschlüsseltes HTTP übertragen.';
      refreshDiagnostics();
      if(!window.djiBridge){status('DJI JSBridge nicht verfügbar: Bitte die Seite innerhalb DJI Pilot 2 öffnen.');return;}
      if(!ready||!isTls)return;
      const token=storageGet(TOKEN_KEY);
      show('unpair',Boolean(token));
      if(token)await connectWithToken(token);
      else await startPairing();
    }catch(e){el('headline').textContent='Backend nicht bereit';status(e.message);}
  }
  // Pilot 2 log (pull-pilot-log): show where Pilot 2 keeps its logs, upload one file with the device token.
  // SkyHub sets no own encryption key (platformSetLogEncryptKey): the logs keep DJI's default key and SkyHub decrypts them.
  // Route uploads (pilot-wayline-import.js history): reason of a refusal, refreshed every 15 s while the page is open.
  let uploadPolling=false;
  async function refreshUploads(){
    if(!el('uploadPanel')||!sessionToken)return;
    let again=false;
    try{
      const r=await fetch('/api/pilot/wayline-uploads',{cache:'no-store',headers:{'Authorization':'Bearer '+sessionToken}});
      if(!r.ok)return;
      const b=await r.json();
      if(!b.enabled){el('uploadPanel').hidden=true;return;}
      el('uploadPanel').hidden=false;
      const list=(b.uploads||[]).slice(0,6);
      el('uploadList').replaceChildren(...(list.length?list.map(u=>{const li=document.createElement('li');
        li.textContent=new Date(u.at).toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'})+' · '+(u.name||'Route')+' · '+(u.ok?'✓ ':'✗ ')+u.text;
        return li;}):[Object.assign(document.createElement('li'),{textContent:'Noch kein Upload seit dem letzten Neustart von SkyHub.'})]));
      again=true;
    }catch(_){}
    // Poll only while the service answers; one chain at a time (showLogPanel runs on every bootstrap).
    if(again){if(!uploadPolling){uploadPolling=true;setTimeout(()=>{uploadPolling=false;refreshUploads();},15000);}}
  }
  function showLogPanel(){
    refreshUploads();
    if(!el('logPanel')||!sessionToken)return;
    el('logPanel').hidden=false;
    let p='';try{p=String(window.djiBridge.platformGetLogPath()||'');}catch(_){p='';}
    el('logPath').textContent=p?'Protokollordner in Pilot 2: '+p.slice(0,200):'Protokollordner von Pilot 2 nicht verfügbar.';
  }
  if(el('logFile'))el('logFile').addEventListener('change',()=>{el('logSend').disabled=!el('logFile').files.length;});
  if(el('logSend'))el('logSend').addEventListener('click',async()=>{
    const f=el('logFile').files[0];
    if(!f||!sessionToken)return;
    if(f.size>32*1024*1024){el('logState').textContent='Datei größer als 32 MB.';return;}
    el('logSend').disabled=true;el('logState').textContent='Wird gesendet …';
    try{
      const r=await fetch('/api/pilot/logs',{method:'POST',cache:'no-store',headers:{'Authorization':'Bearer '+sessionToken,
        'Content-Type':'application/octet-stream','X-Log-Name':f.name.replace(/[^\w.\- ()]/g,'_').slice(0,120)},body:f});
      let red=0;if(r.status===201){try{red=Number((await r.json()).redacted)||0;}catch(_){}}
      el('logState').textContent=r.status===201?'Gesendet'+(red?' ('+red+' Passwort/Token entfernt)':'')+'. In SkyHub unter „Pilot-Protokolle“ ansehen.':'Senden fehlgeschlagen (HTTP '+r.status+').';
    }catch(_){el('logState').textContent='Senden fehlgeschlagen (Netzwerk).';}
    finally{el('logSend').disabled=!el('logFile').files.length;}
  });
  el('retry').addEventListener('click',retryMqtt);
  if(el('liveStart'))el('liveStart').addEventListener('click',startLive);
  if(el('liveStop'))el('liveStop').addEventListener('click',stopLive);
  el('diagnose').addEventListener('click',refreshDiagnostics);
  el('diagnose').disabled=false;
  if(el('rebuild'))el('rebuild').addEventListener('click',rebuildSession);
  if(el('pairNew'))el('pairNew').addEventListener('click',startPairing);
  if(el('unpair'))el('unpair').addEventListener('click',()=>{
    storageDelete(TOKEN_KEY);
    show('unpair',false);
    status('Kopplung auf diesem Gerät entfernt.');
    startPairing();
  });
  init();
})();
