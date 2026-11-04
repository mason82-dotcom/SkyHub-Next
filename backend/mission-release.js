'use strict';
// Mission release for DJI Pilot 2 (risk register M1/M2/M4/M5/M6, design docs/entwurf-missionsfreigabe-ndvi-tak-2026-11-04.md).
// DJI Cloud API 1.18: flight tasks (flighttask_*) are dock-only, so a route reaches the aircraft only through the Pilot 2
// wayline library, and the pilot starts it on the RC. SkyHub never starts, stops or steers a flight. (1.18 does offer
// Pilot live flight controls (DRC, fly-to, one-key takeoff/return) for RC Plus 2 + Matrice 4; SkyHub does not implement them.)
//
// A stored WPML revision becomes visible to Pilot 2 only through an explicit release:
//   - check passes (mission-envelope.js), every warning acknowledged, checklist confirmed
//   - separate release token (X-SkyHub-Release-Token), independent of the view token and of LAN access
//   - bound to the SHA-256 of the stored KMZ, expires (default 72 h), one active release per route family (root)
// The Pilot 2 library lists and serves only actively released revisions; without the database it shows nothing.
const crypto=require('node:crypto');
const {checkMission,limitsFromEnv,DEFAULT_LIMITS}=require('./mission-envelope');
const {waylineId}=require('./wpml-mission-store');

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CHECKLIST=Object.freeze({
  airspace:'Luftraum und Geo-Zonen für Ort und Zeit geprüft (z. B. dipul)',
  visualLineOfSight:'Flug in Sichtweite mit einsatzbereitem Piloten an der Fernsteuerung',
  aircraft:'Zielgerät und Nutzlast der Route stimmen mit dem Einsatzgerät überein',
  preview:'Route wird in DJI Pilot 2 vor dem Start auf der Karte geprüft'
});
const DEFAULT_HOURS=72,MAX_HOURS=168;

const SCHEMA=`
CREATE TABLE IF NOT EXISTS wpml_mission_release(
  id bigserial PRIMARY KEY,
  wayline_id uuid NOT NULL,
  root_id uuid NOT NULL,
  sha256 char(64) NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  name text NOT NULL,
  drone_model_key text NOT NULL,
  payload_model_keys text[] NOT NULL,
  envelope jsonb NOT NULL,
  acknowledged jsonb NOT NULL,
  released_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  released_from text,
  revoked_at timestamptz,
  revoked_from text,
  revoke_reason text,
  CHECK (expires_at > released_at)
);
CREATE UNIQUE INDEX IF NOT EXISTS wpml_mission_release_one_active ON wpml_mission_release(root_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS wpml_mission_release_wayline ON wpml_mission_release(wayline_id);`;

function releaseConfig(env=process.env){
  const token=env.SKYHUB_MISSION_RELEASE_TOKEN||'';
  if(env.SKYHUB_MISSION_RELEASE_ENABLED!=='true')return {enabled:false,issue:null};
  if(token.length<32)return {enabled:false,issue:'SKYHUB_MISSION_RELEASE_TOKEN must have at least 32 characters'};
  if(env.SKYHUB_VIEW_TOKEN&&token===env.SKYHUB_VIEW_TOKEN)return {enabled:false,issue:'release token must differ from SKYHUB_VIEW_TOKEN'};
  let limits;
  try{limits=limitsFromEnv(env);}catch(err){return {enabled:false,issue:err.message};}
  const hours=env.SKYHUB_MISSION_RELEASE_HOURS?Number(env.SKYHUB_MISSION_RELEASE_HOURS):DEFAULT_HOURS;
  if(!Number.isFinite(hours)||hours<1||hours>MAX_HOURS)return {enabled:false,issue:'SKYHUB_MISSION_RELEASE_HOURS must be 1..'+MAX_HOURS};
  return {enabled:true,issue:null,token,limits,hours};
}

function tokenMatches(presented,secret){
  if(typeof presented!=='string'||!presented)return false;
  const a=crypto.createHash('sha256').update(presented).digest(),b=crypto.createHash('sha256').update(secret).digest();
  return crypto.timingSafeEqual(a,b);
}

