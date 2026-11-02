'use strict';
// Visualization only. Contains no DJI/WPML flight mission export or HTTP writes.
(function(){
  const engine=window.SkyHubSurveyPreview;
  const optics=window.SkyHubPhotoGeometry;
  const cameraReference=window.SkyHubCameraReference;
  const dualOptics=window.SkyHubM3MDualOptics;
  const capture=window.SkyHubCapturePreview;
  const $=id=>document.getElementById(id);
  if(!engine){$('status').textContent='Offline-Geometriemodul fehlt.';return;}
  const points=[];let importedGeometry=null,map=null,polygon=null,markers=[],lines=[],photoMarkers=[],report=null,photoReport=null,captureReport=null,dualReport=null,dualCount=null,firstFit=false;
  const feedback=(txt,error=false)=>{
    $('status').textContent=txt;
    $('status').style.color=error?'var(--sky-warning)':'var(--sky-ink)';
  };
  if(typeof window.L==='object'&&typeof window.L.map==='function'){
    map=L.map('map').setView([50.5,10.4],6);
    // Keep document referrer private, but identify the page origin to OSM tiles.
    // OSMF explicitly requires an HTTP Referer; Leaflet 1.9.4 supports this option.
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{
      maxZoom:19,attribution:'© OpenStreetMap contributors',
      referrerPolicy:'strict-origin-when-cross-origin'
    }).addTo(map);
    map.on('click',event=>add(event.latlng.lat,event.latlng.lng));
  }else $('map').textContent='Keine Karte verfügbar. Bitte Koordinaten manuell eingeben.';
  function normalize(raw,min,max){
    if(typeof raw!=='number'||!Number.isFinite(raw)||raw<min||raw>max)return null;
    return Math.round(raw*10000000)/10000000;
  }
  function add(lat,lon){
    if(points.length>=80){feedback('Polygon höchstens 80 Punkte.',true);return;}
    const a=normalize(lat,-85,85),b=normalize(lon,-180,180);
    if(a===null||b===null){feedback('Koordinate außerhalb der erlaubten Grenzen.',true);return;}
    if(importedGeometry&&!window.confirm('Importierte GeoJSON-Fläche durch ein manuelles Polygon ersetzen?'))return;
    importedGeometry=null;
    points.push({lat:a,lon:b});invalidate();render();
  }
  function invalidate(){report=null;photoReport=null;captureReport=null;dualReport=null;dualCount=null;$('geojson').disabled=true;
    $('show-photo-centers').disabled=true;}
  function fit(){
    if(!map)return;
    if(importedGeometry&&polygon){
      map.fitBounds(polygon.getBounds().pad(.22),{maxZoom:17});return;
    }
    if(!points.length)return;
    if(points.length===1)map.setView([points[0].lat,points[0].lon],15);
    else map.fitBounds(L.latLngBounds(points.map(p=>[p.lat,p.lon])).pad(.22),{maxZoom:17});
  }
  function render(){
    $('points').replaceChildren();
    if(importedGeometry){
      const li=document.createElement('li');
      li.textContent='GeoJSON '+importedGeometry.type+' geladen (nur lesende Vorschau, keine Eckpunkt-Bearbeitung).';
      $('points').appendChild(li);
    }
    points.forEach((p,index)=>{
      const li=document.createElement('li');
      li.textContent=(index+1)+': '+p.lat.toFixed(7)+', '+p.lon.toFixed(7);
      $('points').appendChild(li);
    });
    if(!map)return;
    for(const m of markers)m.remove();markers=[];
    for(const layer of lines)layer.remove();lines=[];
    for(const layer of photoMarkers)layer.remove();photoMarkers=[];
    if(polygon){polygon.remove();polygon=null;}
    points.forEach((p,i)=>{
      const m=L.marker([p.lat,p.lon],{draggable:true})
        .bindTooltip('Eckpunkt '+(i+1)).addTo(map);
      m.on('dragend',()=>{
        const loc=m.getLatLng();
        const lat=normalize(loc.lat,-85,85),lon=normalize(loc.lng,-180,180);
        if(lat!==null&&lon!==null){p.lat=lat;p.lon=lon;}
        invalidate();render();
      });
      markers.push(m);
    });
    if(importedGeometry)polygon=L.geoJSON(importedGeometry,{
      style:()=>({color:'#2458d3',fillColor:'#2458d3',fillOpacity:.12,weight:2})
    }).addTo(map);
    else if(points.length>=3)polygon=L.polygon(points.map(p=>[p.lat,p.lon]),{
      color:'#2458d3',fillColor:'#2458d3',fillOpacity:.12,weight:2
    }).addTo(map);
    else if(points.length===2)polygon=L.polyline(points.map(p=>[p.lat,p.lon]),{
      color:'#2458d3',weight:2
    }).addTo(map);
    if(report)for(const seg of report.segments){
      lines.push(L.polyline([[seg.start.lat,seg.start.lon],[seg.end.lat,seg.end.lon]],{
        color:'#b46d12',weight:3,opacity:.93
      }).addTo(map));
    }
    if(report)for(const gap of report.unplannedTransitions){
      lines.push(L.polyline([[gap.from.lat,gap.from.lon],[gap.to.lat,gap.to.lon]],{
        color:'#b42328',weight:2,opacity:.8,dashArray:'5,9'
      }).addTo(map));
    }
    if(captureReport&&$('show-photo-centers').checked){
      for(const p of captureReport.photoCenters)
        photoMarkers.push(L.circleMarker([p.lat,p.lon],{
          radius:3,color:'#b46d12',weight:1,opacity:.85,fillOpacity:.85
        }).addTo(map));
    }
    if(!firstFit&&(points.length||importedGeometry)){fit();firstFit=true;}
  }
  $('add').addEventListener('click',()=>{
    if($('lat').value.trim()===''||$('lon').value.trim()===''){
      feedback('Beide Koordinaten müssen angegeben werden.',true);return;
    }
    add(Number($('lat').value),Number($('lon').value));
  });
  $('undo').addEventListener('click',()=>{
    if(importedGeometry){feedback('GeoJSON-Geometrie kann nicht punktweise bearbeitet werden. Bitte zurücksetzen.',true);return;}
    if(!points.length)return;
    points.pop();invalidate();render();
    feedback('Letzten Polygonpunkt entfernt.');
  });
  $('clear').addEventListener('click',()=>{
    if(!points.length&&!importedGeometry)return;
    if(!window.confirm('Polygon und Vermessungsvorschau zurücksetzen?'))return;
    points.length=0;importedGeometry=null;firstFit=false;invalidate();render();
    feedback('Polygon zurückgesetzt.');
  });
  $('fit').addEventListener('click',fit);
  $('import-geometry').addEventListener('click',async()=>{
    const file=$('geometry-file').files?.[0];
    if(!file){feedback('Bitte lokale GeoJSON-Datei auswählen.',true);return;}
    try{
      if(file.size>65536)throw new Error('GeoJSON größer als 64 KiB.');
      const raw=JSON.parse(await file.text());
      if(!raw||!['Polygon','MultiPolygon'].includes(raw.type))
        throw new Error('Nur GeoJSON-Geometrien vom Typ Polygon oder MultiPolygon.');
      const checked=engine.validateGeometry(raw);
      points.length=0;
      importedGeometry=checked.outlineGeometry;
      firstFit=false;invalidate();render();
      feedback('GeoJSON-Fläche lokal geladen: '+checked.componentCount+' Komponenten, '+
        checked.holeCount+' Aussparungen. Streifenberechnung separat starten.');
    }catch(err){feedback(err instanceof Error?err.message:'Ungültige GeoJSON-Datei.',true);}
  });
  $('show-photo-centers').addEventListener('change',render);
  $('optics-enable').addEventListener('change',()=>{
    $('optics-fields').hidden=!$('optics-enable').checked;
    $('spacing').disabled=$('optics-enable').checked;
    syncDualControls();
    invalidate();render();
    feedback($('optics-enable').checked?
      'Bitte reale Sensor-, Brennweiten-, Bildformat- und AGL-Werte eintragen.':
      'Manueller Streifenabstand wieder aktiviert.');
  });
  const cameraIds=['sensor-width','sensor-height','focal','agl','image-width',
    'image-height','side-overlap','front-overlap','photo-speed','min-capture-interval'];
  for(const id of cameraIds)$(id).addEventListener('input',()=>{
    if(report){invalidate();render();feedback('Kameraparameter geändert. Neu berechnen.');}
  });
  const dualIds=['dual-rgb-width','dual-rgb-height','dual-rgb-focal',
    'dual-rgb-side','dual-rgb-front'];
  function syncDualControls(){
    const enabled=$('optics-enable').checked&&
      $('camera-mode').value==='m3m-rgb-ms-tiff';
    $('dual-optics-enable').disabled=!enabled;
    if(!enabled)$('dual-optics-enable').checked=false;
    $('dual-optics-fields').hidden=!enabled||!$('dual-optics-enable').checked;
  }
  $('dual-optics-enable').addEventListener('change',()=>{
    syncDualControls();invalidate();render();
    feedback($('dual-optics-enable').checked?
      'Für den Doppeloptik-Vergleich beide physikalischen Kameramodelle vollständig eingeben.':
      'Einzeloptik-Vorschau aktiviert.');
  });
  for(const id of dualIds)$(id).addEventListener('input',()=>{
    if(report){invalidate();render();feedback('RGB-Zweitkamera geändert. Neu berechnen.');}
  });
  $('camera-mode').addEventListener('change',()=>{
    syncDualControls();
    invalidate();render();
    feedback($('camera-mode').value==='manual'?
      'Kameramodus: manuelle Eingabe ohne Modellreferenz.':
      'DJI-Modusreferenz ausgewählt. Bitte physische Optik und exakt passende Bildabmessungen eintragen; keine Kalibrierungsfreigabe.');
  });
  function cameraInputs(){
    const v=id=>$(id).value.trim();
    const n=id=>v(id)===''?undefined:v(id);
    return {
      sensorWidthMm:n('sensor-width'),sensorHeightMm:n('sensor-height'),
      focalLengthMm:n('focal'),heightAGLM:n('agl'),
      imageWidthPx:n('image-width'),imageHeightPx:n('image-height'),
      sideOverlapPercent:n('side-overlap'),frontOverlapPercent:n('front-overlap'),
      speedMps:n('photo-speed'),
      ...(v('min-capture-interval')===''?{}:
        {cameraMinIntervalSeconds:v('min-capture-interval')})
    };
  }
  function dualCameraInputs(shared){
    const get=id=>$(id).value.trim();
    const value=id=>get(id)===''?undefined:get(id);
    return {
      sensorWidthMm:value('dual-rgb-width'),
      sensorHeightMm:value('dual-rgb-height'),
      focalLengthMm:value('dual-rgb-focal'),
      imageWidthPx:5280,imageHeightPx:3956,
      heightAGLM:shared.heightAGLM,speedMps:shared.speedMps,
      sideOverlapPercent:value('dual-rgb-side'),
      frontOverlapPercent:value('dual-rgb-front')
    };
  }
  for(const id of ['spacing','heading'])$(id).addEventListener('input',()=>{
    if(report){invalidate();render();feedback('Parameter geändert. Vorschau erneut berechnen.');}
  });
  $('preview').addEventListener('click',()=>{
    try{
      const photogrammetry=$('optics-enable').checked;
      if(photogrammetry&&(!optics||!capture))throw new Error('Kamerageometriemodul nicht geladen');
      const manuallyEntered=photogrammetry?cameraInputs():null;
      const selectedMode=$('camera-mode').value;
      if(photogrammetry&&selectedMode!=='manual'&&!cameraReference)
        throw new Error('M3M-Kamerareferenzmodul nicht geladen.');
      const referenced=photogrammetry&&selectedMode!=='manual'?
        cameraReference.bind(selectedMode,manuallyEntered):null;
      const camera=referenced?referenced.opticalInputs:manuallyEntered;
      const profile=photogrammetry?optics.optics(camera):null;
      const dualMode=photogrammetry&&selectedMode==='m3m-rgb-ms-tiff'&&
        $('dual-optics-enable').checked;
      if(dualMode&&!dualOptics)throw new Error('Dualoptik-Vergleichsmodul nicht geladen.');
      const dualInput=dualMode?{
        rgb:dualCameraInputs(camera),multispectral:camera}:null;
      const comparison=dualMode?dualOptics.compare(dualInput):null;
      report=engine.preview(importedGeometry||points,{
        spacing:dualMode?comparison.nominalStripSpacingM:
          photogrammetry?profile.stripSpacingM:$('spacing').value,
        heading:$('heading').value
      });
      photoReport=photogrammetry&&!dualMode?optics.estimate(report,camera):null;
      captureReport=photogrammetry&&!dualMode?capture.plan(report,camera):null;
      const modeEstimate=referenced&&!dualMode?
        cameraReference.estimate(selectedMode,camera,report):null;
      dualReport=comparison;
      dualCount=dualMode?dualOptics.estimate(dualInput,report):null;
      if(dualMode)$('show-photo-centers').checked=false;
      $('show-photo-centers').disabled=!photogrammetry||dualMode;
      $('geojson').disabled=false;
      render();
      let message='2D-Geometrie: '+Math.round(report.areaSqMeters)+' m² Fläche, '+
        report.stripeCount+' Streifen, '+report.segmentCount+' Linienstücke, '+
        Math.round(report.previewSegmentLengthMeters)+' m Strecken innerhalb der Fläche. '+
        report.unplannedTransitions.length+' ungeplante Übergangslücken (rot gestrichelt; KEINE Flugroute).';
      if(dualReport&&dualCount){
        message+='\nDUALOPTIK – nur theoretischer Vergleich (keine Bildregistrierung): '+
          'RGB GSD '+dualReport.rgb.gsdAcrossCmPerPx.toFixed(2)+
          ' cm/Pixel, MS GSD '+dualReport.multispectral.gsdAcrossCmPerPx.toFixed(2)+
          ' cm/Pixel; engerer Querabstand '+dualReport.nominalStripSpacingM.toFixed(2)+
          ' m, engerer Fotoabstand '+dualReport.nominalPhotoSpacingM.toFixed(2)+
          ' m. Gemeinsames Referenzintervall mindestens '+
          dualReport.effectiveMinIntervalSeconds.toFixed(2)+' s; angenommene '+
          dualReport.nominalIntervalSeconds.toFixed(2)+' s. '+
          (dualReport.meetsNumericalCadence?'Numerische Kadenzbedingung erfüllt.':
            'WARNUNG: Numerische Kadenzbedingung NICHT erfüllt.')+
          '\nNur theoretisch: '+dualCount.nominalCaptureEvents+
          ' gemeinsame Aufnahmeereignisse, '+dualCount.nominalRGBJpegFiles+
          ' RGB-JPEG und '+dualCount.nominalMultispectralTiffFiles+
          ' MS-TIFF. Fotomarker absichtlich deaktiviert. '+
          'Keine Co-Registrierung, Sensorachsen- oder Geländeprüfung, keine Flugfreigabe.';
      }
      if(photoReport){
        const p=photoReport,cam=p.optics;
        message+='\nOptik (nur theoretisch): GSD quer '+cam.gsdAcrossCmPerPx.toFixed(2)+
          ' cm/Pixel, längs '+cam.gsdAlongCmPerPx.toFixed(2)+
          ' cm/Pixel. Bodenbild '+cam.groundWidthM.toFixed(1)+' × '+
          cam.groundLengthM.toFixed(1)+' m, Querstreifenabstand '+
          cam.stripSpacingM.toFixed(1)+' m, Fotoabstand '+
          cam.alongTrackTriggerDistanceM.toFixed(1)+' m, Auslöseintervall '+
          cam.estimatedTriggerIntervalSeconds.toFixed(2)+' s, maximal geschätzte '+
          p.estimatedImageCount+' Endpunkt-inklusive Aufnahmen.';
        message+='\nFoto-Zentren: '+captureReport.displayedCenterCount+
          ' Marker ('+captureReport.sampleDescription+'). Kein Auslöseauftrag.';
        if(captureReport.sampleOnly)
          message+='\nACHTUNG: Es werden nicht alle '+captureReport.estimatedImageCount+
            ' geschätzten Fotopunkte dargestellt.';
        if(modeEstimate){
          message+='\nDJI-M3M-Referenz '+modeEstimate.id+': mindestens '+
            modeEstimate.configuredMinIntervalSeconds.toFixed(1)+' s. Geschätzte '+
            modeEstimate.estimatedCaptureEvents+' Ereignisse / '+
            modeEstimate.estimatedImageArtifacts+' Bilddateien (nur theoretisch). '+
            (modeEstimate.cadencePassesReference?'Geometrisches Intervall erfüllt das Referenzminimum.':
              'WARNUNG: Referenz-Aufnahmeintervall bei der gewählten Geschwindigkeit unterschritten.')+
            ' Keine physische Kalibrierung, keine RGB-Zweitkamera-Footprint-Prüfung, kein Pilot-2-Test.';
        }
        if(cam.cameraIntervalSatisfiesConstraint===false)
          message+='\nWARNUNG: Auslöseintervall unterschreitet das angegebene minimale Kamera-Aufnahmeintervall.';
        else if(cam.cameraIntervalSatisfiesConstraint===null)
          message+='\nKamera-Aufnahmeintervall unbekannt: Fähigkeit nicht geprüft.';
      }
      feedback(message+'\nKeine Wendeflüge, reale Auslösung oder Flug-/Terrainfreigabe.');
    }catch(err){
      invalidate();render();
      feedback(err instanceof Error?err.message:'Geometrie kann nicht berechnet werden.',true);
    }
  });
  $('geojson').addEventListener('click',()=>{
    if(!report)return;
    const closed=[...report.polygon,report.polygon[0]];
    const data={type:'FeatureCollection',name:'SkyHub 2D preview – NOT DJI WPML',
      properties:{flightReady:false,exportableAsWaylines:false,scope:report.validationScope,
        cameraReferenceMode:(photoReport||dualReport)&&$('camera-mode').value!=='manual'?
          $('camera-mode').value:null,
        cameraReferenceHardwareVerified:false,
        dualSensorComparison:dualReport&&dualCount?{
          schema:'skyhub-wpml-dual-optics-inspection-v1',
          kind:'unregistered-theoretical-optics-comparison',
          referenceMode:dualReport.mode,
          rgbGsdAcrossCmPerPx:dualReport.rgb.gsdAcrossCmPerPx,
          rgbGsdAlongCmPerPx:dualReport.rgb.gsdAlongCmPerPx,
          msGsdAcrossCmPerPx:dualReport.multispectral.gsdAcrossCmPerPx,
          msGsdAlongCmPerPx:dualReport.multispectral.gsdAlongCmPerPx,
          nominalStripSpacingM:dualReport.nominalStripSpacingM,
          nominalPhotoSpacingM:dualReport.nominalPhotoSpacingM,
          nominalIntervalSeconds:dualReport.nominalIntervalSeconds,
          effectiveMinIntervalSeconds:dualReport.effectiveMinIntervalSeconds,
          meetsNumericalCadence:dualReport.meetsNumericalCadence,
          nominalCaptureEvents:dualCount.nominalCaptureEvents,
          nominalRGBJpegFiles:dualCount.nominalRGBJpegFiles,
          nominalMultispectralTiffFiles:dualCount.nominalMultispectralTiffFiles,
          nominalTotalFiles:dualCount.nominalTotalFiles,
          photoActionsGenerated:false,
          coRegistrationVerified:false,
          relativeBoresightVerified:false,
          opticalCalibrationVerified:false,
          terrainVerified:false,
          cameraHardwareVerified:false,
          pilot2HardwareVerified:false,
          actualCaptureSupported:null,
          flightReady:false,dispatchAllowed:false,
          exportableAsWaylines:false
        }:null,
        opticsEstimate:photoReport?{...photoReport}:null},
      features:[
        {type:'Feature',geometry:report.outlineGeometry||
          {type:'Polygon',coordinates:[closed.map(p=>[p.lon,p.lat])]},
          properties:{kind:'user-defined-survey-outline',areaSqMeters:report.areaSqMeters,
            componentCount:report.componentCount,holeCount:report.holeCount}},
        {type:'Feature',
          geometry:{type:'MultiLineString',coordinates:report.segments.map(s=>
            [[s.start.lon,s.start.lat],[s.end.lon,s.end.lat]])},
          properties:{kind:'approximate-coverage-preview-not-flight-route',
            spacingMeters:report.lineSpacingMeters,headingDegrees:report.headingDegrees}},
        ...(report.unplannedTransitions.length?[{type:'Feature',
          geometry:{type:'MultiLineString',coordinates:report.unplannedTransitions.map(g=>
            [[g.from.lon,g.from.lat],[g.to.lon,g.to.lat]])},
          properties:{kind:'unplanned-direct-gaps-NOT-safe-flight-paths',planned:false,
            safetyVerified:false,flightReady:false,exportableAsWaylines:false}}]:[]),
        ...(captureReport?[{type:'Feature',geometry:{type:'MultiPoint',
          coordinates:captureReport.photoCenters.map(p=>[p.lon,p.lat])},
          properties:{kind:'nominal-photo-centers-NOT-DJI-actions',
            sampleOnly:captureReport.sampleOnly,
            displayedCenterCount:captureReport.displayedCenterCount,
            estimatedImageCount:captureReport.estimatedImageCount,
            nominalTargetSpacingMeters:captureReport.targetSpacingMeters,
            flightReady:false,exportableAsWaylines:false}}]:[])
      ]};
    const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/geo+json'});
    const url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download='skyhub-coverage-preview.geojson';
    document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),30000);
    feedback('Unverbindliche GeoJSON-Vorschau lokal gespeichert. Kein DJI-Missionsformat.');
  });
  syncDualControls();
  render();
})();