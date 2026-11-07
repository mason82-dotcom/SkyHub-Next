'use strict';

// DJI Pilot 2 HTTPS media endpoints. This router is NOT registered by server.js.
// Caller must explicitly supply workspace-bound Pilot 2 principal verification,
// independent throttling, append-only SQL audit, verified media store and S3 HEAD.
const express=require('express');
const {
  workspaceId,parseTinyFingerprintRequest,parseFastUploadRequest,
  parseUploadCallback,parseGroupUploadCallback,okEnvelope,bodyShape,
  tinyFingerprintResponse,uploadCallbackResponse
}=require('./media-upload-contract');

const MAX_JSON_BYTES=98304;
const TOKEN_MAX=512;
const ROOT='/media/api/v1/workspaces/:workspaceId';
const ACTIONS=Object.freeze({
  tiny:'tiny_fingerprints',fast:'fast_upload',
  callback:'upload_callback',group:'group_upload_callback'
});
function plain(v){return v!==null&&typeof v==='object'&&!Array.isArray(v);}
function error(res,status,message){
  res.set('Cache-Control','no-store');
  res.set('X-Content-Type-Options','nosniff');
  return res.status(status).json({code:status,message,data:{}});
}
function success(res,data){
  res.set('Cache-Control','no-store');
  res.set('X-Content-Type-Options','nosniff');
  return res.status(200).json(data);
}
function validatedBody(req){
  const type=req.headers?.['content-type'];
  if(typeof type!=='string'||!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(type))
    return false;
  if(!plain(req.body))return false;
  const length=req.headers?.['content-length'];
  if(length!==undefined && (!/^\d+$/.test(String(length)) ||
    Number(length)>MAX_JSON_BYTES))return false;
  try{return Buffer.byteLength(JSON.stringify(req.body))<=MAX_JSON_BYTES;}
  catch(_err){return false;}
}
function createPilotMediaHandlers({
  workspace,authorize,allowRequest,audit,store,groups,headObject,transaction,
  log=message=>console.log(message)
}={}){
  // Structure only (field names and value types), never values, keys, tokens or serials.
  function logInvalid(action,req,where){
    try{log('[pilot media] invalid '+action+' ('+where+'): content-type '+
      String(req.headers?.['content-type']||'-').slice(0,60)+' body '+JSON.stringify(bodyShape(req.body)));}
    catch(_err){/* diagnostics only */}
  }
  if(!workspaceId(workspace)||typeof authorize!=='function'||
    typeof allowRequest!=='function'||typeof audit!=='function'||
    !store||typeof store.existingTinyFingerprints!=='function'||
    typeof store.verifiedFingerprint!=='function'||
    typeof store.verifyCallback!=='function'||
    !groups||typeof groups.report!=='function'||
    typeof headObject!=='function'||typeof transaction!=='function')
    throw new TypeError('Complete isolated Pilot media dependencies required');

  async function guarded(req,res,action,perform){
    // req.secure must be computed by an explicitly trusted reverse proxy.
    // Never read X-Forwarded-Proto or a client-supplied workspace directly.
    if(req.secure!==true)return error(res,403,'HTTPS required');
    if(req.params?.workspaceId!==workspace)return error(res,404,'Workspace not found');
    if(!plain(req.query??{})||Object.keys(req.query??{}).length)
      return error(res,400,'Invalid query');
    const token=req.headers?.['x-auth-token'];
    if(typeof token!=='string'||!token||token.length>TOKEN_MAX)
      return error(res,401,'Unauthorized');
    let principal;
    try{principal=await authorize(token);}
    catch(_err){return error(res,503,'Authorization unavailable');}
    if(!plain(principal)||principal.role!=='pilot'||principal.workspaceId!==workspace)
      return error(res,403,'Forbidden');

    async function recorded(outcome){
      // Never forward the token, object key, fingerprint, serial or caller data.
      await audit({workspace,operation:action,outcome});
    }
    let allowed;
    try{allowed=await allowRequest({workspace,principal,operation:action});}
    catch(_err){return error(res,503,'Rate limiter unavailable');}
    if(allowed!==true){
      try{await recorded('denied');}
      catch(_err){return error(res,503,'Media audit unavailable');}
      return error(res,429,'Rate limit exceeded');
    }
    if(!validatedBody(req)){
      logInvalid(action,req,'transport');
      try{await recorded('invalid');}
      catch(_err){return error(res,503,'Media audit unavailable');}
      return error(res,400,'Invalid JSON body');
    }
    let reply;
    if(action===ACTIONS.callback||action===ACTIONS.group){
      try{
        reply=await transaction(async context=>{
          if(!context||typeof context.audit!=='function'||!context.store||!context.groups)
            throw new TypeError('Invalid media transaction context');
          const value=await perform(req.body,context);
          await context.audit({workspace,operation:action,outcome:value.outcome});
          return value;
        });
      }catch(_err){return error(res,503,'Media transaction unavailable');}
    }else{
      try{reply=await perform(req.body);}
      catch(_err){reply={status:503,outcome:'unavailable',message:'Media storage unavailable'};}
      try{await recorded(reply.outcome);}
      catch(_err){return error(res,503,'Media audit unavailable');}
    }
    if(reply.outcome==='invalid')logInvalid(action,req,'contract');
    if(reply.status!==200)return error(res,reply.status,reply.message);
    return success(res,reply.data);
  }

  const invalid=()=>({status:400,outcome:'invalid',message:'Invalid media request'});
  const pending=message=>({status:409,outcome:'pending',message});
  const conflict=message=>({status:409,outcome:'conflict',message});
  const ok=data=>({status:200,outcome:'ok',data});
  return Object.freeze({
    tinyFingerprints:(req,res)=>guarded(req,res,ACTIONS.tiny,async body=>{
      if(!parseTinyFingerprintRequest(body))return invalid();
      const fingerprints=await store.existingTinyFingerprints({workspace,body});
      return ok(tinyFingerprintResponse(fingerprints));
    }),
    fastUpload:(req,res)=>guarded(req,res,ACTIONS.fast,async body=>{
      if(!parseFastUploadRequest(body))return invalid();
      const result=await store.verifiedFingerprint({workspace,body});
      if(!plain(result)||typeof result.exists!=='boolean')
        throw new Error('Invalid media lookup result');
      // DJI fast-upload returns an empty data payload on confirmed existence.
      // When absent, deliberately return nonzero code: hardware semantics TBD.
      return result.exists?ok(okEnvelope({})):
        {status:404,outcome:'pending',message:'Verified media not found'};
    }),
    uploadCallback:(req,res)=>guarded(req,res,ACTIONS.callback,async(body,{store:writer})=>{
      if(!parseUploadCallback(body))return invalid();
      const result=await writer.verifyCallback({workspace,callback:body,headObject});
      switch(result?.status){
        case 'verified':
        case 'duplicate':return ok(uploadCallbackResponse(body.object_key));
        case 'failed-upload':return conflict('Upload reported failure');
        case 'unregistered':return conflict('Upload scope not registered');
        case 'expired':return conflict('Upload scope expired');
        case 'unverified':return pending('Media object not verified');
        case 'conflict':return conflict('Media identity conflict');
        default:throw new Error('Invalid callback state');
      }
    }),
    groupUploadCallback:(req,res)=>guarded(req,res,ACTIONS.group,async(body,{groups:writer})=>{
      if(!parseGroupUploadCallback(body))return invalid();
      const result=await writer.report({workspace,body});
      switch(result?.status){
        case 'recorded':
        case 'duplicate':return ok(okEnvelope({}));
        case 'unverifiable':return conflict('Group has no verifiable identity');
        case 'pending':return pending('Group media not yet verified');
        case 'conflict':return conflict('Group report conflict');
        default:throw new Error('Invalid group callback state');
      }
    })
  });
}

function createPilotMediaRouter(config){
  const handlers=createPilotMediaHandlers(config);
  const router=express.Router();
  router.use(express.json({limit:'96kb',strict:true,type:'application/json'}));
  router.post(ROOT+'/files/tiny-fingerprints',handlers.tinyFingerprints);
  router.post(ROOT+'/fast-upload',handlers.fastUpload);
  router.post(ROOT+'/upload-callback',handlers.uploadCallback);
  router.post(ROOT+'/group-upload-callback',handlers.groupUploadCallback);
  // Fail closed on malformed JSON and excessively large requests; never echo
  // the body or Express parser internals into the DJI response.
  router.use((err,_req,res,next)=>{
    if(!err)return next();
    return error(res,err.status===413?413:400,
      err.status===413?'Media request too large':'Invalid JSON body');
  });
  return router;
}

module.exports={createPilotMediaHandlers,createPilotMediaRouter,ROOT,MAX_JSON_BYTES};
