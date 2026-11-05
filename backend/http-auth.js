'use strict';
const crypto=require('crypto');
const {createWpmlLanAuth}=require('./wpml-lan-auth');

// View-token and home-LAN access for /api and Socket.IO.
// Token-free viewing from the configured home LAN is read-only, never pairing administration.
// The web UI asks for no token or password: inside the home LAN every read (GET) of the
// dashboard, the media gallery (MinIO), the thermal module and the Smart Farming catalog works without one.
// Pairing administration, DR reports and other diagnostics still need the view token.
const lanReadPaths=new Set(['/devices','/topology','/events','/diagnostics/mqtt-shapes','/diagnostics/hms-history']);
const lanReadPatterns=[
  /^\/drone\/[^/]+\/(track|telemetry)$/,
  /^\/media\/(status|buckets|objects|summary|index|file|thumb|mission|m3m\/inventory)$/,
  /^\/smart-farming\/candidates(\/[^/]+)*\/?$/,
  /^\/thermal\/(list|meta|raw|measure)$/,
  /^\/thermal\/export\/[0-9a-f]{24}(\/zip)?$/,
  /^\/ppk\/(health|flights|jobs\/[0-9a-f]{24}(\/result\.csv)?)$/,
  /^\/live\/control\/?$/,
  /^\/map-elements\/?$/,
  /^\/coverage\/flights$/,
  /^\/ndvi\/(captures|results\/[0-9a-f]{16}\.(png|tif))$/,
  /^\/pilot-logs(\/[0-9a-f-]{36}\/text)?\/?$/,
  /^\/smart-farming\/captures(\/manifest)?\/?$/,
  /^\/live\/status$/,
  /^\/live\/hls\/pilot\/[A-Za-z0-9_-]{1,96}\.(m3u8|mp4)$/
];

function createHttpAuth({secret,lanAccess,wpmlLanAuth}){
  const allowWpmlLan=createWpmlLanAuth({...wpmlLanAuth,lanAccess});
  function authorized(value){
    if(typeof value!=='string')return false;
    const a=Buffer.from(value),b=Buffer.from(secret);
    return a.length===b.length && crypto.timingSafeEqual(a,b);
  }
  function lanView(req){
    const readPath=lanReadPaths.has(req.path) || lanReadPatterns.some(pattern=>pattern.test(req.path));
    return (req.method==='GET'||req.method==='HEAD') && readPath &&
      lanAccess.allows(req.socket.remoteAddress,req.headers['x-forwarded-for']);
  }
  function auth(req,res,next){
    const hdr=req.headers.authorization||'';
    if(lanView(req))return next();
    // Token-free home-LAN access (reads and same-origin writes); downstream routers see req.skyhubLan.
    if(!hdr && allowWpmlLan(req)){req.skyhubLan=true;return next();}
    if(!authorized(hdr.startsWith('Bearer ')?hdr.slice(7):'')){
      return res.status(401).json({error:'Unauthorized'});
    }
    next();
  }
  function socketAuth(socket,next){
    return authorized(socket.handshake.auth?.token) ||
      lanAccess.allows(socket.request.socket.remoteAddress,socket.handshake.headers['x-forwarded-for'])
      ?next():next(new Error('Unauthorized'));
  }
  return {authorized,auth,socketAuth,lanSocket:allowWpmlLan.socket};
}
module.exports={createHttpAuth};
