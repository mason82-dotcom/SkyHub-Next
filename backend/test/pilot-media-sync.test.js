'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const crypto=require('node:crypto');
const {once}=require('node:events');
const {createMinioStsIssuer,sessionPolicy,signedRequest}=require('../minio-sts');
const {createS3UploadProxy}=require('../s3-upload-proxy');
const {pilotConfiguration}=require('../pilot-config');
const {createPilotMediaUploadRuntime}=require('../pilot-media-upload-runtime');

const WS='09016a46-e315-441d-bf4a-2c67e0903e11';
const PILOT={role:'pilot',workspaceId:WS};
const SESSION='0123456789abcdef0123456789abcdef';
const XML='<AssumeRoleResponse><AssumeRoleResult><Credentials><AccessKeyId>TMPKEY</AccessKeyId>'+
  '<SecretAccessKey>TMPSECRET</SecretAccessKey><SessionToken>TMPTOKEN</SessionToken>'+
  '<Expiration>2026-10-31T21:00:00Z</Expiration></Credentials></AssumeRoleResult></AssumeRoleResponse>';

test('STS issuer signs an AssumeRole request with a per-session upload-only policy',async()=>{
  let seen;
  const issuer=createMinioStsIssuer({endpoint:'http://skyhub-minio:9000',publicEndpoint:'https://rpi5.fritz.box:9446',
    accessKeyId:'skyhub-pilot-uploader',secretAccessKey:'uploader-secret-123',sessionId:()=>SESSION,
    clock:()=>new Date('2026-10-31T20:00:00Z'),
    fetchImpl:async(url,options)=>{seen={url,options};return {ok:true,text:async()=>XML};}});
  const grant=await issuer.issueGrant({workspace:WS,principal:PILOT,maxSeconds:900});
  assert.equal(seen.url,'http://skyhub-minio:9000/');
  assert.match(seen.options.headers.Authorization,
    /^AWS4-HMAC-SHA256 Credential=skyhub-pilot-uploader\/20261031\/us-east-1\/sts\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/);
  const form=new URLSearchParams(seen.options.body);
  assert.equal(form.get('Action'),'AssumeRole');
  assert.equal(form.get('DurationSeconds'),'900');
  const policy=JSON.parse(form.get('Policy'));
  assert.deepEqual(policy.Statement[0].Resource,['arn:aws:s3:::dji-cloud/'+WS+'/media/'+SESSION+'/*']);
  assert.ok(!policy.Statement[0].Action.some(a=>/Get|Delete|List(Bucket|Objects)/.test(a)));
  assert.deepEqual(grant,{provider:'minio',bucket:'dji-cloud',region:'us-east-1',endpoint:'https://rpi5.fritz.box:9446',
    objectKeyPrefix:WS+'/media/'+SESSION,
    credentials:{accessKeyId:'TMPKEY',accessKeySecret:'TMPSECRET',securityToken:'TMPTOKEN',expire:900}});
  // The signature is reproducible from the documented SigV4 steps.
  const again=signedRequest({endpoint:'http://skyhub-minio:9000',accessKeyId:'skyhub-pilot-uploader',
    secretAccessKey:'uploader-secret-123',body:seen.options.body,now:new Date('2026-10-31T20:00:00Z')});
  assert.equal(again.headers.Authorization,seen.options.headers.Authorization);
});

test('STS issuer refuses wrong scope, plain-HTTP public endpoints and broken replies',async()=>{
  const make=extra=>createMinioStsIssuer({endpoint:'http://skyhub-minio:9000',publicEndpoint:'https://rpi5.fritz.box:9446',
    accessKeyId:'uploader',secretAccessKey:'uploader-secret',fetchImpl:async()=>({ok:true,text:async()=>XML}),...extra});
  assert.throws(()=>make({publicEndpoint:'http://rpi5.fritz.box:9446'}));
  assert.throws(()=>make({secretAccessKey:''}));
  const issuer=make();
  await assert.rejects(issuer.issueGrant({workspace:WS,principal:{role:'operator',workspaceId:WS},maxSeconds:900}));
  await assert.rejects(issuer.issueGrant({workspace:WS,principal:PILOT,maxSeconds:3600}));
  await assert.rejects(make({fetchImpl:async()=>({ok:false,text:async()=>'denied'})})
    .issueGrant({workspace:WS,principal:PILOT,maxSeconds:900}));
  await assert.rejects(make({fetchImpl:async()=>({ok:true,text:async()=>'<x/>'})})
    .issueGrant({workspace:WS,principal:PILOT,maxSeconds:900}));
  assert.match(sessionPolicy(WS+'/media/'+SESSION),/s3:PutObject/);
});

async function listen(server){
  server.listen(0,'127.0.0.1');await once(server,'listening');
  return server.address().port;
}

