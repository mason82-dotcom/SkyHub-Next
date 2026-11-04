'use strict';
const express=require('express');
const http=require('http');
const path=require('path');
const Redis=require('ioredis');
const {Pool}=require('pg');
const {Server}=require('socket.io');
const {serial}=require('./dji');
const {fieldDefinitions}=require('./dji-properties');
const {validateBrokerConfig}=require('./mqtt-config');
const {createMqttMetrics}=require('./mqtt-metrics');
const {createShapeCatalog,createModelShapeCatalog}=require('./mqtt-shape');
const {createRegistry}=require('./registry');
const {pilotConfiguration}=require('./pilot-config');
const {createPilotPairing,redisStore}=require('./pilot-pairing');
const {createTopologyStore}=require('./topology-store');
const {createLanAccess}=require('./lan-access');
const {parseTrustedProxyIps,isTrustedProxyIp}=require('./proxy-trust');
const {createTrackPolicy}=require('./track-policy');
const {createTrackStore,retentionDays}=require('./track-store');
const {createTrackRecorder}=require('./track-recorder');
const {createS3Storage}=require('./s3-storage');
const {createMediaRouter}=require('./media-api');
const {createThermalRouter}=require('./thermal');
const {createThermalSdkClient}=require('./thermal-sdk');
const {createSmartFarmingCaptures}=require('./smart-farming-captures');
const {createPilotMediaLibraryRuntime}=require('./pilot-media-library-runtime');
const {createPilotMediaUploadRuntime}=require('./pilot-media-upload-runtime');
const {createMinioDrRouter}=require('./minio-dr-api');
const {createWpmlMissionStore,createWpmlMissionRouter}=require('./wpml-mission-store');
const {releaseConfig,createReleaseStore,pilotLibrary,createMissionReleaseRouter}=require('./mission-release');
const {drcConfig,createDrcRuntime}=require('./drc-runtime');
const {liveControlConfig,createLiveControl}=require('./live-control');
const {createDjiWaylineRouter,createRedisFavorites,UPLOAD_DISABLED_CODE}=require('./dji-wayline-http');
let pilotWaylineImport=null;
const {createPilotWaylineImport,ImportError}=require('./pilot-wayline-import');
const {terrainConfig,createTerrainClient,createTerrainRouter}=require('./mission-terrain');
const {ppkConfig,createPpkRouter}=require('./ppk');
const {createPpkStorage}=require('./ppk-storage');
const {createSmartFarmingCatalogRouter}=require('./smart-farming-catalog');
const {createHttpAuth}=require('./http-auth');
const {mapPageReferrerPolicy}=require('./map-page-referrer');
const {registerPilotRoutes,registerPilotAdminRoutes}=require('./pilot-routes');
const {createMqttIngest}=require('./mqtt-ingest');
const {createHmsHistory,createHmsHistoryHandler}=require('./hms-history');
const {createPilotAuth}=require('./pilot-auth');
const {createTsaHub,createTopologyListHandler}=require('./tsa-hub');
const {createTileCache,createTileRedirect,tileCacheSettings}=require('./tile-cache');
const {createFhObserver}=require('./fh-observer');
const {createFhMsdkObserve}=require('./fh-msdk-observe');
const {createFhUgcsReader}=require('./fh-ugcs-reader');
const {fhMetrics}=require('./fh-metrics');
const {liveStreamSettings,pilotLiveConfig,createLiveStreamRouter}=require('./live-stream');

