'use strict';
// Live-Steuerung (DRC) für DJI RC Plus 2 + Matrice 4E/4T. Die Sicherheitslogik liegt im Server (drc-session.js);
// diese Seite hält nur das Bediener-Lebenszeichen, schickt Knüppel und zeigt den Zustand.
(function(){
  const $=id=>document.getElementById(id);
  const store=(()=>{try{return window.sessionStorage;}catch{return null;}})();
  const operator=(store&&store.getItem('drcOperator'))||('op-'+crypto.getRandomValues(new Uint32Array(2)).join('-'));
  if(store)store.setItem('drcOperator',operator);
  let socket=null,state=null,target=null,targetMarker=null,aircraftMarker=null,homeMarker=null,pathLine=null,leaseTimer=null;
  const keys=new Set();

  function log(text,cls){
    const li=document.createElement('li');
    li.textContent=new Date().toLocaleTimeString()+'  '+text;
    if(cls)li.className=cls;
    $('log').prepend(li);
    while($('log').children.length>100)$('log').lastChild.remove();
  }
  const tokens=()=>({view:$('viewToken').value.trim(),drc:$('drcToken').value.trim()});
  async function call(path,body){
    const t=tokens();
    const headers={'Content-Type':'application/json','X-SkyHub-DRC-Token':t.drc,'X-SkyHub-Operator':operator};
    if(t.view)headers.Authorization='Bearer '+t.view;
    const res=await fetch('/api/drc'+path,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body),cache:'no-store'});
    const data=await res.json().catch(()=>({}));
    if(data.status)render(data.status);
    if(!res.ok)throw new Error(data.error||('HTTP '+res.status));
    return data;
  }
  async function action(label,path,body){
    try{await call(path,body??{});log(label+': OK','ok');}
    catch(err){log(label+': '+err.message,'bad');}
  }

  // --- Verbindung und Lebenszeichen ---------------------------------------------------------------------------------------
  function connect(){
    const t=tokens();
    if(!t.drc){log('Steuer-Token fehlt','bad');return;}
    if(store){store.setItem('drcView',t.view);}
    if(socket)socket.close();
    socket=io('/drc',{auth:{token:t.view||undefined,drcToken:t.drc,operator},reconnectionDelayMax:2000});
    socket.on('connect',()=>{$('conn').textContent='verbunden';$('conn').className='ok';log('Live-Verbindung steht');});
    socket.on('connect_error',err=>{$('conn').textContent='Fehler: '+err.message;$('conn').className='bad';});
    socket.on('disconnect',()=>{$('conn').textContent='getrennt';$('conn').className='bad';});
    socket.on('drc',render);
    socket.on('drc-error',m=>log(m,'bad'));
    call('/status').catch(err=>log('Status: '+err.message,'bad'));
  }
  // Lebenszeichen nur, solange "Ich steuere" an ist UND die Seite sichtbar ist. Sonst greift nach 1,5 s die Totmannschaltung.
  function leaseTick(){
    if(!socket||!socket.connected||!$('active').checked||document.visibilityState!=='visible')return;
    socket.emit('lease',r=>{if(r&&!r.ok)log(r.error,'bad');});
  }
  function setActive(on){
    clearInterval(leaseTimer);leaseTimer=null;
    if(on){leaseTimer=setInterval(leaseTick,300);leaseTick();log('Bediener aktiv');}
    else{keys.clear();log('Bediener inaktiv: Totmannschaltung greift nach 1,5 s');}
  }
  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState!=='visible'&&$('active').checked){$('active').checked=false;setActive(false);log('Tab verlassen: Steuerung abgegeben','bad');}
  });

  // --- Not-Stopp: über den Socket (schnell) und zusätzlich per HTTP -------------------------------------------------------
  function emergencyStop(){
    if(socket&&socket.connected)socket.emit('emergency-stop');
    action('NOT-STOPP','/emergency-stop');
  }
  $('estop').addEventListener('click',emergencyStop);

  // --- Karte ----------------------------------------------------------------------------------------------------------------
  const map=window.L?L.map('map').setView([51.1657,10.4515],6):null;
  if(map){
    L.tileLayer('/tiles/osm/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap-Mitwirkende'}).addTo(map);
    map.on('click',e=>{
      target={latitude:+e.latlng.lat.toFixed(6),longitude:+e.latlng.lng.toFixed(6)};
      if(targetMarker)targetMarker.setLatLng(e.latlng);else targetMarker=L.marker(e.latlng,{title:'Ziel'}).addTo(map);
      $('target').textContent='Ziel '+target.latitude+', '+target.longitude;
    });
  }
  let centered=false;
  function drawMap(s){
    if(!map||!s.aircraft)return;
    const pos=s.osd&&Number.isFinite(s.osd.latitude)?{latitude:s.osd.latitude,longitude:s.osd.longitude}:s.aircraft.position;
    if(pos&&Number.isFinite(pos.latitude)){
      const ll=[pos.latitude,pos.longitude];
      if(aircraftMarker)aircraftMarker.setLatLng(ll);else aircraftMarker=L.circleMarker(ll,{radius:8,color:'#2458d3',fillOpacity:.8}).addTo(map).bindTooltip('Fluggerät');
      if(!centered){map.setView(ll,17);centered=true;}
    }
    const home=s.aircraft.home;
    if(home&&Number.isFinite(home.latitude)){
      const ll=[home.latitude,home.longitude];
      if(homeMarker)homeMarker.setLatLng(ll);else homeMarker=L.circleMarker(ll,{radius:6,color:'#1e7b34'}).addTo(map).bindTooltip('Startpunkt');
    }
    const path=(s.flyTo&&s.flyTo.path)||(s.returnHome&&s.returnHome.path)||[];
    const pts=path.filter(p=>Number.isFinite(p.latitude)).map(p=>[p.latitude,p.longitude]);
    if(pathLine){pathLine.setLatLngs(pts);}else if(pts.length)pathLine=L.polyline(pts,{color:'#b3261e',dashArray:'6 6'}).addTo(map);
  }

  // --- Zustand anzeigen und Knöpfe freigeben ----------------------------------------------------------------------------
  const PHASE={idle:'keine Cloud-Kontrolle',auth_pending:'wartet auf Zustimmung an der Fernsteuerung',authorized:'autorisiert',
    drc_pending:'Live-Steuermodus wird aufgebaut',drc_active:'LIVE-STEUERUNG AKTIV'};
  // DJI 1.18 m4-series properties, mode_code (vollständig).
  const MODE={0:'Standby',1:'Startvorbereitung',2:'Startvorbereitung abgeschlossen',3:'Manueller Flug',4:'Automatischer Start',
    5:'Wegpunktflug',6:'Panoramaaufnahme',7:'Intelligentes Verfolgen',8:'ADS-B-Ausweichen',9:'Automatische Rückkehr',
    10:'Automatische Landung',11:'Erzwungene Landung',12:'Drei-Blatt-Landung',13:'Aktualisierung',14:'nicht verbunden',15:'APAS',
    16:'Virtueller Knüppel',17:'Live-Steuerung',18:'RTK-Fixierung in der Luft',19:'Dock-Standortprüfung'};
  function render(s){
    state=s;
    const mine=s.operator===operator,active=s.phase==='drc_active',held=s.phase==='authorized'||active;
    $('phase').textContent=PHASE[s.phase]||s.phase;$('phase').className=active?'bad':'';
    $('operator').textContent=s.operator?(mine?'du':'anderer Bediener'):'niemand';
    $('link').textContent=s.broker+' · '+s.upLink+(s.latencyMs!=null?' · '+s.latencyMs+' ms':'');
    const a=s.aircraft;
    $('aircraft').textContent=a?(a.model+' · '+a.sn):'kein Fluggerät an der RC';
    $('height').textContent=a&&Number.isFinite(a.heightAboveTakeoff)?a.heightAboveTakeoff.toFixed(1)+' m':'–';
    $('mode').textContent=a?(MODE[a.modeCode]??('Code '+a.modeCode)):'–';
    const task=s.flyTo&&s.flyTo.active?s.flyTo:(s.takeoff&&s.takeoff.active?{...s.takeoff,status:'Abheben: '+s.takeoff.status}:s.flyTo);
    $('flyto').textContent=task?(task.status+(task.remainingDistance!=null?' · noch '+Math.round(task.remainingDistance)+' m':'')):'–';
    const notes=[];
    if(s.failsafe&&s.failsafe.pending)notes.push('Totmannschaltung: '+s.failsafe.reason);
    if(s.joystickInvalid)notes.push('Knüppel gesperrt: '+s.joystickInvalid.text);
    if(s.lastError)notes.push(s.lastError);
    $('notice').textContent=notes.join(' · ')||'–';$('notice').className=notes.length?'bad':'';
    $('scale').textContent=Math.round((s.limits?.stickScale??0.5)*100);
    $('tHeight').max=s.limits?.maxHeightAboveTakeoffM??120;$('tSpeed').max=s.limits?.maxSpeedMs??10;
    $('auth').disabled=s.phase!=='idle'||!a;
    $('enter').disabled=s.phase!=='authorized'||!mine;
    $('exit').disabled=!active||!mine;
    $('release').disabled=s.phase==='idle';
    $('flyto').disabled=!held||!mine;$('flystop').disabled=!((s.flyTo&&s.flyTo.active)||(s.takeoff&&s.takeoff.active));
    $('takeoff').disabled=!held||!mine;
    $('rth').disabled=!held;$('rthcancel').disabled=!held||!mine;
    $('land').disabled=!active||!mine;$('estop').disabled=!(active||s.phase==='drc_pending');
    drawMap(s);
  }

  // --- Knöpfe -------------------------------------------------------------------------------------------------------------
  $('connect').addEventListener('click',connect);
  $('active').addEventListener('change',e=>setActive(e.target.checked));
  $('auth').addEventListener('click',()=>{if(!$('active').checked){$('active').checked=true;setActive(true);}action('Autorisierung angefordert','/auth/request');});
  $('enter').addEventListener('click',()=>action('Live-Steuermodus','/live/enter'));
  $('exit').addEventListener('click',()=>action('Live-Steuermodus beendet','/live/exit'));
  $('release').addEventListener('click',()=>action('Kontrolle zurückgegeben','/release'));
  function targetBody(){
    if(!target)throw new Error('Erst ein Ziel in der Karte setzen');
    return {...target,heightAboveTakeoff:Number($('tHeight').value),maxSpeed:Number($('tSpeed').value)};
  }
  $('flyto').addEventListener('click',()=>{try{const b=targetBody();
    if(confirm('Ziel anfliegen: '+b.latitude+', '+b.longitude+' in '+b.heightAboveTakeoff+' m über Start mit '+b.maxSpeed+' m/s?'))action('Zielanflug','/flyto',b);}
    catch(err){log(err.message,'bad');}});
  $('flystop').addEventListener('click',()=>action('Anflug gestoppt','/flyto/stop'));
  $('takeoff').addEventListener('click',()=>{try{const b=targetBody();
    const c=prompt('Das Fluggerät hebt ab und fliegt zum Ziel ('+b.heightAboveTakeoff+' m über Start). Bei Signalverlust: Rückkehr.\nZum Bestätigen ABHEBEN eingeben:');
    if(c==='ABHEBEN')action('Abheben','/takeoff',{...b,confirm:'ABHEBEN'});}catch(err){log(err.message,'bad');}});
  $('rth').addEventListener('click',()=>action('Rückkehr ausgelöst','/return-home'));
  $('rthcancel').addEventListener('click',()=>{if(confirm('Rückkehr abbrechen? Das Fluggerät schwebt dann an Ort und Stelle.'))action('Rückkehr abgebrochen','/return-home/cancel');});
  $('land').addEventListener('click',()=>{
    const c=prompt('Landen an der aktuellen Position. Hindernisse und Personen unter dem Fluggerät?\nZum Bestätigen LANDEN eingeben:');
    if(c==='LANDEN')action('Landung','/landing',{kind:'force',confirm:'LANDEN'});
  });

  // --- Knüppel: Tastatur und Gamepad (Totmanntaste LB), 10 Hz ----------------------------------------------------------------
  const KEYMAP={KeyW:['pitch',1],KeyS:['pitch',-1],KeyD:['roll',1],KeyA:['roll',-1],ArrowUp:['throttle',1],ArrowDown:['throttle',-1],
    ArrowRight:['yaw',1],ArrowLeft:['yaw',-1]};
  const typing=e=>/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
  document.addEventListener('keydown',e=>{
    if(typing(e))return;
    if(e.code==='Space'){e.preventDefault();emergencyStop();return;}
    if(KEYMAP[e.code]){e.preventDefault();keys.add(e.code);}
  });
  document.addEventListener('keyup',e=>keys.delete(e.code));
  window.addEventListener('blur',()=>keys.clear());
  const dz=v=>Math.abs(v)<0.12?0:Math.max(-1,Math.min(1,v));
  function readSticks(){
    const v={roll:0,pitch:0,throttle:0,yaw:0};
    for(const k of keys){const [ch,d]=KEYMAP[k];v[ch]+=d;}
    const pad=navigator.getGamepads?[...navigator.getGamepads()].find(Boolean):null;
    let padHeld=false;
    if(pad&&pad.buttons[4]&&pad.buttons[4].pressed){          // LB = Totmanntaste (Standard-Mapping)
      padHeld=true;
      v.yaw+=dz(pad.axes[0]||0);v.throttle+=-dz(pad.axes[1]||0);v.roll+=dz(pad.axes[2]||0);v.pitch+=-dz(pad.axes[3]||0);
    }
    for(const k of Object.keys(v))v[k]=Math.max(-1,Math.min(1,v[k]));
    return {v,any:keys.size>0||padHeld};
  }
  setInterval(()=>{
    const {v,any}=readSticks();
    $('dotL').style.setProperty('--x',v.yaw);$('dotL').style.setProperty('--y',-v.throttle);
    $('dotR').style.setProperty('--x',v.roll);$('dotR').style.setProperty('--y',-v.pitch);
    const live=state&&state.phase==='drc_active'&&state.operator===operator&&$('active').checked;
    $('stickstate').textContent=live?(any?'sendet':'bereit'):'aus';
    // Nur bei Eingabe senden; der Server ergänzt neutral und hört nach kurzer Zeit ohne Eingabe auf (Fluggerät bremst).
    if(live&&any&&socket&&socket.connected)socket.emit('stick',v);
  },100);

  if(store&&store.getItem('drcView'))$('viewToken').value=store.getItem('drcView');
})();
