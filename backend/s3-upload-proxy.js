'use strict';

// Narrow S3 pass-through for DJI Pilot 2 uploads. MinIO itself stays without a published port:
// Caddy terminates HTTPS for the RC (e.g. https://rpi5.fritz.box:9446) and forwards to this listener,
// which streams the unchanged request (Host header, path and SigV4 signature intact) to MinIO.
// Allowed: PUT/POST/HEAD below /dji-cloud/<workspace>/media/<32-hex session>/, nothing else.
// MinIO still enforces the temporary session policy issued by minio-sts.js.
const http=require('http');
const https=require('https');
const {isTrustedProxyIp}=require('./proxy-trust');

const METHODS=new Set(['PUT','POST','HEAD']);
const HOP_BY_HOP=new Set(['connection','keep-alive','proxy-authenticate','proxy-authorization',
  'te','trailer','transfer-encoding','upgrade']);

function uploadPath(workspace){
  const ws=workspace.replace(/[^0-9a-f-]/gi,'');
  return new RegExp('^/dji-cloud/'+ws+'/media/[0-9a-f]{32}/[^?#]+(\\?[^#]*)?$');
}
function forwardHeaders(headers){
  const out={};
  for(const [name,value] of Object.entries(headers)){
    if(!HOP_BY_HOP.has(name.toLowerCase()))out[name]=value;
  }
  return out;
}

function createS3UploadProxy({target,workspace,trustedProxyIps,log=()=>{}}={}){
  const upstream=new URL(target);
  const client=upstream.protocol==='https:'?https:http;
  const allowed=uploadPath(workspace);
  const stats={forwarded:0,rejected:0,failed:0,lastAt:null};

  function reject(res,status){
    stats.rejected++;
    res.writeHead(status,{'Content-Type':'application/xml','Cache-Control':'no-store'});
    res.end('<?xml version="1.0" encoding="UTF-8"?><Error><Code>AccessDenied</Code></Error>');
  }
  function handler(req,res){
    if(!isTrustedProxyIp(req.socket.remoteAddress,trustedProxyIps))return reject(res,403);
    if(!METHODS.has(req.method)||!allowed.test(req.url||''))return reject(res,403);
    const outbound=client.request({
      protocol:upstream.protocol,hostname:upstream.hostname,port:upstream.port,
      method:req.method,path:req.url,headers:forwardHeaders(req.headers)
    },response=>{
      stats.forwarded++;stats.lastAt=new Date().toISOString();
      res.writeHead(response.statusCode,forwardHeaders(response.headers));
      response.pipe(res);
      // Only status and method: never keys, tokens or signatures.
      if(response.statusCode>=400)log('[s3 upload] '+req.method+' -> HTTP '+response.statusCode);
    });
    outbound.on('error',()=>{
      stats.failed++;
      if(!res.headersSent)reject(res,502);else res.destroy();
    });
    req.on('aborted',()=>outbound.destroy());
    req.pipe(outbound);
  }
  function listen(port,host='0.0.0.0'){
    const server=http.createServer(handler);
    // Large videos: no overall request timeout; idle connections still close.
    server.requestTimeout=0;
    server.headersTimeout=60000;
    server.keepAliveTimeout=5000;
    server.listen(port,host);
    return server;
  }
  return {handler,listen,stats:()=>({...stats})};
}

module.exports={createS3UploadProxy,uploadPath};
