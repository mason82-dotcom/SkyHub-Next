'use strict';

// DJI Pilot 2 media-upload contract (pilot-to-cloud, media management).
// Pure request validators and response builders. NOT imported by server.js:
// there is no HTTP route, no storage write and no credential issuance here.
// A future route needs an authenticated workspace principal, an audited store
// and a reviewed STS provider; see docs/dji-media-upload-contract.md.
const {serial}=require('./dji');

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FINGERPRINT=/^[A-Za-z0-9_.-]{1,128}$/;
const FILE_GROUP=/^[A-Za-z0-9_.:-]{1,128}$/;
const MODEL_KEY=/^[A-Za-z0-9_.:-]{1,64}$/;
const MAX_TINY_FINGERPRINTS=500;
const MAX_NAME=255;
const MAX_PATH=1024;
const MAX_KEY=1024;
const MAX_STS_SECONDS=3600;
const STS_PROVIDERS=Object.freeze(['ali','aws','minio']);

function isObject(value){
  return value!==null&&typeof value==='object'&&!Array.isArray(value);
}
function text(value,max,{required=false}={}){
  if(value===undefined||value===null)return required?undefined:null;
  if(typeof value!=='string'||!value.length||value.length>max||
    /[\u0000-\u001f\u007f]/.test(value))return undefined;
  return value;
}
// Object keys and business paths: relative, no traversal, no empty segments.
function relativePath(value,max,options){
  const result=text(value,max,options);
  if(!result)return result;
  if(result.startsWith('/')||result.includes('\\')||
    result.split('/').some(part=>part===''||part==='.'||part==='..'))return undefined;
  return result;
}
function fingerprint(value,{required=false}={}){
  if(value===undefined||value===null)return required?undefined:null;
  return typeof value==='string'&&FINGERPRINT.test(value)?value:undefined;
}
function bool(value){
  if(value===undefined||value===null)return null;
  return typeof value==='boolean'?value:undefined;
}
function coordinate(value,limit){
  return Number.isFinite(value)&&Math.abs(value)<=limit?value:undefined;
}

function fileExtension(input){
  if(input===undefined||input===null)return {};
  if(!isObject(input))return undefined;
  const out={};
  const fields=[
    ['file_group_id',text(input.file_group_id,128),FILE_GROUP],
    ['drone_model_key',text(input.drone_model_key,64),MODEL_KEY],
    ['payload_model_key',text(input.payload_model_key,64),MODEL_KEY]
  ];
  for(const [name,value,pattern] of fields){
    if(value===undefined||(value!==null&&!pattern.test(value)))return undefined;
    if(value!==null)out[name]=value;
  }
  const tiny=fingerprint(input.tinny_fingerprint);
  const original=bool(input.is_original);
  if(tiny===undefined||original===undefined)return undefined;
  if(tiny!==null)out.tinny_fingerprint=tiny;
  if(original!==null)out.is_original=original;
  if(input.sn!==undefined&&input.sn!==null){
    const sn=serial(input.sn);
    if(!sn)return undefined;
    out.sn=sn;
  }
  return out;
}

function workspaceId(value){
  return typeof value==='string'&&UUID.test(value)?value:null;
}

// POST .../files/tiny-fingerprints
function parseTinyFingerprintRequest(body){
  if(!isObject(body)||!Array.isArray(body.tiny_fingerprints)||
    body.tiny_fingerprints.length>MAX_TINY_FINGERPRINTS)return null;
  const seen=new Set();
  for(const item of body.tiny_fingerprints){
    if(fingerprint(item,{required:true})===undefined)return null;
    seen.add(item);
  }
  return {tinyFingerprints:[...seen]};
}

// POST .../fast-upload
function parseFastUploadRequest(body){
  if(!isObject(body))return null;
  const print=fingerprint(body.fingerprint,{required:true});
  const name=text(body.name,MAX_NAME);
  const path=relativePath(body.path,MAX_PATH);
  const ext=fileExtension(body.ext);
  if(print===undefined||name===undefined||path===undefined||ext===undefined)return null;
  return {fingerprint:print,name,path,ext};
}

