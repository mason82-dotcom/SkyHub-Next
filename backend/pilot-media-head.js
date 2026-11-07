'use strict';

// Read-only S3 HEAD verifier for the DJI Pilot 2 ingest pipeline.
// Construct with a separately authenticated, server-side read identity.
// Do NOT use the controller's PutObject-only STS token for HEAD.
const {HeadObjectCommand}=require('@aws-sdk/client-s3');

function createPilotMediaHead(s3){
  if(!s3||typeof s3.send!=='function')
    throw new TypeError('Read-only S3 client required');
  return async function headObject({bucket,key}={}){
    if(bucket!=='dji-cloud'||typeof key!=='string'||key.length<1||key.length>1024)
      throw new TypeError('Invalid Pilot media object lookup');
    try{
      const response=await s3.send(new HeadObjectCommand({Bucket:bucket,Key:key}));
      if(!response||!Number.isSafeInteger(response.ContentLength)||
        response.ContentLength<=0||!(response.LastModified instanceof Date)||
        Number.isNaN(response.LastModified.getTime())||!response.ETag)
        return null;
      return {size:response.ContentLength,etag:response.ETag,
        lastModified:response.LastModified};
    }catch(err){
      if(['NotFound','NoSuchKey','NoSuchObject'].includes(err?.name)||
         err?.$metadata?.httpStatusCode===404)return null;
      // Do not downgrade AccessDenied, expired credentials or network errors
      // to a false "missing" response.
      throw new Error('Pilot media HEAD verification unavailable');
    }
  };
}

module.exports={createPilotMediaHead};
