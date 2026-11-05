'use strict';
// Geozone check for the mission release: which dipul geozones (DFS, § 21h LuftVO) the route touches.
// Source: dipul WFS https://uas-betrieb.de/geoservices/dipul/wfs (GeoJSON, EPSG:4326, one typeName per request; licence
// CC BY-ND 4.0, © DFS). Only the bounding box of the route (+ buffer) is sent, never the route itself. Opt-in
// (SKYHUB_GEOZONES_ENABLED=true). The result is a hint for the pilot: it does not replace the check in dipul / the
// authorisation, and zones that dipul does not publish are not covered.
// The 31 feature types of the WFS GetCapabilities (05.11.2026); modellflugplaetze and haengegleiter exist only in the WMS.
const LAYERS=Object.freeze(['flughaefen','flugplaetze','kontrollzonen','flugbeschraenkungsgebiete','temporaere_betriebseinschraenkungen',
  'militaerische_anlagen','behoerden','diplomatische_vertretungen','internationale_organisationen',
  'polizei','sicherheitsbehoerden','justizvollzugsanstalten','labore','krankenhaeuser','industrieanlagen','kraftwerke',
  'umspannwerke','stromleitungen','windkraftanlagen','bundesautobahnen','bundesstrassen','bahnanlagen','binnenwasserstrassen',
  'seewasserstrassen','schifffahrtsanlagen','naturschutzgebiete','nationalparks','vogelschutzgebiete','ffh-gebiete',
  'freibaeder','wohngrundstuecke']);
const DEFAULT_URL='https://uas-betrieb.de/geoservices/dipul/wfs';
const RAD=Math.PI/180,R=6371008.8;
const round=(v,d=1)=>Math.round(v*10**d)/10**d;

function geozoneConfig(env=process.env){
  if(env.SKYHUB_GEOZONES_ENABLED!=='true')return {enabled:false};
  let u;try{u=new URL(env.SKYHUB_GEOZONES_WFS_URL||DEFAULT_URL);}catch{return {enabled:false,issue:'SKYHUB_GEOZONES_WFS_URL ist keine URL'};}
  if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash)return {enabled:false,issue:'SKYHUB_GEOZONES_WFS_URL: nur https://host/pfad'};
  return {enabled:true,url:u.origin+u.pathname,bufferM:100};
}

// --- geometry ---------------------------------------------------------------------------------------------------------
function inRing(p,ring){
  let inside=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const [xi,yi]=ring[i],[xj,yj]=ring[j];
    if(((yi>p[1])!==(yj>p[1]))&&(p[0]<(xj-xi)*(p[1]-yi)/(yj-yi)+xi))inside=!inside;
  }
  return inside;
}
function inPolygon(p,rings){return rings.length>0&&inRing(p,rings[0])&&!rings.slice(1).some(h=>inRing(p,h));}
function contains(geometry,p){
  if(!geometry)return false;
  if(geometry.type==='Polygon')return inPolygon(p,geometry.coordinates);
  if(geometry.type==='MultiPolygon')return geometry.coordinates.some(poly=>inPolygon(p,poly));
  return false;
}
// Route densified to ≤ 10 m steps (lon,lat pairs) so short crossings between waypoints are seen.
function densify(points,stepM=10,max=20000){
  const out=[];
  for(let i=0;i<points.length;i++){
    const a=points[i],b=points[i+1];
    out.push({p:[a.lon,a.lat],wp:i+1,h:a.h});
    if(!b)break;
    const dx=(b.lon-a.lon)*Math.cos(a.lat*RAD)*RAD*R,dy=(b.lat-a.lat)*RAD*R,n=Math.min(500,Math.floor(Math.hypot(dx,dy)/stepM));
    for(let k=1;k<n;k++){const t=k/n;out.push({p:[a.lon+(b.lon-a.lon)*t,a.lat+(b.lat-a.lat)*t],wp:i+1+t,h:a.h===null||b.h===null?null:a.h+(b.h-a.h)*t});}
    if(out.length>max)break;
  }
  return out;
}
function bbox(points,bufferM){
  let s=90,w=180,n=-90,e=-180;
  for(const p of points){s=Math.min(s,p.lat);n=Math.max(n,p.lat);w=Math.min(w,p.lon);e=Math.max(e,p.lon);}
  const dLat=bufferM/(RAD*R),dLon=bufferM/(RAD*R*Math.cos(((s+n)/2)*RAD));
  return {s:s-dLat,w:w-dLon,n:n+dLat,e:e+dLon};
}

