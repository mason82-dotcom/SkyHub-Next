'use strict';
// DJI Cloud API wayline file management for DJI Pilot 2 (HTTPS), modelled on
// third_party/dji-cloud-api-demo cloud-sdk IHttpWaylineService (PREFIX wayline/api/v1):
//   GET    /workspaces/{workspace_id}/waylines                 list (PaginationData)
//   GET    /workspaces/{workspace_id}/waylines/{id}/url        302 to a presigned object URL
//   GET    /workspaces/{workspace_id}/waylines/duplicate-names name uniqueness check
//   POST   /workspaces/{workspace_id}/upload-callback          Pilot 2 upload report
//   POST   /workspaces/{workspace_id}/favorites?id=…           favourite
//   DELETE /workspaces/{workspace_id}/favorites?id=…           unfavourite
// Read/download only towards the RC: SkyHub never creates a flight task here.
// Pilot 2 uploads: accepted only with an importUpload function (pilot-wayline-import.js: STS scope + HEAD evidence + full
// WPML validation, write-once store, never auto-released); without it they are refused with UPLOAD_DISABLED_CODE.
const express=require('express');

const PREFIX='/wayline/api/v1/workspaces/:workspaceId';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ORDER=/^(name|update_time|create_time) (asc|desc)$/;
const TOKEN_MAX=512;
// Code reported for a deliberately unsupported operation (not a DJI-defined value).
const UPLOAD_DISABLED_CODE=310001;

function envelope(res,status,code,message,data){
  res.set('Cache-Control','no-store');
  res.set('X-Content-Type-Options','nosniff');
  return res.status(status).json({code,message,data});
}
const ok=(res,data)=>envelope(res,200,0,'success',data);
const error=(res,status,message)=>envelope(res,status,status,message,{});
function values(raw){
  if(raw===undefined)return [];
  const list=Array.isArray(raw)?raw:[raw];
  if(list.length>100||list.some(v=>typeof v!=='string'||v.length>200))return null;
  // Pilot may send repeated parameters or a comma separated list.
  return list.flatMap(v=>v.split(',')).map(v=>v.trim()).filter(Boolean);
}

function createRedisFavorites(redis,prefix='skyhub:wpml:favorites:'){
  return {
    async list(workspace){return new Set(await redis.smembers(prefix+workspace));},
    async add(workspace,ids){if(ids.length)await redis.sadd(prefix+workspace,...ids);},
    async remove(workspace,ids){if(ids.length)await redis.srem(prefix+workspace,...ids);}
  };
}

