'use strict';

// Narrow S3 pass-through for DJI Pilot 2 uploads. MinIO itself stays without a published port:
// Caddy terminates HTTPS for the RC (e.g. https://rpi5.fritz.box:9446) and forwards to this listener,
// which streams the unchanged request (Host header, path and SigV4 signature intact) to MinIO.
// Allowed: PUT/POST/HEAD below /dji-cloud/<workspace>/media/<32-hex session>/.
// Optional (DJI wayline library): presigned GET/HEAD of exactly /<wpml bucket>/missions/<uuid>.kmz.
// Nothing else.
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
const DOWNLOAD_METHODS=new Set(['GET','HEAD']);
// Only presigned requests (SigV4 query) for one wayline file; MinIO verifies the signature.
function downloadPath(bucket){
  if(!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket))throw new Error('Invalid download bucket');
  return new RegExp('^/'+bucket+'/missions/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.kmz'+
    '\\?(?=[^#]*X-Amz-Algorithm=AWS4-HMAC-SHA256)(?=[^#]*X-Amz-Signature=[0-9a-f]{64})[^#]*$');
}
// Defence in depth before the prefix regex: no dot segments, empty segments, backslashes or
// encoded separators, also not percent-encoded. (MinIO's session policy is the second line.)
function plainObjectPath(url){
  const path=String(url).split('?')[0];
  if(/[\\]|%2f|%5c|%00/i.test(path))return false;
  let decoded;
  try{decoded=decodeURIComponent(path);}catch(_err){return false;}
  return !decoded.slice(1).split('/').some(segment=>segment===''||segment==='.'||segment==='..');
}
// S3 operation behind a request, for diagnostics only (no object names).
function requestKind(method,url){
  const query=String(url).split('?')[1]||'';
  const keys=new Set(query.split('&').map(p=>p.split('=')[0]));
  if(method==='POST'&&keys.has('uploads'))return 'CreateMultipartUpload';
  if(method==='POST'&&keys.has('uploadId'))return 'CompleteMultipartUpload';
  if(method==='PUT'&&keys.has('uploadId'))return 'UploadPart';
  if(method==='PUT')return 'PutObject';
  if(method==='POST')return 'PostObject';
  return method==='HEAD'?'HeadObject':'GetObject';
}
function forwardHeaders(headers){
  const out={};
  for(const [name,value] of Object.entries(headers)){
    if(!HOP_BY_HOP.has(name.toLowerCase()))out[name]=value;
  }
  return out;
}

function createS3UploadProxy({target,workspace,trustedProxyIps,downloadBucket=null,log=()=>{}}={}){
  const upstream=new URL(target);
  const client=upstream.protocol==='https:'?https:http;
  const allowed=uploadPath(workspace);
  const download=downloadBucket?downloadPath(downloadBucket):null;
  const stats={forwarded:0,rejected:0,failed:0,lastAt:null};

  function reject(res,status){
    stats.rejected++;
    res.writeHead(status,{'Content-Type':'application/xml','Cache-Control':'no-store'});
    res.end('<?xml version="1.0" encoding="UTF-8"?><Error><Code>AccessDenied</Code></Error>');
  }
  function handler(req,res){
    if(!isTrustedProxyIp(req.socket.remoteAddress,trustedProxyIps))return reject(res,403);
    const url=req.url||'';
    if(!plainObjectPath(url))return reject(res,403);
    const upload=METHODS.has(req.method)&&allowed.test(url);
    const fetchWayline=download!==null&&DOWNLOAD_METHODS.has(req.method)&&download.test(url);
    if(!upload&&!fetchWayline)return reject(res,403);
    const outbound=client.request({
      protocol:upstream.protocol,hostname:upstream.hostname,port:upstream.port,
      method:req.method,path:req.url,headers:forwardHeaders(req.headers)
    },response=>{
      stats.forwarded++;stats.lastAt=new Date().toISOString();
      res.writeHead(response.statusCode,forwardHeaders(response.headers));
      if(response.statusCode>=400){
        // Only method, request kind, status and the S3 error code (e.g. EntityTooSmall):
        // never keys, tokens, signatures or object names.
        let head='';
        response.on('data',chunk=>{if(head.length<2048)head+=chunk.toString('utf8',0,2048-head.length);});
        response.on('end',()=>{
          const code=(/<Code>([A-Za-z0-9]{1,64})<\/Code>/.exec(head)||[])[1]||'-';
          // Header NAMES only (x-amz-*), never values: shows which optional S3 features the
          // client requests (tagging, checksums, storage class ...).
          const amz=Object.keys(req.headers).filter(h=>/^x-amz-[a-z0-9-]{1,48}$/.test(h)&&!/security-token|credential|signature/.test(h)).sort().join(',');
          const q=String(url).split('?')[1]||'';
          const auth=req.headers.authorization?'header':/X-Amz-Signature=/.test(q)?'query':'none';
          const token=req.headers['x-amz-security-token']?'header':/X-Amz-Security-Token=/.test(q)?'query':'none';
          log('[s3 upload] '+req.method+' '+requestKind(req.method,url)+' -> HTTP '+response.statusCode+' '+code+
            ' auth='+auth+' token='+token+' session='+((/\/media\/([0-9a-f]{8})[0-9a-f]{24}\//.exec(url)||[])[1]||'-')+(amz?' headers '+amz:''));
        });
      }
      response.pipe(res);
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

module.exports={createS3UploadProxy,uploadPath,downloadPath,plainObjectPath,requestKind};
