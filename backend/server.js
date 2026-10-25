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
const {createTrackPolicy}=require('./track-policy');
const {createTrackStore,retentionDays}=require('./track-store');
const {createTrackRecorder}=require('./track-recorder');
const {createS3Storage}=require('./s3-storage');
const {createMediaRouter}=require('./media-api');
const {createMinioDrRouter}=require('./minio-dr-api');
const {createSmartFarmingCatalogRouter}=require('./smart-farming-catalog');
const {createHttpAuth}=require('./http-auth');
const {registerPilotRoutes,registerPilotAdminRoutes}=require('./pilot-routes');
const {createMqttIngest}=require('./mqtt-ingest');
const {createPilotAuth}=require('./pilot-auth');
const {createTsaHub,createTopologyListHandler}=require('./tsa-hub');

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
let lanAccess,trackRetentionDays;
try {
  lanAccess=createLanAccess(process.env.SKYHUB_LAN_VIEW_CIDR);
  trackRetentionDays=retentionDays(process.env.SKYHUB_TRACK_RETENTION_DAYS);
} catch(err) {
  console.error('[config]',err.message);
  process.exit(1);
}
const app=express(),server=http.createServer(app);
// Do not trust forged X-Forwarded-Proto when SkyHub occupies the legacy LAN port.
// Trust proxy headers only when the backend is published exclusively on loopback.
if(['127.0.0.1','::1'].includes(process.env.SKYHUB_BIND_ADDRESS||'127.0.0.1')){
  app.set('trust proxy',['loopback','linklocal','uniquelocal']);
}
// With the situation-awareness WebSocket enabled this process answers unknown upgrades itself.
const tsaWanted=pilot.tsa.enabled;
if(pilot.tsa.issue)console.error('[tsa] disabled:',pilot.tsa.issue);
if(tsaWanted&&!pilot.ready)console.error('[tsa] disabled: Pilot 2 configuration is incomplete');
const tsaActive=tsaWanted&&pilot.ready;
const io=new Server(server,{maxHttpBufferSize:131072,...(tsaActive?{destroyUpgrade:false}:{})});
const registry=createRegistry();
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
const {auth,socketAuth}=createHttpAuth({secret,lanAccess});
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
    onTopologyChanged:()=>tsaHub&&tsaHub.topologyChanged()});
}catch(err){
  console.error('[topology ack]',err.message);
  process.exit(1);
}
const {state:mqttState,ack}=ingest;
registerPilotRoutes(app,{pilot,pairing,redis,registry,pool,ack,pilotAuth});
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
  lanViewEnabled:lanAccess.enabled,...trackRecorder.snapshot(),
  trackRetentionDays,...mqttStats.snapshot(),
  ...(tsaHub?{tsa:tsaHub.stats()}:{})
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

// MinIO disaster-recovery reports: read-only and disabled by default.
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
if(process.env.SKYHUB_MEDIA_ENABLED==='true'){
  const mediaStorage=createS3Storage(process.env);
  app.use('/api/media',createMediaRouter(mediaStorage));
}

app.get('/api/devices',(req,res)=>res.json(registry.snapshot()));
app.get('/api/topology',(req,res)=>res.json(registry.snapshot().map(d=>({sn:d.sn,role:d.role,gatewaySn:d.gatewaySn,model:d.model,topologyOnline:d.topologyOnline,online:d.online,
  lastTopologyAt:d.lastTopologyAt,topologyTimeVerified:d.topologyTimeVerified,children:d.children}))));
app.get('/api/events',(req,res)=>res.json(registry.events()));
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
app.use(express.static(path.resolve(__dirname,'../frontend/public'),{index:'index.html'}));
app.use((req,res)=>res.status(404).json({error:'Not found'}));
const port=Number(process.env.PORT||4000);
const listenAddress=process.env.NODE_ENV==='test'?'127.0.0.1':'0.0.0.0';
server.listen(port,listenAddress,()=>console.log('[skyhub] Port '+server.address().port+' / read-only'));
function stop(){
  ingest.stop();
  if(tsaHub)tsaHub.close();
  io.close();server.close();
  redis.disconnect();if(pool)pool.end().catch(()=>{});
}
process.once('SIGTERM',stop);
process.once('SIGINT',stop);
module.exports={server,stop};
