'use strict';

// Opt-in, read-only Pilot 2 media library HTTP API. Not mounted in server.js.
// No S3 object download, presigned URLs or raw EXIF/XMP output.
const express=require('express');
const {workspaceId}=require('./media-upload-contract');
const ROOT='/api/media-library/v1/workspaces/:workspaceId';
const TOKEN_MAX=512;
function plain(v){return v!==null&&typeof v==='object'&&!Array.isArray(v);}
function error(res,status,message){
  res.set('Cache-Control','no-store');
  res.set('X-Content-Type-Options','nosniff');
  return res.status(status).json({code:status,message,data:{}});
}
function ok(res,data){
  res.set('Cache-Control','no-store');
  res.set('X-Content-Type-Options','nosniff');
  return res.status(200).json({code:0,message:'success',data});
}
function createPilotMediaLibraryHandlers({workspace,authorize,allowRead,audit,library,headObject}={}){
  if(!workspaceId(workspace)||typeof authorize!=='function'||
    typeof allowRead!=='function'||typeof audit!=='function'||
    !library||typeof library.list!=='function'||
    typeof library.detail!=='function'||typeof library.m3mGroup!=='function'||
    typeof headObject!=='function')
    throw new TypeError('Complete Pilot media library dependencies required');
  async function guarded(req,res,action,run){
    if(req.secure!==true)return error(res,403,'HTTPS required');
    if(req.params?.workspaceId!==workspace)return error(res,404,'Workspace not found');
    const token=req.headers?.['x-auth-token'];
    if(typeof token!=='string'||!token||token.length>TOKEN_MAX)
      return error(res,401,'Unauthorized');
    let principal;
    try{principal=await authorize(token);}
    catch(_err){return error(res,503,'Authorization unavailable');}
    if(!plain(principal)||!['operator','pilot'].includes(principal.role)||
      principal.workspaceId!==workspace)return error(res,403,'Forbidden');

    const recorded=async outcome=>audit({workspace,action,outcome});
    try{
      if(await allowRead({workspace,principal,operation:'library_'+action})!==true){
        await recorded('denied');
        return error(res,429,'Rate limit exceeded');
      }
    }catch(_err){return error(res,503,'Media library unavailable');}
    let result;
    try{result=await run(req);}
    catch(e){
      // Input errors are only used for malformed query fields or cursor, but
      // never send internal errors, SQL, AWS headers or client values.
      result=e instanceof TypeError?
        {status:400,outcome:'invalid',message:'Invalid library query'}:
        {status:503,outcome:'unavailable',message:'Media library unavailable'};
    }
    try{await recorded(result.outcome??'ok');}
    catch(_err){return error(res,503,'Media library audit unavailable');}
    if(result.status&&result.status!==200)
      return error(res,result.status,result.message);
    return ok(res,result.data);
  }
  return Object.freeze({
    list:(req,res)=>guarded(req,res,'list',async request=>{
      const q=request.query;
      if(!plain(q)||Object.keys(q).some(k=>!['limit','cursor'].includes(k)))
        throw new TypeError('Invalid query');
      const count=q.limit===undefined?30:typeof q.limit==='string'&&
        /^[1-9][0-9]?$|^100$/.test(q.limit)?Number(q.limit):null;
      if(count===null||q.cursor!==undefined&&
        (typeof q.cursor!=='string'||q.cursor.length>512))
        throw new TypeError('Invalid page');
      return {data:await library.list({workspace,limit:count,cursor:q.cursor??null})};
    }),
    detail:(req,res)=>guarded(req,res,'detail',async request=>{
      if(!plain(request.query??{})||Object.keys(request.query??{}).length)
        throw new TypeError('Invalid query');
      const result=await library.detail({
        workspace,id:request.params.assetId,headObject
      });
      if(result?.status==='not-found')return {status:404,outcome:'pending',
        message:'Media asset not found'};
      if(result?.status==='missing'||result?.status==='changed')
        return {status:409,outcome:'pending',message:'Stored media requires reconciliation'};
      if(result?.status!=='ok')throw new Error('Invalid library detail result');
      return {data:{item:result.item}};
    }),
    m3mGroup:(req,res)=>guarded(req,res,'m3m_group',async request=>{
      if(!plain(request.query??{})||Object.keys(request.query??{}).length)
        throw new TypeError('Invalid query');
      const result=await library.m3mGroup({
        workspace,groupId:request.params.groupId
      });
      if(result?.status==='not-found')return {status:404,outcome:'pending',
        message:'Verified media group not found'};
      if(result?.status==='limit-exceeded')
        return {status:413,outcome:'invalid',message:'Group inventory exceeds safe limit'};
      if(result?.status!=='ok')throw new Error('Invalid M3M group result');
      return {data:result.report};
    })
  });
}
function createPilotMediaLibraryRouter(config){
  const h=createPilotMediaLibraryHandlers(config);
  const router=express.Router();
  router.get(ROOT+'/assets',h.list);
  router.get(ROOT+'/assets/:assetId',h.detail);
  router.get(ROOT+'/groups/:groupId/m3m-hints',h.m3mGroup);
  return router;
}
module.exports={createPilotMediaLibraryHandlers,createPilotMediaLibraryRouter,ROOT};