function createReleaseStore(pool,{now=()=>new Date()}={}){
  if(!pool||typeof pool.query!=='function')throw new Error('mission release needs PostgreSQL (DATABASE_URL)');
  let ready=null;
  const init=()=>ready||(ready=pool.query(SCHEMA).catch(err=>{ready=null;throw err;}));
  const row=r=>({id:Number(r.id),waylineId:r.wayline_id,rootId:r.root_id,sha256:r.sha256.trim(),name:r.name,
    droneModelKey:r.drone_model_key,payloadModelKeys:r.payload_model_keys,envelope:r.envelope,acknowledged:r.acknowledged,
    releasedAt:new Date(r.released_at).getTime(),expiresAt:new Date(r.expires_at).getTime(),releasedFrom:r.released_from,
    revokedAt:r.revoked_at?new Date(r.revoked_at).getTime():null,revokedFrom:r.revoked_from,revokeReason:r.revoke_reason});
  async function active(){
    await init();
    const {rows}=await pool.query('SELECT * FROM wpml_mission_release WHERE revoked_at IS NULL AND expires_at > $1',[now()]);
    return rows.map(row);
  }
  async function history(waylineIds){
    await init();
    const {rows}=await pool.query('SELECT * FROM wpml_mission_release WHERE wayline_id = ANY($1::uuid[]) ORDER BY released_at DESC LIMIT 200',[waylineIds]);
    return rows.map(row);
  }
  // One transaction: revoke the family's active release (superseded), insert the new one.
  async function release(entry){
    await init();
    const client=typeof pool.connect==='function'?await pool.connect():pool;
    try{
      await client.query('BEGIN');
      await client.query(`UPDATE wpml_mission_release SET revoked_at=$2, revoked_from=$3, revoke_reason='ersetzt durch neue Freigabe'
        WHERE root_id=$1 AND revoked_at IS NULL`,[entry.rootId,now(),entry.from]);
      const {rows}=await client.query(`INSERT INTO wpml_mission_release
        (wayline_id,root_id,sha256,name,drone_model_key,payload_model_keys,envelope,acknowledged,released_at,expires_at,released_from)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [entry.waylineId,entry.rootId,entry.sha256,entry.name,entry.droneModelKey,entry.payloadModelKeys,
          JSON.stringify(entry.envelope),JSON.stringify(entry.acknowledged),entry.releasedAt,entry.expiresAt,entry.from]);
      await client.query('COMMIT');
      return row(rows[0]);
    }catch(err){
      await client.query('ROLLBACK').catch(()=>{});
      throw err;
    }finally{
      if(client!==pool&&typeof client.release==='function')client.release();
    }
  }
  async function revoke(waylineId,{from,reason}){
    await init();
    const {rows}=await pool.query(`UPDATE wpml_mission_release SET revoked_at=$2, revoked_from=$3, revoke_reason=$4
      WHERE wayline_id=$1 AND revoked_at IS NULL RETURNING *`,[waylineId,now(),from,reason]);
    return rows.map(row);
  }
  return {init,active,history,release,revoke};
}

// Pilot 2 view of the WPML store: only actively released revisions whose stored hash still matches the release.
// Any failure of the release database hides everything (fail-closed).
function releasedLibrary(store,releases,{log=m=>console.error(m)}={}){
  async function activeMap(){
    try{
      const map=new Map();
      for(const r of await releases.active())map.set(r.waylineId,r);
      return map;
    }catch(err){
      log('[mission release] database unavailable, Pilot 2 library hidden: '+err.message);
      return new Map();
    }
  }
  return {
    ...store,
    async all(){
      const map=await activeMap();
      // The wayline id is derived from the SHA-256 of the KMZ (write-once, content addressed): a release binds to
      // exactly these bytes. A metadata hash, where present, must agree as well.
      return (await store.all()).filter(w=>{
        const r=map.get(w.id);
        return r&&waylineId(r.sha256)===w.id&&(!w.sha256||w.sha256===r.sha256)&&w.droneModelKey===r.droneModelKey;
      }).map(w=>{
        const r=map.get(w.id);
        return {...w,releasedAt:r.releasedAt,expiresAt:r.expiresAt};
      });
    },
    async downloadUrl(id,opts){
      const map=await activeMap(),r=map.get(id);
      if(!r||waylineId(r.sha256)!==id){
        const err=new Error('Wayline not released');err.status=404;throw err;
      }
      return store.downloadUrl(id,opts);
    }
  };
}

// What DJI Pilot 2 may see. Without an active mission release the library is EMPTY (risk M1, fail-closed):
// before 04.11.2026 every stored route, including unreviewed drafts, was downloadable on the RC.
function pilotLibrary(store,releases,{log}={}){
  if(releases)return releasedLibrary(store,releases,log?{log}:{});
  return {...store,
    async all(){return [];},
    async downloadUrl(){const e=new Error('Mission release not configured');e.status=404;throw e;}};
}

function clientAddress(req){
  const fwd=String(req.headers['x-forwarded-for']||'').split(',').map(s=>s.trim()).filter(Boolean);
  return (fwd[fwd.length-1]||req.socket?.remoteAddress||'?').slice(0,64);
}

function createMissionReleaseRouter({express,store,releases,config,audit=e=>console.log('[mission release] '+JSON.stringify(e)),now=()=>new Date()}){
  const router=express.Router();
  const send=(res,status,body)=>{res.set('Cache-Control','no-store');return res.status(status).json(body);};
  function requireReleaseToken(req,res){
    if(tokenMatches(req.get('X-SkyHub-Release-Token'),config.token))return true;
    audit({ts:now().toISOString(),action:'denied',from:clientAddress(req),path:req.path});
    send(res,403,{error:'Freigabe-Token fehlt oder ist falsch'});
    return false;
  }
  async function load(id){
    if(!UUID.test(id||'')){const e=new Error('Ungültige Routen-ID');e.status=400;throw e;}
    const meta=(await store.all()).find(w=>w.id===id);
    if(!meta){const e=new Error('Route nicht gefunden');e.status=404;throw e;}
    const {bytes}=await store.get(id);    // get() verifies waylineId(sha256(bytes)) === id
    const sha256=crypto.createHash('sha256').update(bytes).digest('hex');
    return {meta,bytes,sha256,check:checkMission(bytes,config.limits)};
  }
  const wrap=fn=>async(req,res)=>{
    try{await fn(req,res);}
    catch(err){send(res,err.status&&err.status<600?err.status:500,{error:err.status?err.message:'Interner Fehler'});
      if(!err.status)console.error('[mission release]',err);}
  };

  router.get('/config',(req,res)=>send(res,200,{checklist:CHECKLIST,limits:{...DEFAULT_LIMITS,...config.limits},
    hours:config.hours,reference:'DJI Cloud API 1.18: Route geht über die Pilot-2-Bibliothek an das Fluggerät; Start nur auf der Fernsteuerung'}));

  // Read-only: check result and release history. Needs normal SkyHub access only.
  router.get('/:id',wrap(async(req,res)=>{
    const {meta,sha256,check}=await load(req.params.id);
    const hist=await releases.history([meta.id]);
    const t=now().getTime();
    send(res,200,{id:meta.id,name:meta.name,sha256,rootId:meta.rootId,generation:meta.generation,check,
      active:hist.find(r=>!r.revokedAt&&r.expiresAt>t)||null,history:hist.slice(0,20)});
  }));

  router.post('/:id/release',wrap(async(req,res)=>{
    if(!requireReleaseToken(req,res))return;
    const body=req.body||{};
    const {meta,sha256,check}=await load(req.params.id);
    if(!check.ok)return send(res,422,{error:'Prüfung nicht bestanden',check});
    // Every warning and every checklist item must be confirmed explicitly, by exact text.
    const acks=Array.isArray(body.acknowledgedWarnings)?body.acknowledgedWarnings:[];
    const missing=check.warnings.filter(w=>!acks.includes(w));
    if(missing.length)return send(res,409,{error:'Nicht bestätigte Warnungen',missing,check});
    const confirmed=body.checklist&&typeof body.checklist==='object'?body.checklist:{};
    const open=Object.keys(CHECKLIST).filter(k=>confirmed[k]!==true);
    if(open.length)return send(res,409,{error:'Checkliste unvollständig',missing:open.map(k=>CHECKLIST[k])});
    if(body.sha256!==sha256)return send(res,409,{error:'Die Route wurde seit der Prüfung geändert, bitte neu prüfen',sha256});
    if(!check.envelope.droneModelKey)return send(res,422,{error:'Route nennt kein Fluggerät'});
    const hours=body.hours===undefined?config.hours:Number(body.hours);
    if(!Number.isFinite(hours)||hours<1||hours>config.hours)return send(res,400,{error:'Gültigkeit 1..'+config.hours+' Stunden'});
    const released=now(),from=clientAddress(req);
    const r=await releases.release({waylineId:meta.id,rootId:meta.rootId||meta.id,sha256,name:meta.name||meta.id,
      droneModelKey:check.envelope.droneModelKey,payloadModelKeys:check.envelope.payloadModelKeys,envelope:check.envelope,
      acknowledged:{warnings:check.warnings,checklist:Object.keys(CHECKLIST)},releasedAt:released,
      expiresAt:new Date(released.getTime()+hours*3600e3),from});
    audit({ts:released.toISOString(),action:'release',wayline:meta.id,sha256,aircraft:check.envelope.aircraft,hours,from});
    send(res,201,{release:r});
  }));

  router.delete('/:id/release',wrap(async(req,res)=>{
    if(!requireReleaseToken(req,res))return;
    if(!UUID.test(req.params.id))return send(res,400,{error:'Ungültige Routen-ID'});
    const reason=typeof req.body?.reason==='string'?req.body.reason.slice(0,200):'zurückgezogen';
    const from=clientAddress(req);
    const revoked=await releases.revoke(req.params.id,{from,reason});
    audit({ts:now().toISOString(),action:'revoke',wayline:req.params.id,count:revoked.length,from});
    send(res,revoked.length?200:404,revoked.length?{revoked}:{error:'Keine aktive Freigabe'});
  }));
  return router;
}

module.exports={releaseConfig,createReleaseStore,releasedLibrary,pilotLibrary,createMissionReleaseRouter,tokenMatches,CHECKLIST,SCHEMA};
