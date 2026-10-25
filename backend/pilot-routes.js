'use strict';
const path=require('path');
const {serial}=require('./dji');
const {createMapElementStore}=require('./map-element-store');
const {createMapElementHandler}=require('./map-element-api');
const {createPilotAuth}=require('./pilot-auth');

// Pilot 2 onboarding endpoints. Public part: mounted before the view-token guard.
function registerPilotRoutes(app,{pilot,pairing,redis,registry,pool,ack,pilotAuth=createPilotAuth({pilot,pairing,redis})}){
  // Existing DJI Pilot 2 URL /pilot-login now resolves when v3 takes over port 4000.
  // Login/bootstrap remains opt-in; secret provisioning is forbidden over plaintext HTTP.
  app.get('/pilot-login',(req,res)=>{
    res.set('Content-Security-Policy',
      "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; "+
      "connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    res.sendFile(path.resolve(__dirname,'../frontend/public/pilot-login.html'));
  });
  app.get('/api/pilot/status',(req,res)=>res.json({
    configured:pilot.ready,missing:pilot.missing,mqttPort:pilot.mqttPort,requiresHttps:true
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
  }else if(process.env.SKYHUB_DJI_MAP_ELEMENTS_ENABLED==='true'){
    console.error('[map elements] disabled: Pilot 2 configuration is incomplete');
  }
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
