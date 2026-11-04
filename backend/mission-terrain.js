'use strict';
// Terrain check for the mission release: height above ground along the route from a digital elevation model.
// Idea and API from hdrpano/GeoTIFF-Python (MIT, Kilian Eisenegger): Open Topo Data (https://www.opentopodata.org)
//   GET {base}/v1/{dataset}?locations=lat,lon|lat,lon…  → {status:"OK",results:[{elevation,location:{lat,lng}}]}
//   at most 100 locations per request (public API: 1 request/s, 1000/day; self-hosted: no limit).
// Off by default (SKYHUB_TERRAIN_URL). The public server receives the route coordinates; a self-hosted Open Topo Data
// (e.g. on brix-node with EU-DEM/SRTM) keeps them local.
// Height above ground for relativeToStartPoint routes: ground(take-off) + height above take-off − ground(point).
// The take-off point is wpml:takeOffRefPoint if present, otherwise ASSUMED to be the first waypoint (flagged).
// realTimeFollowSurface routes fly at height above ground already; WGS84 routes are not converted (geoid unknown).
// A DEM knows neither buildings nor trees and has 25–30 m cells: the result is a plausibility check, not clearance.
const BATCH=100,MAX_SAMPLES=600,STEP_M=25;

const RAD=Math.PI/180,R=6371008.8;
function haversine(a,b){
  const dLat=(b.lat-a.lat)*RAD,dLon=(b.lon-a.lon)*RAD;
  const h=Math.sin(dLat/2)**2+Math.cos(a.lat*RAD)*Math.cos(b.lat*RAD)*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.min(1,Math.sqrt(h)));
}
const round=(v,d=1)=>Math.round(v*10**d)/10**d;

function terrainConfig(env=process.env){
  const url=env.SKYHUB_TERRAIN_URL;
  if(!url)return {enabled:false};
  let u;
  try{u=new URL(url);}catch{return {enabled:false,issue:'SKYHUB_TERRAIN_URL ist keine URL'};}
  if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.search||u.hash)
    return {enabled:false,issue:'SKYHUB_TERRAIN_URL: nur http(s)://host[:port][/pfad] ohne Zugangsdaten'};
  const dataset=env.SKYHUB_TERRAIN_DATASET||'eudem25m';
  if(!/^[a-z0-9_-]{2,40}$/i.test(dataset))return {enabled:false,issue:'SKYHUB_TERRAIN_DATASET ungültig'};
  const minAgl=env.SKYHUB_TERRAIN_MIN_AGL_M===undefined||env.SKYHUB_TERRAIN_MIN_AGL_M===''?15:Number(env.SKYHUB_TERRAIN_MIN_AGL_M);
  if(!Number.isFinite(minAgl)||minAgl<0||minAgl>100)return {enabled:false,issue:'SKYHUB_TERRAIN_MIN_AGL_M 0..100'};
  return {enabled:true,base:u.origin+u.pathname.replace(/\/+$/,''),dataset,minAglM:minAgl,
    public:/(^|\.)opentopodata\.org$/i.test(u.hostname)};
}

// Densify the route (straight lines between waypoints) so ridges between waypoints are seen.
function routeSamples(points,{stepM=STEP_M,max=MAX_SAMPLES}={}){
  const out=[];
  for(let i=0;i<points.length;i++){
    const a=points[i];
    out.push({lat:a.lat,lon:a.lon,h:a.heightAboveTakeoffM,wp:i});
    const b=points[i+1];
    if(!b)break;
    const n=Math.min(50,Math.floor(haversine(a,b)/stepM));
    for(let k=1;k<n;k++){
      const t=k/n;
      out.push({lat:a.lat+(b.lat-a.lat)*t,lon:a.lon+(b.lon-a.lon)*t,
        h:a.heightAboveTakeoffM===null||b.heightAboveTakeoffM===null?null:a.heightAboveTakeoffM+(b.heightAboveTakeoffM-a.heightAboveTakeoffM)*t,wp:i+t});
    }
  }
  if(out.length<=max)return out;
  const every=out.length/max;                       // thin out evenly, always keep waypoints
  return out.filter((p,i)=>Number.isInteger(p.wp)||Math.floor(i/every)!==Math.floor((i-1)/every));
}

