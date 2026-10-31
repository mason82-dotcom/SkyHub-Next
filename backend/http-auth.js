'use strict';
const crypto=require('crypto');

// View-token and home-LAN access for /api and Socket.IO.
// Token-free viewing from the configured home LAN is read-only, never pairing administration.
// The web UI asks for no token or password: inside the home LAN every read (GET) of the
// dashboard, the media gallery (MinIO), the thermal module and the Smart Farming catalog works without one.
// Pairing administration, DR reports and other diagnostics still need the view token.
const lanReadPaths=new Set(['/devices','/topology','/events','/diagnostics/mqtt-shapes']);
const lanReadPatterns=[
  /^\/drone\/[^/]+\/(track|telemetry)$/,
  /^\/media\/(status|buckets|objects|summary|index|file|thumb|mission|m3m\/inventory)$/,
  /^\/smart-farming\/candidates(\/[^/]+)*\/?$/,
  /^\/thermal\/(list|meta|raw)$/
];

function createHttpAuth({secret,lanAccess}){
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
  return {authorized,auth,socketAuth};
}
module.exports={createHttpAuth};
