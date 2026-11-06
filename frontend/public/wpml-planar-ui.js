'use strict';
// Explicit, local-only planar laboratory controls; no DJI flight command or WPML export.
(function(){
  const c=window.SkyHubPlanarAdvanced,bridge=window.SkyHubPlanarSelection,$=id=>document.getElementById(id);
  if(!c||!bridge){$('planar-status').textContent='Planarmodul nicht geladen.';return;}
  let last=null,groups=null,epoch=0;
  const show=t=>{$('planar-status').textContent=t;};
  const options=()=>{
    const s=bridge.snapshot();
    if(!s.geometry||(Array.isArray(s.geometry)&&s.geometry.length<3))throw Error('Erst eine gültige Fläche zeichnen.');
    if(!Number.isFinite(s.spacing))throw Error('Zuerst die gültige 2D-Kameravorschau berechnen.');
    return {geometry:s.geometry,spacing:s.spacing,heading:s.heading,
      optimize:$('planar-optimize-angle').checked};
  };
  $('planar-sweep').addEventListener('click',()=>{
    try{
      const a=options();groups=null;$('planar-pass-select').disabled=true;
      last=c.optimize(a.geometry,{spacing:a.spacing,heading:a.heading,optimize:a.optimize});
      bridge.drawAdvanced([last]);epoch++;
      show('P0: '+last.segmentCount+' Scanabschnitte, '+last.optimizedHeadingDegrees.toFixed(1)+
        '°; '+last.evaluatedHeadingCount+' Richtungen bewertet; '+
        last.transitionCandidates.filter(x=>x.status==='candidate').length+
        ' unverifizierte Übergangskandidaten. Keine sicheren Flugrouten.');
    }catch(e){show(e.message);}
  });
  $('planar-five').addEventListener('click',()=>{
    try{
      const a=options();
      if(!$('planar-height').value.trim()||!$('planar-pitch').value.trim())
        throw Error('AGL und Neigungswinkel explizit eingeben.');
      groups=c.fiveDirection(a.geometry,{spacing:a.spacing,heading:a.heading,
        optimize:a.optimize,heightAGLM:$('planar-height').value,
        pitchDegrees:$('planar-pitch').value});
      last=groups.passes[0].preview;
      $('planar-pass-select').value='0';$('planar-pass-select').disabled=false;
      bridge.drawAdvanced([last]);epoch++;
      show('P1: fünf Aufnahmegruppen; '+groups.passes.map(p=>p.preview.segmentCount).join('/')+
        ' Scansegmente. Nur vereinfachte Geometrie, keine Kamera-/Flugfreigabe.');
    }catch(e){show(e.message);}
  });
  $('planar-pass-select').addEventListener('change',()=>{
    if(!groups)return;
    const n=Number($('planar-pass-select').value);
    if(!Number.isInteger(n)||n<0||n>=5)return;
    last=groups.passes[n].preview;bridge.drawAdvanced([last]);epoch++;
    show('P1 Gruppe '+(n+1)+' von 5: '+last.segmentCount+' Scansegmente. Nur Vorschau.');
  });
  $('planar-terrain').addEventListener('click',async()=>{
    try{
      if(!last)throw Error('Zuerst eine Planarvorschau berechnen.');
      const h=$('planar-takeoff-height').value.trim(),v=Number(h);
      if(!h||!Number.isFinite(v)||v<2||v>500)
        throw Error('Höhe über Startpunkt (2–500 m) explizit eingeben, nicht AGL.');
      if(!window.SkyHubTerrainClient)throw Error('DEM-Dienstclient fehlt.');
      const first=last.segments[0],snapshot=JSON.stringify(bridge.snapshot()),at=epoch;
      $('planar-terrain').disabled=true;show('DEM-Abfrage für das erste Scansegment läuft …');
      const data=await window.SkyHubTerrainClient.profile(
        [first.start,first.end].map(p=>({lat:p.lat,lon:p.lon,h:v})));
      if(at!==epoch||snapshot!==JSON.stringify(bridge.snapshot())){
        show('Geometrie geändert: veraltete DEM-Antwort verworfen.');return;
      }
      const result=c.terrainAssessment(data);
      if(result.status!=='sampled')throw Error('DEM unvollständig oder nicht verfügbar.');
      show('DEM nur Segment 1/'+last.segmentCount+': AGL '+result.minAglM+
        '–'+result.maxAglM+' m; '+result.samples+' Höhenpunkte. '+
        (result.below15m?'WARNUNG: unter 15 m. ':'')+
        (result.above120m?'WARNUNG: über 120 m. ':'')+
        'Startreferenz angenommen; keine Hindernis-/Flugfreigabe.');
    }catch(e){show(e.message);}
    finally{$('planar-terrain').disabled=false;}
  });
  for(const id of ['planar-height','planar-pitch','planar-takeoff-height','planar-optimize-angle'])
    $(id).addEventListener('input',()=>{epoch++;show('Parameter geändert – neu berechnen.');});
})();