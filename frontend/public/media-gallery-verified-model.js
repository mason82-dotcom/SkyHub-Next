// Verified Pilot 2 media-library contract (PR #39), NOT the generic MinIO inventory.
// Fail closed: reject readiness or calibration claims not proven by the API.
(function(root){
'use strict';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const GROUP=/^[A-Za-z0-9_.:-]{1,128}$/;
const CURSOR=/^[A-Za-z0-9_-]{10,450}\.[A-Za-z0-9_-]{43}$/;
const HINTS=new Set(['RGB','G','R','RE','NIR',null]);
const SOURCES=new Set(['filename-only-unverified','none']);
const BAD='Ungültige Antwort der verifizierten Medienbibliothek';
function object(x){return x!==null&&typeof x==='object'&&!Array.isArray(x);}
function stamp(x){
  return typeof x==='string'&&x.length<=40&&Number.isFinite(Date.parse(x));
}
function readyFalse(x){
  if(!object(x)||x.m3mSourceVerified!==false||
     x.radiometricCalibrationVerified!==false||x.bandCoregistrationVerified!==false||
     x.reflectanceReady!==false||x.ndviReady!==false||x.ndreReady!==false||
     x.captureUuidConfirmed!==false)return false;
  return x.exif==='not-extracted'&&x.xmp==='not-extracted'&&x.rtk==='not-extracted';
}
function asset(x,status){
  if(!object(x)||!UUID.test(x.id)||typeof x.fileName!=='string'||
     !x.fileName||x.fileName.length>255||!Number.isSafeInteger(x.fileSizeBytes)||
     x.fileSizeBytes<=0||!stamp(x.verifiedAt)||
     !object(x.objectEvidence)||x.objectEvidence.status!==status||
     !stamp(x.objectEvidence.lastModified)||
     x.objectEvidence.sizeBytes!==x.fileSizeBytes||
     !HINTS.has(x.bandHint)||!SOURCES.has(x.hintSource)||
     !readyFalse(x.imageInspection)||!(x.fileGroupId===null||
       typeof x.fileGroupId==='string'&&GROUP.test(x.fileGroupId)))throw Error(BAD);
  if((x.bandHint===null)!==(x.hintSource==='none'))throw Error(BAD);
  return Object.freeze({
    id:x.id,name:x.fileName,bytes:x.fileSizeBytes,verifiedAt:x.verifiedAt,
    objectLastModified:x.objectEvidence.lastModified,
    fileGroupId:x.fileGroupId,bandHint:x.bandHint,hintSource:x.hintSource,
    evidence:status
  });
}
function envelope(response){
  if(!object(response)||response.code!==0||!object(response.data))throw Error(BAD);
  return response.data;
}
function libraryList(response,limit=20){
  if(!Number.isInteger(limit)||limit<1||limit>100)throw Error(BAD);
  const data=envelope(response);
  if(data.schema!=='skyhub-pilot-media-library-v1'||
     data.verification!=='s3-head-at-ingestion-not-rechecked'||
     !Array.isArray(data.items)||data.items.length>limit)throw Error(BAD);
  if(data.nextCursor!==null&&(typeof data.nextCursor!=='string'||!CURSOR.test(data.nextCursor)))throw Error(BAD);
  const items=data.items.map(x=>asset(x,'head-at-ingestion'));
  if(new Set(items.map(x=>x.id)).size!==items.length)throw Error(BAD);
  if(data.nextCursor&&items.length!==limit)throw Error(BAD);
  return {items,nextCursor:data.nextCursor};
}
function detail(response,expectedId){
  if(!UUID.test(expectedId))throw Error(BAD);
  const data=envelope(response);
  if(!object(data.item)||data.item.id!==expectedId)throw Error(BAD);
  return asset(data.item,'head-rechecked');
}
function group(response){
  const d=envelope(response),fields=[
    'examined','sessionPartitions','classified','unrecognized','invalid',
    'captureGroups','spectralSets','fiveChannelSets','partialSets','duplicateSets'
  ];
  if(d.schema!=='skyhub-m3m-library-hints-v1'||d.classification!=='filename-hints-only'||
     !object(d.bandCounts)||!Object.keys(d.bandCounts).every(k=>['RGB','G','R','RE','NIR'].includes(k))||
     Object.keys(d.bandCounts).length!==5||
     d.captureUuidVerified!==false||d.exifVerified!==false||d.xmpVerified!==false||
     d.bandCoregistrationVerified!==false||d.radiometricCalibrationVerified!==false||
     d.reflectanceReady!==false||d.ndviReady!==false||d.ndreReady!==false)throw Error(BAD);
  if(fields.some(k=>!Number.isSafeInteger(d[k])||d[k]<0||d[k]>5000)||
     Object.values(d.bandCounts).some(v=>!Number.isSafeInteger(v)||v<0||v>5000))throw Error(BAD);
  return {examined:d.examined,sessionPartitions:d.sessionPartitions,
    spectralSets:d.spectralSets,fiveChannelSets:d.fiveChannelSets,
    bands:Object.freeze({...d.bandCounts}),classification:d.classification};
}
const api=Object.freeze({UUID,GROUP,CURSOR,libraryList,detail,group});
if(typeof module==='object'&&module.exports)module.exports=api;
if(root)root.SkyhubVerifiedMediaModel=api;
})(typeof window==='object'?window:null);
