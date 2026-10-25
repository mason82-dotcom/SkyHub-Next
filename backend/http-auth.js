'use strict';
const crypto=require('crypto');

// View-token and home-LAN access for /api and Socket.IO.
// Token-free viewing from the configured home LAN is read-only, never pairing administration.
const lanReadPaths=new Set(['/devices','/topology','/events','/diagnostics/mqtt-shapes']);

function createHttpAuth({secret,lanAccess}){
  function authorized(value){
    if(typeof value!=='string')return false;
    const a=Buffer.from(value),b=Buffer.from(secret);
    return a.length===b.length && crypto.timingSafeEqual(a,b);
  }
  function lanView(req){
    const readPath=lanReadPaths.has(req.path) || /^\/drone\/[^/]+\/(track|telemetry)$/.test(req.path);
    return req.method==='GET' && readPath &&
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
