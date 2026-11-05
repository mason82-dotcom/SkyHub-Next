'use strict';
// Explicit, opt-in token-free access for the HTTPS home-LAN WPML mission library.
// Other write APIs, DJI Pilot 2 and requests from outside the allowlisted network stay protected.
const UUID='[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
// Read-only: the mission store, the release overview/check (mission-release.js) and the live-control status (drc-runtime.js).
const READ=new RegExp('^/(?:wpml/(?:missions(?:/status|/'+UUID+'(?:/kmz)?)?|release(?:/config|/'+UUID+')?)|drc/(?:rcpro/)?status)/?$');
// Token-free writes from the home LAN (decision 04.11.2026: no token fields in the UI), always with browser same-origin proof.
// Explicit allowlist per method (fail closed): a new route is NOT token-free until it is added here.
const RELEASE=new RegExp('^/wpml/release/'+UUID+'/release$');
const DRC_COMMANDS=new Set(['auth/request','release','live/enter','live/exit','flyto','flyto/stop','takeoff','return-home',
  'return-home/cancel','emergency-stop','landing','payload/look-at']);
// drc-payload.js COMMANDS (camera_mode, photo_take, gimbal_reset, …): lower case with underscores, checked again by the router.
const MAP_ELEMENT=/^\/map-elements\/[A-Za-z0-9_.:-]{1,128}$/;
const DRC_PAYLOAD=/^payload\/[a-z][a-z_]{1,31}$/;
const WRITES=Object.freeze({
  POST:path=>path==='/wpml/missions'||path==='/thermal/export'||path==='/ppk/jobs'||path==='/ppk/jobs/storage'||path==='/terrain/profile'||path==='/coverage/run'||path==='/ndvi/run'||/^\/live\/control\/(start|stop|quality|lens)$/.test(path)||path==='/map-elements'||RELEASE.test(path)||
    (path.startsWith('/drc/')&&(c=>DRC_COMMANDS.has(c)||DRC_PAYLOAD.test(c))(path.slice(5).replace(/^rcpro\//,''))),
  PUT:path=>MAP_ELEMENT.test(path),
  DELETE:path=>RELEASE.test(path)||MAP_ELEMENT.test(path)||/^\/pilot-logs\/[0-9a-f-]{36}$/.test(path)||/^\/(thermal\/export|ppk\/jobs)\/[0-9a-f]{24}$/.test(path)
});
function parseWpmlLanOrigins(raw){
  if(typeof raw!=='string'||!raw.trim()||raw.length>1024)
    throw new Error('SKYHUB_WPML_LAN_ORIGINS must list explicit HTTPS origins');
  const entries=raw.split(',').map(s=>s.trim());
  if(entries.length>4||entries.some(s=>!s))throw new Error('Invalid WPML LAN origins list');
  const origins=new Set();
  for(const entry of entries){
    let u;
    try{u=new URL(entry);}catch{throw new Error('Invalid WPML LAN origin');}
    if(u.protocol!=='https:'||!u.hostname||!u.port||u.username||u.password||
      u.pathname!=='/'||u.search||u.hash||entry.replace(/\/$/,'')!==u.origin)
      throw new Error('WPML LAN origins must be explicit HTTPS host:port origins');
    origins.add(u.origin);
  }
  return origins;
}
function createWpmlLanAuth({enabled=false,origins='',lanAccess}={}){
  if(!enabled){const off=()=>false;off.socket=()=>false;return off;}
  if(!lanAccess?.enabled)throw new Error('WPML LAN no-token access requires SKYHUB_LAN_VIEW_CIDR');
  const allowed=parseWpmlLanOrigins(origins);
  const check=req=>{
    if(req.secure!==true)return false;
    const host=req.headers?.host;
    if(typeof host!=='string'||!allowed.has('https://'+host))return false;
    if(!lanAccess.allows(req.socket?.remoteAddress,req.headers?.['x-forwarded-for']))return false;
    if(req.method==='GET'||req.method==='HEAD')return READ.test(req.path);
    if(!Object.hasOwn(WRITES,req.method)||!WRITES[req.method](req.path))return false;
    // Browser same-origin proof is mandatory for token-free writes.
    if(req.headers.origin!=='https://'+host)return false;
    if(req.headers['sec-fetch-site']!==undefined&&
      req.headers['sec-fetch-site']!=='same-origin')return false;
    return true;
  };
  // Socket.IO handshake (live control): same rules for host, LAN client and Origin. HTTPS is taken from X-Forwarded-Proto
  // only where Express would trust it (isTrustedProxy = the app's compiled "trust proxy" function, so the same
  // loopback-bind condition applies as for req.secure), never from a direct client.
  check.socket=(request,isTrustedProxy)=>{
    const h=request?.headers||{},host=h.host,remote=request?.socket?.remoteAddress;
    if(typeof host!=='string'||!allowed.has('https://'+host))return false;
    if(typeof isTrustedProxy!=='function'||!isTrustedProxy(remote)||h['x-forwarded-proto']!=='https')return false;
    if(!lanAccess.allows(remote,h['x-forwarded-for']))return false;
    return h.origin==='https://'+host;
  };
  return check;
}
module.exports={createWpmlLanAuth,parseWpmlLanOrigins};
