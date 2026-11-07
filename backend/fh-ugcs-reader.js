'use strict';
const RESOURCES=new Set(['health','vehicles','routes','telemetry']);
const VISIBLE=new Set(['id','name','type','model','status','latitude','longitude',
 'altitude','connected','routeId','vehicleId','timestamp']);
function internalHost(h){
 return h==='localhost'||h==='127.0.0.1'||h==='[::1]'||
 /^10\.(?:\d{1,3}\.){2}\d{1,3}$/.test(h)||
 /^192\.168\.\d{1,3}\.\d{1,3}$/.test(h)||
 /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(h)||
 h==='ugcs-bridge';
}
function createFhUgcsReader({baseUrl='',fetchImpl=globalThis.fetch,timeoutMs=3000}={}){
 let base=null;
 if(baseUrl){
  const u=new URL(baseUrl);
  if(!['http:','https:'].includes(u.protocol)||!internalHost(u.hostname)||
    u.username||u.password||u.search||u.hash||u.pathname!=='/')
   throw new Error('UGCS bridge URL must be internal and credential-free');
  base=u;
 }
 async function read(resource){
  if(!base)return {status:503,data:{error:'ugcs_disabled'}};
  if(!RESOURCES.has(resource))return {status:404,data:{error:'unknown_resource'}};
  try{
   const response=await fetchImpl(new URL(resource,base),{
    method:'GET',redirect:'error',signal:AbortSignal.timeout(timeoutMs),
    headers:{accept:'application/json'}
   });
   if(!response.ok)return {status:503,data:{error:'ugcs_unavailable'}};
   const body=await response.text();
   if(body.length>65536)return {status:502,data:{error:'ugcs_response_too_large'}};
   const data=JSON.parse(body);
   const src=Array.isArray(data)?data:Array.isArray(data?.[resource])?data[resource]:
     data&&typeof data==='object'?[data]:[];
   const records=src.slice(0,32).map(item=>{
    const out={};
    if(!item||typeof item!=='object'||Array.isArray(item))return out;
    for(const [k,v] of Object.entries(item)){
     if(!VISIBLE.has(k))continue;
     if(typeof v==='boolean'||typeof v==='number'&&Number.isFinite(v))out[k]=v;
     else if(typeof v==='string'&&v.length<=128)out[k]=v;
    }
    return out;
   });
   return {status:200,data:{source:'ugcs',resource,readOnly:true,records}};
  }catch(_err){return {status:503,data:{error:'ugcs_unavailable'}};}
 }
 return Object.freeze({enabled:!!base,read});
}
module.exports={createFhUgcsReader};
