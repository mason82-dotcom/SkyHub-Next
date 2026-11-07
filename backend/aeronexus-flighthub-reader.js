'use strict';
// P3 independent opt-in FlightHub 2 GET-only reader; NEVER mounted in main backend.
// FlightHub 2 OpenAPI is not DJI Cloud API MQTT and not DJI Cloud API 2.
const VERSION='v2.0',MAX_BODY=262144,MAX_ITEMS=100;
const DEVICE_PATH='/openapi/v2.0/project/device';
const VALID_TYPES=new Set(['aircraft','gateway','unknown']);
function requireThat(ok,msg){if(!ok)throw new TypeError(msg);}
function uuid(v){return typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);}
function cleanDevice(v){
  if(!v||typeof v!=='object'||Array.isArray(v))return null;
  // No serial number, cloud credential, external URL, raw state or precise location.
  const d={source:'flighthub2-openapi-v2',displayName:null,model:null,type:'unknown',online:null};
  if(typeof v.name==='string'&&v.name.length<=80&&/^[^\x00-\x1f]*$/.test(v.name))
    d.displayName=v.name;
  if(typeof v.device_name==='string'&&v.device_name.length<=80)d.displayName=v.device_name;
  if(typeof v.model==='string'&&v.model.length<=60)d.model=v.model;
  if(typeof v.device_type==='string'&&VALID_TYPES.has(v.device_type))d.type=v.device_type;
  if(typeof v.online==='boolean')d.online=v.online;
  return d;
}
function createFlightHubReadOnly({origin,approvedOrigins,apiToken,fetchImpl=globalThis.fetch,timeoutMs=6000}){
  requireThat(typeof origin==='string'&&Array.isArray(approvedOrigins)&&approvedOrigins.includes(origin),
    'FlightHub endpoint requires an explicit operator origin allowlist');
  let u;try{u=new URL(origin)}catch(_){throw new TypeError('Invalid origin')}
  requireThat(u.protocol==='https:'&&u.origin+'/'===origin&&u.username===''&&u.password===''&&
    u.search===''&&u.hash===''&&u.pathname==='/'&&!u.port,'HTTPS origin only');
  requireThat(typeof apiToken==='string'&&apiToken.length>=16&&apiToken.length<=512&&
    !/[\r\n]/.test(apiToken),'Invalid private bearer token');
  requireThat(typeof fetchImpl==='function'&&Number.isInteger(timeoutMs)&&
    timeoutMs>=1000&&timeoutMs<=10000,'Invalid transport settings');
  return {
    async listDevices(projectId){
      requireThat(uuid(projectId),'Invalid project ID');
      const url=new URL(DEVICE_PATH,origin);
      url.searchParams.set('project_id',projectId);
      const controller=new AbortController();
      const timer=setTimeout(()=>controller.abort(),timeoutMs);
      try{
        const response=await fetchImpl(url.toString(),{
          method:'GET',redirect:'error',signal:controller.signal,
          headers:{Authorization:'Bearer '+apiToken,Accept:'application/json'}
        });
        if(!response||response.status!==200||!response.headers||
           !String(response.headers.get('content-type')||'').toLowerCase().includes('application/json'))
          throw new Error('FlightHub read failed');
        const raw=await response.text();
        requireThat(Buffer.byteLength(raw,'utf8')<=MAX_BODY,'Response exceeds safety limit');
        const json=JSON.parse(raw);
        const items=json?.data?.list;
        requireThat(Array.isArray(items)&&items.length<=MAX_ITEMS,'Unexpected FlightHub device list');
        return {source:'flighthub2-openapi-v2',projectId,devices:items.map(cleanDevice).filter(Boolean),
          completeness:'unverified-first-page',readOnly:true,flightReady:false};
      }catch(_){
        throw new Error('FlightHub read unavailable');
      }finally{clearTimeout(timer)}
    }
  };
}
module.exports={createFlightHubReadOnly,cleanDevice,DEVICE_PATH,VERSION};
