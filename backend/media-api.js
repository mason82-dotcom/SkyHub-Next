'use strict';

const express=require('express');
const {
  inventoryM3MFromS3
}=require('./m3m-s3-inventory');
const {
  extension,contentType,inline,exifThumbnail,createLru
}=require('./media-preview');
const {readKmz,inspectKmz}=require('./wpml-kmz');
const {FIXED}=require('./wpml-product-support');

const INDEX_TTL_MS=120000;
const INDEX_MAX_OBJECTS=100000;
const THUMB_PROBE_BYTES=262144;
const MISSION_MAX_BYTES=8*1024*1024;
const KINDS=Object.freeze({
  image:new Set(['jpg','jpeg','png','webp','gif']),
  tiff:new Set(['tif','tiff']),
  video:new Set(['mp4','mov','m4v'])
});
function kindOf(key){
  const ext=extension(key);
  for(const [kind,set] of Object.entries(KINDS))if(set.has(ext))return kind;
  return 'other';
}
async function collect(stream,limit){
  const chunks=[];let size=0;
  for await(const chunk of stream){
    chunks.push(chunk);size+=chunk.length;
    if(size>=limit)break;
  }
  if(typeof stream.destroy==='function')stream.destroy();
  return Buffer.concat(chunks).subarray(0,limit);
}