function createGeozoneClient(config,{fetchImpl=globalThis.fetch,timeoutMs=15000,cacheMs=24*3600e3,now=()=>Date.now(),concurrency=4}={}){
  const cache=new Map();
  async function layer(name,b){
    const q=new URLSearchParams({service:'WFS',version:'2.0.0',request:'GetFeature',typeNames:'dipul:'+name,outputFormat:'application/json',
      srsName:'EPSG:4326',count:'500',bbox:[b.s,b.w,b.n,b.e].map(v=>v.toFixed(6)).join(',')+',urn:ogc:def:crs:EPSG::4326'});
    const res=await fetchImpl(config.url+'?'+q,{signal:AbortSignal.timeout(timeoutMs),headers:{Accept:'application/json','User-Agent':'SkyHub-Next geozone check'}});
    if(!res.ok)throw new Error(name+': HTTP '+res.status);
    const body=await res.json();
    if(!body||!Array.isArray(body.features))throw new Error(name+': unexpected answer');
    return body.features.map(f=>({layer:name,id:String(f.id||'').slice(0,80),geometry:f.geometry,p:f.properties||{}}));
  }
  async function compute(points){
    if(!Array.isArray(points)||!points.length)return {status:'skipped',reason:'no route'};
    const b=bbox(points,config.bufferM);
    const features=[],failed=[];
    for(let i=0;i<LAYERS.length;i+=concurrency){
      const part=await Promise.allSettled(LAYERS.slice(i,i+concurrency).map(l=>layer(l,b)));
      part.forEach((r,k)=>{if(r.status==='fulfilled')features.push(...r.value);else failed.push(LAYERS[i+k]);});
    }
    if(failed.length===LAYERS.length)return {status:'unavailable',reason:'dipul WFS not reachable'};
    const samples=densify(points);
    const zones=[];
    for(const f of features){
      let first=null,last=null,count=0;
      for(const s of samples)if(contains(f.geometry,s.p)){count++;if(first===null)first=s.wp;last=s.wp;}
      if(!count)continue;
      zones.push({layer:f.layer,id:f.id,name:String(f.p.name||f.p.generated_name_DE||f.layer).slice(0,120),
        typeCode:String(f.p.type_code||'').slice(0,40),legalRef:String(f.p.legal_ref||'').slice(0,80),
        lowerLimitMAgl:Number.isFinite(f.p.lower_limit_m_agl)?f.p.lower_limit_m_agl:null,
        upperLimitMAgl:Number.isFinite(f.p.upper_limit_m_agl)?f.p.upper_limit_m_agl:null,
        fromWaypoint:Math.floor(first),toWaypoint:Math.ceil(last),share:round(count/samples.length*100,0)});
    }
    zones.sort((a,b)=>b.share-a.share);
    return {status:'ok',source:'dipul (DFS), CC BY-ND 4.0',checkedAt:new Date(now()).toISOString(),layersFailed:failed,zones};
  }
  async function check(key,points){
    const hit=cache.get(key);
    if(hit&&now()-hit.at<cacheMs)return hit.result;
    let result;
    try{result=await compute(points);}catch(err){result={status:'unavailable',reason:String(err.message||err).slice(0,80)};}
    if(result.status==='ok')cache.set(key,{at:now(),result});
    if(cache.size>200)for(const [k,v] of cache)if(now()-v.at>=cacheMs)cache.delete(k);
    return result;
  }
  return {check,compute,config};
}

// Findings for the release (exact English texts: acknowledged one by one; missionsfreigabe.js translates them).
function geozoneFindings(g){
  const warnings=[];
  if(!g)return {errors:[],warnings};
  if(g.status==='unavailable'){warnings.push('geozones not checked: dipul unavailable ('+g.reason+'); check the route in dipul.de');return {errors:[],warnings};}
  if(g.status!=='ok')return {errors:[],warnings};
  for(const z of g.zones)warnings.push('geozone: '+z.name+' ('+(z.typeCode||z.layer)+(z.legalRef?', '+z.legalRef:'')+') waypoints '+z.fromWaypoint+'-'+z.toWaypoint+
    ', '+z.share+' % of the route; check permission or conditions in dipul');
  if(g.layersFailed.length)warnings.push('geozones partly checked: '+g.layersFailed.length+' dipul layers unavailable ('+g.layersFailed.slice(0,4).join(', ')+')');
  if(!g.zones.length&&!g.layersFailed.length)warnings.push('geozones: no published dipul zone on the route (dipul data only; temporary and local restrictions may be missing)');
  return {errors:[],warnings};
}

module.exports={geozoneConfig,createGeozoneClient,geozoneFindings,contains,densify,bbox,LAYERS};