function createTerrainClient(config,{fetchImpl=globalThis.fetch,timeoutMs=8000,cacheMs=3600e3,now=()=>Date.now()}={}){
  const cache=new Map();
  async function elevations(list){
    const out=[];
    for(let i=0;i<list.length;i+=BATCH){
      const batch=list.slice(i,i+BATCH);
      const q=batch.map(p=>p.lat.toFixed(6)+','+p.lon.toFixed(6)).join('|');
      const ctrl=new AbortController(),t=setTimeout(()=>ctrl.abort(),timeoutMs);
      let body;
      try{
        const res=await fetchImpl(config.base+'/v1/'+encodeURIComponent(config.dataset)+'?locations='+encodeURIComponent(q),
          {signal:ctrl.signal,headers:{Accept:'application/json','User-Agent':'SkyHub-Next terrain check'}});
        if(!res.ok)throw new Error('HTTP '+res.status);
        body=await res.json();
      }finally{clearTimeout(t);}
      if(!body||body.status!=='OK'||!Array.isArray(body.results)||body.results.length!==batch.length)throw new Error('unexpected answer');
      for(const r of body.results)out.push(typeof r?.elevation==='number'&&Number.isFinite(r.elevation)?r.elevation:null);
      if(config.public&&i+BATCH<list.length)await new Promise(r=>setTimeout(r,1100));   // public API: 1 request/s
    }
    return out;
  }
  // check(key, points, ref) → {status:'ok'|'skipped'|'unavailable', …}; cached per key (route hash) for GET/POST consistency.
  async function check(key,points,ref){
    const hit=cache.get(key);
    if(hit&&now()-hit.at<cacheMs)return hit.result;
    const result=await compute(points,ref);
    cache.set(key,{at:now(),result});
    if(cache.size>200)for(const [k,v] of cache)if(now()-v.at>=cacheMs)cache.delete(k);
    return result;
  }
  async function compute(points,ref){
    const relative=points.filter(p=>p.heightMode==='relativeToStartPoint'&&p.heightAboveTakeoffM!==null);
    if(!relative.length)return {status:'skipped',reason:points.some(p=>p.heightMode==='realTimeFollowSurface')?'terrain-follow':'wgs84'};
    const samples=routeSamples(relative);
    const start=ref?{lat:ref.lat,lon:ref.lon}:{lat:relative[0].lat,lon:relative[0].lon};
    let ground;
    try{ground=await elevations([start,...samples]);}
    catch(err){return {status:'unavailable',reason:String(err&&err.name==='AbortError'?'timeout':err.message).slice(0,80)};}
    const g0=ground[0];
    if(g0===null)return {status:'unavailable',reason:'no elevation at the take-off point'};
    let max=null,min=null,gMin=null,gMax=null,missing=0;
    samples.forEach((p,i)=>{
      const g=ground[i+1];
      if(g===null||p.h===null){missing++;return;}
      const agl=g0+p.h-g;
      if(!max||agl>max.agl)max={agl,lat:p.lat,lon:p.lon,wp:p.wp};
      if(!min||agl<min.agl)min={agl,lat:p.lat,lon:p.lon,wp:p.wp};
      gMin=gMin===null?g:Math.min(gMin,g);gMax=gMax===null?g:Math.max(gMax,g);
    });
    if(!max)return {status:'unavailable',reason:'no elevations along the route'};
    const at=x=>({aglM:round(x.agl),waypoint:Math.floor(x.wp)+1,lat:round(x.lat,6),lon:round(x.lon,6)});
    return {status:'ok',dataset:config.dataset,samples:samples.length,missing,assumedTakeoff:!ref,
      takeoffGroundM:round(g0),groundMinM:round(gMin),groundMaxM:round(gMax),maxAgl:at(max),minAgl:at(min)};
  }
  return {check,elevations,config};
}

// Errors/warnings for the release from a terrain result (exact texts: they are acknowledged one by one).
function terrainFindings(t,{maxHeightM=120,minAglM=15}={}){
  const errors=[],warnings=[];
  if(!t)return {errors,warnings};
  if(t.status==='unavailable'){
    warnings.push('terrain not checked: elevation service unavailable ('+t.reason+'); check heights above ground manually');
    return {errors,warnings};
  }
  if(t.status!=='ok')return {errors,warnings};
  warnings.push('terrain from '+t.dataset+' (25-30 m grid, no buildings or trees): highest '+t.maxAgl.aglM+' m and lowest '+
    t.minAgl.aglM+' m above ground; obstacles must still be checked on site');
  if(t.assumedTakeoff)warnings.push('terrain: take-off point assumed at the first waypoint (ground '+t.takeoffGroundM+' m); a different take-off point shifts all heights above ground');
  if(t.maxAgl.aglM>maxHeightM)errors.push('terrain: '+t.maxAgl.aglM+' m above ground near waypoint '+t.maxAgl.waypoint+' exceeds '+maxHeightM+' m');
  if(t.minAgl.aglM<minAglM)warnings.push('terrain: only '+t.minAgl.aglM+' m above ground near waypoint '+t.minAgl.waypoint+' (below '+minAglM+' m)');
  if(t.missing)warnings.push('terrain: '+t.missing+' route points without elevation data');
  return {errors,warnings};
}

module.exports={terrainConfig,createTerrainClient,terrainFindings,routeSamples,haversine};
