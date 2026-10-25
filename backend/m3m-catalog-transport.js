'use strict';
// Defense in depth for the optional, bearer-protected M3M catalog.
// Never trust X-Forwarded-Proto from a non-loopback peer.
const {isIP} = require('node:net');

function isLoopbackPeer(address) {
  if (typeof address !== 'string') return false;
  if (address === '::1') return true;
  const normalized = address.toLowerCase().startsWith('::ffff:')
    ? address.slice(7) : address;
  return isIP(normalized) === 4 && normalized.split('.')[0] === '127';
}

function allowsCatalogTransport(req) {
  if (!req || !req.socket) return false;
  // Direct TLS terminates at Node. X-Forwarded-* cannot downgrade direct TLS.
  if (req.socket.encrypted === true) return true;
  // Reverse-proxy termination is supported only through a LOCAL transport.
  if (!isLoopbackPeer(req.socket.remoteAddress)) return false;
  const hdr = req.headers || {};
  const proxyHeaders = ['x-forwarded-proto', 'x-forwarded-for', 'forwarded'];
  const proxied = proxyHeaders.some(name => hdr[name] !== undefined);
  if (!proxied) return true; // SSH-forwarded direct loopback HTTP only.
  // Require a single explicit HTTPS statement from a trusted local proxy.
  // req.secure must independently reflect Express's configured trust proxy.
  return hdr['x-forwarded-proto'] === 'https' && req.secure === true;
}

function requireCatalogTransport(req, res, next) {
  if (allowsCatalogTransport(req)) return next();
  res.set('Cache-Control', 'no-store');
  return res.status(403).json({error:'Catalog requires HTTPS or local loopback'});
}

module.exports = {isLoopbackPeer, allowsCatalogTransport, requireCatalogTransport};
