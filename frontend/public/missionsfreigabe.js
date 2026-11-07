'use strict';
// Missionsfreigabe: Routen vom Server prüfen, für DJI Pilot 2 freigeben oder zurückziehen.
// Backend: /api/wpml/missions (Liste), /api/wpml/release (Prüfung, Freigabe; mission-release.js). Alle Regeln prüft der Server;
// diese Seite zeigt sie nur an. Texte vom Server (Namen, Prüfmeldungen) werden nur als Text eingesetzt, nie als HTML.
(function(){
  // Start view of all SkyHub maps: skyhub-map-home.js (76694 Forst); Germany if that file is missing.
  const HOME=typeof window!=='undefined'&&window.SkyHubMapHome||{lat:51.1657,lon:10.4515,zoom:6};
  const $=id=>document.getElementById(id);
  const el=(tag,props={},...children)=>{
    const n=document.createElement(tag);
    for(const [k,v] of Object.entries(props)){if(k==='class')n.className=v;else if(k in n)n[k]=v;else n.setAttribute(k,v);}
    for(const c of children)if(c!==null&&c!==undefined)n.append(c instanceof Node?c:String(c));
    return n;
  };
  // No token fields (decision 04.11.2026): reads and release/revoke work from the home LAN over HTTPS with the browser's
  // same-origin proof (wpml-lan-auth.js); fetch sends Origin on POST/DELETE automatically.
  let config=null,missions=[],active=new Map(),current=null,selectSeq=0;

  const fmtTime=ms=>Number.isFinite(ms)?new Date(ms).toLocaleString('de-DE',{dateStyle:'short',timeStyle:'short'}):'–';
  const num=(v,unit,d=0)=>Number.isFinite(v)?v.toLocaleString('de-DE',{maximumFractionDigits:d})+(unit?' '+unit:''):'–';

  async function api(path,{method='GET',body}={}){
    const res=await fetch(path,{method,cache:'no-store',credentials:'same-origin',
      headers:{Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
    const data=await res.json().catch(()=>({}));
    if(!res.ok){
      const msg=res.status===401||res.status===403?'Kein Zugriff: Diese Seite funktioniert nur im Heimnetz über https://rpi5.fritz.box:4443.'
        :res.status===404&&path.startsWith('/api/wpml/release')&&!data.error?'Missionsfreigabe ist auf diesem Server nicht eingeschaltet.'
        :(data.error||('HTTP '+res.status));
      const err=new Error(msg);err.status=res.status;err.data=data;throw err;
    }
    return data;
  }
  const setStatus=(id,text,cls='')=>{$(id).textContent=text;$(id).className=cls||'muted';};

  // --- Liste ---------------------------------------------------------------------------------------------------------------
  async function load(done){
    setStatus('accessStatus','Lade …');
    try{
      const [cfg,list,rel]=await Promise.all([api('/api/wpml/release/config'),
        window.SkyHubWpmlMissionStore.list('',{page:1,pageSize:100}),api('/api/wpml/release')]);
      config=cfg;missions=list.list||[];
      active=new Map((rel.active||[]).map(r=>[r.waylineId,r]));
      $('hours').max=cfg.hours;$('hours').value=Math.min(Number($('hours').value)||cfg.hours,cfg.hours);
      $('hoursMax').textContent='(höchstens '+cfg.hours+')';
      renderList();
      const total=list.pagination?.total??missions.length,shown=[...active.values()].filter(r=>r.visible).length;
      setStatus('accessStatus',(done?done+' ':'')+total+' Routen auf dem Server, '+shown+' in Pilot 2 sichtbar.'+
        (total>missions.length?' Angezeigt: die neuesten '+missions.length+'.':''),'ok');
      if(current)await select(current.id,false);
    }catch(err){setStatus('accessStatus',err.message,'bad');}
  }
  function renderList(){
    const body=$('routes');body.replaceChildren();
    if(!missions.length){
      body.append(el('tr',{},el('td',{colSpan:6,class:'muted'},
        'Keine Routen auf dem Server. Routen in der Routenverwaltung speichern und die MinIO-Synchronisierung einschalten.')));
      return;
    }
    const sorted=[...missions].sort((a,b)=>(b.createTime||0)-(a.createTime||0));
    for(const m of sorted){
      const r=active.get(m.id);
      const btn=el('button',{type:'button',class:'secondary'},'Prüfen');
      btn.setAttribute('aria-label','Route '+(m.name||m.id)+' prüfen');
      btn.addEventListener('click',()=>select(m.id,true));
      body.append(el('tr',{class:current&&current.id===m.id?'sel':''},
        el('td',{},m.name||m.id),el('td',{},m.aircraft||m.droneModelKey||'–'),el('td',{},num(m.waypointCount)),
        el('td',{},String(m.generation||1)),
        r&&r.visible?el('td',{class:'ok'},'sichtbar bis '+fmtTime(r.expiresAt))
          :r?el('td',{class:'bad'},'freigegeben, aber nicht sichtbar: Route oder Fluggerät passt nicht mehr – neu prüfen')
          :el('td',{class:'muted'},'nein'),
        el('td',{},btn)));
    }
  }

  // --- Aus FlightHub übernehmen (FlightHub ADR-002) -------------------------------------------------------------------------
  // The server pulls the KMZ from FlightHub Keyless and stores it unchanged; nothing is released here.
  let fhItems=[],fhBusy=false;
  const FH_TEXT=[
    [/^FlightHub not reachable/,'FlightHub ist nicht erreichbar. Läuft FlightHub Keyless auf brix?'],
    [/^FlightHub answered HTTP/,'FlightHub hat mit einem Fehler geantwortet. Später erneut versuchen.'],
    [/^FlightHub (list unreadable|answer too large)/,'Die Antwort von FlightHub ist unlesbar. FlightHub neu laden und erneut versuchen.'],
    [/^FlightHub file does not match/,'Die Datei in FlightHub hat sich geändert. FlightHub-Liste neu laden und erneut übernehmen.'],
    [/^Route not found in FlightHub/,'Die Route gibt es in FlightHub nicht mehr. FlightHub-Liste neu laden.'],
    [/^A different wayline with this name already exists/,'In der Bibliothek liegt schon eine andere Route mit diesem Namen. Route in FlightHub umbenennen und erneut übernehmen.'],
    [/^WPML validation failed|^KMZ archive rejected|^KMZ lacks/,'Die WPML-Prüfung hat Fehler gefunden. Route im Editor korrigieren und erneut übernehmen.'],
    [/^KMZ exceeds/,'Die Datei ist größer als 12 MB und kann nicht übernommen werden.']
  ];
  const fhText=msg=>{for(const [re,t] of FH_TEXT)if(re.test(msg))return t;return msg;};
  const inLibrary=id=>missions.find(m=>typeof m.sha256==='string'&&m.sha256.startsWith(id));
  async function loadFlightHub(){
    setStatus('fhStatus','Lade FlightHub-Liste …');
    try{
      fhItems=(await api('/api/wpml/missions/flighthub')).items||[];
      $('fhSection').hidden=false;
      renderFlightHub();
      setStatus('fhStatus',fhItems.length+' Routen in FlightHub.','ok');
    }catch(err){
      // 404 with configured:false: the server has no FlightHub address – the section stays hidden.
      if(err.status===404&&err.data&&err.data.configured===false){$('fhSection').hidden=true;return;}
      $('fhSection').hidden=false;$('fhRoutes').replaceChildren();
      setStatus('fhStatus',fhText(err.message),'bad');
    }
  }
  function renderFlightHub(){
    const body=$('fhRoutes');body.replaceChildren();
    if(!fhItems.length){
      body.append(el('tr',{},el('td',{colSpan:5,class:'muted'},'Keine Routen in FlightHub. Routen dort hochladen oder aus DroneRoute bzw. dem Flächenplaner senden.')));
      return;
    }
    const wanted=new URLSearchParams(location.search).get('flighthub');
    for(const w of fhItems){
      const known=inLibrary(w.id);
      const btn=el('button',{type:'button',class:'secondary'},known?'Prüfen':'In Bibliothek übernehmen');
      btn.setAttribute('aria-label',(known?'Route ':'In Bibliothek übernehmen: ')+(w.name||w.id)+(known?' prüfen':''));
      btn.addEventListener('click',()=>known?select(known.id,true):importFlightHub(w,btn));
      const row=el('tr',{class:w.id===wanted?'sel':'','data-fh':w.id},
        el('td',{},w.name||w.id),el('td',{},w.model||'–'),el('td',{},num(w.waypoints)),
        el('td',{class:known?'ok':(w.issues||[]).length?'bad':'muted'},
          known?'schon in der Bibliothek':(w.issues||[]).length?w.issues.join(' · '):'–'),
        el('td',{},btn));
      body.append(row);
      if(w.id===wanted&&!fhItems.scrolled){fhItems.scrolled=true;row.scrollIntoView({block:'center'});btn.focus({preventScroll:true});}
    }
  }
  async function importFlightHub(w,btn){
    if(fhBusy)return;                                  // one take-over at a time, no double POST
    fhBusy=true;btn.disabled=true;$('fhErrorsBox').hidden=true;
    setStatus('fhStatus','Übernehme „'+(w.name||w.id)+'“ …');
    try{
      const r=await api('/api/wpml/missions/import/flighthub',{method:'POST',body:{id:w.id}});
      await load((r.created?'Übernommen':'Schon vorhanden')+': „'+r.name+'“. Jetzt prüfen und freigeben.');
      renderFlightHub();
      setStatus('fhStatus','„'+r.name+'“ liegt in der Bibliothek – noch nicht freigegeben.','ok');
      await select(r.id,true);
    }catch(err){
      setStatus('fhStatus','„'+(w.name||w.id)+'“ nicht übernommen: '+fhText(err.message),'bad');
      const errs=(err.data&&err.data.errors)||[];
      $('fhErrors').replaceChildren(...errs.map(e=>el('li',{},(e.path?e.path+': ':'')+e.message)));
      $('fhErrorsBox').hidden=!errs.length;
    }finally{fhBusy=false;btn.disabled=false;}
  }

  // German display of the server check messages (mission-envelope.js). The confirmation still sends the original text.
  const DE=[
    [/^WPML 1\.0\.6 as written by DJI Pilot 2/,()=>'Route im Format WPML 1.0.6 aus DJI Pilot 2: SkyHub hat die Flughülle geprüft, die Datei wird unverändert freigegeben (der SkyHub-Editor schreibt 1.0.2).'],
    [/^no return-to-home height in the route/,()=>'Keine Rückkehrhöhe in der Route: Das Fluggerät nutzt die in Pilot 2 eingestellte Rückkehrhöhe – vor dem Start dort prüfen.'],
    [/^wayline (\d+): terrain follow \(height above ground\) for the Matrice 4/,m=>'Abschnitt '+m[1]+': Geländefolge (Höhe über Grund) für die Matrice 4, wie von Pilot 2 erzeugt – Geländedaten und Sensorik in Pilot 2 müssen funktionieren.'],
    [/^terrain from (\S+) \(LGL DGM1 1 m bare earth where available, otherwise 30 m; buildings, trees and masts not included\): highest ([-\d.]+) m and lowest ([-\d.]+) m above ground/,
      m=>'Gelände ('+m[1]+': LGL-DGM1 1 m wo vorhanden, sonst 30 m; ohne Gebäude, Bäume und Masten): höchstens '+m[2]+' m, mindestens '+m[3]+' m über Grund. Hindernisse vor Ort prüfen.'],
    [/^terrain from (\S+) \(25-30 m grid, buildings, trees and masts not reliably included\): highest ([-\d.]+) m and lowest ([-\d.]+) m above ground/,
      m=>'Gelände ('+m[1]+', Raster 25–30 m, Gebäude, Bäume und Masten nicht verlässlich enthalten): höchstens '+m[2]+' m, mindestens '+m[3]+' m über Grund. Hindernisse trotzdem vor Ort prüfen.'],
    [/^terrain: take-off point assumed at the first waypoint \(ground ([-\d.]+) m\)/,m=>'Gelände: Startpunkt als erster Wegpunkt angenommen (Boden '+m[1]+' m). Ein anderer Startpunkt verschiebt alle Höhen über Grund.'],
    [/^terrain: ([-\d.]+) m above ground near waypoint (\d+) exceeds ([\d.]+) m/,m=>'Gelände: '+m[1]+' m über Grund bei Wegpunkt '+m[2]+' – mehr als '+m[3]+' m.'],
    [/^terrain: only ([-\d.]+) m above ground near waypoint (\d+) \(below ([\d.]+) m\)/,m=>'Gelände: nur '+m[1]+' m über Grund bei Wegpunkt '+m[2]+' (unter '+m[3]+' m).'],
    [/^terrain: (\d+) route points without elevation data/,m=>'Gelände: '+m[1]+' Routenpunkte ohne Höhendaten.'],
    [/^droneSubEnumValue (\d+) \(([^)]+)\) does not match camera (\d+) of the ([^:]+): treated as/,m=>'Route nennt '+m[2]+' (Untertyp '+m[1]+'), die Kamera '+m[3]+' gehört aber zur '+m[4]+'. Wie in Pilot 2 gilt die Kamera: Route wird als '+m[4]+' behandelt. Fluggerät in Pilot 2 prüfen.'],
    [/^geozone: (.+) \(([^,)]+)(?:, ([^)]+))?\) waypoints (\d+)-(\d+), (\d+) % of the route/,m=>'Geozone: '+m[1]+' ('+m[2]+(m[3]?', '+m[3]:'')+') – Wegpunkte '+m[4]+' bis '+m[5]+', '+m[6]+' % der Route. Genehmigung oder Auflagen in dipul prüfen.'],
    [/^geozones not checked: dipul unavailable/,()=>'Geozonen nicht geprüft: dipul nicht erreichbar – Route selbst in dipul.de prüfen.'],
    [/^geozones partly checked: (\d+) dipul layers unavailable \(([^)]*)\)/,m=>'Geozonen nur teilweise geprüft: '+m[1]+' dipul-Ebenen nicht erreichbar ('+m[2]+').'],
    [/^geozones: no published dipul zone on the route/,()=>'Geozonen: keine in dipul veröffentlichte Zone auf der Route (nur dipul-Daten; vorübergehende und örtliche Beschränkungen können fehlen).'],
    [/^terrain not checked: elevation service unavailable/,()=>'Gelände nicht geprüft: Höhendienst nicht erreichbar – Höhen über Grund selbst prüfen.'],
    [/^no take-off reference point/,()=>'Kein Startbezugspunkt: Entfernung und Dauer sind ab dem ersten Wegpunkt gerechnet.'],
    [/^heights are relative to the take-off point, not to the ground.*exceed ([\d.]+) m/,m=>'Höhen gelten relativ zum Startpunkt, nicht zum Boden: Gelände entlang der Route prüfen (ansteigendes Gelände verringert den Abstand, abfallendes kann mehr als '+m[1]+' m über Grund ergeben).'],
    [/^lowest waypoint ([\d.]+) m above take-off/,m=>'Niedrigster Wegpunkt '+m[1]+' m über Start: Hindernisabstand prüfen.'],
    [/^two waypoints only ([\d.]+) m apart/,m=>'Zwei Wegpunkte liegen nur '+m[1]+' m auseinander.'],
    [/^signal loss does not trigger return-to-home/,()=>'Bei Verbindungsverlust gibt es keine Rückkehr zum Start.'],
    [/^finish action is "?(\w+)"?, not return-to-home/,m=>'Nach dem Flug: „'+m[1]+'“ statt Rückkehr zum Start.'],
    [/^wayline (\d+): WGS84 \(ellipsoid\) heights/,m=>'Abschnitt '+m[1]+': Ellipsoidhöhen (WGS84); die Höhe über Start beruht auf dem geplanten Bezugspunkt, geflogen wird ab dem tatsächlichen Startpunkt.'],
    [/^height ([\d.]+) m above take-off exceeds ([\d.]+) m/,m=>'Höhe '+m[1]+' m über Start überschreitet '+m[2]+' m.'],
    [/^RTH height ([\d.]+) m exceeds ([\d.]+) m/,m=>'Rückkehrhöhe '+m[1]+' m überschreitet '+m[2]+' m.'],
    [/^speed ([\d.]+) m\/s exceeds ([\d.]+) m\/s/,m=>'Geschwindigkeit '+m[1]+' m/s überschreitet '+m[2]+' m/s.'],
    [/^estimated flight time ([\d.]+) min exceeds ([\d.]+) min/,m=>'Geschätzte Flugzeit '+m[1]+' min überschreitet '+m[2]+' min.'],
    [/^route reaches ([\d.]+) m from its origin, more than ([\d.]+) m/,m=>'Die Route entfernt sich '+m[1]+' m vom Start, erlaubt sind '+m[2]+' m.'],
    [/^waylines\.wpml unreadable/,()=>'waylines.wpml nicht lesbar.'],
    [/^wpml:globalRTHHeight missing/,()=>'Rückkehrhöhe (globalRTHHeight) fehlt.'],
    [/^dock-only aircraft/,()=>'Fluggerät nur für das Dock: vor Ort kann keine Fernsteuerung diese Route fliegen.'],
    [/^aircraft \(wpml:droneEnumValue\) missing/,()=>'Die Route nennt kein Fluggerät.']
  ];
  function german(msg){for(const [re,f] of DE){const m=re.exec(msg);if(m)return f(m);}return null;}
  function message(msg){
    const de=german(msg);
    return de?el('span',{},de,el('br'),el('span',{class:'small muted'},'Original: '+msg)):el('span',{},msg);
  }

  // --- Prüfung und Freigabe -------------------------------------------------------------------------------------------------
  const ENVELOPE=[
    ['aircraft','Fluggerät',v=>v||'–'],['wpmlVersion','WPML-Version',v=>v||'–'],['waylines','Routenabschnitte',v=>num(v)],['waypoints','Wegpunkte',v=>num(v)],
    ['maxHeightAboveTakeoffM','Höchste Höhe über Start',v=>num(v,'m',1)],['minHeightAboveTakeoffM','Niedrigste Höhe über Start',v=>num(v,'m',1)],
    ['rthHeightM','Rückkehrhöhe',v=>v==null?'nicht in der Route (Einstellung in Pilot 2)':num(v,'m',1)],['takeOffSecurityHeightM','Sicherheitssteighöhe',v=>num(v,'m',1)],
    ['maxSpeedMs','Höchste Geschwindigkeit',v=>num(v,'m/s',1)],['lengthM','Streckenlänge',v=>num(v,'m')],
    ['estimatedDurationMin','Geschätzte Flugzeit',v=>num(v,'min',1)],['maxDistanceFromOriginM','Größte Entfernung vom Start',v=>num(v,'m')],
    ['heightModes','Höhenbezug',v=>(v||[]).map(h=>({relativeToStartPoint:'relativ zum Start',realTimeFollowSurface:'über Grund',WGS84:'Ellipsoid (WGS84)'}[h]||h)).join(', ')||'–'],
    ['finishAction','Nach dem Flug',v=>({goHome:'Rückkehr zum Start',noAction:'keine Aktion',autoLand:'Landen',gotoFirstWaypoint:'zum ersten Wegpunkt'}[v]||v||'–')],
    ['terrain','Gelände (über Grund)',t=>!t?'nicht geprüft (kein Höhendienst eingestellt)':t.status==='ok'?
      t.minAgl.aglM+' bis '+t.maxAgl.aglM+' m ('+t.dataset+(t.assumedTakeoff?', Start = 1. Wegpunkt':'')+')':
      t.status==='skipped'?(t.reason==='terrain-follow'?'Geländefolge der Route':'WGS84-Höhen, nicht umgerechnet'):'Dienst nicht erreichbar'],
    ['geozones','Geozonen (dipul)',g=>!g?'nicht geprüft (Geozonen-Prüfung aus)':g.status==='ok'?
      (g.zones.length?g.zones.length+' berührt: '+g.zones.slice(0,4).map(z=>z.name+' ('+(z.typeCode||z.layer)+')').join(', ')+(g.zones.length>4?' …':''):'keine veröffentlichte Zone')+
      (g.layersFailed.length?' · '+g.layersFailed.length+' Ebenen nicht erreichbar':''):'dipul nicht erreichbar'],
    ['exitOnRCLost','Bei Verbindungsverlust',v=>({goContinue:'Route fortsetzen',executeLostAction:'Notfallaktion ausführen'}[v]||v||'–')]
  ];
  async function select(id,focus){
    const seq=++selectSeq;                 // only the newest selection may update the page (late answers are dropped)
    try{
      const d=await api('/api/wpml/release/'+encodeURIComponent(id));
      if(seq!==selectSeq)return;
      current=d;renderList();renderDetail();
      if(focus)$('h-detail').focus();
    }catch(err){setStatus('accessStatus',err.message,'bad');}
  }
  function checkbox(name,text){
    const box=el('input',{type:'checkbox',name});
    box.addEventListener('change',updateReleaseButton);
    return el('label',{class:'check'},box,typeof text==='string'?el('span',{},text):text);
  }
  // Map of the flight line (Leaflet, offline OSM tile cache; dipul geozones switchable).
  let rmap=null,rlayer=null;
  function renderMap(d){
    if(!window.L)return;
    if(!rmap){
      rmap=L.map('rmap',{zoomControl:true,scrollWheelZoom:false}).setView([HOME.lat,HOME.lon],HOME.zoom);
      L.tileLayer('/tiles/osm/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap-Mitwirkende',
        referrerPolicy:'strict-origin-when-cross-origin'}).addTo(rmap);
      if(window.SkyHubGeozones)window.SkyHubGeozones.attach(rmap);
    }
    if(rlayer)rmap.removeLayer(rlayer);
    rlayer=L.layerGroup().addTo(rmap);
    const pts=(d.track||[]).filter(p=>Number.isFinite(p[0])&&Number.isFinite(p[1])).map(p=>[p[0],p[1]]);
    if(pts.length>1)L.polyline(pts,{color:'#2458d3',weight:3,opacity:.9}).addTo(rlayer);
    if(pts.length){
      L.circleMarker(pts[0],{radius:7,color:'#1e7b34',fillOpacity:.9}).bindTooltip('Erster Wegpunkt').addTo(rlayer);
      L.circleMarker(pts.at(-1),{radius:6,color:'#b3261e',fillOpacity:.9}).bindTooltip('Letzter Wegpunkt').addTo(rlayer);
    }
    if(d.takeoff)L.circleMarker(d.takeoff,{radius:6,color:'#5b6b84',fillOpacity:.6}).bindTooltip('Startbezugspunkt').addTo(rlayer);
    const t=d.check.envelope&&d.check.envelope.terrain;
    if(t&&t.status==='ok'){
      L.circleMarker([t.maxAgl.lat,t.maxAgl.lon],{radius:5,color:'#c26a00'}).bindTooltip('Höchster Punkt über Grund: '+t.maxAgl.aglM+' m').addTo(rlayer);
      L.circleMarker([t.minAgl.lat,t.minAgl.lon],{radius:5,color:'#c26a00'}).bindTooltip('Niedrigster Punkt über Grund: '+t.minAgl.aglM+' m').addTo(rlayer);
    }
    setTimeout(()=>{rmap.invalidateSize();if(pts.length)rmap.fitBounds(L.latLngBounds(pts).pad(.15),{maxZoom:18});},0);
    $('rmapNote').hidden=!pts.length;
  }
  function renderDetail(){
    const d=current,c=d.check;
    $('detail').hidden=false;
    renderMap(d);
    $('dName').textContent=d.name||d.id;
    $('dState').textContent=c.ok?'Prüfung bestanden. Revision '+(d.generation||1)+', SHA-256 '+d.sha256.slice(0,12)+'…'
      :'Prüfung nicht bestanden: '+c.errors.length+' Fehler.';
    $('dState').className=c.ok?'ok':'bad';
    const dl=$('envelope');dl.replaceChildren();
    for(const [k,label,f] of ENVELOPE)if(c.envelope)dl.append(el('dt',{},label),el('dd',{},f(c.envelope[k])));
    const terr=c.envelope&&c.envelope.terrain;
    $('profileBox').hidden=!terr;
    if(terr&&window.SkyHubElevationProfile)window.SkyHubElevationProfile.render($('profile'),terr,
      {maxHeightM:(config&&config.limits&&config.limits.maxHeightM)||120,minAglM:(config&&config.terrain&&config.terrain.minAglM)||15});
    $('errorsBox').hidden=!c.errors.length;
    $('errors').replaceChildren(...c.errors.map(e=>el('li',{},message(e))));
    $('warningsBox').hidden=!c.warnings.length;
    $('warnings').replaceChildren(...c.warnings.map((w,i)=>checkbox('w'+i,message(w))));
    $('checklist').replaceChildren(...Object.entries(config?.checklist||{}).map(([k,t])=>checkbox('c:'+k,t)));
    $('checklistBox').disabled=!c.ok;$('warningsBox').disabled=!c.ok;
    $('activeBox').hidden=!d.active;
    if(d.active)$('activeText').textContent='Sichtbar in Pilot 2 bis '+fmtTime(d.active.expiresAt)+' (freigegeben '+fmtTime(d.active.releasedAt)+').';
    $('history').replaceChildren(...(d.history.length?d.history.map(h=>el('li',{},
      'Freigegeben '+fmtTime(h.releasedAt)+' bis '+fmtTime(h.expiresAt)+
      (h.revokedAt?' · zurückgezogen '+fmtTime(h.revokedAt)+(h.revokeReason?' ('+h.revokeReason+')':''):''))):[el('li',{class:'muted'},'Noch nie freigegeben.')]));
    updateReleaseButton();
  }
  function confirmations(){
    const boxes=[...document.querySelectorAll('#warnings input,#checklist input')];
    return {all:boxes.length>0&&boxes.every(b=>b.checked),open:boxes.filter(b=>!b.checked).length};
  }
  function updateReleaseButton(){
    if(!current)return;
    const c=current.check,{all,open}=confirmations();
    $('release').disabled=!c.ok||!all;
    $('releaseHint').className='small muted';
    $('releaseHint').textContent=!c.ok?'Mit Fehlern ist keine Freigabe möglich.'
      :!all?'Noch '+open+' Punkt'+(open===1?'':'e')+' zu bestätigen.'
      :current.active?'Diese Revision ist bereits freigegeben; eine neue Freigabe beginnt die Gültigkeit von vorn.'
      :'Eine Freigabe ersetzt eine aktive Freigabe einer anderen Revision dieser Route.';
  }
  async function release(){
    const d=current,hours=Number($('hours').value),max=config?.hours||72;
    if(!Number.isInteger(hours)||hours<1||hours>max){
      setStatus('releaseHint','Gültigkeit als ganze Stunden zwischen 1 und '+max+' eingeben.','bad');$('hours').focus();return;}
    if(!confirm('Route „'+(d.name||d.id)+'“ für '+hours+' Stunden in DJI Pilot 2 freigeben?\n\n'+
      'Der Pilot kann sie dann auf der Fernsteuerung laden und starten. Eine aktive Freigabe einer anderen Revision dieser Route endet dabei.'))return;
    try{
      await api('/api/wpml/release/'+encodeURIComponent(d.id)+'/release',{method:'POST',body:{sha256:d.sha256,
        acknowledgedWarnings:d.check.warnings,hours,checklist:Object.fromEntries(Object.keys(config.checklist).map(k=>[k,true]))}});
      await load('Freigegeben: „'+(d.name||d.id)+'“ für '+hours+' h.');
    }catch(err){
      const missing=err.data&&Array.isArray(err.data.missing)?' Offen: '+err.data.missing.join('; '):'';
      setStatus('releaseHint',err.message+missing,'bad');
      // Route or check changed on the server (hash, warnings): reload the check so the confirmations match again.
      if(err.status===409||err.status===422){await select(d.id,false);setStatus('releaseHint',err.message+missing+' Prüfung neu geladen, bitte erneut bestätigen.','bad');}
    }
  }
  async function revoke(){
    const d=current;
    if(!confirm('Freigabe von „'+(d.name||d.id)+'“ zurückziehen?\n\nDie Route verschwindet sofort aus der Pilot-2-Bibliothek. '+
      'Eine bereits auf die Fernsteuerung geladene Kopie kann SkyHub nicht löschen – dem Piloten Bescheid geben.'))return;
    try{
      await api('/api/wpml/release/'+encodeURIComponent(d.id)+'/release',{method:'DELETE',
        body:{reason:$('revokeReason').value.trim()||'zurückgezogen'}});
      $('revokeReason').value='';
      await load('Freigabe zurückgezogen: „'+(d.name||d.id)+'“ ist nicht mehr in Pilot 2 sichtbar.');
    }catch(err){setStatus('releaseHint',err.message,'bad');}
  }

  // load(done) takes a status prefix; a bare listener would pass the click event ("[object PointerEvent]").
  $('reload').addEventListener('click',()=>load().then(()=>{if(!$('fhSection').hidden)renderFlightHub();}));
  $('fhReload').addEventListener('click',()=>loadFlightHub());
  $('release').addEventListener('click',release);
  $('revoke').addEventListener('click',revoke);
  // FlightHub list after the library: "schon in der Bibliothek" compares with the loaded routes.
  load().then(loadFlightHub);
})();