test('S3 upload proxy forwards only uploads below a session prefix, unchanged',async()=>{
  const received=[];
  const minio=http.createServer((req,res)=>{
    let body='';req.on('data',c=>body+=c);
    req.on('end',()=>{received.push({method:req.method,url:req.url,host:req.headers.host,
      auth:req.headers.authorization,body});res.writeHead(200,{ETag:'"abc"'});res.end();});
  });
  const minioPort=await listen(minio);
  const proxy=createS3UploadProxy({target:'http://127.0.0.1:'+minioPort,workspace:WS,
    trustedProxyIps:new Set(['127.0.0.1'])});
  const server=http.createServer(proxy.handler);
  const port=await listen(server);
  const send=(method,path,body)=>new Promise((resolve,reject)=>{
    const req=http.request({host:'127.0.0.1',port,method,path,headers:{Host:'rpi5.fritz.box:9446',
      Authorization:'AWS4-HMAC-SHA256 signed'}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});
    req.on('error',reject);req.end(body);
  });
  try{
    const key='/dji-cloud/'+WS+'/media/'+SESSION+'/DJI_0001.JPG';
    assert.equal(await send('PUT',key,'pixels'),200);
    assert.equal(await send('POST',key+'?uploads',''),200);
    assert.deepEqual(received[0],{method:'PUT',url:key,host:'rpi5.fritz.box:9446',auth:'AWS4-HMAC-SHA256 signed',body:'pixels'});
    assert.equal(await send('GET',key),403);
    assert.equal(await send('DELETE',key),403);
    assert.equal(await send('PUT','/dji-cloud/'+WS+'/other/'+SESSION+'/x.jpg','x'),403);
    assert.equal(await send('PUT','/farming/'+WS+'/media/'+SESSION+'/x.jpg','x'),403);
    assert.equal(await send('PUT','/dji-cloud/'+WS+'/media/short/x.jpg','x'),403);
    assert.equal(received.length,2);
    assert.equal(proxy.stats().rejected,5);
  }finally{server.close();minio.close();}
  // Requests that do not come from the trusted reverse proxy are refused.
  const strict=createS3UploadProxy({target:'http://127.0.0.1:1',workspace:WS,trustedProxyIps:new Set(['10.9.9.9'])});
  const other=http.createServer(strict.handler);
  const otherPort=await listen(other);
  try{
    const status=await new Promise(resolve=>http.request({host:'127.0.0.1',port:otherPort,method:'PUT',
      path:'/dji-cloud/'+WS+'/media/'+SESSION+'/a.jpg'},res=>{res.resume();resolve(res.statusCode);}).end('x'));
    assert.equal(status,403);
  }finally{other.close();}
});

const BASE_ENV={
  SKYHUB_PILOT_ACCESS_TOKEN:'pilot-token-abcdefghijklmnopqrstuvwxyz',SKYHUB_DJI_APP_ID:'1',
  SKYHUB_DJI_APP_KEY:'k',SKYHUB_DJI_APP_LICENSE:'l',SKYHUB_PILOT_MQTT_URL:'mqtt://192.168.178.63:1884',
  SKYHUB_PILOT_MQTT_USER:'u',SKYHUB_PILOT_MQTT_PASSWORD:'p',SKYHUB_PILOT_WORKSPACE_ID:WS,
  SKYHUB_PILOT_ENABLED:'true',SKYHUB_MQTT_REQUIRED_PORT:'1884'
};

test('bootstrap advertises the media module only when the sync is enabled with an HTTPS origin',()=>{
  const off=pilotConfiguration(BASE_ENV);
  assert.equal(off.media.enabled,false);
  if(off.ready)assert.equal(off.bootstrap().media,undefined);
  const on=pilotConfiguration({...BASE_ENV,SKYHUB_PILOT_MEDIA_UPLOAD_ENABLED:'true',
    SKYHUB_PILOT_PUBLIC_URL:'https://rpi5.fritz.box'});
  assert.equal(on.media.enabled,true);
  assert.equal(on.media.apiHost,'https://rpi5.fritz.box');
  if(on.ready)assert.deepEqual(on.bootstrap().media,{apiHost:'https://rpi5.fritz.box'});
  const bad=pilotConfiguration({...BASE_ENV,SKYHUB_PILOT_MEDIA_UPLOAD_ENABLED:'true',
    SKYHUB_PILOT_PUBLIC_URL:'http://rpi5.fritz.box'});
  assert.equal(bad.media.enabled,false);
  assert.match(bad.media.issue,/HTTPS/);
});

test('upload runtime stays off by default and refuses incomplete or shared credentials',()=>{
  const env={SKYHUB_PILOT_MEDIA_UPLOAD_ENABLED:'true',SKYHUB_MEDIA_ENABLED:'true',
    SKYHUB_S3_ENDPOINT:'http://skyhub-minio:9000',SKYHUB_S3_ACCESS_KEY:'reader',
    SKYHUB_PILOT_MEDIA_S3_PUBLIC_ENDPOINT:'https://rpi5.fritz.box:9446',
    SKYHUB_PILOT_UPLOAD_S3_ACCESS_KEY:'skyhub-pilot-uploader',SKYHUB_PILOT_UPLOAD_S3_SECRET_KEY:'secret-secret'};
  const deps={pool:{connect(){},query(){}},redis:{eval(){},status:'ready'},authorize:async()=>PILOT,
    storage:{headObject:async()=>null},pilot:{ready:true,workspaceId:WS},trustedProxyIps:new Set()};
  assert.equal(createPilotMediaUploadRuntime({env:{},...deps}),null);
  assert.throws(()=>createPilotMediaUploadRuntime({env,...deps,pool:null}),/prerequisites/);
  assert.throws(()=>createPilotMediaUploadRuntime({env:{...env,SKYHUB_PILOT_UPLOAD_S3_ACCESS_KEY:'reader'},...deps}),/own MinIO account/);
  assert.throws(()=>createPilotMediaUploadRuntime({env:{...env,SKYHUB_PILOT_MEDIA_S3_PUBLIC_ENDPOINT:'http://x'},...deps}));
  const runtime=createPilotMediaUploadRuntime({env,...deps});
  assert.equal(runtime.endpoint,'https://rpi5.fritz.box:9446');
  assert.equal(typeof runtime.router,'function');
});
