'use strict';
// Explicit, opt-in token-free access for the HTTPS home-LAN WPML mission library.
// Other write APIs, DJI Pilot 2 and requests from outside the allowlisted network stay protected.
const UUID='[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const READ=new RegExp('^/wpml/missions(?:/status|/'+UUID+'(?:/kmz)?)?/?$');
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
  if(!enabled)return ()=>false;
  if(!lanAccess?.enabled)throw new Error('WPML LAN no-token access requires SKYHUB_LAN_VIEW_CIDR');
  const allowed=parseWpmlLanOrigins(origins);
  return req=>{
    if(req.secure!==true)return false;
    const host=req.headers?.host;
    if(typeof host!=='string'||!allowed.has('https://'+host))return false;
    if(!lanAccess.allows(req.socket?.remoteAddress,req.headers?.['x-forwarded-for']))return false;
    if(req.method==='GET'||req.method==='HEAD')return READ.test(req.path);
    if(req.method!=='POST'||req.path!=='/wpml/missions')return false;
    // Browser same-origin proof is mandatory for token-free writes.
    if(req.headers.origin!=='https://'+host)return false;
    if(req.headers['sec-fetch-site']!==undefined&&
      req.headers['sec-fetch-site']!=='same-origin')return false;
    return true;
  };
}
module.exports={createWpmlLanAuth,parseWpmlLanOrigins};
