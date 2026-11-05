'use strict';
const path=require('path');
const {serial}=require('./dji');
const {createMapElementStore}=require('./map-element-store');
const {createMapElementHandler}=require('./map-element-api');
const {registerPilotMapWrites}=require('./map-element-write');
const {registerPilotLogUpload}=require('./pilot-log');
const {createPilotAuth}=require('./pilot-auth');
const {createPilotDiagnostics}=require('./pilot-diagnostics');

// Pilot 2 onboarding endpoints. Public part: mounted before the view-token guard.
function registerPilotRoutes(app,{pilot,pairing,redis,registry,pool,ack,pilotAuth=createPilotAuth({pilot,pairing,redis}),mapWriter=null,pilotLogs=null,waylineUploads=()=>null,
  diagnostics=createPilotDiagnostics({enabled:process.env.SKYHUB_PILOT_DIAGNOSTICS_ENABLED==='true'})}){
  // Existing DJI Pilot 2 URL /pilot-login now resolves when v3 takes over port 4000.
  // Login/bootstrap remains opt-in; secret provisioning is forbidden over plaintext HTTP.
  app.get('/pilot-login',(req,res)=>{
    res.set('Content-Security-Policy',
      "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; "+
      "connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    res.sendFile(path.resolve(__dirname,'../frontend/public/pilot-login.html'));
  });
  app.get('/api/pilot/status',(req,res)=>res.json({
    configured:pilot.ready,missing:pilot.missing,mqttPort:pilot.mqttPort,requiresHttps:true,diagnostics:diagnostics.enabled
  }));
  function guard(req,res){
    if(!pilot.ready){res.status(503).json({error:'Pilot 2 not configured'});return false;}
    if(!req.secure){res.status(403).json({error:'HTTPS required'});return false;}
    return true;
  }
  async function pilotAuthorized(req){
    const hdr=req.headers.authorization||'';
    return pilotAuth.authorizedToken(hdr.startsWith('Bearer ')?hdr.slice(7):'');
  }
  if(process.env.SKYHUB_DJI_MAP_ELEMENTS_ENABLED==='true'&&pilot.ready){
    app.get('/map/api/v1/workspaces/:workspaceId/element-groups',createMapElementHandler({
      store:pool?createMapElementStore(pool):null,
      workspaceId:pilot.workspaceId,
      authorize:pilotAuth.principal
    }));
    // Pilot 2 (seen 05.11.2026, Pilot 2 on RC Plus 2) asks GET …/element-icons before the element groups; the endpoint is not in
    // the DJI 1.18 documentation. SkyHub has no custom icons: an empty list (same response envelope as element-groups).
    app.get('/map/api/v1/workspaces/:workspaceId/element-icons',async(req,res)=>{
      if(!req.secure)return res.status(403).json({code:403,message:'HTTPS required',data:[]});
      let p=null;try{p=await pilotAuth.principal(req.headers['x-auth-token']);}catch{return res.status(503).json({code:503,message:'Authorization unavailable',data:[]});}
      if(!p||p.workspaceId!==pilot.workspaceId||req.params.workspaceId!==pilot.workspaceId)return res.status(401).json({code:401,message:'Unauthorized',data:[]});
      res.set('Cache-Control','no-store').json({code:0,message:'success',data:[]});
    });
    // Pilot 2 writes (create/update/delete) only with SKYHUB_DJI_MAP_WRITES_ENABLED; server.js builds the writer.
    if(mapWriter)registerPilotMapWrites(app,{writer:mapWriter,workspaceId:pilot.workspaceId,authorize:pilotAuth.principal});
  }else if(process.env.SKYHUB_DJI_MAP_ELEMENTS_ENABLED==='true'){
    console.error('[map elements] disabled: Pilot 2 configuration is incomplete');
  }
  // Pilot 2 log upload (pull-pilot-log): device token like the bootstrap; viewer in server.js (/api/pilot-logs).
  if(pilotLogs)registerPilotLogUpload(app,{express:require('express'),store:pilotLogs,authorized:pilotAuthorized});
  // Last route uploads from Pilot 2 with the reason of a refusal (Pilot 2 shows only "Netzwerkfehler (3100xx)").
  app.get('/api/pilot/wayline-uploads',async(req,res)=>{
    if(!guard(req,res))return;
    if(!await pilotAuthorized(req))return res.status(401).json({error:'Unauthorized'});
    const h=waylineUploads();
    res.set('Cache-Control','no-store').json({enabled:Boolean(h),uploads:h||[]});
  });
  app.post('/api/pilot/bootstrap',async(req,res)=>{
    if(!guard(req,res))return;
    try{
      if(!await pilotAuthorized(req))return res.status(401).json({error:'Unauthorized'});
      res.json(pilot.bootstrap());
    }catch(_err){res.status(503).json({error:'Pilot authorization unavailable'});}
  });
  // Pairing: unauthenticated start/poll over HTTPS; approval requires the view token.
  app.post('/api/pilot/pair',(req,res)=>{
    if(!guard(req,res))return;
    if(redis.status!=='ready')return res.status(503).json({error:'Pairing store unavailable'});
    const userAgent=String(req.headers['user-agent']||'').slice(0,300);
    const started=pairing.start(userAgent,Date.now(),req.ip+'|'+userAgent);
    if(!started)return res.status(429).json({error:'Too many pending pairings'});
    console.log('[pilot pairing] code issued; approve with scripts/pi-pilot-pair.js');
    res.json(started);
  });
  app.get('/api/pilot/pair/:id',async(req,res)=>{
    if(!guard(req,res))return;
    try{
      const result=await pairing.poll(req.params.id);
      if(result.status==='approved')console.log('[pilot pairing] device paired');
      res.json(result);
    }catch(_err){res.status(503).json({error:'Pairing store unavailable'});}
  });
  // Diagnostics from the Pilot 2 page (pilot-diagnostics.js): HTTPS only; paired devices get their own rate bucket.
  app.post('/api/pilot/diagnostics',async(req,res)=>{
    if(!req.secure)return res.status(403).json({error:'HTTPS required'});
    let paired=false;
    try{paired=pilot.ready&&Boolean(await pilotAuthorized(req));}catch(_err){paired=false;}
    return diagnostics.receive(req,res,{paired});
  });
  // Lets the Pilot page see whether SkyHub acknowledged this RC's topology.
  app.get('/api/pilot/session',async(req,res)=>{
    if(!guard(req,res))return;
    try{
      if(!await pilotAuthorized(req))return res.status(401).json({error:'Unauthorized'});
    }catch(_err){return res.status(503).json({error:'Pilot authorization unavailable'});}
    const gateway=serial(req.query.gateway);
    const device=gateway?registry.get(gateway):null;
    res.json({
      topologyReplyEnabled:ack.enabled,
      topologyAckAt:gateway?ack.acks.get(gateway)??null:null,
      lastTopologyAt:device?.lastTopologyAt??null,
      lastTelemetryAt:device?.lastTelemetryAt??null
    });
  });
}

// Pairing administration: loopback/SSH tunnel only (not routed by Caddy) plus view token.
// Mounted after the view-token guard.
function registerPilotAdminRoutes(app,{pairing}){
  app.get('/api/pilot-admin/pairings',async(req,res)=>{
    try{res.json({pending:pairing.pending(),devices:await pairing.devices()});}
    catch(_err){res.status(503).json({error:'Pairing store unavailable'});}
  });
  app.post('/api/pilot-admin/approve',(req,res)=>{
    if(!pairing.approve(req.body?.code))return res.status(404).json({error:'No pending pairing with this code'});
    console.log('[pilot pairing] code approved');
    res.json({approved:true});
  });
  app.delete('/api/pilot-admin/devices/:id',async(req,res)=>{
    try{
      if(!await pairing.revoke(req.params.id))return res.status(404).json({error:'Unknown device'});
      res.json({revoked:true});
    }catch(_err){res.status(503).json({error:'Pairing store unavailable'});}
  });
}
module.exports={registerPilotRoutes,registerPilotAdminRoutes};
