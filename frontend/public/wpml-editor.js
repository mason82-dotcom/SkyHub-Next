'use strict';
// Client-only waypoint editor; never calls DJI/MQTT/SkyHub write endpoints.
(function () {
  const core=window.SkyHubWpmlPlanner;
  const reference=window.SkyHubWpmlWaylinesReference;
  const reviewCore=window.SkyHubWpmlMissionReview;
  const $=id=>document.getElementById(id);
  if(!core){$('message').textContent='WPML-Modul nicht geladen – kein Export möglich.';return;}
  const points=[];
  let map=null,markers=[],line=null,hasFit=false;
  const renderMessage=(message,error=false)=>{
    $('message').textContent=message;
    $('message').style.color=error?'var(--sky-warning)':'var(--sky-ink)';
  };
  if(typeof window.L==='object'&&typeof window.L.map==='function'){
    map=L.map('map',{zoomControl:true}).setView([50.5,10.4],6);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
      maxZoom:19,attribution:'© OpenStreetMap contributors'
    }).addTo(map);
    map.on('click',event=>addPoint(event.latlng.lat,event.latlng.lng));
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
  function addPoint(lat,lon){
    const latitude=normalizeCoordinate(lat,-90,90);
    const longitude=normalizeCoordinate(lon,-180,180);
    if(latitude===null||longitude===null){renderMessage('Koordinaten sind ungültig.',true);return;}
    if(points.length>=500){renderMessage('Maximal 500 Wegpunkte.',true);return;}
    if(points.length&&points[points.length-1].lat===latitude&&points[points.length-1].lon===longitude){
      renderMessage('Aufeinanderfolgende identische Wegpunkte sind nicht erlaubt.',true);return;
    }
    const defaultHeight=Number($('height').value);
    points.push({lat:latitude,lon:longitude,height:defaultHeight,photo:false});
    $('latitude').value=String(latitude);
    $('longitude').value=String(longitude);
    render();
  }
  function swap(i,j){
    if(j<0||j>=points.length)return;
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
      const deleteButton=action('Entfernen',()=>{points.splice(index,1);render();});
      controls.append(up,down,deleteButton);
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
        p.lat=normalizeCoordinate(pos.lat,-90,90);
        p.lon=normalizeCoordinate(pos.lng,-180,180);
        render();
      });
      markers.push(marker);
    }
    if(points.length>1){
      line=L.polyline(points.map(p=>[p.lat,p.lon]),{color:'#2458d3',weight:4,opacity:.9}).addTo(map);
    }
    if(!hasFit){fitRoute();hasFit=true;}
  }
  function fitRoute(){
    if(!map||!points.length)return;
    if(points.length===1)map.setView([points[0].lat,points[0].lon],Math.max(map.getZoom(),15));
    else map.fitBounds(L.latLngBounds(points.map(p=>[p.lat,p.lon])).pad(.15),{maxZoom:17});
  }
  function render(){
    renderList();renderMap();updateReview();
    $('export').disabled=points.length<2;
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
    points.length=0;hasFit=false;render();
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
    $('finish').value=mapped.plan.finishAction;
    $('local-heights').checked=false;
    $('photo-trigger').value='reachPoint';
    $('photo-interval-fields').hidden=true;
    points.splice(0,points.length,...mapped.plan.waypoints.map(p=>({...p})));
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
  $('mission-form').addEventListener('submit',event=>{
    event.preventDefault();
    if(!event.currentTarget.reportValidity())return;
    try{
      const height=Number($('height').value);
      const triggerMode=$('photo-trigger').value;
      const intervalPhotos=triggerMode==='reachPoint'?undefined:{
        type:triggerMode,interval:$('photo-interval').value,
        ...($('photo-camera-min').value.trim()===''?{}:{
          cameraMinIntervalSeconds:$('photo-camera-min').value})
      };
      const plan={
        name:$('name').value,model:$('model').value,speed:Number($('speed').value),
        takeoffHeight:Number($('takeoff').value),finishAction:$('finish').value,
        ...(intervalPhotos?{intervalPhotos}:{}),
        waypoints:points.map(p=>$('local-heights').checked?
          {lat:p.lat,lon:p.lon,height:p.height,ellipsoidHeight:p.ellipsoidHeight,photo:p.photo}:
          {lat:p.lat,lon:p.lon,height,photo:p.photo})
      };
      const output=core.build(plan);
      // ZIP construction and XML generation run only on this device.
      const bytes=output.kmz;
      const blob=new Blob([bytes],{type:'application/vnd.google-earth.kmz'});
      const url=URL.createObjectURL(blob);
      const anchor=document.createElement('a');
      anchor.href=url;anchor.download='skyhub-waypoint-'+Date.now()+'.kmz';
      document.body.appendChild(anchor);anchor.click();anchor.remove();
      setTimeout(()=>URL.revokeObjectURL(url),30000);
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
  render();
})();
