'use strict';
// Height above local terrain for a PHOTO: relative-to-takeoff height + DEM(takeoff) - DEM(photo).
// Both DEM readings come from the SAME configured dataset, so NO WGS84 ellipsoid / EGM96 / EGM2008
// mixing occurs. DJI AbsoluteAltitude/RtkFlag are diagnostic metadata only; never used for AGL.
// Takeoff position must be supplied explicitly by the operator: the first image/MRK position is NOT takeoff.
// The DEM is a coarse surface estimate, not obstacle clearance or a verified photogrammetric result.
const MAX_TERRAIN_PHOTOS=5000;
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const validCoordinate=p=>p&&finite(p.lat)&&finite(p.lon)&&p.lat>=-90&&p.lat<=90&&p.lon>=-180&&p.lon<=180;

function parseTakeoff(body){
  if(!body||body.takeoff===undefined||body.takeoff===null)return null;
  const p=body.takeoff;
  if(!validCoordinate(p)||Array.isArray(p))
    throw Object.assign(new Error('Startpunkt: Breite -90..90 und Länge -180..180 als Zahlen erforderlich'),{status:400});
  return {lat:p.lat,lon:p.lon};
}

function unavailable(reason){
  return {status:'unavailable',reason,photos:[],altitude:{status:'unavailable',reason}};
}
async function terrainCorrectedPhotos(photos,takeoff,terrain){
  if(!validCoordinate(takeoff))return unavailable('Startpunkt fehlt oder ist ungültig');
  // No external terrain requests from the media QA path: coordinates are mission-sensitive.
  if(!terrain||terrain.config?.public||typeof terrain.elevations!=='function')
    return unavailable('Lokaler Geländedienst nicht verfügbar');
  if(photos.length>MAX_TERRAIN_PHOTOS)
    return unavailable('Zu viele Fotos für eine Geländeabfrage (maximal '+MAX_TERRAIN_PHOTOS+')');
  const selected=photos.map((p,i)=>({p,i})).filter(({p})=>p.info&&validCoordinate(p.info)&&
    finite(p.info.relAlt)&&p.info.pitch<=-30);
  if(selected.length<2)return unavailable('Weniger als zwei auswertbare Foto-Positionen');
  const positions=[takeoff,...selected.map(({p})=>({lat:p.info.lat,lon:p.info.lon}))];
  let heights;
  try{heights=await terrain.elevations(positions);}
  catch{return unavailable('Geländedienst fehlgeschlagen oder Zeitüberschreitung');}
  if(!Array.isArray(heights)||heights.length!==positions.length||!finite(heights[0]))
    return unavailable('Geländehöhe des Startpunkts fehlt oder Antwort unvollständig');
  const corrected=photos.map(p=>({...p,info:null}));
  let valid=0,missing=0,implausible=0;
  selected.forEach(({p,i},index)=>{
    const ground=heights[index+1];
    if(!finite(ground)){missing++;return;}
    const agl=p.info.relAlt+heights[0]-ground;
    if(!(agl>1&&agl<1000)){implausible++;return;}
    corrected[i]={...p,aglM:agl};valid++;
  });
  if(valid<2)return unavailable('Weniger als zwei gültige AGL-Schätzwerte');
  return {
    status:'estimated',
    photos:corrected,
    altitude:{
      status:'estimated',basis:'relative-to-takeoff + same-datum DEM difference',
      terrainDataset:terrain.config?.dataset||'unknown',
      takeoff:{lat:takeoff.lat,lon:takeoff.lon},
      groundAtTakeoffM:heights[0],
      evaluated:selected.length,valid,missing,implausible,
      absoluteAltitudeDatum:'not-used',
      warning:'Geländemodell-Schätzung; keine Hindernis-, Höhenfreigabe oder photogrammetrische Validierung'
    }
  };
}
module.exports={MAX_TERRAIN_PHOTOS,parseTakeoff,terrainCorrectedPhotos};
