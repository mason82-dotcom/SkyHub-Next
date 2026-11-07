'use strict';
// Version-pinned, offline-only DJI Cloud API 2 contract reference for SkyHub Next.
// Never connect to DJI, MQTT, S3, the Pi, or any aircraft from this module.
const CATALOG=require('./data/dji-cloud-api2-v1.1.0-p0.json');
const EXPECTED_VENDOR_SHA='705c73f48a77bb5120b28d73436d73594d289359';
const EXPECTED_MAIN_SHA='a17b8b487ef27906c75badf713bef67dbe741087';
const RESOURCES=Object.freeze([
  'status','devices','capabilities','linkage','evidence','hardware/rc-plus2-m4t'
]);
const LAN=Object.freeze(['status','devices','capabilities','linkage']);
const FALSE_GATES=Object.freeze([
  'hardwareVerified','flightReady','dispatchAllowed','accuracyVerified','validatedMissionExecution'
]);
const RELATIONS=Object.freeze(['deviceMission','missionMedia','deviceMedia']);
const ALLOWED_MODES=new Set(['read-only-projection','reference-only','disabled']);
const ALLOWED_VENDOR_SURFACES=new Set(['read-only','mixed','control']);
const ALLOWED_VENDOR_SUPPORT=new Set([
  'explicitly-listed-not-hardware-certified','family-listed-not-specific-certified',
  'not-explicitly-listed','sdk-controller-class-only'
]);
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
function reject(message){throw new TypeError('Cloud API 2 P0 contract: '+message);}
function equalList(a,b){
  return Array.isArray(a)&&a.length===b.length&&a.every((x,i)=>x===b[i]);
}
function validateContract(candidate=CATALOG){
  if(!plain(candidate)||candidate.schema!=='skyhub.dji.cloudapi2.contract-catalog.v1'||
      candidate.catalogVersion!=='1.0.0'||candidate.referenceDate!=='2026-11-07')
    reject('catalog schema/version mismatch');
  const s=candidate.source,l=candidate.localBaseline,a=candidate.adapterContract;
  if(!plain(s)||s.repository!=='dji-sdk/Cloud-API-2'||s.commit!==EXPECTED_VENDOR_SHA||
      s.platformVersion!=='V1.1.0'||s.platformReleased!=='2026-11-05'||
      s.sdkSourceVersion!=='3.4.0'||s.devkitPrebuiltJarVersion!=='3.3.7')
    reject('DJI SDK/DevKit source pin mismatch');
  const names=['releaseNotes','sdk','demoDeploy','demoUsage','mqttBridge','apiComparison','devices','frontend'];
  if(!plain(s.documents)||Object.keys(s.documents).length!==names.length)
    reject('missing source inventory');
  for(const name of names){
    const d=s.documents[name];
    if(!plain(d)||typeof d.path!=='string'||!/^docs\/cn\/[\w.\/-]+\.md$/.test(d.path)||
        d.url!=='https://github.com/dji-sdk/Cloud-API-2/blob/'+EXPECTED_VENDOR_SHA+'/'+d.path)
      reject('source URL is not revision pinned: '+name);
  }
  if(!plain(l)||l.repository!=='mason82-dotcom/SkyHub-Next'||l.mainCommit!==EXPECTED_MAIN_SHA||
      l.mode!=='skyhub-cloud-api-1.x-backed-reference'||
      ['vendorPaaSInstalled','vendorSdkInstalled','vendorMcpInstalled','liveControlPermitted'].some(k=>l[k]!==false))
    reject('SkyHub runtime boundary changed');
  if(!plain(a)||a.basePath!=='/api/cloud-api2'||a.sameOrigin!==true||
      !equalList(a.permittedMethods,['GET'])||
      !equalList(a.forbiddenMethods,['POST','PUT','PATCH','DELETE'])||
      a.evidenceIsOperatorTriggered!==true||a.mutationsEnabled!==false||
      a.automaticMqttPublish!==false||!equalList(a.bareLanAllowedResources,LAN)||
      !Array.isArray(a.routes)||a.routes.length!==RESOURCES.length)
    reject('read-only adapter contract changed');
  for(let i=0;i<RESOURCES.length;i++){
    const r=a.routes[i],res=RESOURCES[i];
    if(!plain(r)||r.resource!==res||r.method!=='GET'||r.noWrite!==true||
        r.access!==(LAN.includes(res)?'trusted-lan-get':'view-token-required')||
        typeof r.scope!=='string'||!r.scope)
      reject('route permission mismatch: '+res);
  }
  const devices=candidate.deviceMatrix,pairs=candidate.controllerAircraftMatrix,
        caps=candidate.capabilityMatrix,g=candidate.immutableGates;
  const expectedDevices=['m3e','m3t','m3ta','m3m','m4t','rc-pro-enterprise','rc-plus2-enterprise'];
  if(!Array.isArray(devices)||!equalList(devices.map(x=>x.id),expectedDevices))
    reject('device inventory changed');
  for(const d of devices){
    if(!plain(d)||typeof d.name!=='string'||!d.name||!ALLOWED_VENDOR_SUPPORT.has(d.vendorSupport)||
        typeof d.evidenceLimit!=='string'||!d.evidenceLimit||
        d.cloudApi2HardwareVerified!==false||d.flightReady!==false)
      reject('device support must remain unverified: '+d?.id);
  }
  if(devices.find(x=>x.id==='m3m').vendorSupport!=='not-explicitly-listed'||
     devices.find(x=>x.id==='m3ta').vendorSupport!=='not-explicitly-listed'||
     devices.find(x=>x.id==='m4t').vendorSupport!=='explicitly-listed-not-hardware-certified')
    reject('unsubstantiated DJI model claim');
  if(!Array.isArray(pairs)||pairs.length!==2||
      pairs[0].controller!=='rc-pro-enterprise'||pairs[0].aircraft!=='m3m'||
      pairs[1].controller!=='rc-plus2-enterprise'||pairs[1].aircraft!=='m4t'||
      pairs.some(p=>p.cloudApi2PairingVerified!==false||p.hardwareAcceptanceComplete!==false||
        p.skyhubCloudApi1Transport!=='previous-smoke-observation'))
    reject('controller-aircraft combination must remain unverified');
  const expectedCaps=['device-inventory','drone-osd','dock-osd','hms-alerts',
    'wayline-library','flight-task-query','flight-task-execute','media-catalog',
    'terra-build','map-view','live-and-sei','mcp-agent','remote-flight-control'];
  if(!Array.isArray(caps)||!equalList(caps.map(x=>x.id),expectedCaps))
    reject('capability matrix changed without contract revision');
  for(const c of caps){
    if(!plain(c)||typeof c.vendorModule!=='string'||!c.vendorModule||
       typeof c.skyhubOrigin!=='string'||!c.skyhubOrigin||
       !ALLOWED_MODES.has(c.skyhubMode)||!ALLOWED_VENDOR_SURFACES.has(c.vendorSurface)||
       c.vendorDocumented!==true||c.api2RuntimeVerified!==false||
       c.skyhubCommandEnabled!==false||c.flightReady!==false||
       (c.vendorSurface==='control'&&c.skyhubMode!=='disabled'))
      reject('capability exceeds read-only scope: '+c?.id);
  }
  if(!plain(g)||FALSE_GATES.some(k=>g[k]!==false)||
      RELATIONS.some(k=>g[k]!=='not-established'))
    reject('evidence gates must fail closed');
  return true;
}
function listCapabilities(candidate=CATALOG){
  validateContract(candidate);
  return candidate.capabilityMatrix.map(c=>({...c}));
}
function lookupDevice(id,candidate=CATALOG){
  validateContract(candidate);
  const d=candidate.deviceMatrix.find(x=>x.id===id);
  return d?{...d}:null;
}
function auditRegisteredRoutes(records,candidate=CATALOG){
  validateContract(candidate);
  if(!Array.isArray(records)||records.length!==RESOURCES.length)reject('unexpected HTTP route count');
  for(let i=0;i<RESOURCES.length;i++){
    const r=records[i];
    if(!plain(r)||r.method!=='GET'||r.path!=='/'+RESOURCES[i])
      reject('unexpected HTTP method/path');
  }
  return true;
}
function auditClientRequests(calls,candidate=CATALOG){
  validateContract(candidate);
  if(!Array.isArray(calls)||calls.length!==RESOURCES.length)
    reject('unexpected browser request count');
  for(let i=0;i<RESOURCES.length;i++){
    const call=calls[i],opts=call?.options;
    if(!plain(call)||call.url!==candidate.adapterContract.basePath+'/'+RESOURCES[i]||
       !plain(opts)||opts.method!=='GET'||opts.credentials!=='same-origin'||
       opts.cache!=='no-store')
      reject('client must use same-origin GET only');
  }
  return true;
}
validateContract();
module.exports={CATALOG,RESOURCES,LAN,validateContract,listCapabilities,lookupDevice,
  auditRegisteredRoutes,auditClientRequests};
