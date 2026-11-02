'use strict';

// MinIO AssumeRole issuer for DJI Pilot 2 media uploads.
// A dedicated uploader account (never the read-only gallery account, never root) requests
// temporary credentials whose inline session policy allows ONLY uploads below
// dji-cloud/<workspace>/media/<session>/. MinIO enforces the intersection of the account
// policy and this session policy, so a leaked token can neither read, list nor delete.
const crypto=require('crypto');
const {workspaceId}=require('./media-upload-contract');

const BUCKET='dji-cloud';
const REGION='us-east-1';
const DURATION_SECONDS=900;   // MinIO minimum, also the SkyHub maximum for Pilot grants
const MAX_RESPONSE_BYTES=65536;

const sha256=value=>crypto.createHash('sha256').update(value).digest('hex');
const hmac=(key,value)=>crypto.createHmac('sha256',key).update(value).digest();

function sessionPolicy(prefix){
  return JSON.stringify({
    Version:'2012-10-17',
    Statement:[{
      Effect:'Allow',
      Action:['s3:PutObject','s3:AbortMultipartUpload','s3:ListMultipartUploadParts'],
      Resource:['arn:aws:s3:::'+BUCKET+'/'+prefix+'/*']
    }]
  });
}

// AWS Signature Version 4 for the STS form POST (service "sts").
function signedRequest({endpoint,accessKeyId,secretAccessKey,body,now}){
  const url=new URL(endpoint);
  const amzDate=now.toISOString().replace(/[:-]|\.\d{3}/g,'');
  const day=amzDate.slice(0,8);
  const payloadHash=sha256(body);
  const contentType='application/x-www-form-urlencoded; charset=utf-8';
  const canonicalHeaders='content-type:'+contentType+'\n'+'host:'+url.host+'\n'+
    'x-amz-content-sha256:'+payloadHash+'\n'+'x-amz-date:'+amzDate+'\n';
  const signedHeaders='content-type;host;x-amz-content-sha256;x-amz-date';
  const canonical=['POST','/','',canonicalHeaders,signedHeaders,payloadHash].join('\n');
  const scope=day+'/'+REGION+'/sts/aws4_request';
  const toSign=['AWS4-HMAC-SHA256',amzDate,scope,sha256(canonical)].join('\n');
  let key=hmac('AWS4'+secretAccessKey,day);
  key=hmac(key,REGION);key=hmac(key,'sts');key=hmac(key,'aws4_request');
  const signature=crypto.createHmac('sha256',key).update(toSign).digest('hex');
  return {
    url:url.origin+'/',
    headers:{
      'Content-Type':contentType,
      'X-Amz-Date':amzDate,
      'X-Amz-Content-Sha256':payloadHash,
      Authorization:'AWS4-HMAC-SHA256 Credential='+accessKeyId+'/'+scope+
        ', SignedHeaders='+signedHeaders+', Signature='+signature
    }
  };
}
function xmlValue(xml,tag){
  const match=new RegExp('<'+tag+'>([^<]{1,4096})</'+tag+'>').exec(xml);
  return match?match[1]:null;
}

function createMinioStsIssuer({endpoint,publicEndpoint,accessKeyId,secretAccessKey,
  fetchImpl=globalThis.fetch,clock=()=>new Date(),sessionId=()=>crypto.randomBytes(16).toString('hex')}={}){
  let internal,external;
  try{internal=new URL(endpoint);external=new URL(publicEndpoint);}
  catch(_err){throw new TypeError('MinIO STS endpoints required');}
  if(!['http:','https:'].includes(internal.protocol)||internal.pathname!=='/'||internal.username)
    throw new TypeError('Invalid internal MinIO endpoint');
  if(external.protocol!=='https:'||external.pathname!=='/'||external.username||external.search)
    throw new TypeError('Public MinIO upload endpoint must be a plain HTTPS origin');
  if(typeof accessKeyId!=='string'||accessKeyId.length<3||
     typeof secretAccessKey!=='string'||secretAccessKey.length<8)
    throw new TypeError('MinIO uploader credentials required');
  if(typeof fetchImpl!=='function')throw new TypeError('fetch required');

  const config=Object.freeze({bucket:BUCKET,region:REGION,endpoint:external.origin});

  async function issueGrant({workspace,principal,maxSeconds}={}){
    if(!workspaceId(workspace)||!principal||principal.role!=='pilot'||
       principal.workspaceId!==workspace||maxSeconds!==DURATION_SECONDS)
      throw new TypeError('Invalid STS grant request');
    const session=sessionId();
    if(!/^[0-9a-f]{32}$/.test(session))throw new TypeError('Invalid session id');
    const objectKeyPrefix=workspace+'/media/'+session;
    const body=new URLSearchParams({
      Action:'AssumeRole',Version:'2011-06-15',
      DurationSeconds:String(DURATION_SECONDS),
      Policy:sessionPolicy(objectKeyPrefix)
    }).toString();
    const request=signedRequest({endpoint:internal.origin,accessKeyId,secretAccessKey,body,now:clock()});
    const response=await fetchImpl(request.url,{method:'POST',headers:request.headers,body,
      redirect:'error',signal:AbortSignal.timeout(10000)});
    const text=await response.text();
    if(!response.ok||text.length>MAX_RESPONSE_BYTES)throw new Error('MinIO STS refused');
    const credentials={
      accessKeyId:xmlValue(text,'AccessKeyId'),
      accessKeySecret:xmlValue(text,'SecretAccessKey'),
      securityToken:xmlValue(text,'SessionToken'),
      expire:DURATION_SECONDS
    };
    if(!credentials.accessKeyId||!credentials.accessKeySecret||!credentials.securityToken)
      throw new Error('Invalid MinIO STS response');
    return {provider:'minio',bucket:BUCKET,region:REGION,endpoint:config.endpoint,
      objectKeyPrefix,credentials};
  }
  return {issueGrant,config};
}

module.exports={createMinioStsIssuer,sessionPolicy,signedRequest,DURATION_SECONDS,BUCKET,REGION};