const secret=process.env.SKYHUB_VIEW_TOKEN;
if(!secret || secret.length<24 || secret.startsWith('REPLACE_')){
  console.error('SKYHUB_VIEW_TOKEN (minimum 24 characters) is mandatory');
  process.exit(1);
}
let broker;
try {
  broker=validateBrokerConfig(process.env.MQTT_BROKER_URL,process.env.SKYHUB_MQTT_REQUIRED_PORT,process.env.SKYHUB_MQTT_BROKER_KIND);
} catch(err) {
  console.error('[mqtt config]',err.message);
  process.exit(1);
}
const pilot=pilotConfiguration(process.env);
// Pilot 2 livestream relay (opt-in): RTMP from the RC to MediaMTX, HLS to the dashboard.
const liveSettings=liveStreamSettings(process.env);
if(liveSettings.issue)console.error('[live] disabled:',liveSettings.issue);
const liveStream=createLiveStreamRouter({settings:liveSettings});
// Livestream on demand (live_start_push etc. over MQTT, DJI Cloud API 1.18); opt-in, needs the relay above.
const liveControlSettings=liveControlConfig(process.env,liveSettings);
if(liveControlSettings.issue)console.error('[live control] disabled:',liveControlSettings.issue);
// The authenticated Pilot bootstrap additionally carries the RTMP target when the relay is enabled.
const pilotWithLive=Object.assign(Object.create(null),pilot,{bootstrap(){
  const live=pilotLiveConfig(liveSettings,{onDemand:liveControlSettings.enabled});
  return {...pilot.bootstrap(),...(live?{live}:{})};
}});
let lanAccess,trackRetentionDays,trustedProxyIps,tileSettings;
try {
  trustedProxyIps=parseTrustedProxyIps(process.env.SKYHUB_TRUSTED_PROXY_IPS||'');
  lanAccess=createLanAccess(process.env.SKYHUB_LAN_VIEW_CIDR,trustedProxyIps);
  trackRetentionDays=retentionDays(process.env.SKYHUB_TRACK_RETENTION_DAYS);
  tileSettings=tileCacheSettings(process.env);
} catch(err) {
  console.error('[config]',err.message);
  process.exit(1);
}
const app=express(),server=http.createServer(app);
// Do not trust forged X-Forwarded-Proto when SkyHub occupies the legacy LAN port.
// Even with loopback-only host publication, sibling Docker containers can
// reach the internal container port. Trust X-Forwarded-Proto only from the
// explicitly named Caddy peer, never all private networks or Docker peers.
if(['127.0.0.1','::1'].includes(process.env.SKYHUB_BIND_ADDRESS||'127.0.0.1')){
  app.set('trust proxy',ip=>isTrustedProxyIp(ip,trustedProxyIps));
}
// With the situation-awareness WebSocket enabled this process answers unknown upgrades itself.
const tsaWanted=pilot.tsa.enabled;
if(pilot.tsa.issue)console.error('[tsa] disabled:',pilot.tsa.issue);
if(tsaWanted&&!pilot.ready)console.error('[tsa] disabled: Pilot 2 configuration is incomplete');
const tsaActive=tsaWanted&&pilot.ready;
const io=new Server(server,{maxHttpBufferSize:131072,...(tsaActive?{destroyUpgrade:false}:{})});
const registry=createRegistry();
const fhObserver=createFhObserver(); // Passive FC0 analysis of accepted DJI OSD/state.
let fhUgcs;
try{fhUgcs=createFhUgcsReader({baseUrl:process.env.SKYHUB_FH_UGCS_URL||''});}
catch(_err){console.error('[fh ugcs] invalid configuration; disabled');fhUgcs=createFhUgcsReader();}
const tiles=tileSettings.enabled?createTileCache(tileSettings):createTileRedirect();
if(tileSettings.enabled)console.log('[tiles] offline OSM tile cache active, limit '+Math.round(tileSettings.maxBytes/1048576)+' MB');
const mqttStats=createMqttMetrics();
const mqttShapes=createShapeCatalog();
const mqttModelShapes=createModelShapeCatalog();
app.disable('x-powered-by');
app.use(express.json({limit:'128kb'}));
app.use((req,res,next)=>{
  res.set('X-Content-Type-Options','nosniff');
  res.set('Referrer-Policy','no-referrer');
  res.set('Cache-Control','no-store');
  next();
});
// Scope the OSM Referer exception to the two browser map documents only.
// API, Pilot 2 and other routes retain the global no-referrer policy.
app.use(mapPageReferrerPolicy);
const {auth,socketAuth,lanSocket}=createHttpAuth({secret,lanAccess,wpmlLanAuth:{
  enabled:process.env.SKYHUB_WPML_LAN_NO_TOKEN_ENABLED==='true',
  origins:process.env.SKYHUB_WPML_LAN_ORIGINS||''
}});
io.use(socketAuth);
io.on('connection',socket=>socket.emit('snapshot',registry.snapshot()));

const redis=new Redis(process.env.REDIS_URL||'redis://redis:6379',{
  lazyConnect:true,maxRetriesPerRequest:1,
  retryStrategy:attempts=>Math.min(attempts*1000,5000)
});
redis.on('error',err=>console.error('[redis]',err.message));
const topologyStore=createTopologyStore(redis);
let topologyRestored=0;
redis.connect()
  .then(()=>topologyStore.load())
  .then(records=>{
    topologyRestored=registry.restoreTopology(records);
    // Count only; never log serial numbers.
    if(topologyRestored)console.log('[topology] restored '+topologyRestored+' devices from Redis');
  })
  .catch(err=>console.error('[redis connect]',err.message));