function createDjiWaylineRouter({workspace,authorize,store,favorites,importUpload=null,log=m=>console.log(m)}){
  if(typeof workspace!=='string'||!UUID.test(workspace)||typeof authorize!=='function'||
     !store||typeof store.all!=='function'||typeof store.downloadUrl!=='function'||
     !favorites||typeof favorites.list!=='function')
    throw new TypeError('Complete DJI wayline dependencies required');
  const router=express.Router({mergeParams:true});

  async function guard(req,res){
    // req.secure is computed only for the explicitly trusted reverse proxy.
    if(req.secure!==true){error(res,403,'HTTPS required');return false;}
    if(req.params.workspaceId!==workspace){error(res,404,'Workspace not found');return false;}
    const token=req.headers['x-auth-token'];
    if(typeof token!=='string'||!token||token.length>TOKEN_MAX){error(res,401,'Unauthorized');return false;}
    let principal;
    try{principal=await authorize(token);}
    catch(_err){error(res,503,'Authorization unavailable');return false;}
    if(!principal||principal.role!=='pilot'||principal.workspaceId!==workspace){
      error(res,403,'Forbidden');return false;
    }
    req.pilotPrincipal=principal;
    return true;
  }
  const handle=fn=>async(req,res)=>{
    try{if(await guard(req,res))await fn(req,res);}
    catch(err){
      if(err&&err.status&&err.status<500)return error(res,err.status,err.message);
      // Never echo tokens, keys, URLs or storage errors.
      log('[pilot wayline] '+(err&&err.name||'error'));
      return error(res,503,'Wayline storage unavailable');
    }
  };

  router.get(PREFIX+'/waylines',handle(async(req,res)=>{
    const q=req.query||{};
    const page=q.page===undefined?1:Number(q.page);
    const pageSize=q.page_size===undefined?10:Number(q.page_size);
    if(!Number.isInteger(page)||page<1||!Number.isInteger(pageSize)||pageSize<1||pageSize>100)
      return error(res,400,'Invalid pagination');
    const order=typeof q.order_by==='string'&&q.order_by?q.order_by:'update_time desc';
    if(!ORDER.test(order))return error(res,400,'Invalid order_by');
    const types=values(q.template_type),drones=values(q.drone_model_keys),payloads=values(q.payload_model_key);
    if(!types||!drones||!payloads)return error(res,400,'Invalid filter');
    if(types.some(t=>!/^[0-3]$/.test(t)))return error(res,400,'Invalid template_type');
    const key=typeof q.key==='string'?q.key.slice(0,64):undefined;
    const favoriteFilter=q.favorited===undefined?null:q.favorited==='true'?true:q.favorited==='false'?false:undefined;
    if(favoriteFilter===undefined)return error(res,400,'Invalid favorited');
    const favored=await favorites.list(workspace);
    // Filter and sort over the full (bounded, cached) library, then paginate.
    const collected=(await store.all())
      .filter(w=>!key||(w.name||'').toLowerCase().includes(key.toLowerCase()))
      .filter(w=>!types.length||w.templateTypes.some(t=>types.includes(String(t))))
      .filter(w=>!drones.length||drones.includes(w.droneModelKey));
    let rows=collected.filter(w=>!payloads.length||w.payloadModelKeys.some(k=>payloads.includes(k)))
      .filter(w=>favoriteFilter===null||favored.has(w.id)===favoriteFilter);
    const [column,direction]=order.split(' ');
    const field=column==='name'?w=>w.name||'':w=>w.createTime||0;
    rows=rows.sort((a,b)=>{
      const x=field(a),y=field(b);
      const c=typeof x==='string'?x.localeCompare(y):x-y;
      return direction==='asc'?c:-c;
    });
    const list=rows.slice((page-1)*pageSize,page*pageSize).map(w=>({
      id:w.id,name:w.name,
      drone_model_key:w.droneModelKey,
      payload_model_keys:w.payloadModelKeys,
      template_types:w.templateTypes,
      sign:w.sign,
      favorited:favored.has(w.id),
      object_key:w.objectKey,
      user_name:w.username||'SkyHub',
      // Wayline files are write-once: update time equals creation time.
      update_time:w.createTime,
      create_time:w.createTime
    }));
    return ok(res,{list,pagination:{page,page_size:pageSize,total:rows.length}});
  }));

  router.get(PREFIX+'/waylines/duplicate-names',handle(async(req,res)=>{
    const names=values(req.query?.name);
    if(!names||!names.length)return error(res,400,'name required');
    return ok(res,await store.duplicateNames(names));
  }));

  router.get(PREFIX+'/waylines/:waylineId/url',handle(async(req,res)=>{
    if(!UUID.test(req.params.waylineId))return error(res,400,'Invalid wayline id');
    const url=await store.downloadUrl(req.params.waylineId,{expiresIn:600});
    res.set('Cache-Control','no-store');
    return res.redirect(302,url);
  }));

  router.post(PREFIX+'/upload-callback',handle(async(req,res)=>{
    // DJI: Pilot 2 uploads the KMZ via STS and reports it here.
    if(typeof importUpload!=='function')
      return envelope(res,200,UPLOAD_DISABLED_CODE,
        'Wayline upload from Pilot 2 is not enabled; upload via the SkyHub mission editor',{});
    try{
      const r=await importUpload(req.pilotPrincipal,req.body);
      log('[pilot wayline] imported '+r.id+(r.created?'':' (already stored)')+'; not visible in Pilot 2 until released');
      return ok(res,{});
    }catch(err){
      // Only import errors (pilotCode) are returned to Pilot 2; everything else goes to the generic handler.
      if(err&&Number.isSafeInteger(err.pilotCode)&&err.pilotCode!==0)return envelope(res,200,err.pilotCode,String(err.message).slice(0,200),{});
      throw err;
    }
  }));

  async function favoriteIds(req,res){
    const ids=values(req.query?.id);
    if(!ids||!ids.length||ids.some(id=>!UUID.test(id))){error(res,400,'Invalid id');return null;}
    return [...new Set(ids)];
  }
  router.post(PREFIX+'/favorites',handle(async(req,res)=>{
    const ids=await favoriteIds(req,res);if(!ids)return;
    for(const id of ids)await store.describe(id);
    await favorites.add(workspace,ids);
    return ok(res,{});
  }));
  router.delete(PREFIX+'/favorites',handle(async(req,res)=>{
    const ids=await favoriteIds(req,res);if(!ids)return;
    await favorites.remove(workspace,ids);
    return ok(res,{});
  }));
  return router;
}

module.exports={createDjiWaylineRouter,createRedisFavorites,UPLOAD_DISABLED_CODE};
