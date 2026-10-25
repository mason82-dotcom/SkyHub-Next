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
  let tsaState=null; // null: not requested, otherwise a short German status for the diagnostics
  const memory=Object.create(null);
  const isTls=location.protocol==='https:';
  function status(text){el('result').textContent=text;}
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
      'Gerät gekoppelt: '+(storageGet(TOKEN_KEY)?'ja':'nein')
    ].join('\n');
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
      tsaState='Module geladen';
    }catch(e){tsaState='nicht geladen ('+e.message+')';}
    refreshDiagnostics();
  }
  window.skyhubPilotWsState=function(_callbackResult){
    // The callback payload is intentionally ignored; the state is queried instead.
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
    // Do not echo backend exception text or any potential credentials.
    if(!response.ok)throw new Error('Bootstrap fehlgeschlagen (HTTP '+response.status+').');
    const config=await response.json();
    sessionToken=token;
    lastConfig=config;
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
      refreshDiagnostics();
      status('DJI Cloud-Modul geladen. MQTT-Verbindungsstatus wird geprüft ...');
      setTimeout(()=>window.skyhubPilotMqttState(),4000);
      return 'loaded';
    }
    loadTsa(config);
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
      status('Gerät noch nicht gekoppelt. Code auf dem Pi bestätigen: node scripts/pi-pilot-pair.js '+pairing.code);
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
      if(outcome==='unauthorized'){
        storageDelete(TOKEN_KEY);
        show('unpair',false);
        status('Kopplung ungültig oder widerrufen. Neue Kopplung wird gestartet ...');
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
      ready=data.configured===true;
      el('headline').textContent=ready?'Plattform vorbereitet':'Pilot-2-Onboarding noch deaktiviert';
      el('details').textContent=ready?
        'Gekoppelte Fernsteuerungen verbinden sich beim Öffnen dieser Seite automatisch.':
        'Noch erforderliche Konfiguration: '+(data.missing||[]).join(', ');
      el('security').hidden=isTls;
      if(!isTls)el('security').textContent='HTTPS fehlt. Aus Sicherheitsgründen werden keine Zugangsdaten über unverschlüsseltes HTTP übertragen.';
      refreshDiagnostics();
      el('start').disabled=!ready||!isTls||!window.djiBridge;
      if(!window.djiBridge){status('DJI JSBridge nicht verfügbar: Bitte die Seite innerhalb DJI Pilot 2 öffnen.');return;}
      if(!ready||!isTls)return;
      const token=storageGet(TOKEN_KEY);
      show('unpair',Boolean(token));
      if(token)await connectWithToken(token);
      else await startPairing();
    }catch(e){el('headline').textContent='Backend nicht bereit';status(e.message);}
  }
  // Fallback: shared operator access token, used once and never stored.
  el('start').addEventListener('click',async()=>{
    if(!ready||!isTls||connecting)return;
    const token=el('access').value.trim();
    if(!token){status('Bitte den Pilot-Zugangstoken eingeben.');return;}
    if(!window.djiBridge){status('DJI JSBridge nicht verfügbar.');return;}
    connecting=true;el('start').disabled=true;
    try{
      const outcome=await handshake(token);
      if(outcome==='unauthorized')throw new Error('Bootstrap fehlgeschlagen (HTTP 401).');
      // Drop the manually entered token as soon as authorization succeeds.
      el('access').value='';
      stopPairing();
    }catch(e){status('Verbindung noch nicht bestätigt: '+e.message);}
    finally{connecting=false;el('start').disabled=!ready||!isTls||!window.djiBridge;}
  });
  el('retry').addEventListener('click',retryMqtt);
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
