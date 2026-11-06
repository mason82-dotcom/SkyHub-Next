'use strict';
// Explicit planar geometry and DEM laboratory. No mission export, DJI control or automatic network requests.
(function(){
  const core=window.SkyHubPlanarAdvanced;
  const bridge=window.SkyHubPlanarSelection;
  const terrain=window.SkyHubTerrainClient;
  const $=id=>document.getElementById(id);
  if(!core||!bridge){
    $('planar-status').textContent='Planarmodul nicht geladen – Labortools deaktiviert.';
    return;
  }
  let current=null,groups=null,epoch=0,fingerprint=null,pending=null;
  const show=message=>{$('planar-status').textContent=message;};
  function stopRequest(){
    if(pending){pending.abort();pending=null;}
    $('planar-terrain').disabled=false;
  }
  function snapshot(){
    return JSON.stringify({
      survey:bridge.snapshot(),
      optimize:$('planar-optimize-angle').checked,
      agl:$('planar-height').value,pitch:$('planar-pitch').value,
      relativeHeight:$('planar-takeoff-height').value,
      takeoffLat:$('planar-takeoff-lat').value,
      takeoffLon:$('planar-takeoff-lon').value
    });
  }
  function invalidate(){
    epoch++;stopRequest();current=null;groups=null;fingerprint=null;
    $('planar-pass-select').disabled=true;
    bridge.clearAdvanced();
    show('Eingaben oder Geometrie geändert – Planarvorschau neu berechnen.');
  }
  function inputs(){
    const s=bridge.snapshot();
    if(!s.geometry||(Array.isArray(s.geometry)&&s.geometry.length<3))
      throw Error('Zuerst eine gültige Vermessungsfläche zeichnen oder importieren.');
    if(!Number.isFinite(s.spacing)||s.spacing<2||s.spacing>200)
      throw Error('Gültigen Streifenabstand beziehungsweise reale Kameradaten eingeben.');
    return {geometry:s.geometry,spacing:s.spacing,heading:s.heading,
      optimize:$('planar-optimize-angle').checked};
  }
  function renderPlan(){
    if(current)bridge.drawAdvanced([current],{
      showCandidates:$('planar-show-candidates').checked
    });
  }
  function applyPlan(plan){
    stopRequest();epoch++;current=plan;fingerprint=snapshot();renderPlan();
  }
  $('planar-sweep').addEventListener('click',()=>{
    try{
      const a=inputs();
      groups=null;$('planar-pass-select').disabled=true;
      applyPlan(core.optimize(a.geometry,{
        spacing:a.spacing,heading:a.heading,optimize:a.optimize
      }));
      const count=current.transitionCandidates.filter(x=>x.status==='candidate').length;
      show('P0: '+current.segmentCount+' Scansegmente, Richtung '+
        current.optimizedHeadingDegrees.toFixed(1)+'°, '+
        current.evaluatedHeadingCount+' Winkel bewertet. '+
        count+' Übergangskandidaten; '+current.unexaminedTransitionCount+
        ' Übergänge nicht untersucht. Kein Hindernis-/Flugnachweis.');
    }catch(err){invalidate();show(err.message);}
  });
  $('planar-five').addEventListener('click',()=>{
    try{
      const a=inputs();
      const h=$('planar-height').value.trim(),p=$('planar-pitch').value.trim();
      if(!h||!p)throw Error('Tatsächliche AGL-Höhe und Kameraneigung eingeben.');
      const result=core.fiveDirection(a.geometry,{
        spacing:a.spacing,heading:a.heading,optimize:a.optimize,
        heightAGLM:h,pitchDegrees:p
      });
      groups=result;
      $('planar-pass-select').value='0';
      $('planar-pass-select').disabled=false;
      applyPlan(result.passes[0].preview);
      show('P1: fünf theoretische Aufnahmegruppen mit '+
        result.passes.map(x=>x.preview.segmentCount).join('/')+
        ' Scansegmenten. Keine Fotoauslösung oder Flugfreigabe.');
    }catch(err){invalidate();show(err.message);}
  });
  $('planar-pass-select').addEventListener('change',()=>{
    if(!groups)return;
    const index=Number($('planar-pass-select').value);
    if(!Number.isInteger(index)||index<0||index>=groups.passes.length)return;
    applyPlan(groups.passes[index].preview);
    show('P1 Aufnahmegruppe '+(index+1)+'/'+groups.passes.length+
      ': '+current.segmentCount+' Scansegmente. Nur geometrische Vorschau.');
  });
  $('planar-show-candidates').addEventListener('change',renderPlan);
  function readTakeoff(){
    const rawLat=$('planar-takeoff-lat').value.trim();
    const rawLon=$('planar-takeoff-lon').value.trim();
    if(!rawLat||!rawLon)throw Error('Gemessene WGS84-Startposition (Breite und Länge) ist erforderlich.');
    const lat=Number(rawLat),lon=Number(rawLon);
    if(!Number.isFinite(lat)||!Number.isFinite(lon)||
       lat< -85||lat>85||lon< -180||lon>180)
      throw Error('Ungültige Startkoordinaten. WGS84-Breite -85…85°, Länge -180…180°.');
    return {lat,lon};
  }
  $('planar-terrain').addEventListener('click',async()=>{
    if(!current){show('Zuerst P0 oder P1 berechnen.');return;}
    if(fingerprint!==snapshot()){
      invalidate();show('Vorschau veraltet – zuerst neu berechnen.');return;
    }
    let h,ref;
    try{
      const raw=$('planar-takeoff-height').value.trim();
      if(!raw||!Number.isFinite(Number(raw))||Number(raw)<2||Number(raw)>500)
        throw Error('Explizite theoretische Höhe über Startpunkt (2–500 m) erforderlich.');
      h=Number(raw);ref=readTakeoff();
      if(!terrain)throw Error('Terrain-Client nicht verfügbar.');
    }catch(err){show(err.message);return;}
    stopRequest();
    const ctrl=new AbortController();pending=ctrl;
    const started=++epoch,observed=snapshot();
    const segments=current.segments.slice(0,8);
    const results=[];
    $('planar-terrain').disabled=true;
    for(const [index,segment] of segments.entries()){
      if(ctrl.signal.aborted||epoch!==started||snapshot()!==observed)break;
      show('P3 DEM: Segment '+(index+1)+'/'+segments.length+
        ' wird einzeln geprüft; keine Prüfung der Übergangslücken.');
      try{
        const points=[segment.start,segment.end].map(p=>({lat:p.lat,lon:p.lon,h}));
        const response=await terrain.profile(points,{takeoff:ref,signal:ctrl.signal});
        if(ctrl.signal.aborted||epoch!==started||snapshot()!==observed)break;
        results.push(core.terrainAssessment(response));
      }catch(err){
        if(ctrl.signal.aborted||epoch!==started||snapshot()!==observed)break;
        results.push({status:'unknown',reason:'dem-request-failed'});
      }
    }
    if(!ctrl.signal.aborted&&epoch===started&&snapshot()===observed&&results.length){
      const r=core.assessTerrainSegments(results,current.segmentCount);
      const range=r.sampledSegmentCount?
        ('AGL min/max '+r.minAglM+' / '+r.maxAglM+' m. '):'Keine gültigen Höhenwerte. ';
      show('P3 DEM-Stichprobe: '+r.sampledSegmentCount+'/'+r.totalSegmentCount+
        ' Scansegmente geprüft ('+r.failedSegmentCount+
        ' fehlgeschlagen, '+r.notRequestedSegmentCount+' nicht angefragt). '+
        range+(r.below15m?'WARNUNG unter 15 m. ':'')+
        (r.above120m?'WARNUNG über 120 m. ':'')+
        'Kein Nachweis für nicht geprüfte Segmente, Hindernisse oder DJI-Flugfreigabe.');
    }
    if(pending===ctrl){pending=null;$('planar-terrain').disabled=false;}
  });
  for(const id of ['planar-height','planar-pitch','planar-optimize-angle',
    'planar-takeoff-height','planar-takeoff-lat','planar-takeoff-lon',
    'spacing','heading','optics-enable']){
    $(id).addEventListener('input',invalidate);
    $(id).addEventListener('change',invalidate);
  }
  // The canonical survey module broadcasts every geometry invalidation,
  // including map clicks, dragged markers and completed asynchronous GeoJSON imports.
  window.addEventListener('skyhub-survey-invalidated',invalidate);
})();