'use strict';

// Optional token-free, read-only dashboard access for one private home network.
// Requests reach the loopback-bound backend only through Caddy (or local processes);
// Caddy's LAN site admits 192.168.178.0/24 and sets X-Forwarded-For to the client.
const {parseTrustedProxyIps,isTrustedProxyIp}=require('./proxy-trust');
const PRIVATE=[['10.0.0.0',8],['172.16.0.0',12],['192.168.0.0',16]];

function ipv4(value){
  if(typeof value!=='string')return null;
  const text=value.trim().replace(/^::ffff:/i,'');
  const parts=text.split('.');
  if(parts.length!==4 || !parts.every(p=>/^\d{1,3}$/.test(p) && Number(p)<=255))return null;
  return parts.reduce((n,p)=>n*256+Number(p),0);
}
function within(ip,[base,prefix]){
  const size=2**(32-prefix);
  return Math.floor(ip/size)===Math.floor(ipv4(base)/size);
}
// Only a narrow private IPv4 network (at least /16) can be granted token-free viewing.
function parseLanCidr(value){
  if(!value)return null;
  const match=/^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/.exec(String(value).trim());
  if(!match)throw new Error('SKYHUB_LAN_VIEW_CIDR must look like 192.168.178.0/24');
  const base=ipv4(match[1]),prefix=Number(match[2]);
  if(base===null || prefix<16 || prefix>32)throw new Error('SKYHUB_LAN_VIEW_CIDR must be /16 to /32');
  if(!PRIVATE.some(net=>within(base,net)))throw new Error('SKYHUB_LAN_VIEW_CIDR must be a private network');
  // Docker bridge gateways live in 172.16.0.0/12: such a range would admit every local request.
  if(within(base,['172.16.0.0',12]))throw new Error('SKYHUB_LAN_VIEW_CIDR must not overlap Docker networks (172.16.0.0/12)');
  return [match[1],prefix];
}
// Trust X-Forwarded-For ONLY from explicitly allowlisted reverse-proxy socket peers.
// A Docker container's IP is not automatically trusted just because it is private.
// The validated Caddy peer address must be configured in SKYHUB_TRUSTED_PROXY_IPS.
function clientAddress(peer,forwardedFor,trustedProxies=parseTrustedProxyIps()){
  if(isTrustedProxyIp(peer,trustedProxies) && typeof forwardedFor==='string' && forwardedFor.trim()){
    const hops=forwardedFor.split(',');
    return hops[hops.length-1].trim();
  }
  return peer||null;
}
function createLanAccess(cidrValue,trustedProxies=parseTrustedProxyIps()){
  const cidr=parseLanCidr(cidrValue);
  return {
    enabled:Boolean(cidr),
    allows(peer,forwardedFor){
      if(!cidr)return false;
      const ip=ipv4(clientAddress(peer,forwardedFor,trustedProxies));
      return ip!==null && within(ip,cidr);
    }
  };
}
module.exports={createLanAccess,parseLanCidr,clientAddress};