// POST .../upload-callback
function parseUploadCallback(body){
  if(!isObject(body)||!Number.isSafeInteger(body.result)||body.result<0)return null;
  const name=text(body.name,MAX_NAME,{required:true});
  const objectKey=relativePath(body.object_key,MAX_KEY,{required:true});
  const print=fingerprint(body.fingerprint);
  const path=relativePath(body.path,MAX_PATH);
  const ext=fileExtension(body.ext);
  if(name===undefined||objectKey===undefined||print===undefined||
    path===undefined||ext===undefined)return null;
  let subFileType=null;
  if(body.sub_file_type!==undefined){
    if(![0,1].includes(body.sub_file_type))return null;
    subFileType=body.sub_file_type;
  }
  let metadata=null;
  if(body.metadata!==undefined&&body.metadata!==null){
    const m=body.metadata;
    if(!isObject(m))return null;
    metadata={};
    for(const [key,value] of [
      ['absolute_altitude',m.absolute_altitude],
      ['relative_altitude',m.relative_altitude],
      ['gimbal_yaw_degree',m.gimbal_yaw_degree]
    ]){
      if(value===undefined||value===null)continue;
      if(!Number.isFinite(value)||Math.abs(value)>100000)return null;
      metadata[key]=value;
    }
    if(m.created_time!==undefined&&m.created_time!==null){
      const created=text(m.created_time,64);
      if(!created||!Number.isFinite(Date.parse(created)))return null;
      metadata.created_time=created;
    }
    if(m.shoot_position!==undefined&&m.shoot_position!==null){
      const p=m.shoot_position;
      if(!isObject(p))return null;
      const lat=coordinate(p.lat,90),lng=coordinate(p.lng,180);
      if(lat===undefined||lng===undefined)return null;
      // DJI documents 0/0 as "no position"; it is not stored as a location.
      if(!(lat===0&&lng===0))metadata.shoot_position={lat,lng};
    }
  }
  return {
    uploaded:body.result===0,result:body.result,name,objectKey,
    fingerprint:print,path,ext,subFileType,metadata
  };
}

// POST .../group-upload-callback
function parseGroupUploadCallback(body){
  if(!isObject(body))return null;
  const group=body.file_group_id;
  if(group!==undefined&&group!==null&&
    (typeof group!=='string'||!FILE_GROUP.test(group)))return null;
  const {file_count:count,file_uploaded_count:uploaded}=body;
  if(!Number.isSafeInteger(count)||count<0||
    !Number.isSafeInteger(uploaded)||uploaded<0||uploaded>count)return null;
  return {fileGroupId:group??null,fileCount:count,fileUploadedCount:uploaded};
}

// An uploaded object must live under the prefix the server issued for this workspace.
function objectKeyUnderPrefix(objectKey,prefix){
  const key=relativePath(objectKey,MAX_KEY,{required:true});
  const base=relativePath(prefix,MAX_KEY,{required:true});
  return Boolean(key&&base&&key.startsWith(base+'/')&&key.length>base.length+1);
}

function okEnvelope(data={}){return {code:0,message:'success',data};}
function errorEnvelope(code,message){
  if(!Number.isSafeInteger(code)||code===0)throw new TypeError('Error code required');
  return {code,message:String(message).slice(0,200),data:{}};
}
function tinyFingerprintResponse(existing){
  if(!Array.isArray(existing)||existing.length>MAX_TINY_FINGERPRINTS||
    existing.some(item=>fingerprint(item,{required:true})===undefined)){
    throw new TypeError('Invalid tiny fingerprint list');
  }
  return okEnvelope({tiny_fingerprints:[...new Set(existing)]});
}
function uploadCallbackResponse(objectKey){
  const key=relativePath(objectKey,MAX_KEY,{required:true});
  if(!key)throw new TypeError('Invalid object key');
  return okEnvelope({object_key:key});
}

// Future STS provider output. Static, long-lived or over-broad credentials are
// refused here so that a provider bug cannot hand them to a remote controller.
function stsResponse(grant,{workspace}={}){
  if(!workspaceId(workspace)||!isObject(grant)||!isObject(grant.credentials))
    throw new TypeError('Invalid STS grant');
  const c=grant.credentials;
  const prefix=relativePath(grant.objectKeyPrefix,MAX_KEY,{required:true});
  const bucket=text(grant.bucket,63,{required:true});
  const region=text(grant.region,64,{required:true});
  let endpoint;
  try{endpoint=new URL(grant.endpoint);}catch(_err){throw new TypeError('Invalid STS endpoint');}
  if(!prefix||!bucket||!region||endpoint.protocol!=='https:'||endpoint.username||endpoint.password||
    !STS_PROVIDERS.includes(grant.provider)||
    !prefix.split('/').includes(workspace)||
    typeof c.accessKeyId!=='string'||!c.accessKeyId||
    typeof c.accessKeySecret!=='string'||!c.accessKeySecret||
    typeof c.securityToken!=='string'||!c.securityToken||
    !Number.isSafeInteger(c.expire)||c.expire<=0||c.expire>MAX_STS_SECONDS){
    throw new TypeError('Invalid STS grant');
  }
  return okEnvelope({
    bucket,
    credentials:{
      access_key_id:c.accessKeyId,
      access_key_secret:c.accessKeySecret,
      expire:c.expire,
      security_token:c.securityToken
    },
    endpoint:endpoint.origin,
    object_key_prefix:prefix,
    provider:grant.provider,
    region
  });
}

module.exports={
  parseTinyFingerprintRequest,parseFastUploadRequest,parseUploadCallback,
  parseGroupUploadCallback,objectKeyUnderPrefix,okEnvelope,errorEnvelope,
  tinyFingerprintResponse,uploadCallbackResponse,stsResponse,workspaceId,
  MAX_TINY_FINGERPRINTS,STS_PROVIDERS
};
