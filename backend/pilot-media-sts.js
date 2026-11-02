'use strict';

// DJI Pilot 2 media STS boundary (HTTPS, NOT the Dock MQTT requests channel).
// Deliberately NOT wired into server.js. No built-in STS issuer, tokens or storage access.
const {stsResponse,workspaceId}=require('./media-upload-contract');

const MAX_ISSUE_SECONDS=900;
const MAX_TOKEN_LENGTH=512;
const MAX_CREDENTIAL_LENGTH=4096;
const SESSION_ID=/^[A-Za-z0-9_-]{8,64}$/;

function plain(value){
  return value!==null&&typeof value==='object'&&!Array.isArray(value);
}
function deny(res,code,message){
  res.set?.('Cache-Control','no-store');
  return res.status(code).json({code,message,data:{}});
}
function cleanConfig(config){
  if(!plain(config)||
    typeof config.bucket!=='string'||config.bucket!=='dji-cloud'||
    typeof config.endpoint!=='string'||typeof config.region!=='string'||
    !/^[a-z0-9-]{1,64}$/i.test(config.region))return null;
  let parsed;
  try{parsed=new URL(config.endpoint);}catch(_err){return null;}
  if(parsed.protocol!=='https:'||parsed.username||parsed.password||
     parsed.pathname!=='/'||parsed.search||parsed.hash||
     parsed.origin!==config.endpoint)return null;
  return Object.freeze({...config});
}

function createPilotMediaStsHandler({workspace,authorize,issueGrant=null,allowIssuance=null,
  storage=null}={}){
  if(!workspaceId(workspace)||typeof authorize!=='function')
    throw new TypeError('Pilot STS workspace and principal authorizer required');
  const config=cleanConfig(storage);
  return async function pilotMediaSts(req,res){
    // Do not trust client-supplied proxy headers or a user-provided workspace.
    if(req.secure!==true)return deny(res,403,'HTTPS required');
    if(req.params?.workspaceId!==workspace)return deny(res,404,'Workspace not found');
    if(!plain(req.query??{})||Object.keys(req.query??{}).length||
       !plain(req.body??{})||Object.keys(req.body??{}).length)
      return deny(res,400,'Invalid request');
    const token=req.headers?.['x-auth-token'];
    if(typeof token!=='string'||!token||token.length>MAX_TOKEN_LENGTH)
      return deny(res,401,'Unauthorized');
    let principal;
    try{principal=await authorize(token);}
    catch(_err){return deny(res,503,'Authorization unavailable');}
    if(!plain(principal)||principal.role!=='pilot'||principal.workspaceId!==workspace)
      return deny(res,403,'Forbidden');

    // Both an audited, short-lived credential issuer and an independent rate
    // limiter are required. Missing any dependency fails closed, even for an
    // authenticated RC. This does not attest the underlying MinIO IAM policy.
    if(!config||typeof issueGrant!=='function'||typeof allowIssuance!=='function')
      return deny(res,503,'Media storage not available');
    try{
      if(await allowIssuance({workspace,principal})!==true)
        return deny(res,429,'Upload credentials temporarily unavailable');
    }catch(_err){return deny(res,503,'Media storage not available');}

    try{
      // The issuer MUST generate genuine temporary scoped credentials; never
      // supply the paired controller's token or a permanent S3 key to it.
      const grant=await issueGrant({workspace,principal,maxSeconds:MAX_ISSUE_SECONDS});
      if(!plain(grant)||grant.provider!=='minio'||grant.bucket!==config.bucket||
        grant.region!==config.region||grant.endpoint!==config.endpoint||
        typeof grant.objectKeyPrefix!=='string')throw new TypeError('Invalid grant');
      const prefix=grant.objectKeyPrefix;
      const required=workspace+'/media/';
      if(!prefix.startsWith(required)||!SESSION_ID.test(prefix.slice(required.length)))
        throw new TypeError('Invalid grant prefix');
      const credentials=grant.credentials;
      if(!plain(credentials)||!Number.isSafeInteger(credentials.expire)||
        credentials.expire<1||credentials.expire>MAX_ISSUE_SECONDS||
        ['accessKeyId','accessKeySecret','securityToken'].some(
          k=>typeof credentials[k]!=='string'||!credentials[k]||
          credentials[k].length>MAX_CREDENTIAL_LENGTH))
        throw new TypeError('Invalid grant credentials');
      const output=stsResponse(grant,{workspace});
      res.set?.('Cache-Control','no-store');
      return res.status(200).json(output);
    }catch(_err){
      // Never log the issuer error or credential material.
      return deny(res,503,'Media storage not available');
    }
  };
}

module.exports={createPilotMediaStsHandler,MAX_ISSUE_SECONDS};
