'use strict';
// Routes from FlightHub Keyless into the WPML mission library (FlightHub ADR-002, 07.11.2026).
// SkyHub PULLS a route on an operator action in SkyHub; FlightHub never writes into SkyHub and gets no credential.
//   GET  /api/wpml/missions/flighthub          list of the FlightHub route library (names, aircraft, waypoint count)
//   POST /api/wpml/missions/import/flighthub   {id}: load that KMZ, check SHA-256 against the id, store it via store.put
// The stored route is NOT released: Pilot 2 sees it only after the normal mission release (mission-release.js).
// The only network target is SKYHUB_FLIGHTHUB_URL from the configuration (home-LAN address, no URL from requests).
const crypto=require('node:crypto');
const net=require('node:net');

const ID=/^[0-9a-f]{16}$/;
const LIST_MAX=2*1024*1024;
const KMZ_MAX=12*1024*1024;          // = wpml-mission-store MAX_KMZ
const TIMEOUT_MS=10000;
const LIST_MAX_ITEMS=500;
const LOCAL_HOSTS=new Set(['brix-node','localhost','host.docker.internal','flighthub-keyless']);

function privateIpv4(host){
  if(net.isIP(host)!==4)return false;
  const [a,b]=host.split('.').map(Number);
  return a===10||a===127||(a===172&&b>=16&&b<=31)||(a===192&&b===168);
}
// SKYHUB_FLIGHTHUB_URL: plain http(s) origin of FlightHub Keyless in the home LAN, e.g. http://192.168.178.50:3003.
function flighthubConfig(env=process.env){
  const raw=env.SKYHUB_FLIGHTHUB_URL;
  if(raw===undefined||raw==='')return {enabled:false,issue:null,base:null};
  try{
    const u=new URL(raw);
    if(!/^https?:$/.test(u.protocol)||u.username||u.password||u.search||u.hash||(u.pathname!=='/'&&u.pathname!==''))
      throw new Error('origin only');
    if(!privateIpv4(u.hostname)&&!LOCAL_HOSTS.has(u.hostname))throw new Error('home-LAN host only');
    return {enabled:true,issue:null,base:u.origin};
  }catch(err){
    return {enabled:false,issue:'SKYHUB_FLIGHTHUB_URL must be a plain http(s) home-LAN origin ('+err.message+')',base:null};
  }
}

const httpError=(status,message)=>Object.assign(new Error(message),{status});

