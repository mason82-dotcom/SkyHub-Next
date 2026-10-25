// Data contract for the existing read-only SkyHub MinIO API. No sensor/EXIF inference.
(function(root){
'use strict';
const ALLOWED_BUCKETS=Object.freeze(['basemaps','dji-cloud','farming','mapping-results','pv-inspections']);
function buckets(input){
  if(!input||!Array.isArray(input.buckets)||input.buckets.length>ALLOWED_BUCKETS.length)throw Error('Invalid bucket response');
  const result=input.buckets;
  if(result.some(x=>!ALLOWED_BUCKETS.includes(x))||new Set(result).size!==result.length)throw Error('Invalid bucket response');
  return result;
}
function page(input,{bucket,prefix='',cursor=null,limit=50}={}){
  if(!ALLOWED_BUCKETS.includes(bucket)||typeof prefix!=='string'||prefix.length>512||
     !Number.isInteger(limit)||limit<1||limit>200)throw Error('Invalid request');
  if(!input||input.bucket!==bucket||input.prefix!==prefix||!Array.isArray(input.objects)||
     input.objects.length>limit||typeof input.truncated!=='boolean')throw Error('Invalid object response');
  const items=input.objects.map(x=>{
    if(!x||typeof x.key!=='string'||!x.key||x.key.length>2048||
       !Number.isSafeInteger(x.size)||x.size<0)throw Error('Invalid object response');
    if(x.lastModified!==null&&x.lastModified!==undefined&&typeof x.lastModified!=='string')throw Error('Invalid object response');
    return {name:x.key.replace(/[\u0000-\u001f\u007f]/g,'�'),
      bytes:x.size,modified:x.lastModified||null};
  });
  const nextCursor=input.nextCursor;
  if(input.truncated&&(typeof nextCursor!=='string'||!nextCursor||nextCursor.length>4096||
     nextCursor===cursor))throw Error('Invalid pagination response');
  if(!input.truncated&&nextCursor!==null&&nextCursor!==undefined)throw Error('Invalid pagination response');
  return {items,truncated:input.truncated,nextCursor:input.truncated?nextCursor:null};
}
function size(bytes){
  if(!Number.isSafeInteger(bytes)||bytes<0)return '—';
  if(bytes<1024)return bytes+' B';
  const units=['KiB','MiB','GiB','TiB'];
  let number=bytes,i=-1;
  do{number/=1024;i++;}while(number>=1024&&i<units.length-1);
  return new Intl.NumberFormat('de-DE',{maximumFractionDigits:1}).format(number)+' '+units[i];
}
function date(value){
  if(typeof value!=='string'||!value||!Number.isFinite(Date.parse(value)))return '—';
  return new Date(value).toLocaleString('de-DE');
}
const api=Object.freeze({ALLOWED_BUCKETS,buckets,page,size,date});
if(typeof module==='object'&&module.exports)module.exports=api;
if(root)root.SkyhubMediaModel=api;
})(typeof window==='object'?window:null);