const pairing=createPilotPairing({store:redisStore(redis),workspaceId:pilot.workspaceId});
const pool=process.env.DATABASE_URL?
  new Pool({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:3000}):null;
if(pool)pool.on('error',err=>console.error('[postgres]',err.message));
const trackPolicy=createTrackPolicy();
const trackStore=createTrackStore(pool);
const hmsHistory=(pool&&process.env.SKYHUB_HMS_HISTORY_ENABLED==='true')?createHmsHistory(pool):null;
// Historical GPS recording is opt-in; live DJI telemetry remains available.
const trackRecordingEnabled=process.env.SKYHUB_TRACK_RECORDING_ENABLED==='true';
const trackRecorder=createTrackRecorder({store:trackStore,policy:trackPolicy,enabled:Boolean(pool),
  recordingEnabled:trackRecordingEnabled,
  onWriteError:()=>console.error('[postgres insert] failed')});
async function pruneTracks(){
  try{
    const removed=await trackRecorder.prune(trackRetentionDays);
    if(removed)console.log('[track] removed '+removed+' points older than '+trackRetentionDays+' days');
  }catch(err){console.error('[track prune]',err.message);}
}
async function initializeTracks(){
  if(!pool || trackRecorder.snapshot().postgresMigrationReady)return;
  try{await trackRecorder.migrate();await pruneTracks();}
  catch(_err){console.error('[track migrate] failed; will retry');}
}
initializeTracks();
setInterval(initializeTracks,60000).unref();
setInterval(pruneTracks,3600000).unref();

const pilotAuth=createPilotAuth({pilot,pairing,redis});
// DJI Pilot 2 situation awareness: fleet positions and presence pushed to paired RCs (read-only).
const tsaHub=tsaActive?createTsaHub({registry,authorize:pilotAuth.principal,
  workspaceId:pilot.workspaceId,trustedProxyIps:pilot.tsa.trustedProxyIps}):null;

let ingest;
try{
  ingest=createMqttIngest({broker,env:process.env,registry,io,redis,topologyStore,trackRecorder,
    trackRecordingEnabled,pool,mqttStats,mqttShapes,mqttModelShapes,
    onHmsSnapshot:hmsHistory?((sn,alerts,at,verified)=>hmsHistory.observe(sn,alerts,at,verified)):null,
    onTopologyChanged:()=>tsaHub&&tsaHub.topologyChanged(),
     onObserved:(parsed,device,at)=>fhObserver.observe(parsed,device,at)});
}catch(err){
  console.error('[topology ack]',err.message);
  process.exit(1);
}
const {state:mqttState,ack}=ingest;
registerPilotRoutes(app,{pilot:pilotWithLive,pairing,redis,registry,pool,ack,pilotAuth});
if(tsaHub){
  app.get('/manage/api/v1/workspaces/:workspaceId/devices/topologies',createTopologyListHandler({
    registry,workspaceId:pilot.workspaceId,authorize:pilotAuth.principal,
    trustedProxyIps:pilot.tsa.trustedProxyIps
  }));
  server.on('upgrade',(req,socket,head)=>{
    if(tsaHub.matches(req))return tsaHub.handleUpgrade(req,socket,head);
    // Socket.IO keeps its own path; every other upgrade is refused (engine.io no longer does it).
    if(!String(req.url||'').startsWith('/socket.io/'))socket.destroy();
  });
}