async function readLimited(res,max){
  const declared=Number(res.headers.get('content-length'));
  if(Number.isFinite(declared)&&declared>max)throw httpError(502,'FlightHub answer too large');
  if(!res.body)throw httpError(502,'FlightHub list unreadable');
  const reader=res.body.getReader(),chunks=[];let size=0;
  for(;;){
    const {done,value}=await reader.read();
    if(done)break;
    size+=value.length;
    if(size>max){await reader.cancel().catch(()=>{});throw httpError(502,'FlightHub answer too large');}
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

function createFlightHubRouteSource({base,fetchImpl=globalThis.fetch,timeoutMs=TIMEOUT_MS}){
  if(typeof base!=='string'||typeof fetchImpl!=='function')throw new TypeError('FlightHub base URL and fetch required');
  async function get(path,max){
    let res;
    try{
      res=await fetchImpl(base+path,{method:'GET',redirect:'error',cache:'no-store',
        headers:{Accept:'application/json, application/vnd.google-earth.kmz'},signal:AbortSignal.timeout(timeoutMs)});
    }catch(_err){throw httpError(502,'FlightHub not reachable');}
    if(res.status===404)throw httpError(404,'Route not found in FlightHub');
    if(!res.ok)throw httpError(502,'FlightHub answered HTTP '+res.status);
    return readLimited(res,max);
  }
  const text=v=>typeof v==='string'?v.slice(0,120):null;
  const count=v=>Number.isSafeInteger(v)&&v>=0?v:null;
  return {
    async list(){
      let data;
      try{data=JSON.parse((await get('/api/waylines',LIST_MAX)).toString('utf8'));}
      catch(err){if(err.status)throw err;throw httpError(502,'FlightHub list unreadable');}
      if(!Array.isArray(data))throw httpError(502,'FlightHub list unreadable');
      return data.filter(w=>w&&ID.test(w.id)).slice(0,LIST_MAX_ITEMS).map(w=>({
        id:w.id,name:text(w.name),model:text(w.modelName||w.drone?.modelName||w.compatible),
        waypoints:count(w.waypoints),templateType:text(w.templateType),
        heightMode:text(w.heightMode),distanceM:count(w.distanceM),origin:text(w.origin),
        addedAt:Number.isFinite(w.addedAt)?w.addedAt:null,
        issues:Array.isArray(w.issues)?w.issues.slice(0,5).map(text):[]
      }));
    },
    async kmz(id){
      if(!ID.test(String(id||'')))throw httpError(400,'Invalid FlightHub route id');
      const bytes=await get('/api/waylines/'+id+'/kmz',KMZ_MAX);
      // FlightHub ids are the first 16 hex digits of the SHA-256 of the file: the bytes must be exactly that route.
      const sha256=crypto.createHash('sha256').update(bytes).digest('hex');
      if(!sha256.startsWith(id))throw httpError(502,'FlightHub file does not match the route id');
      return {bytes,sha256};
    }
  };
}

// DJI wayline names: 1–64 characters without < > : " / | ? * . _ \ (wpml-mission-store validName).
function missionName(raw,id){
  const name=String(raw||'').replace(/\.kmz$/i,'').replace(/[<>:"/|?*._\\\u0000-\u001f\u007f]+/g,' ')
    .replace(/\s+/g,' ').trim().slice(0,64).trim();
  return name||'FlightHub '+id.slice(0,8);
}

function createFlightHubImportRouter({express,source,store,audit=e=>console.log('[wpml import] '+JSON.stringify(e)),now=()=>new Date()}){
  if(!store||typeof store.put!=='function')throw new TypeError('WPML store required');
  const router=express.Router();
  const send=(res,status,body)=>{res.set('Cache-Control','no-store');return res.status(status).json(body);};
  // Without SKYHUB_FLIGHTHUB_URL both paths answer "not configured" (the mission router would read them as an id).
  if(!source){
    router.all(['/flighthub','/import/flighthub'],(req,res)=>send(res,404,{error:'FlightHub import not configured',configured:false}));
    return router;
  }
  const fail=(res,err)=>{
    if(err&&err.status&&err.status<600&&err.status!==500){
      return send(res,err.status,{error:err.message,...(Array.isArray(err.details?.errors)?{errors:err.details.errors.slice(0,25)}:{})});
    }
    console.error('[wpml import]',err&&err.name||'error');
    return send(res,503,{error:'Import unavailable'});
  };
  router.get('/flighthub',async(req,res)=>{
    try{send(res,200,{items:await source.list()});}catch(err){fail(res,err);}
  });
  router.post('/import/flighthub',async(req,res)=>{
    const id=req.body&&typeof req.body.id==='string'?req.body.id:'';
    try{
      if(!ID.test(id))throw httpError(400,'Invalid FlightHub route id');
      const meta=(await source.list()).find(w=>w.id===id);
      if(!meta)throw httpError(404,'Route not found in FlightHub');
      const {bytes,sha256}=await source.kmz(id);
      const stored=await store.put(bytes,{name:missionName(meta.name,id),username:'FlightHub',origin:'flighthub'});
      // No coordinates in the log: source id, stored id, hash, aircraft, waypoint count.
      audit({ts:now().toISOString(),action:'import',source:'flighthub',flighthubId:id,waylineId:stored.id,
        sha256,created:stored.created!==false,droneModelKey:stored.droneModelKey||null,waypoints:stored.waypointCount??null});
      send(res,stored.created===false?200:201,{id:stored.id,name:stored.name,created:stored.created!==false,
        released:false,droneModelKey:stored.droneModelKey||null,waypointCount:stored.waypointCount??null});
    }catch(err){fail(res,err);}
  });
  return router;
}

module.exports={flighthubConfig,createFlightHubRouteSource,createFlightHubImportRouter,missionName};
