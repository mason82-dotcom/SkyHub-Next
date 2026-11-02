'use strict';

// Only named, exact reverse-proxy socket peers may supply X-Forwarded-* headers.
// Docker's complete RFC1918 bridge address space is NOT a trusted proxy network.
const DEFAULT_PROXY_IPS=Object.freeze(['127.0.0.1','::1']);

function normalizeProxyIp(value){
  if(typeof value!=='string')return null;
  let ip=value.trim();
  if(ip==='::1')return ip;
  if(ip.startsWith('::ffff:'))ip=ip.slice(7);
  const parts=ip.split('.');
  if(parts.length!==4 || !parts.every(p=>/^(?:0|[1-9]\d{0,2})$/.test(p)&&Number(p)<=255))
    return null;
  return parts.map(Number).join('.');
}
function isPrivateProxyIp(ip){
  if(ip==='::1' || ip==='127.0.0.1')return true;
  const a=ip.split('.').map(Number);
  return a.length===4 && (
    a[0]===10 || (a[0]===172&&a[1]>=16&&a[1]<=31) ||
    (a[0]===192&&a[1]===168)
  );
}
function parseTrustedProxyIps(raw=''){
  if(typeof raw!=='string'||raw.length>512)
    throw new Error('SKYHUB_TRUSTED_PROXY_IPS must be a bounded comma-separated list');
  const configured=raw.trim()?raw.split(','):[];
  if(configured.length>8)
    throw new Error('SKYHUB_TRUSTED_PROXY_IPS permits at most eight exact IP addresses');
  const trusted=new Set(DEFAULT_PROXY_IPS);
  for(const entry of configured){
    const ip=normalizeProxyIp(entry);
    if(!ip || !isPrivateProxyIp(ip))
      throw new Error('SKYHUB_TRUSTED_PROXY_IPS requires exact private/loopback IP addresses');
    trusted.add(ip);
  }
  return trusted;
}
function isTrustedProxyIp(peer, trusted=undefined){
  const ip=normalizeProxyIp(peer);
  return Boolean(ip && (trusted??new Set(DEFAULT_PROXY_IPS)).has(ip));
}
module.exports={normalizeProxyIp,parseTrustedProxyIps,isTrustedProxyIp};