// labels (optional): async () => Map(objectKey -> {fileName, capturedAt}) for Pilot 2 uploads,
// whose objects are stored as org_<fingerprint>_<ms>.jpg while the DJI file name lives in PostgreSQL.
function createMediaRouter(storage,{now=()=>Date.now(),labels=null}={}){
  const router=express.Router();
  const indexes=new Map();
  const thumbs=createLru(4000);

  // Complete, cached object list of one bucket (all pages of ListObjectsV2).
  function bucketIndex(bucket){
    const cached=indexes.get(bucket);
    if(cached&&(cached.pending||now()-cached.at<INDEX_TTL_MS))return cached.promise;
    const entry={at:now(),pending:true};
    entry.promise=(async()=>{
      const objects=[];let cursor;
      do{
        const page=await storage.objects(bucket,{limit:200,cursor});
        objects.push(...page.objects);
        if(objects.length>INDEX_MAX_OBJECTS){
          const err=new Error('Index limit exceeded');err.status=413;throw err;
        }
        cursor=page.nextCursor||undefined;
      }while(cursor);
      if(bucket==='dji-cloud'&&typeof labels==='function'){
        try{
          const known=await labels();
          for(const item of objects){
            const label=known.get(item.key);
            if(label){item.displayName=label.fileName;if(label.capturedAt)item.capturedAt=label.capturedAt;}
          }
        }catch(_err){/* names are a convenience; the listing stays complete without them */}
      }
      return {bucket,objects,scannedAt:new Date(now()).toISOString()};
    })();
    entry.promise.then(()=>{entry.pending=false;entry.at=now();},
      ()=>indexes.delete(bucket));
    indexes.set(bucket,entry);
    return entry.promise;
  }
  function summarize(index){
    const kinds={image:0,tiff:0,video:0,other:0};
    let bytes=0,latest=null;
    for(const item of index.objects){
      kinds[kindOf(item.key)]++;
      bytes+=item.size||0;
      if(item.lastModified&&(!latest||item.lastModified>latest))latest=item.lastModified;
    }
    return {bucket:index.bucket,objects:index.objects.length,bytes,kinds,
      lastModified:latest,scannedAt:index.scannedAt};
  }
  function storageError(res,err){
    const status=[400,404,413,416].includes(err.status)?err.status:503;
    res.status(status).json({error:{400:'Invalid query',404:'Not found',
      413:'Index limit exceeded',416:'Range not satisfiable'}[status]||'Storage unavailable'});
  }

  router.get('/status',async(req,res)=>{
    try{
      const buckets=await storage.buckets();
      res.json({status:'online',readOnly:true,bucketCount:buckets.length});
    }catch(_err){
      res.status(503).json({status:'unavailable',readOnly:true});
    }
  });

  router.get('/buckets',async(req,res)=>{
    try{
      res.json({buckets:await storage.buckets()});
    }catch(_err){
      res.status(503).json({error:'Storage unavailable'});
    }
  });

  router.get('/objects',async(req,res)=>{
    const {bucket,prefix='',limit='100',cursor,delimiter}=req.query;
    if(typeof bucket!=='string' ||
       typeof prefix!=='string' ||
       typeof limit!=='string' ||
       !/^[1-9]\d{0,2}$/.test(limit) ||
       (cursor!==undefined && typeof cursor!=='string') ||
       (delimiter!==undefined && delimiter!=='/')){
      return res.status(400).json({error:'Invalid query'});
    }

    try{
      res.json(await storage.objects(bucket,{
        prefix,limit:Number(limit),cursor,
        ...(delimiter?{delimiter}:{})
      }));
    }catch(err){
      res.status(err.status===400?400:503).json({
        error:err.status===400?'Invalid query':'Storage unavailable'
      });
    }
  });

  // Overview of every available bucket: object count, bytes and media kinds.
  router.get('/summary',async(req,res)=>{
    try{
      const names=await storage.buckets();
      const buckets=[];
      for(const name of names)buckets.push(summarize(await bucketIndex(name)));
      res.json({buckets});
    }catch(err){storageError(res,err);}
  });

  // Every object of one bucket in a single response, for complete client-side browsing.
  router.get('/index',async(req,res)=>{
    const {bucket}=req.query;
    if(typeof bucket!=='string')return res.status(400).json({error:'Invalid query'});
    try{
      if(!(await storage.buckets()).includes(bucket)){
        return res.status(404).json({error:'Not found'});
      }
      const index=await bucketIndex(bucket);
      res.json({...summarize(index),items:index.objects});
    }catch(err){storageError(res,err);}
  });

  // Object payload: inline for images/videos/PDF, otherwise as download. Range requests
  // are passed to MinIO so videos can seek without loading the whole file.
  router.get('/file',async(req,res)=>{
    const {bucket,key,download}=req.query;
    if(typeof bucket!=='string'||typeof key!=='string'||
       (download!==undefined&&download!=='1')){
      return res.status(400).json({error:'Invalid query'});
    }
    const range=typeof req.headers.range==='string'?req.headers.range:undefined;
    let object;
    try{
      object=await storage.getObject(bucket,key,
        range&&/^bytes=\d{0,15}-\d{0,15}$/.test(range)?{range}:{});
    }catch(err){return storageError(res,err);}
    const name=key.split('/').pop()||'download';
    const disposition=download||!inline(key)?'attachment':'inline';
    res.status(object.contentRange?206:200);
    res.set({
      'Content-Type':contentType(key),
      'Content-Disposition':disposition+'; filename*=UTF-8\'\''+encodeURIComponent(name),
      'Accept-Ranges':'bytes',
      'Cache-Control':'private, max-age=3600',
      'Content-Security-Policy':"default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox"
    });
    if(Number.isSafeInteger(object.contentLength))res.set('Content-Length',String(object.contentLength));
    if(object.contentRange)res.set('Content-Range',object.contentRange);
    if(object.etag)res.set('ETag',object.etag);
    if(object.lastModified)res.set('Last-Modified',object.lastModified);
    const body=object.body;
    res.on('close',()=>{if(typeof body?.destroy==='function')body.destroy();});
    if(typeof body?.pipe!=='function')return res.end();
    body.on('error',()=>res.destroy());
    body.pipe(res);
  });

  // Small JPEG preview from the EXIF thumbnail; 404 lets the browser fall back to /file.
  router.get('/thumb',async(req,res)=>{
    const {bucket,key}=req.query;
    if(typeof bucket!=='string'||typeof key!=='string'){
      return res.status(400).json({error:'Invalid query'});
    }
    if(!['jpg','jpeg'].includes(extension(key))){
      return res.status(404).json({error:'No thumbnail'});
    }
    const cacheKey=bucket+'\n'+key;
    let thumb=thumbs.get(cacheKey);
    if(thumb===undefined){
      try{
        const object=await storage.getObject(bucket,key,{range:'bytes=0-'+(THUMB_PROBE_BYTES-1)});
        thumb=exifThumbnail(await collect(object.body,THUMB_PROBE_BYTES));
      }catch(err){return storageError(res,err);}
      thumbs.set(cacheKey,thumb);
    }
    if(!thumb)return res.status(404).json({error:'No thumbnail'});
    res.set({'Content-Type':'image/jpeg','Cache-Control':'private, max-age=86400',
      'Content-Length':String(thumb.length)});
    res.end(thumb);
  });

  // Read-only mission analysis of a KMZ (WPML 1.0.2, or 1.0.6 as analysis only): aircraft,
  // template types, waypoints, errors (e.g. aircraft/camera mismatch) and warnings.
  router.get('/mission',async(req,res)=>{
    const {bucket,key}=req.query;
    if(typeof bucket!=='string'||typeof key!=='string'||extension(key)!=='kmz'){
      return res.status(400).json({error:'Invalid query'});
    }
    let buffer;
    try{
      const object=await storage.getObject(bucket,key);
      if(Number.isSafeInteger(object.contentLength)&&object.contentLength>MISSION_MAX_BYTES){
        object.body?.destroy?.();
        return res.status(413).json({error:'Mission file too large'});
      }
      buffer=await collect(object.body,MISSION_MAX_BYTES+1);
      if(buffer.length>MISSION_MAX_BYTES)return res.status(413).json({error:'Mission file too large'});
    }catch(err){return storageError(res,err);}
    try{
      const report=inspectKmz(buffer);
      const {template}=readKmz(buffer);
      const num=name=>{const m=new RegExp('<wpml:'+name+'>\\s*(\\d+)\\s*<').exec(template);return m?Number(m[1]):null;};
      const drone=num('droneEnumValue'),sub=num('droneSubEnumValue'),payload=num('payloadEnumValue');
      const declared=FIXED[drone+':'+sub]||null;
      const camera=Object.entries(FIXED).find(([,p])=>p.payload===payload);
      const created=num('createTime');
      res.json({
        wpmlVersion:report.wpmlVersion||null,readOnlyAnalysis:Boolean(report.readOnlyAnalysis),
        valid:report.valid,flightReady:false,
        aircraft:{drone:drone===null?null:drone+'-'+sub,model:declared?.model||null,
          payload,payloadModel:camera?camera[1].model:null,
          consistent:declared?declared.payload===payload:null},
        createdAt:created&&created>1e12?new Date(created).toISOString():null,
        templates:report.templates,waylines:report.waylines,resourceCount:report.resourceCount,
        errors:report.errors.slice(0,20).map(e=>({path:e.path,message:e.message})),
        errorCount:report.errors.length,warnings:report.warnings.slice(0,20)
      });
    }catch(_err){
      res.status(422).json({error:'Not a readable DJI WPML mission'});
    }
  });

  router.get('/m3m/inventory',async(req,res)=>{
    const {prefix}=req.query;

    if(typeof prefix!=='string'){
      return res.status(400).json({
        error:'Invalid inventory prefix'
      });
    }

    try{
      const report=await inventoryM3MFromS3(
        storage,prefix
      );
      res.json(report);
    }catch(err){
      const status=err.status===400?400:
        err.status===413?413:503;

      res.status(status).json({
        error:status===400?'Invalid inventory prefix':
          status===413?'Inventory limit exceeded':
          'Storage unavailable'
      });
    }
  });

  return router;
}

module.exports={createMediaRouter};