app.get('/api/health',(req,res)=>res.json({
  status:mqttState.connected&&mqttState.subscribed?'online':'degraded',mqtt:mqttState.connected,
  subscribed:mqttState.subscribed,redis:redis.status==='ready',devices:registry.count(),readOnly:true,
  mqttBrokerPort:broker.port,topologyReplyEnabled:ack.enabled,
  topologyReplyConnected:ack.connected,topologyReplySent:ack.sent,
  topologyReplyErrors:ack.failed,topologyReplySkipped:ack.skipped,
  topologyReplyLastAt:ack.lastAt,topologyRestoredDevices:topologyRestored,
  lanViewEnabled:lanAccess.enabled,hmsHistoryEnabled:Boolean(hmsHistory),...trackRecorder.snapshot(),
  trackRetentionDays,...mqttStats.snapshot(),...ingest.cacheStats(),
  tileCache:tiles.stats(),liveStream:liveStream.stats(),
  ...(tsaHub?{tsa:tsaHub.stats()}:{}),
  ...(mediaUpload?{pilotMediaUpload:mediaUpload.stats()}:{})
}));
// Separate opt-in MSDK observation credential, NEVER a control channel.
// Registered before the view-token middleware; its own HTTPS/token guard is mandatory.
app.post('/api/adapters/msdk/observe',createFhMsdkObserve({
 observer:fhObserver,registry,
 enabled:process.env.SKYHUB_FH_MSDK_OBSERVER_ENABLED==='true',
 token:process.env.SKYHUB_FH_MSDK_OBSERVER_TOKEN||''
}));
app.use('/api',auth);

// Disabled by default; authenticated bounded M3M candidate metadata only.
// No public LAN exception, no pixel delivery, no GIS tiles and no DJI actions.
if(process.env.SKYHUB_M3M_CATALOG_ENABLED==='true'){
  app.use('/api/smart-farming/candidates',createSmartFarmingCatalogRouter({
    express,auth,root:process.env.SKYHUB_M3M_CATALOG_ROOT,
    manifestSha256:process.env.SKYHUB_M3M_CATALOG_SHA256
  }));
}

// MinIO disaster-recovery reports: read-only, behind auth. Off unless explicitly enabled here;
// the root Compose file enables it by default (reports are optional: status stays 'unavailable' without them).
if(process.env.SKYHUB_MINIO_DR_ENABLED==='true'){
  const drDirectory=process.env.SKYHUB_MINIO_DR_REPORT_DIR;
  if(!drDirectory || !path.isAbsolute(drDirectory)){
    throw new Error('Absolute MinIO DR report directory required');
  }
  const compositeEnabled =
    process.env.SKYHUB_MINIO_DR_COMPOSITE_ENABLED === 'true';
  app.use('/api/dr/minio',createMinioDrRouter({
    directory:drDirectory,
    ...(compositeEnabled
      ? {compositeRoot:path.dirname(drDirectory)}
      : {})
  }));
}
const mediaStorage=process.env.SKYHUB_MEDIA_ENABLED==='true'?
  createS3Storage(process.env):null;
