'use strict';
// Import of routes that DJI Pilot 2 uploads into SkyHub (decision 04.11.2026: accept, check, never release automatically).
// DJI Cloud API 1.18, pilot-to-cloud/https/waypoint-management/waypointfile-upload-result-report:
//   POST /wayline/api/v1/workspaces/{workspace_id}/upload-callback  {object_key (required), name, metadata{…}}
// Pilot 2 first gets STS credentials (storage/api/v1/…/sts, the same grant as for media) and PUTs the KMZ below the issued
// prefix in the dji-cloud bucket. SkyHub then:
//   1. trusts the object only below a database-registered, time-valid STS prefix with HEAD evidence (pilot-media-store),
//   2. reads at most 12 MiB, and stores it through the WPML store (write-once, id = SHA-256, full WPML validation,
//      unique name). The callback metadata (aircraft, payload, template) is ignored; everything is derived from the KMZ.
//   3. A stored route is NOT visible to Pilot 2 until it passes the mission release (missionsfreigabe.html).
// The uploaded temporary object stays in dji-cloud/<workspace>/media/<session>/ (the SkyHub account has no delete right);
// it is not registered as media (no dji_pilot_media_verified row), but raw bucket listings show it.
// Known limit: STS grants are not bound to a principal (dji_pilot_media_grants has none), so any paired pilot of this
// workspace can import an object below any valid prefix. Acceptable for one RC per workspace; revisit with several RCs.
const MAX_KMZ=12*1024*1024;
const NAME_MAX=64;                                   // wpml-mission-store validName
const RATE={windowMs:60000,max:30};                  // imports per principal and minute
const SEEN_MS=10*60000;                              // same object+ETag within 10 min: answer from memory

// pilotCode marks errors whose code and message may be returned to Pilot 2 (dji-wayline-http.js).
class ImportError extends Error{constructor(code,message){super(message);this.name='ImportError';this.code=code;this.pilotCode=code;}}

