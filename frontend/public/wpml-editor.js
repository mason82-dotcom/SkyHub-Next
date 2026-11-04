'use strict';
// Client-only waypoint editor; never calls DJI/MQTT/SkyHub write endpoints.
(function () {
  const core=window.SkyHubWpmlPlanner;
  const reference=window.SkyHubWpmlWaylinesReference;
  const reviewCore=window.SkyHubWpmlMissionReview;
  // KMZ import is local; the store client is the editor's only (explicit) network path.
  const kmzImport=window.SkyHubWpmlKmzImport;
  const store=window.SkyHubWpmlMissionStore;
  const $=id=>document.getElementById(id);
  if(!core){$('message').textContent='WPML-Modul nicht geladen – kein Export möglich.';return;}
  const points=[];
  let map=null,markers=[],line=null,hasFit=false;
  // Turn mode of the route ('stop' or 'pass' with damping); an orbit sets 'pass', clearing the route resets it.
  let routeTurn={mode:'stop',damping:null},orbitPicking=false,poiLayer=null;
  // Undo history of waypoint edits (bounded, in memory only).
  const history=[];
  function remember(){
    history.push(points.map(p=>({...p})));
    if(history.length>50)history.shift();
  }
  function undo(){
    const previous=history.pop();
    if(!previous)return;
    points.splice(0,points.length,...previous);
    render();
    renderMessage('Letzte Wegpunktänderung rückgängig gemacht.');
  }
  const renderMessage=(message,error=false)=>{
    $('message').textContent=message;
    $('message').style.color=error?'var(--sky-warning)':'var(--sky-ink)';
  };
  if(typeof window.L==='object'&&typeof window.L.map==='function'){
    map=L.map('map',{zoomControl:true}).setView([50.5,10.4],6);
    // Keep document referrer private, but identify the page origin to OSM tiles.
    // OSMF explicitly requires an HTTP Referer; Leaflet 1.9.4 supports this option.
    L.tileLayer('/tiles/osm/{z}/{x}/{y}.png',{
      maxZoom:19,attribution:'© OpenStreetMap contributors',
      referrerPolicy:'strict-origin-when-cross-origin'
    }).addTo(map);
    if(window.SkyHubGeozones)window.SkyHubGeozones.attach(map);
    map.on('click',event=>{
      if(orbitPicking){setOrbitCenter(event.latlng.lat,event.latlng.lng);return;}
      addPoint(event.latlng.lat,event.latlng.lng);
    });
  }else{
    $('map').textContent='Kartendienst nicht verfügbar. Wegpunkte können weiterhin manuell hinzugefügt und als KMZ exportiert werden.';
    $('map').style.padding='32px 18px';
  }
  function updateReview(){
    const target=$('mission-review');
    if(!target)return;
    if(!reviewCore){
      target.textContent='Lokale Missionsprüfung nicht geladen. Kein Flugbereitschaftsnachweis.';
      return;
    }
    try{
      // Match the exporter's decimal-only camera cadence parser, rather than
      // accepting JS number syntax (e.g. 1e2 / hex) that WPML refuses.
      const decimalField=id=>{
        const raw=$(id).value.trim();
        return /^(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw)?Number(raw):NaN;
      };
      const numericField=id=>{
        const raw=$(id).value.trim();
        return raw===''?NaN:Number(raw);
      };
      const cameraRaw=$('photo-camera-min').value.trim();
      const output=reviewCore.analyze({
        name:$('name').value,
        waypoints:points,
        model:$('model').value,
        speed:numericField('speed'),
        globalHeight:numericField('height'),
        takeoffHeight:numericField('takeoff'),
        ...($('rth')&&String($('rth').value).trim()!==''?{rthHeight:numericField('rth')}:{}),
        finishAction:$('finish').value,
        localHeights:$('local-heights').checked,
        photoTrigger:$('photo-trigger').value,
        photoInterval:$('photo-trigger').value==='reachPoint'?null:decimalField('photo-interval'),
        cameraMinIntervalSeconds:cameraRaw===''?null:decimalField('photo-camera-min')
      });
      const status=output.status==='incomplete'?'UNVOLLSTÄNDIG':
        output.status==='invalid'?'EINGABEN PRÜFEN':'ENTWURF – SICHTPRÜFUNG NÖTIG';
      const distance=output.horizontalDistanceMeters===null?'nicht berechenbar':
        (output.horizontalDistanceMeters/1000).toFixed(2)+' km';
      const segment=output.longestSegmentMeters===null?'nicht berechenbar':
        output.longestSegmentMeters+' m';
      const nominal=output.nominalStraightTravelSeconds===null?'nicht berechenbar':
        Math.ceil(output.nominalStraightTravelSeconds/60)+' min';
      const photos=output.periodicPhotoMode?
        'Intervallauslösung: Anzahl Fotos unbekannt (nicht simuliert)':
        output.waypointPhotoCount+' markierte Wegpunkt-Fotos';
      const issues=output.issueCodes.map(code=>reviewCore.issueLabel(code)).filter(Boolean);
      target.textContent=status+' · '+output.waypointCount+' Wegpunkte. '+
        '2D-Luftliniensegmente gesamt ca. '+distance+', größtes Segment ca. '+segment+
        '. Nominell nur Strecke / Sollgeschwindigkeit: '+nominal+
        ' (KEINE Flugzeit). '+photos+'. '+
        (issues.length?'Prüfhinweise: '+issues.join(' '):'Keine formalen Prüfhinweise aus dieser eingeschränkten Prüfung. ')+
        ' KEINE Flugfreigabe. Nicht DJI Pilot 2 / Hardware verifiziert.';
    }catch(_error){
      // Deliberately do not expose untrusted parser or coordinate values.
      target.textContent='Lokale Prüfung fehlgeschlagen oder Eingaben unvollständig. Keine Flugfreigabe.';
    }
  }
  function normalizeCoordinate(raw,min,max){
    if(typeof raw!=='number'||!Number.isFinite(raw)||raw<min||raw>max)return null;
    return Math.round(raw*10000000)/10000000;
  }
  // --- Orbit around a point of interest (core.orbit) --------------------------------------------------------------------
  function setOrbitCenter(lat,lon){
    $('orbit-lat').value=String(Math.round(lat*1e7)/1e7);$('orbit-lon').value=String(Math.round(lon*1e7)/1e7);
    orbitPicking=false;$('orbit-pick').setAttribute('aria-pressed','false');$('orbit-pick').textContent='Objekt in der Karte wählen';
    $('orbit-status').textContent='Objekt gesetzt. Jetzt „Orbit erzeugen“.';
  }
  $('orbit-pick').addEventListener('click',()=>{
    orbitPicking=!orbitPicking;
    $('orbit-pick').setAttribute('aria-pressed',String(orbitPicking));
    $('orbit-pick').textContent=orbitPicking?'Klick in die Karte setzt das Objekt … (abbrechen)':'Objekt in der Karte wählen';
    $('orbit-status').textContent=orbitPicking?'Nächster Kartenklick setzt das Objekt (kein Wegpunkt).':'';
  });
  $('orbit-create').addEventListener('click',()=>{
    try{
      const o=core.orbit({center:{lat:$('orbit-lat').value,lon:$('orbit-lon').value},radiusM:$('orbit-radius').value,
        points:$('orbit-points').value,heightM:$('orbit-height').value,poiHeightM:$('orbit-poi-height').value,
        direction:$('orbit-direction').value,startBearing:$('orbit-start').value,photo:$('orbit-photo').checked});
      if(points.length&&!window.confirm('Die '+points.length+' vorhandenen Wegpunkte durch den Orbit ersetzen?'))return;
      remember();
      $('local-heights').checked=false;
      $('height').value=String(o.waypoints[0].height);
      points.splice(0,points.length,...o.waypoints.map(p=>({...p,poi:{...p.poi}})));
      routeTurn={mode:'pass',damping:o.turnDampingM};
      if($('photo-trigger').value!=='reachPoint'){$('photo-trigger').value='reachPoint';photoModeUpdate();}
      hasFit=false;render();
      $('orbit-status').textContent='Orbit: '+(o.waypoints.length-1)+' Punkte, '+o.lengthM+' m Kreis, Abschnitte '+o.segmentM+
        ' m, Gimbal '+o.gimbalPitch+'°, Kurven durchfliegend. Vor dem Flug in Pilot 2 prüfen.';
      renderMessage('Orbit erzeugt. Die Nase zeigt zum Objekt; die Gimbal-Neigung wird an jedem Punkt gesetzt.');
    }catch(error){
      const why=error&&error.message?error.message.replace(/^.*invalid: /,''):'';
      const de={'orbit center required':'Objekt fehlt','orbit center latitude':'Breitengrad des Objekts','orbit center longitude':'Längengrad des Objekts',
        'orbit radius':'Radius (5–500 m)','orbit points':'Wegpunkte (4–72)','orbit height':'Flughöhe (2–120 m)','POI height':'Objekthöhe (0–120 m)',
        'start bearing':'Startrichtung (0–360°)'};
      const key=Object.keys(de).find(k=>why.startsWith(k));
      $('orbit-status').textContent='Bitte prüfen: '+(key?de[key]:why||'Orbit fehlgeschlagen')+'.';
    }
  });
  function addPoint(lat,lon){
    const latitude=normalizeCoordinate(lat,-90,90);
    const longitude=normalizeCoordinate(lon,-180,180);
    if(latitude===null||longitude===null){renderMessage('Koordinaten sind ungültig.',true);return;}
    if(points.length>=500){renderMessage('Maximal 500 Wegpunkte.',true);return;}
    if(points.length&&points[points.length-1].lat===latitude&&points[points.length-1].lon===longitude){
      renderMessage('Aufeinanderfolgende identische Wegpunkte sind nicht erlaubt.',true);return;
    }
    const defaultHeight=Number($('height').value);
    remember();
    points.push({lat:latitude,lon:longitude,height:defaultHeight,photo:false});
    $('latitude').value=String(latitude);
    $('longitude').value=String(longitude);
    render();
  }
  function swap(i,j){
    if(j<0||j>=points.length)return;
    remember();
    [points[i],points[j]]=[points[j],points[i]];
    render();
  }
  function action(label,callback){
    const b=document.createElement('button');
    b.type='button';b.textContent=label;
    b.addEventListener('click',callback);return b;
  }
  function renderList(){
    const list=$('waypoints');
    list.replaceChildren();
    $('count').textContent=points.length+' / 500';
    points.forEach((point,index)=>{
      const item=document.createElement('div');
      item.className='waypoint';item.setAttribute('role','listitem');
      const title=document.createElement('strong');
      title.textContent='Wegpunkt '+(index+1);item.appendChild(title);
      const detail=document.createElement('small');
      detail.textContent=point.lat.toFixed(7)+'° N/S, '+point.lon.toFixed(7)+'° E/W';
      item.appendChild(detail);
      const photoLabel=document.createElement('label');photoLabel.className='photo';
      const checkbox=document.createElement('input');checkbox.type='checkbox';
      checkbox.checked=point.photo;
      checkbox.disabled=$('photo-trigger').value!=='reachPoint';
      checkbox.setAttribute('aria-label','Foto an Wegpunkt '+(index+1));
      checkbox.addEventListener('change',()=>{point.photo=checkbox.checked;updateReview();renderMessage('Entwurf aktualisiert.');});
      photoLabel.append(checkbox,document.createTextNode('Einzelbild aufnehmen'));
      item.appendChild(photoLabel);
      if($('local-heights').checked){
        const alt=document.createElement('div');alt.className='rows';
        const relative=document.createElement('label');
        relative.textContent='Relative Höhe (m)';
        const relInput=document.createElement('input');
        relInput.type='number';relInput.min='2';relInput.max='120';relInput.step='any';
        relInput.required=true;
        relInput.value=point.height===undefined?'':String(point.height);
        relInput.setAttribute('aria-label','Wegpunkt '+(index+1)+' relative Höhe');
        relInput.addEventListener('input',()=>{
          point.height=relInput.value===''?undefined:Number(relInput.value);
          updateReview();
        });
        relative.appendChild(relInput);
        const geodetic=document.createElement('label');
        geodetic.textContent='WGS84-Ellipsoidhöhe (m)';
        const ellipsoid=document.createElement('input');
        ellipsoid.type='number';ellipsoid.min='-10000';ellipsoid.max='100000';
        ellipsoid.step='any';ellipsoid.required=true;
        ellipsoid.value=point.ellipsoidHeight===undefined?'':String(point.ellipsoidHeight);
        ellipsoid.setAttribute('aria-label','Wegpunkt '+(index+1)+' WGS84 Ellipsoidhöhe');
        ellipsoid.addEventListener('input',()=>{
          if(ellipsoid.value==='')delete point.ellipsoidHeight;
          else point.ellipsoidHeight=Number(ellipsoid.value);
          updateReview();
        });
        geodetic.appendChild(ellipsoid);
        alt.append(relative,geodetic);
        item.appendChild(alt);
      }
      const controls=document.createElement('div');controls.className='actions';
      const up=action('↑',()=>swap(index,index-1));up.disabled=index===0;up.title='Wegpunkt nach oben';
      const down=action('↓',()=>swap(index,index+1));down.disabled=index===points.length-1;down.title='Wegpunkt nach unten';
      const deleteButton=action('Entfernen',()=>{remember();points.splice(index,1);render();});
      controls.append(up,down,deleteButton);
      if(index<points.length-1&&points.length<500){
        // Geometric midpoint between two neighbours (short-arc safe for small legs).
        const insert=action('+ Mitte',()=>{
          const next=points[index+1];
          let dLon=next.lon-point.lon;
          if(dLon>180)dLon-=360;else if(dLon<-180)dLon+=360;
          let lon=point.lon+dLon/2;
          if(lon>180)lon-=360;else if(lon<-180)lon+=360;
          remember();
          points.splice(index+1,0,{lat:normalizeCoordinate((point.lat+next.lat)/2,-90,90),
            lon:normalizeCoordinate(lon,-180,180),height:point.height,photo:false});
          render();
          renderMessage('Wegpunkt zwischen '+(index+1)+' und '+(index+2)+' eingefügt.'+
            ($('local-heights').checked?' Bitte Ellipsoidhöhe des neuen Wegpunkts messen und eintragen.':''));
        });
        insert.title='Wegpunkt in der Mitte zum nächsten einfügen';
        controls.append(insert);
      }
      item.appendChild(controls);
      list.appendChild(item);
    });
  }
  function renderMap(){
    if(!map)return;
    for(const marker of markers)marker.remove();
    markers=[];
    if(line){line.remove();line=null;}
    if(!points.length)return;
    for(let i=0;i<points.length;i++){
      const p=points[i];
      const marker=L.marker([p.lat,p.lon],{draggable:true})
        .bindTooltip('WP '+(i+1))
        .addTo(map);
      marker.on('dragend',()=>{
        const pos=marker.getLatLng();
        remember();
        p.lat=normalizeCoordinate(pos.lat,-90,90);
        p.lon=normalizeCoordinate(pos.lng,-180,180);
        render();
      });
      markers.push(marker);
    }
    if(points.length>1){
      line=L.polyline(points.map(p=>[p.lat,p.lon]),{color:'#2458d3',weight:4,opacity:.9}).addTo(map);
    }
    // Points of interest: marker and thin sight lines from each waypoint that faces it.
    if(poiLayer){map.removeLayer(poiLayer);poiLayer=null;}
    const facing=points.filter(p=>p.poi);
    if(facing.length){
      poiLayer=L.layerGroup().addTo(map);
      const seen=new Set();
      for(const p of facing){
        L.polyline([[p.lat,p.lon],[p.poi.lat,p.poi.lon]],{color:'#1e7b34',weight:1,opacity:.6,dashArray:'3 4'}).addTo(poiLayer);
        const k=p.poi.lat+','+p.poi.lon;
        if(!seen.has(k)){seen.add(k);L.circleMarker([p.poi.lat,p.poi.lon],{radius:7,color:'#1e7b34',fillOpacity:.8})
          .bindTooltip('Objekt (POI)').addTo(poiLayer);}
      }
    }
    if(!hasFit){fitRoute();hasFit=true;}
  }
  function fitRoute(){
    if(!map||!points.length)return;
    if(points.length===1)map.setView([points[0].lat,points[0].lon],Math.max(map.getZoom(),15));
    else map.fitBounds(L.latLngBounds(points.map(p=>[p.lat,p.lon])).pad(.15),{maxZoom:19});
  }
  function render(){
    renderList();renderMap();updateReview();
    updateSaveState();
    $('export').disabled=points.length<2;
    $('undo').disabled=history.length===0;
    $('reverse').disabled=points.length<2;
    if($('store-save'))$('store-save').disabled=points.length<2||!store||storeBusy;
    if(points.length<2)renderMessage('Mindestens zwei unterschiedliche Wegpunkte setzen.');
    else renderMessage(points.length+' Wegpunkte vorgemerkt. Der KMZ-Export erfolgt lokal.');
  }
  $('add').addEventListener('click',()=>{
    const latRaw=$('latitude').value.trim(),lonRaw=$('longitude').value.trim();
    if(latRaw===''||lonRaw===''){renderMessage('Bitte beide Koordinaten eingeben.',true);return;}
    addPoint(Number(latRaw),Number(lonRaw));
  });
  $('clear').addEventListener('click',()=>{
    if(!points.length)return;
    if(!window.confirm('Alle Wegpunkte aus dem Entwurf entfernen?'))return;
    remember();points.length=0;hasFit=false;routeTurn={mode:'stop',damping:null};
    currentParentId=null;savedPlanSignature=null;render();
  });
  $('undo').addEventListener('click',undo);
  $('reverse').addEventListener('click',()=>{
    if(points.length<2)return;
    remember();points.reverse();render();
    renderMessage('Flugrichtung umgekehrt; Fotomarkierungen bleiben an ihren Wegpunkten.');
  });
  $('fit').addEventListener('click',fitRoute);
  let pendingReference=null;
  let importGeneration=0;
  const referenceApply=$('waylines-reference-apply');
  const referenceDiscard=$('waylines-reference-discard');
  const referencePreview=$('waylines-reference-preview');
  function resetReferencePreview(message,error=false){
    pendingReference=null;
    referenceApply.disabled=true;
    referenceDiscard.disabled=true;
    referencePreview.textContent=message;
    referencePreview.style.color=error?'var(--sky-warning)':'var(--sky-muted)';
  }
  $('waylines-reference-file').addEventListener('change',async event=>{
    const input=event.currentTarget;
    const file=input.files&&input.files[0];
    const generation=++importGeneration;
    resetReferencePreview('Keine geprüfte Referenzdatei vorgemerkt.');
    if(!file)return;
    try{
      if(!reference)throw new TypeError('Referenzimport nicht verfügbar.');
      if(file.size>128*1024)throw new TypeError('JSON-Datei überschreitet 128 KiB.');
      let payload;
      try{payload=reference.parseJson(await file.text());}
      catch(error){
        if(error && typeof error.message==='string' && /doppelter JSON-Schlüssel/.test(error.message))
          throw new TypeError('Ungültiges Waylines-JSON: doppelter JSON-Schlüssel.');
        if(error && typeof error.message==='string' && /JSON-Verschachtelung zu tief/.test(error.message))
          throw new TypeError('Ungültiges Waylines-JSON: Verschachtelung zu tief.');
        throw new TypeError('Ungültiges Waylines-JSON.');
      }
      if(generation!==importGeneration)return;
      const mapped=reference.convert(payload);
      // Dry-run the SkyHub model validator before staging; no UI mutation yet.
      core.normalize(mapped.plan);
      pendingReference=mapped;
      referenceApply.disabled=false;
      referenceDiscard.disabled=false;
      const review=mapped.review;
      referencePreview.textContent='Geprüfter Import: '+mapped.plan.model+
        ', '+review.waypointCount+' Wegpunkte, '+review.photoActionCount+
        ' Fotoaktionen. Horizontale Luftlinien-Segmentstrecke ca. '+
        (review.horizontalRouteMeters/1000).toFixed(2)+' km; reine Strecke / Sollgeschwindigkeit ca. '+
        Math.ceil(review.nominalStraightCruiseSeconds/60)+
        ' min. Keine vollständige Flugzeit- oder Energieberechnung. '+
        'RC-Verlustverhalten und DJI-Subtyp können gegenüber dem Go-SDK abweichen; '+
        'nicht semantisch äquivalent. DJI Pilot 2 nicht geprüft.';
      renderMessage('Referenzdatei lokal geprüft. Bestehende Mission unverändert; '+
        'für Übernahme den gesonderten Button benutzen.');
    }catch(error){
      if(generation!==importGeneration)return;
      const message=error && typeof error.message==='string' ? error.message.slice(0,180) : 'Waylines-Import fehlgeschlagen.';
      resetReferencePreview(message,true);
      renderMessage(message,true);
    }finally{
      input.value='';
    }
  });
  referenceDiscard.addEventListener('click',()=>{
    ++importGeneration;
    resetReferencePreview('Import verworfen. Bestehender Entwurf unverändert.');
  });
  referenceApply.addEventListener('click',()=>{
    if(!pendingReference)return;
    if(points.length>0&&!window.confirm('Vorhandene Wegpunkte durch den geprüften Referenzentwurf ersetzen?'))return;
    const mapped=pendingReference;
    // This point is the first operation that changes the active mission draft.
    $('name').value=mapped.plan.name;
    $('model').value=mapped.plan.model;
    $('height').value=String(mapped.plan.waypoints[0].height);
    $('speed').value=String(mapped.plan.speed);
    $('takeoff').value=String(mapped.plan.takeoffHeight);
    $('rth').value=String(mapped.plan.rthHeight??100);
    $('finish').value=mapped.plan.finishAction;
    $('local-heights').checked=false;
    $('photo-trigger').value='reachPoint';
    $('photo-interval-fields').hidden=true;
    remember();
    points.splice(0,points.length,...mapped.plan.waypoints.map(p=>({...p})));routeTurn={mode:'stop',damping:null};
    currentParentId=null;savedPlanSignature=null;
    hasFit=false;
    render();
    ++importGeneration;
    resetReferencePreview('Referenzentwurf übernommen; kein DJI-Hardwaretest.');
    renderMessage('Waylines-Referenzentwurf lokal übernommen ('+points.length+
      ' Wegpunkte). SkyHub verwendet eigene RC-Verlustregeln. '+
      'Keine semantische Gleichsetzung mit dem Go-SDK. Kein Flugauftrag.');
  });
  for(const fieldId of ['name','model','height','speed','takeoff','finish','photo-interval','photo-camera-min']){
    $(fieldId).addEventListener('input',updateReview);
    $(fieldId).addEventListener('change',updateReview);
  }
  $('local-heights').addEventListener('change',render);
  function photoModeUpdate(){
    const mode=$('photo-trigger').value,interval=mode!=='reachPoint';
    $('photo-interval-fields').hidden=!interval;
    $('photo-interval-label').textContent=mode==='multipleTiming'?
      'Auslöseintervall (s)':'Auslöseabstand (m)';
    $('photo-interval').max=mode==='multipleTiming'?'60':'1000';
    $('photo-interval').value=mode==='multipleTiming'?'3':'12';
    if(interval)for(const p of points)p.photo=false;
    render();
    if(interval)renderMessage('Experimentelle Intervall-Fotoaktion: kein gerätegeprüfter DJI-Flugauftrag.');
  }
  $('photo-trigger').addEventListener('change',photoModeUpdate);
  function currentPlan(){
    const height=Number($('height').value);
    const triggerMode=$('photo-trigger').value;
    const intervalPhotos=triggerMode==='reachPoint'?undefined:{
      type:triggerMode,interval:$('photo-interval').value,
      ...($('photo-camera-min').value.trim()===''?{}:{
        cameraMinIntervalSeconds:$('photo-camera-min').value})
    };
    return {
      name:$('name').value,model:$('model').value,speed:Number($('speed').value),
      takeoffHeight:Number($('takeoff').value),
      ...($('rth')&&String($('rth').value).trim()!==''?{rthHeight:Number($('rth').value)}:{}),
      finishAction:$('finish').value,
      ...(intervalPhotos?{intervalPhotos}:{}),
      ...(routeTurn.mode==='pass'?{turnMode:'pass',turnDampingM:routeTurn.damping}:{}),
      waypoints:points.map(p=>({...($('local-heights').checked?
        {lat:p.lat,lon:p.lon,height:p.height,ellipsoidHeight:p.ellipsoidHeight,photo:p.photo}:
        {lat:p.lat,lon:p.lon,height,photo:p.photo}),
        ...(p.poi?{poi:{lat:p.poi.lat,lon:p.poi.lon}}:{}),...(p.gimbalPitch!=null?{gimbalPitch:p.gimbalPitch}:{})}))
    };
  }
  // No background network writes. The baseline is set only after an explicit successful save.
  let savedPlanSignature=null;
  let currentParentId=null;
  let storeBusy=false;
  const planSignature=()=>JSON.stringify(currentPlan());
  function updateSaveState(){
    const status=$('store-draft-state');
    if(!status)return;
    status.textContent=storeBusy?'Speichervorgang läuft …':
      savedPlanSignature===null?'Entwurf noch nicht zentral gespeichert.':
      planSignature()===savedPlanSignature?'Aktueller Entwurf ist zentral gespeichert.':
      'Ungespeicherte Änderungen – erst mit „In Bibliothek speichern“ veröffentlichen.';
  }
  // Headless editor tests provide getElementById but no querySelector.
  // In browsers the form listener tracks all editable mission fields.
  document.querySelector?.('form')?.addEventListener('input',updateSaveState);
  document.querySelector?.('form')?.addEventListener('change',updateSaveState);
  // ASCII-only, filesystem-safe download name derived from the mission name.
  function fileStem(name){
    const stem=String(name||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
      .replace(/ß/g,'ss').replace(/[^A-Za-z0-9._-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,60);
    return stem||'skyhub-waypoint';
  }
  function downloadKmz(bytes,stem){
    const blob=new Blob([bytes],{type:'application/vnd.google-earth.kmz'});
    const url=URL.createObjectURL(blob);
    const anchor=document.createElement('a');
    anchor.href=url;anchor.download=stem+'.kmz';
    document.body.appendChild(anchor);anchor.click();anchor.remove();
    setTimeout(()=>URL.revokeObjectURL(url),30000);
  }
  $('mission-form').addEventListener('submit',event=>{
    event.preventDefault();
    if(!event.currentTarget.reportValidity())return;
    try{
      const plan=currentPlan();
      const output=core.build(plan);
      // ZIP construction and XML generation run only on this device.
      downloadKmz(output.kmz,fileStem(output.summary.name)+'-'+Date.now());
      renderMessage('Lokaler KMZ-Entwurf erzeugt: '+output.summary.waypointCount+
        ' Wegpunkte, '+output.summary.photoCount+' einzelne Fotoaktionen'+
        (output.summary.intervalPhotos?
          ', experimenteller '+output.summary.intervalPhotos.type+'-Trigger ('+
          output.summary.intervalPhotos.interval+' '+output.summary.intervalPhotos.unit+')':'')+
        '. NICHT fluggeprüft. Vor Verwendung in DJI Pilot 2 prüfen.');
    }catch(error){
      renderMessage(error instanceof Error?error.message:'KMZ konnte nicht erzeugt werden.',true);
    }
  });
  // ---- KMZ upload: local parse -> staged preview -> explicit apply -------------
  const DJI_NAME=/^[^<>:"/|?*._\\]+$/;
  let staged=null,stagedBytes=null,stagedParentId=null,kmzGeneration=0;
  // Read-only preview of a mapping/oblique/corridor KMZ (not editable): own map layer, never touches the draft.
  let stagedMapping=null,mappingLayer=null;
  function clearMappingPreview(){
    stagedMapping=null;
    if(mappingLayer&&map){map.removeLayer(mappingLayer);}
    mappingLayer=null;
  }
  function showMappingPreview(preview){
    stagedMapping=preview;
    if(!map)return;
    if(mappingLayer)map.removeLayer(mappingLayer);
    mappingLayer=L.layerGroup().addTo(map);
    const ll=list=>list.map(p=>[p.lat,p.lon]);
    if(preview.area.length>2)L.polygon(ll(preview.area),{color:'#c26a00',weight:2,dashArray:'6 6',fillOpacity:.12})
      .bindTooltip('Kartierungsfläche (nur Ansicht)').addTo(mappingLayer);
    if(preview.corridor.length>1)L.polyline(ll(preview.corridor),{color:'#c26a00',weight:3,dashArray:'6 6'})
      .bindTooltip('Korridor (nur Ansicht)').addTo(mappingLayer);
    if(preview.path.length>1){
      L.polyline(ll(preview.path),{color:'#5b6b84',weight:2,opacity:.9}).bindTooltip('Fluglinien aus waylines.wpml').addTo(mappingLayer);
      L.circleMarker(ll(preview.path)[0],{radius:6,color:'#1e7b34',fillOpacity:.9}).bindTooltip('Beginn der Fluglinien').addTo(mappingLayer);
    }
    const all=[...preview.area,...preview.corridor,...preview.path];
    if(all.length)map.fitBounds(L.latLngBounds(ll(all)).pad(.15),{maxZoom:18});
  }
  function mappingSummary(p){
    const s=p.stats,f=(v,u,d=0)=>v==null?'–':v.toLocaleString('de-DE',{maximumFractionDigits:d})+' '+u;
    return [p.label+' (WPML '+p.wpmlVersion+'), '+p.aircraft+' – nur Ansicht, im Editor nicht bearbeitbar.',
      (s.areaM2?'Fläche '+f(s.areaM2/10000,'ha',2)+' · ':'')+(s.corridorM?'Korridor '+f(s.corridorM,'m')+' · ':'')+
        s.waypoints+' Wegpunkte · Fluglinien '+f(s.lengthM,'m')+' · '+f(s.speedMs,'m/s',1)+
        (s.durationMin!=null?' · ≈ '+f(s.durationMin,'min',1)+' reine Strecke':''),
      'Aufnahmehöhe '+f(s.shootHeightM,'m',1)+(s.terrainFollow?' über Grund (Geländefolge)':s.heightMode==='relativeToStartPoint'?' über Start':'')+
        (s.overlapH!=null?' · Überlappung '+s.overlapH+' % / '+s.overlapW+' %':'')+(s.direction!=null?' · Richtung '+s.direction+'°':'')+
        (s.smartOblique?' · Smart Oblique':''),
      'Bearbeiten in DJI Pilot 2; „Original in MinIO ablegen“ speichert die Datei unverändert (danach Missionsfreigabe).'];
  }
  let compareGeneration=0;
  const kmzApply=$('kmz-import-apply'),kmzStore=$('kmz-import-store'),kmzDiscard=$('kmz-import-discard');
  const kmzPreview=$('kmz-import-preview'),kmzNotes=$('kmz-import-notes');
  function resetKmz(message,error=false){
    staged=null;stagedBytes=null;stagedParentId=null;clearMappingPreview();
    kmzApply.disabled=true;kmzStore.disabled=true;kmzDiscard.disabled=true;
    kmzPreview.textContent=message;
    kmzPreview.style.color=error?'var(--sky-warning)':'var(--sky-muted)';
    kmzNotes.replaceChildren();kmzNotes.hidden=true;
  }
  function showNotes(notes){
    kmzNotes.replaceChildren();
    for(const note of notes){
      const li=document.createElement('li');li.textContent=note;kmzNotes.appendChild(li);
    }
    kmzNotes.hidden=notes.length===0;
  }
  async function stageKmz(bytes,fileName,{storable,sourceId=null}={}){
    const generation=++kmzGeneration;
    resetKmz('KMZ wird lokal geprüft …');
    try{
      if(!kmzImport)throw new TypeError('KMZ-Importmodul nicht geladen.');
      const result=await kmzImport.importKmz(bytes,{fileName,models:core.MODELS});
      if(generation!==kmzGeneration)return;
      // Dry-run the exporter's validator before anything in the editor changes.
      core.normalize(result.plan);
      staged=result;
      stagedBytes=storable?bytes:null;
      stagedParentId=sourceId;
      kmzApply.disabled=false;kmzDiscard.disabled=false;kmzStore.disabled=!storable||!store;
      const r=result.review;
      kmzPreview.textContent='Geprüfte KMZ (WPML '+r.wpmlVersion+'): '+r.aircraft+', '+
        r.waypointCount+' Wegpunkte, '+(r.intervalPhotos?'Intervallfotos ('+r.intervalPhotos.type+')':
        r.photoCount+' Wegpunktfotos')+(result.localHeights?', individuelle Höhen':'')+'. '+
        (result.notes.length?result.notes.length+' Abweichung(en) unten beachten – sie gehen beim Übernehmen verloren.':
          'Keine Abweichungen gegenüber dem Editor-Modell erkannt.')+' Kein DJI-Hardwaretest.';
      kmzPreview.style.color=result.notes.length?'var(--sky-warning)':'var(--sky-muted)';
      showNotes(result.notes);
      renderMessage('KMZ lokal geprüft. Bestehende Mission unverändert; zum Übernehmen den Button benutzen.');
    }catch(error){
      if(generation!==kmzGeneration)return;
      // Mapping/oblique/corridor: show it read-only instead of failing.
      if(error&&error.templateType&&kmzImport.MAPPING&&Object.hasOwn(kmzImport.MAPPING,error.templateType)){
        try{
          const preview=await kmzImport.previewKmz(bytes,{fileName,models:core.MODELS});
          if(generation!==kmzGeneration)return;
          showMappingPreview(preview);
          stagedBytes=storable?bytes:null;stagedParentId=sourceId;
          kmzApply.disabled=true;kmzDiscard.disabled=false;kmzStore.disabled=!storable||!store;
          const lines=mappingSummary(preview);
          kmzPreview.textContent=lines[0];kmzPreview.style.color='var(--sky-ink)';
          showNotes(lines.slice(1));
          renderMessage('Kartierungsroute als Ansicht geladen. Der Missionsentwurf bleibt unverändert.');
          return;
        }catch(previewError){
          if(generation!==kmzGeneration)return;
          const message=previewError&&typeof previewError.message==='string'?previewError.message.slice(0,220):'Vorschau fehlgeschlagen.';
          resetKmz(message,true);renderMessage(message,true);return;
        }
      }
      const message=error&&typeof error.message==='string'?error.message.slice(0,220):'KMZ-Import fehlgeschlagen.';
      resetKmz(message,true);
      renderMessage(message,true);
    }
  }
  $('kmz-import-file').addEventListener('change',async event=>{
    const input=event.currentTarget;
    const file=input.files&&input.files[0];
    if(!file){resetKmz('Keine KMZ-Datei ausgewählt.');return;}
    try{
      if(file.size>12*1024*1024){resetKmz('KMZ-Datei überschreitet 12 MiB.',true);return;}
      await stageKmz(new Uint8Array(await file.arrayBuffer()),file.name,{storable:true});
    }finally{input.value='';}
  });
  kmzDiscard.addEventListener('click',()=>{++kmzGeneration;resetKmz('Import verworfen. Bestehender Entwurf unverändert.');});
  kmzApply.addEventListener('click',()=>{
    if(!staged)return;
    if(staged.notes.length&&!window.confirm(staged.notes.length+
      ' Abweichung(en) gehen beim Übernehmen verloren (siehe Liste). Trotzdem übernehmen?'))return;
    if(points.length>0&&!window.confirm('Vorhandene Wegpunkte durch die importierte Mission ersetzen?'))return;
    const result=staged,plan=result.plan;
    const linkedParent=stagedParentId;
    $('name').value=plan.name;
    $('model').value=plan.model;
    $('speed').value=String(plan.speed);
    $('takeoff').value=String(plan.takeoffHeight);
    $('rth').value=String(plan.rthHeight??100);
    $('finish').value=plan.finishAction;
    $('local-heights').checked=result.localHeights;
    if(!result.localHeights)$('height').value=String(result.globalHeight);
    $('photo-trigger').value=plan.intervalPhotos?plan.intervalPhotos.type:'reachPoint';
    photoModeUpdate();
    if(plan.intervalPhotos)$('photo-interval').value=String(plan.intervalPhotos.interval);
    remember();
    points.splice(0,points.length,...plan.waypoints.map(p=>({...p})));routeTurn={mode:'stop',damping:null};
    currentParentId=linkedParent;savedPlanSignature=null;
    hasFit=false;
    render();
    ++kmzGeneration;
    resetKmz('Mission übernommen'+(result.notes.length?' ('+result.notes.length+' Abweichungen verworfen)':'')+'.');
    renderMessage('KMZ-Mission lokal übernommen ('+points.length+' Wegpunkte). '+
      (linkedParent?'Vorgänger für neue Version dokumentiert. Vor dem Speichern einen neuen, eindeutigen Missionsnamen vergeben. ':'')+
      'Kein Flugauftrag, keine Flugfreigabe.');
  });

  // ---- MinIO mission library (authenticated SkyHub API, explicit actions only) ---
  // The token lives only in this input field and this closure; it is never persisted.
  const token=()=>$('store-token').value.trim();
  const storeStatus=(message,error=false)=>{
    $('store-status').textContent=message;
    $('store-status').style.color=error?'var(--sky-warning)':'var(--sky-muted)';
  };
  $('store-token').addEventListener('keydown',event=>{if(event.key==='Enter')event.preventDefault();});
  function missionName(){
    const name=$('name').value.trim();
    if(!name||name.length>64||!DJI_NAME.test(name))
      throw new TypeError('Für die Bibliothek verlangt DJI einen eindeutigen Namen (max. 64 Zeichen) ohne < > : " / | ? * . _ \\');
    return name;
  }
  async function saveToStore(bytes,name,{markCurrentDraft=false}={}){
    // Explicit confirmation contract (UX-CONTRACT.md): name, target, no flight task.
    if(!window.confirm('„'+name+'“ in die SkyHub-Missionsbibliothek (MinIO-Bucket skyhub-wpml) hochladen?\n'+
      'Die Datei wird serverseitig geprüft und unveränderlich abgelegt. Kein Flugauftrag, keine Flugfreigabe.')){
      storeStatus('Upload abgebrochen. Nichts gesendet.');
      return;
    }
    const signatureAtUpload=markCurrentDraft?planSignature():null;
    const parentAtUpload=markCurrentDraft?currentParentId:null;
    const stored=await store.upload(token(),bytes,name,
      parentAtUpload?{parentId:parentAtUpload}:{});
    if(markCurrentDraft){
      savedPlanSignature=signatureAtUpload;
      // Subsequent explicit saves derive from the most recently stored object.
      currentParentId=stored.id;
    }
    updateSaveState();
    storeStatus((stored.created?'Gespeichert':'Bereits vorhanden')+': „'+stored.name+'“ · '+
      (stored.validation?.aircraft||'Fluggerät ?')+' · '+(stored.validation?.waypointCount??'?')+
      ' Wegpunkte · ID '+stored.id.slice(0,8)+'… Kein Flugauftrag.');
    await refreshStore();
  }
  $('store-save').addEventListener('click',async()=>{
    if(!store){storeStatus('Bibliotheksmodul nicht geladen.',true);return;}
    if(storeBusy)return;
    if(savedPlanSignature!==null&&savedPlanSignature===planSignature()){
      storeStatus('Keine Änderungen seit der letzten zentralen Speicherung. Kein erneuter Upload.');
      return;
    }
    storeBusy=true;
    $('store-save').disabled=true;
    updateSaveState();
    try{
      const name=missionName();
      const output=core.build({...currentPlan(),name});
      storeStatus('Speichere in MinIO …');
      await saveToStore(output.kmz,name,{markCurrentDraft:true});
    }catch(error){storeStatus(error instanceof Error?error.message:'Speichern fehlgeschlagen.',true);}
    finally{
      storeBusy=false;
      $('store-save').disabled=points.length<2||!store;
      updateSaveState();
    }
  });
  kmzStore.addEventListener('click',async()=>{
    if(!store||!stagedBytes||(!staged&&!stagedMapping))return;
    try{
      const name=(staged?staged.plan.name:stagedMapping.name).trim();
      if(!DJI_NAME.test(name)||name.length>64)
        throw new TypeError('Dateiname ist kein gültiger DJI-Wayline-Name (keine . _ : usw.). Datei umbenennen.');
      storeStatus('Lege Original-KMZ in MinIO ab …');
      await saveToStore(stagedBytes,name);
    }catch(error){storeStatus(error instanceof Error?error.message:'Ablage fehlgeschlagen.',true);}
  });
  async function compareMissionFiles(beforeId,afterId,{documentedParent=false}={}){
    const generation=++compareGeneration;
    $('store-compare-status').textContent='Versionsvergleich läuft (nur lokal, lesend) …';
    try{
      if(beforeId===afterId)throw new Error('Zwei unterschiedliche Missionen auswählen.');
      if(!kmzImport||!window.SkyHubWpmlVersionCompare)
        throw new Error('Versionsvergleich nicht geladen.');
      const [oldBytes,newBytes]=await Promise.all([
        store.download(token(),beforeId),store.download(token(),afterId)]);
      const [oldVersion,newVersion]=await Promise.all([
        kmzImport.importKmz(oldBytes,{fileName:'previous.kmz',models:core.MODELS}),
        kmzImport.importKmz(newBytes,{fileName:'current.kmz',models:core.MODELS})]);
      if(generation!==compareGeneration)return;
      const diff=window.SkyHubWpmlVersionCompare.compare(oldVersion,newVersion);
      $('store-compare-status').textContent=
        (documentedParent?'Dokumentierte Nachfolge: ':'Manueller Vergleich (Abstammung nicht belegt): ')+
        beforeId.slice(0,8)+'… → '+afterId.slice(0,8)+'… · '+
        diff.previousWaypoints+' → '+diff.currentWaypoints+' Wegpunkte; '+
        diff.addedWaypoints+' hinzugefügt, '+diff.removedWaypoints+' entfernt; '+
        diff.positionChanges+' Positionen, '+diff.heightChanges+' Höhen, '+
        diff.photoChanges+' Wegpunkt-Fotoaktionen verändert; '+
        diff.profileChanges.length+' Profilfelder und Intervallmodus '+
        (diff.intervalChanged?'geändert':'unverändert')+'. '+
        (diff.partial?'Eingeschränkter Vergleich: Nicht alle WPML-Felder werden abgebildet. ':'')+
        'Keine Hardwareprüfung oder Flugfreigabe.';
    }catch(_error){
      if(generation!==compareGeneration)return;
      $('store-compare-status').textContent=
        'Vergleich nicht möglich. Ausgewählte KMZ-Dateien und unterstütztes Editor-Teilformat prüfen. '+
        'Keine Daten geändert oder übertragen.';
    }
  }
  function storeItem(mission){
    const item=document.createElement('div');
    item.className='store-item';item.setAttribute('role','listitem');
    const title=document.createElement('strong');title.textContent=mission.name||'(ohne Namen)';
    const detail=document.createElement('small');
    const when=mission.createTime?new Date(mission.createTime).toLocaleString('de-DE'):'Zeit unbekannt';
    detail.textContent=(mission.aircraft||mission.droneModelKey||'Fluggerät ?')+' · '+
      (mission.waypointCount??'?')+' Wegpunkte · WPML '+(mission.wpmlVersion||'?')+' · '+when+
      (mission.parentId?' · Generation '+(mission.generation||'?')+
        ' · Vorgänger '+mission.parentId.slice(0,8)+'…':
        ' · Keine dokumentierte Vorgängerversion');
    const controls=document.createElement('div');controls.className='tools';
    const load=action('In Editor laden',async()=>{
      try{
        storeStatus('Lade „'+(mission.name||mission.id)+'“ …');
        const bytes=await store.download(token(),mission.id);
        // Re-imported missions are already stored; offer no second upload.
        await stageKmz(bytes,(mission.name||'Mission')+'.kmz',{storable:false,sourceId:mission.id});
        storeStatus('Mission geladen und lokal geprüft – oben unter „Mission hochladen“ übernehmen.');
      }catch(error){storeStatus(error instanceof Error?error.message:'Laden fehlgeschlagen.',true);}
    });
    const save=action('KMZ herunterladen',async()=>{
      try{downloadKmz(await store.download(token(),mission.id),fileStem(mission.name));}
      catch(error){storeStatus(error instanceof Error?error.message:'Download fehlgeschlagen.',true);}
    });
    controls.append(load,save);
    if(mission.parentId){
      controls.append(action('Mit Vorgänger vergleichen',()=>compareMissionFiles(
        mission.parentId,mission.id,{documentedParent:true})));
    }
    item.append(title,detail,controls);
    return item;
  }
  async function refreshStore(){
    // The store limits listings to 100 entries per page. Show every supported
    // mission so a predecessor does not vanish from the version overview.
    const first=await store.list(token(),{pageSize:100});
    const total=first.pagination.total;
    if(!Number.isSafeInteger(total)||total<0||total>500)
      throw new Error('Bibliotheksumfang ungültig oder zu groß.');
    const all=[...first.list];
    for(let page=2;all.length<total&&page<=5;page++){
      const next=await store.list(token(),{page,pageSize:100});
      if(!next.list.length)throw new Error('Unvollständige Missionsbibliothek.');
      all.push(...next.list);
    }
    if(all.length!==total)throw new Error('Bibliotheksseiten sind unvollständig.');
    $('store-list').replaceChildren(...all.map(storeItem));
    for(const id of ['store-compare-left','store-compare-right']){
      const select=$(id),previous=select.value;
      select.replaceChildren();
      const blank=document.createElement('option');
      blank.value='';blank.textContent='Mission auswählen';
      select.appendChild(blank);
      for(const mission of all){
        const option=document.createElement('option');
        option.value=mission.id;
        option.textContent=(mission.name||'Mission')+' · '+
          (mission.waypointCount??'?')+' WP · '+mission.id.slice(0,8);
        select.appendChild(option);
      }
      // Preserve a selection when refreshing a complete catalogue.
      select.value=all.some(m=>m.id===previous)?previous:'';
    }
    if(!all.length)storeStatus('Bibliothek ist leer.');
    return {list:all,pagination:{...first.pagination,total}};
  }
  $('store-compare-selected').addEventListener('click',()=>{
    const beforeId=$('store-compare-left').value,afterId=$('store-compare-right').value;
    if(!beforeId||!afterId){
      $('store-compare-status').textContent='Bitte beide Missionen auswählen.';
      return;
    }
    void compareMissionFiles(beforeId,afterId);
  });
  $('store-refresh').addEventListener('click',async()=>{
    if(!store){storeStatus('Bibliotheksmodul nicht geladen.',true);return;}
    try{
      storeStatus('Lade Bibliothek …');
      const list=await refreshStore();
      if(list.list.length)storeStatus(list.pagination.total+' Mission(en) in MinIO. Ablage ist keine Übertragung an DJI Pilot 2.');
    }catch(error){storeStatus(error instanceof Error?error.message:'Bibliothek nicht erreichbar.',true);}
  });
  render();
})();