// Pilot 2 uploads are stored as org_<fingerprint>_<ms>.jpg; show the DJI file name from PostgreSQL.
async function pilotMediaLabels(){
  const {rows}=await pool.query('SELECT object_key,file_name,pilot_metadata->>\'created_time\' AS created '+
    'FROM dji_pilot_media_verified');
  return new Map(rows.map(r=>[r.object_key,{fileName:r.file_name,capturedAt:r.created||null}]));
}
if(mediaStorage){
  const mediaRouter=createMediaRouter(mediaStorage,{labels:pool?pilotMediaLabels:null});
  app.use('/api/media',mediaRouter);
  // Thermal module: radiometric R-JPEGs from the same storage, read-only.
  // Optional DJI Thermal SDK: isolated thermal-sdk service (compose profile), internal network only.
  let thermalSdk=null;
  if(process.env.SKYHUB_THERMAL_SDK_URL){
    try{
      thermalSdk=createThermalSdkClient({url:process.env.SKYHUB_THERMAL_SDK_URL,
        token:process.env.SKYHUB_THERMAL_SDK_TOKEN});
      console.log('[thermal sdk] DJI Thermal SDK service configured');
    }catch(err){console.error('[thermal sdk] disabled:',err.message);}
  }
  app.use('/api/thermal',createThermalRouter({storage:mediaStorage,
    bucketIndex:mediaRouter.bucketIndex,buckets:()=>mediaStorage.buckets(),sdk:thermalSdk}));
  // Smart Farming: Mavic 3M multispectral captures grouped by CaptureUUID (read-only).
  app.use('/api/smart-farming/captures',createSmartFarmingCaptures({storage:mediaStorage,
    bucketIndex:mediaRouter.bucketIndex}).router);
}
// WPML mission library (opt-in; token or explicitly scoped HTTPS home-LAN access).
// Validated file storage only: no DJI flight task, no Pilot 2 or MQTT dispatch.
let wpmlStore=null;
if(process.env.SKYHUB_WPML_STORE_ENABLED==='true'){
  try{
    wpmlStore=createWpmlMissionStore({env:process.env});
    app.use('/api/wpml/missions',createWpmlMissionRouter({express,store:wpmlStore}));
    console.log('[wpml store] active, bucket '+wpmlStore.bucket);
  }catch(err){console.error('[wpml store] disabled:',err.message);}
}
// Mission release (docs/entwurf-missionsfreigabe-ndvi-tak-2026-11-04.md): checked, explicitly released revisions only.
// DJI Cloud API 1.18: flight tasks (flighttask_*) are dock-only, routes reach the aircraft through the Pilot 2 library.
// (Pilot live flight controls / DRC exist for RC Plus 2 + Matrice 4 and payload-only for M3E/M3T/M3M; not used by SkyHub.)
const missionRelease=releaseConfig(process.env);
let releaseStore=null;
if(missionRelease.issue)console.error('[mission release] disabled:',missionRelease.issue);
if(wpmlStore&&missionRelease.enabled){
  if(!pool)console.error('[mission release] disabled: needs PostgreSQL (DATABASE_URL)');
  else{
    releaseStore=createReleaseStore(pool);
    releaseStore.init().catch(err=>console.error('[mission release] schema:',err.message));
    // Optional terrain check (SKYHUB_TERRAIN_URL, Open Topo Data); off by default.
    const terrainSettings=terrainConfig(process.env);
    if(terrainSettings.issue)console.error('[terrain] disabled:',terrainSettings.issue);
    const terrain=terrainSettings.enabled?createTerrainClient(terrainSettings):null;
    if(terrain)console.log('[terrain] height above ground check active ('+terrainSettings.dataset+(terrainSettings.public?', PUBLIC service: route coordinates leave the network':'')+')');
    app.use('/api/wpml/release',createMissionReleaseRouter({express,store:wpmlStore,releases:releaseStore,config:missionRelease,terrain}));
    if(terrain)app.use('/api/terrain',createTerrainRouter({express,terrain}));
    console.log('[mission release] active ('+missionRelease.hours+' h validity)');
  }
}
// DJI Pilot 2 wayline library (DJI Cloud API wayline/api/v1): list + presigned download only.
// Separate opt-in; never creates a flight task (no flighttask_prepare / MQTT services).
// Fail-closed since 04.11.2026 (risk M1): Pilot 2 sees ONLY released revisions; without mission release it sees none.
if(pilot.wayline.issue)console.error('[pilot wayline] disabled:',pilot.wayline.issue);
if(pilot.wayline.enabled&&!wpmlStore)console.error('[pilot wayline] disabled: WPML store is not active');
if(wpmlStore&&pilot.wayline.enabled){
  if(!pilot.ready)console.error('[pilot wayline] disabled: Pilot 2 configuration is incomplete');
  else{
    const pilotRoutes=pilotLibrary(wpmlStore,releaseStore);
    if(!releaseStore)console.error('[pilot wayline] mission release not active: the Pilot 2 library stays empty (set SKYHUB_MISSION_RELEASE_*)');
    // Uploads from Pilot 2 (decision 04.11.2026): accepted into the WPML store when the media upload grants exist,
    // never released automatically. The import uses the full store; Pilot 2 still sees released routes only.
    // Same STS grants as the media upload (dji_pilot_media_grants): the importer is attached once the media upload
    // runtime exists (below); until then, or without it, uploads are refused.
    const importUpload=(principal,body)=>{
      if(!pilotWaylineImport)throw new ImportError(UPLOAD_DISABLED_CODE,'Wayline upload from Pilot 2 needs the Pilot media upload');
      return pilotWaylineImport(principal,body);
    };
    app.use(createDjiWaylineRouter({workspace:pilot.workspaceId,authorize:pilotAuth.principal,
      store:pilotRoutes,favorites:createRedisFavorites(redis),importUpload}));
    console.log('[pilot wayline] library active for Pilot 2 (released routes only)');
  }
}
// PPK geotagging (dji-geotagger) through the internal ppk service; opt-in (SKYHUB_PPK_URL + SKYHUB_PPK_TOKEN).
const ppk=ppkConfig(process.env);
if(ppk.issue)console.error('[ppk] disabled:',ppk.issue);
if(ppk.enabled){app.use('/api/ppk',createPpkRouter(ppk,{flights:mediaStorage?createPpkStorage({storage:mediaStorage}):null}));console.log('[ppk] PPK geotagging service active');}
// Live flight control (DRC) for one pinned DJI RC Plus 2 + Matrice 4E/4T (DJI Cloud API 1.18 pilot live flight controls).
// Off by default; separate token; operator lease with fail-safe hand-back to the RC (drc-session.js).
const drc=drcConfig(process.env);
let drcRuntime=null;
if(drc.issue)console.error('[drc] disabled:',drc.issue);
if(drc.enabled){
  drcRuntime=createDrcRuntime({config:drc,registry,pool,io,express,mqttConnect:require('mqtt').connect,socketAuth,
    lanSocket:request=>lanSocket(request,ip=>app.get('trust proxy fn')(ip,0))});
  app.use('/api/drc',drcRuntime.router);
  console.log('[drc] live flight control active for RC '+drc.gateway);
}
let liveControl=null;
if(liveControlSettings.enabled){
  liveControl=createLiveControl({config:liveControlSettings,liveSettings,registry,mqttConnect:require('mqtt').connect,express,
    audit:e=>{console.log('[live control] '+JSON.stringify(e));
      if(pool)pool.query('INSERT INTO drc_audit(gateway,action,detail) VALUES ($1,$2,$3)',[e.gateway,'live',JSON.stringify(e)]).catch(()=>{});}});
  app.use('/api/live/control',liveControl.router);
  console.log('[live control] livestream on demand active');
}
const mediaLibraryRouter=createPilotMediaLibraryRuntime({
  env:process.env,db:pool,redis,authorize:pilotAuth.principal,
  storage:mediaStorage,pilot
});
if(mediaLibraryRouter)app.use(mediaLibraryRouter);
// DJI Pilot 2 media synchronisation (STS + upload callbacks + narrow S3 upload proxy); opt-in.
let mediaUpload=null;
if(pilot.media.issue)console.error('[pilot media] disabled:',pilot.media.issue);
try{
  mediaUpload=pilot.media.enabled?createPilotMediaUploadRuntime({env:process.env,pool,redis,
    authorize:pilotAuth.principal,storage:mediaStorage,pilot,trustedProxyIps}):null;
}catch(err){console.error('[pilot media] disabled:',err.message);}
if(mediaUpload){
  app.use(mediaUpload.router);
  mediaUpload.start();
  console.log('[pilot media] upload sync active, S3 endpoint '+mediaUpload.endpoint);
  if(wpmlStore&&pilot.wayline.enabled&&pilot.ready){
    pilotWaylineImport=createPilotWaylineImport({workspace:pilot.workspaceId,media:mediaUpload.grants,
      headObject:mediaStorage.headObject,getObject:mediaStorage.getObject,store:wpmlStore,
      audit:e=>console.log('[pilot wayline] '+JSON.stringify(e))});
    console.log('[pilot wayline] uploads from Pilot 2 accepted into the route store (visible in Pilot 2 only after release)');
  }
}