// Non-DJI codes, chosen in DJI's 3xxxxx style so Pilot 2 shows them; message is for the SkyHub log and API clients.
const CODES=Object.freeze({
  invalid:310010,          // callback malformed
  scope:310011,            // object not below a registered STS prefix / expired / not found
  tooLarge:310012,         // over 12 MiB
  rejected:310013,         // not a valid DJI WPML KMZ (or lacks aircraft/payload/template)
  nameTaken:310014,        // a different route with this name exists (DJI requires unique names)
  unavailable:310015,      // storage not reachable
  busy:310016              // too many uploads from this pilot in a minute
});
// DJI wayline names (wpml-mission-store DJI_NAME): no < > : " / | ? * . _ \ ; at most 64 characters.
function cleanName(raw){
  return String(raw).trim().replace(/\.kmz$/i,'').replace(/[<>:"/|?*._\\]+/g,' ').replace(/\s+/g,' ').trim().slice(0,NAME_MAX).trim();
}

async function readCapped(body,limit){
  if(!body)throw new ImportError(CODES.scope,'Uploaded object is empty');
  if(Buffer.isBuffer(body))return body;
  if(typeof body.transformToByteArray==='function'&&!body[Symbol.asyncIterator]){
    const bytes=Buffer.from(await body.transformToByteArray());
    if(bytes.length>limit)throw new ImportError(CODES.tooLarge,'KMZ exceeds 12 MiB');
    return bytes;
  }
  const chunks=[];let size=0;
  for await(const chunk of body){
    size+=chunk.length;
    if(size>limit){if(typeof body.destroy==='function')body.destroy();throw new ImportError(CODES.tooLarge,'KMZ exceeds 12 MiB');}
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function parseCallback(body){
  if(!body||typeof body!=='object'||Array.isArray(body))return null;
  const key=body.object_key;
  if(typeof key!=='string'||!key||key.length>1024||/[\u0000-\u001f\\]/.test(key)||key.startsWith('/')||
    key.split('/').some(p=>p===''||p==='.'||p==='..'))return null;
  let name=null;
  if(body.name!==undefined&&body.name!==null&&body.name!==''){
    if(typeof body.name!=='string'||/[\u0000-\u001f]/.test(body.name))return null;
    name=cleanName(body.name)||null;
  }
  return {objectKey:key,name};
}

// importUpload(principal, body) → {id, name, created}. Throws ImportError with a code for Pilot 2.
function createPilotWaylineImport({workspace,media,headObject,getObject,store,audit=()=>{},log=console.log}){
  if(!media||typeof media.verifyGrantedObject!=='function'||typeof headObject!=='function'||typeof getObject!=='function'||
    !store||typeof store.put!=='function')throw new TypeError('Pilot wayline import needs media grants, S3 read and the WPML store');
  const recent=new Map(),seen=new Map();
  function allow(who,now){
    const list=(recent.get(who)||[]).filter(t=>now-t<RATE.windowMs);
    if(list.length>=RATE.max){recent.set(who,list);return false;}
    list.push(now);recent.set(who,list);
    if(recent.size>200)for(const [k,v] of recent)if(!v.some(t=>now-t<RATE.windowMs))recent.delete(k);
    return true;
  }
  return async function importUpload(principal,body){
    const now=Date.now(),who=String(principal?.userId||principal?.deviceId||'pilot');
    if(!allow(who,now))throw new ImportError(CODES.busy,'Too many uploads, try again in a minute');
    const item=parseCallback(body);
    if(!item)throw new ImportError(CODES.invalid,'Invalid upload callback');
    let granted;
    try{granted=await media.verifyGrantedObject({workspace,key:item.objectKey,headObject});}
    catch(err){log('[pilot wayline] import: grant check failed ('+(err&&err.name||'error')+')');throw new ImportError(CODES.unavailable,'Storage unavailable');}
    if(granted.status!=='verified'){
      audit({action:'wayline-import-refused',reason:granted.status,principal:principal?.userId||null});
      throw new ImportError(CODES.scope,'Upload not in a valid SkyHub upload scope ('+granted.status+')');
    }
    if(granted.evidence.size>MAX_KMZ)throw new ImportError(CODES.tooLarge,'KMZ exceeds 12 MiB');
    const seenKey=item.objectKey+'|'+granted.evidence.etag+'|'+(item.name||'');
    const hit=seen.get(seenKey);
    if(hit&&now-hit.at<SEEN_MS)return {...hit.result,created:false};
    let bytes;
    // The read is bound to the HEAD evidence (If-Match ETag): a later overwrite of the key is not imported.
    try{bytes=await readCapped((await getObject(granted.bucket,item.objectKey,{ifMatch:granted.evidence.etag})).body,
      Math.min(MAX_KMZ,granted.evidence.size));}
    catch(err){
      if(err instanceof ImportError)throw err;
      if(err&&(err.status===404||err.status===412))throw new ImportError(CODES.scope,'Uploaded object missing or changed since the check');
      log('[pilot wayline] import: read failed ('+(err&&err.name||'error')+')');throw new ImportError(CODES.unavailable,'Storage unavailable');}
    if(bytes.length!==granted.evidence.size)throw new ImportError(CODES.scope,'Uploaded object changed since the check');
    // No ':' etc. (DJI name rule); minutes as HHhMM.
    const name=item.name||('Pilot 2 '+new Date(now).toISOString().slice(0,16).replace('T',' ').replace(':','h'));
    let stored;
    try{stored=await store.put(bytes,{name,username:'Pilot 2'});}
    catch(err){
      const status=err&&err.status;
      audit({action:'wayline-import-rejected',status:status||500,name,principal:principal?.userId||null});
      if(status===409)throw new ImportError(CODES.nameTaken,'A different route named "'+name+'" already exists in SkyHub');
      if(status===400&&/name/i.test(String(err.message)))throw new ImportError(CODES.invalid,'Route name not accepted: '+String(err.message).slice(0,120));
      if(status===400||status===413||status===422)throw new ImportError(CODES.rejected,'Not an accepted DJI WPML route: '+String(err.message||'').slice(0,120));
      log('[pilot wayline] import: store failed ('+(err&&err.name||'error')+')');
      throw new ImportError(CODES.unavailable,'Storage unavailable');
    }
    audit({action:'wayline-import',id:stored.id,name:stored.name||name,created:stored.created!==false,principal:principal?.userId||null});
    const result={id:stored.id,name:stored.name||name,created:stored.created!==false};
    seen.set(seenKey,{at:now,result});
    if(seen.size>500)for(const [k,v] of seen)if(now-v.at>=SEEN_MS)seen.delete(k);
    return result;
  };
}

module.exports={createPilotWaylineImport,ImportError,CODES,MAX_KMZ,parseCallback,cleanName};
