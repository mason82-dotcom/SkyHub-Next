'use strict';
// Keyless SkyHub-owned read-only projection of the existing Cloud API 1.x registry.
// This is not DJI Cloud API 2 PaaS, native SDK, MQTT bridge or flight controller.
const SCHEMA='skyhub.cloudapi2.keyless.v1';
const REFERENCE='DJI Cloud API 2 V1.1.0 reference';
function batteryValue(value){
  return Number.isFinite(value)&&value>=0&&value<=100?Math.round(value*10)/10:null;
}
function projectDevice(device,now){
  const at=Number.isFinite(device.lastTelemetryAt)&&device.lastTelemetryAt>=0&&
    device.lastTelemetryAt<=now?device.lastTelemetryAt:null;
  return {
    role:['gateway','subdevice'].includes(device.role)?device.role:'unknown',
    modelName:typeof device.modelName==='string'&&device.modelName.trim()
      ?device.modelName.slice(0,80):'Unbekannt',
    topologyOnline:typeof device.topologyOnline==='boolean'?device.topologyOnline:null,
    online:device.online===true&&device.fresh===true&&device.topologyOnline===true,
    batteryPercent:batteryValue(device.telemetry?.battery),
    telemetryAgeSeconds:at===null?null:Math.max(0,Math.floor((now-at)/1000))
  };
}
function projectRegistry(registry,now=Date.now()){
  const all=registry.snapshot(now);
  return {schema:SCHEMA,source:'existing-skyhub-cloud-api-1.x-registry',readOnly:true,
    total:all.length,
    online:all.filter(x=>x.online===true&&x.fresh===true&&x.topologyOnline===true).length,
    truncated:all.length>100,
    devices:all.slice(0,100).map(device=>projectDevice(device,now)),
    hardwareVerified:false,flightReady:false};
}
const CAPABILITIES=Object.freeze({
  schema:SCHEMA,mode:'read-only',referenceVersion:REFERENCE,djiKeyRequired:false,
  djiRuntimeInstalled:false,officialDjiSdkInstalled:false,
  officialDjiFrontendLoaded:false,externalMqttBridgeEnabled:false,
  simulator:'isolated-browser-memory',aiTools:'offline-prompt-templates',
  allowedMethods:['GET'],flightCommandsEnabled:false,missionDispatchEnabled:false
});
function createCloudApi2PortalRouter({express,registry,mqttState}){
  const router=express.Router();
  router.get('/status',(_req,res)=>res.json({
    schema:SCHEMA,mode:'keyless-read-only',
    source:'existing-skyhub-cloud-api-1.x-registry',
    mqttConnected:mqttState?.connected===true,
    mqttSubscribed:mqttState?.subscribed===true,
    djiRuntimeInstalled:false,flightControlEnabled:false,
    hardwareVerified:false,flightReady:false
  }));
  router.get('/devices',(_req,res)=>res.json(projectRegistry(registry)));
  router.get('/capabilities',(_req,res)=>res.json(CAPABILITIES));
  return router;
}
module.exports={SCHEMA,CAPABILITIES,projectDevice,projectRegistry,createCloudApi2PortalRouter};