app.get('/api/devices',(req,res)=>res.json(registry.snapshot()));
app.get('/api/topology',(req,res)=>res.json(registry.snapshot().map(d=>({sn:d.sn,role:d.role,gatewaySn:d.gatewaySn,model:d.model,topologyOnline:d.topologyOnline,online:d.online,
  lastTopologyAt:d.lastTopologyAt,topologyTimeVerified:d.topologyTimeVerified,children:d.children}))));
app.get('/api/events',(req,res)=>res.json(registry.events()));
// FH2-derived diagnostics remain behind existing /api authorization (no LAN exception).
app.get('/api/diagnostics/fh/rtk',(req,res)=>res.json({readOnly:true,devices:fhObserver.rtk()}));
app.get('/api/diagnostics/fh/flights',(req,res)=>res.json({readOnly:true,active:fhObserver.flights()}));
app.get('/api/diagnostics/fh/events',(req,res)=>res.json({readOnly:true,events:fhObserver.events()}));
app.get('/api/diagnostics/fh/sources/:sn',(req,res)=>{
 const sn=serial(req.params.sn);
 if(!sn)return res.status(400).json({error:'Invalid serial'});
 const result=fhObserver.sources(sn);
 return result?res.json(result):res.status(404).json({error:'No accepted observations'});
});
app.get('/api/diagnostics/fh/metrics',(req,res)=>res.type('text/plain').send(fhMetrics(fhObserver)));
app.get('/api/diagnostics/fh/ugcs/:section',async(req,res)=>{
 const result=await fhUgcs.read(req.params.section);
 res.status(result.status).json(result.data);
});
app.use(liveStream.router);
app.get('/api/diagnostics/hms-history',createHmsHistoryHandler({history:hmsHistory,registry}));
registerPilotAdminRoutes(app,{pairing});
// Field names per channel/method as actually received; no values or serial numbers.
app.get('/api/diagnostics/mqtt-shapes',(req,res)=>res.json(mqttShapes.snapshot()));
// View-token protected: only RC Pro/M3M model keys and documented root names.
// Does not include serials, coordinates, raw DJI telemetry or arbitrary keys.
app.get('/api/diagnostics/mqtt-model-shapes',(req,res)=>res.json(mqttModelShapes.snapshot()));
// Authenticated, value-free property definitions for the six targeted devices.
// Example: /api/diagnostics/dji-fields?model=0:77:2
app.get('/api/diagnostics/dji-fields',(req,res)=>{
  const key=req.query.model;
  if (typeof key!=='string' || !/^[0-3]:\d{1,3}:\d{1,3}$/.test(key))
    return res.status(400).json({error:'Expected domain:type:sub_type'});
  const [domain,type,subType]=key.split(':');
  const schema=fieldDefinitions({domain,type:Number(type),subType:Number(subType)});
  if (!schema) return res.status(404).json({error:'Model not in schema catalogue'});
  return res.json(schema);
});
// Persisted track for the map: newest points within ?minutes (1-1440, default 60).
app.get('/api/drone/:sn/track',async(req,res)=>{
  const sn=serial(req.params.sn);
  if(!sn)return res.status(400).json({error:'Invalid serial'});
  try{res.json(await trackStore.track(sn,req.query.minutes));}
  catch(_err){res.status(503).json({error:'Track history unavailable'});}
});
app.get('/api/drone/:sn/telemetry',(req,res)=>{
  const d=registry.get(req.params.sn);
  if(!d)return res.status(404).json({error:'Device not observed'});
  res.json(d);
});
// Map tiles: on-demand offline cache (opt-in) or redirect to OpenStreetMap; no token, no API data.
app.use(tiles.router);
// Self-hosted third-party libraries (no CDN at runtime, works offline in the field).
// Paths carry the exact version, so the files can be cached as immutable.
app.use('/vendor',express.static(path.resolve(__dirname,'../frontend/public/vendor'),
  {index:false,fallthrough:false,cacheControl:false,
    setHeaders:res=>res.set('Cache-Control','public, max-age=31536000, immutable')}));
