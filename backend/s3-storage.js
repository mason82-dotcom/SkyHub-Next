'use strict';

const {
  S3Client,
  HeadBucketCommand,
  ListObjectsV2Command,
  GetObjectCommand
}=require('@aws-sdk/client-s3');
const {createPilotMediaHead}=require('./pilot-media-head');

const BUCKETS=Object.freeze([
  'basemaps',
  'dji-cloud',
  'farming',
  'mapping-results',
  'pv-inspections'
]);

function createS3Storage(env=process.env,client){
  const endpoint=env.SKYHUB_S3_ENDPOINT;
  const accessKeyId=env.SKYHUB_S3_ACCESS_KEY;
  const secretAccessKey=env.SKYHUB_S3_SECRET_KEY;

  if(!client && (!endpoint || !accessKeyId || !secretAccessKey)){
    throw new Error('S3 configuration incomplete');
  }

  const s3=client || new S3Client({
    endpoint,
    region:'us-east-1',
    forcePathStyle:true,
    credentials:{accessKeyId,secretAccessKey},
    maxAttempts:2
  });

  async function buckets(){
    const available=[];
    for(const name of BUCKETS){
      try{
        await s3.send(new HeadBucketCommand({Bucket:name}));
        available.push(name);
      }catch(err){
        if(err.$metadata?.httpStatusCode===404 ||
           err.name==='NotFound' ||
           err.name==='NoSuchBucket'){
          continue;
        }
        throw err;
      }
    }
    return available;
  }

  function invalid(message){
    const err=new Error(message);
    err.status=400;
    return err;
  }
  function validKey(key){
    return typeof key==='string'&&key.length>0&&key.length<=1024&&
      !/[\x00-\x1f\x7f]/.test(key);
  }

  async function objects(bucket,{prefix='',limit=100,cursor,delimiter}={}){
    if(!BUCKETS.includes(bucket)){
      const err=new Error('Invalid bucket');
      err.status=400;
      throw err;
    }
    if(typeof prefix!=='string' || prefix.length>512 ||
       !Number.isInteger(limit) || limit<1 || limit>200 ||
       (cursor!==undefined &&
        (typeof cursor!=='string' || cursor.length>4096)) ||
       (delimiter!==undefined && delimiter!=='/')){
      throw invalid('Invalid query');
    }

    const result=await s3.send(new ListObjectsV2Command({
      Bucket:bucket,
      Prefix:prefix,
      MaxKeys:limit,
      ...(delimiter?{Delimiter:delimiter}:{}),
      ...(cursor?{ContinuationToken:cursor}:{})
    }));

    // Fail closed: a missing IsTruncated flag must not appear as a complete
    // listing, and an invalid token must not silently end pagination.
    const entries=result?.Contents??[];
    if(!result||typeof result.IsTruncated!=='boolean'||
       !Array.isArray(entries)||entries.length>limit||
       (result.CommonPrefixes!==undefined&&!Array.isArray(result.CommonPrefixes))||
       (result.IsTruncated &&
         (typeof result.NextContinuationToken!=='string'||
          !result.NextContinuationToken||
          result.NextContinuationToken.length>4096||
          /[\x00-\x1f\x7f]/.test(result.NextContinuationToken)))||
       (!result.IsTruncated&&Boolean(result.NextContinuationToken))){
      throw new Error('Invalid S3 listing response');
    }
    const seen=new Set();
    const objects=entries.map(item=>{
      const key=item?.Key;
      if(typeof key!=='string'||key.length>1024||
         !key.startsWith(prefix)||/[\x00-\x1f\x7f]/.test(key)||
         seen.has(key)||
         (item.Size!==undefined&&
           (!Number.isSafeInteger(item.Size)||item.Size<0))){
        throw new Error('Invalid S3 listing object');
      }
      seen.add(key);
      return {
        key,size:item.Size,
        lastModified:item.LastModified?.toISOString?.()||null,
        etag:item.ETag||null
      };
    });

    const folders=(result.CommonPrefixes||[]).map(item=>item?.Prefix)
      .filter(name=>typeof name==='string'&&name.startsWith(prefix)&&
        name.length<=1024&&!/[\x00-\x1f\x7f]/.test(name));

    return {
      bucket,prefix,objects,
      ...(delimiter?{folders}:{}),
      truncated:result.IsTruncated,
      nextCursor:result.IsTruncated?result.NextContinuationToken:null
    };
  }

  // Read-only object payload (optionally a byte range) for the LAN media viewer.
  async function getObject(bucket,key,{range}={}){
    if(!BUCKETS.includes(bucket))throw invalid('Invalid bucket');
    if(!validKey(key))throw invalid('Invalid key');
    if(range!==undefined&&(typeof range!=='string'||!/^bytes=\d{0,15}-\d{0,15}$/.test(range)||range==='bytes=-')){
      throw invalid('Invalid range');
    }
    try{
      const result=await s3.send(new GetObjectCommand({
        Bucket:bucket,Key:key,...(range?{Range:range}:{})
      }));
      return {
        body:result.Body,
        contentLength:result.ContentLength,
        contentRange:result.ContentRange||null,
        etag:result.ETag||null,
        lastModified:result.LastModified?.toUTCString?.()||null
      };
    }catch(err){
      const code=err.$metadata?.httpStatusCode;
      if(code===404||err.name==='NoSuchKey'||err.name==='NotFound'){
        const missing=new Error('Not found');
        missing.status=404;
        throw missing;
      }
      if(code===416||err.name==='InvalidRange'){
        const bad=new Error('Range not satisfiable');
        bad.status=416;
        throw bad;
      }
      throw err;
    }
  }

  return {buckets,objects,getObject,headObject:createPilotMediaHead(s3)};
}

module.exports={createS3Storage,BUCKETS};