app.use(express.static(path.resolve(__dirname,'../frontend/public'),{index:'index.html'}));
app.use((req,res)=>res.status(404).json({error:'Not found'}));
// Body-parser and router errors answer in JSON; never an HTML page, stack trace or parser detail.
app.use((err,req,res,next)=>{
  if(res.headersSent)return next(err);
  const status=Number.isInteger(err?.status)&&err.status>=400&&err.status<500?err.status:500;
  if(status===500)console.error('[http] unhandled route error');
  res.status(status).json({error:{400:'Invalid request body',404:'Not found',413:'Request body too large',
    415:'Unsupported content encoding'}[status]||(status===500?'Internal error':'Invalid request')});
});
const port=Number(process.env.PORT||4000);
const listenAddress=process.env.NODE_ENV==='test'?'127.0.0.1':'0.0.0.0';
server.listen(port,listenAddress,()=>console.log('[skyhub] Port '+server.address().port+' / read-only'));
function stop(){
  // Hand control back to the RC before anything else goes down (drc_mode_exit + cloud_control_release).
  if(drcRuntime)drcRuntime.shutdown().catch(err=>console.error('[drc] shutdown:',err.message));
  if(liveControl)liveControl.shutdown();
  ingest.stop();
  if(tsaHub)tsaHub.close();
  if(mediaUpload)mediaUpload.stop();
  io.close();server.close();
  redis.disconnect();if(pool)pool.end().catch(()=>{});
}
// Signals: close cleanly, but never outlive Docker's stop timeout because of idle keep-alive sockets.
function shutdown(){
  stop();
  if(typeof server.closeIdleConnections==='function')server.closeIdleConnections();
  setTimeout(()=>process.exit(0),5000).unref();
}
process.once('SIGTERM',shutdown);
process.once('SIGINT',shutdown);
module.exports={server,stop};
