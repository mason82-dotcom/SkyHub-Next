// DJI Cloud API 2 V1.1.0 P1: public, same-origin, read-only adapter facade.
// This module never connects to the DJI PaaS, MQTT broker or an aircraft.
import {SkyHubDaaSClient} from './cloud-api2-sdk.mjs';
const VENDOR_SHA='705c73f48a77bb5120b28d73436d73594d289359';
const IDS=Object.freeze(['m3e','m3t','m3ta','m3m','m4t','rc-pro-enterprise','rc-plus2-enterprise']);
const CAP_IDS=Object.freeze(['device-inventory','drone-osd','dock-osd','hms-alerts',
  'wayline-library','flight-task-query','flight-task-execute','media-catalog',
  'terra-build','map-view','live-and-sei','mcp-agent','remote-flight-control']);
const CONTROLLER_PAIRS=Object.freeze([
  'rc-pro-enterprise:m3m','rc-plus2-enterprise:m4t'
]);
const GATES=['api2RuntimeVerified','hardwareVerified','flightReady','dispatchAllowed',
  'accuracyVerified','validatedMissionExecution'];
const RELATIONS=['deviceMission','missionMedia','deviceMedia'];
const PUBLIC_KEYS=['schema','readOnly','source','vendorPlatformVersion','vendorCommit',
  'sdkSourceVersion','devkitJarVersion','catalogVersion',...GATES,...RELATIONS,
  'devices','capabilities','controllerAircraft'];
const ENVELOPE_KEYS=['schema','mode','referenceVersion','djiKeyRequired',
  'djiRuntimeInstalled','officialDjiSdkInstalled','officialDjiFrontendLoaded',
  'externalMqttBridgeEnabled','simulator','aiTools','allowedMethods',
  'flightCommandsEnabled','missionDispatchEnabled','contract'];
const DEVICE_KEYS=['id','name','vendorSupport','hardwareVerified','flightReady'];
const CAP_KEYS=['id','vendorModule','skyhubMode','api2RuntimeVerified',
  'commandEnabled','flightReady'];
const PAIR_KEYS=['controller','aircraft','api2PairingVerified','hardwareAcceptanceComplete'];
const SUPPORT=new Set(['explicitly-listed-not-hardware-certified',
  'family-listed-not-specific-certified','not-explicitly-listed','sdk-controller-class-only']);
const MODES=new Set(['read-only-projection','reference-only','disabled']);
const CONTROL=new Set(['flight-task-execute','mcp-agent','remote-flight-control']);
function bad(){throw new TypeError('Read-only-Vertrag ungültig oder nicht bestätigt');}
function exact(x,keys){
  return x!==null&&typeof x==='object'&&!Array.isArray(x)&&
    Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
}
function bounded(value,max=96){
  return typeof value==='string'&&value.length>0&&value.length<=max&&
    !/[\u0000-\u001f\u007f]/.test(value);
}
function validateReadOnlyCapabilities(value){
  if(!exact(value,ENVELOPE_KEYS)||value.schema!=='skyhub.cloudapi2.keyless.v1'||
    value.mode!=='read-only'||value.referenceVersion!=='DJI Cloud API 2 V1.1.0 reference'||
    value.djiKeyRequired!==false||value.djiRuntimeInstalled!==false||
    value.officialDjiSdkInstalled!==false||value.officialDjiFrontendLoaded!==false||
    value.externalMqttBridgeEnabled!==false||value.flightCommandsEnabled!==false||
    value.missionDispatchEnabled!==false||value.simulator!=='isolated-browser-memory'||
    value.aiTools!=='offline-prompt-templates'||!Array.isArray(value.allowedMethods)||
    value.allowedMethods.length!==1||value.allowedMethods[0]!=='GET')
    bad();
  const c=value.contract;
  if(!exact(c,PUBLIC_KEYS)||c.schema!=='skyhub.cloudapi2.readonly-adapter.v1'||
    c.source!=='pinned-offline-dji-reference-not-runtime'||
    c.readOnly!==true||c.vendorPlatformVersion!=='V1.1.0'||c.vendorCommit!==VENDOR_SHA||
    c.sdkSourceVersion!=='3.4.0'||c.devkitJarVersion!=='3.3.7'||c.catalogVersion!=='1.0.0'||
    GATES.some(k=>c[k]!==false)||RELATIONS.some(k=>c[k]!=='not-established'))bad();
  if(!Array.isArray(c.devices)||c.devices.length!==IDS.length||
    !Array.isArray(c.capabilities)||c.capabilities.length!==CAP_IDS.length||
    !Array.isArray(c.controllerAircraft)||c.controllerAircraft.length!==CONTROLLER_PAIRS.length)
    bad();
  const devices=c.devices.map((d,i)=>{
    if(!exact(d,DEVICE_KEYS)||d.id!==IDS[i]||!bounded(d.name)||
      !SUPPORT.has(d.vendorSupport)||d.hardwareVerified!==false||d.flightReady!==false)
      bad();
    if((d.id==='m3m'||d.id==='m3ta')&&d.vendorSupport!=='not-explicitly-listed')bad();
    if(d.id==='m4t'&&d.vendorSupport!=='explicitly-listed-not-hardware-certified')bad();
    return {id:d.id,name:d.name,vendorSupport:d.vendorSupport,
      hardwareVerified:false,flightReady:false};
  });
  const capabilities=c.capabilities.map((v,i)=>{
    if(!exact(v,CAP_KEYS)||v.id!==CAP_IDS[i]||!bounded(v.vendorModule)||
      !MODES.has(v.skyhubMode)||v.api2RuntimeVerified!==false||
      v.commandEnabled!==false||v.flightReady!==false||
      (CONTROL.has(v.id)&&v.skyhubMode!=='disabled'))bad();
    return {id:v.id,vendorModule:v.vendorModule,skyhubMode:v.skyhubMode,
      api2RuntimeVerified:false,commandEnabled:false,flightReady:false};
  });
  const controllerAircraft=c.controllerAircraft.map(p=>{
    if(!exact(p,PAIR_KEYS)||!CONTROLLER_PAIRS.includes(p.controller+':'+p.aircraft)||
      p.api2PairingVerified!==false||p.hardwareAcceptanceComplete!==false)bad();
    return {controller:p.controller,aircraft:p.aircraft,api2PairingVerified:false,
      hardwareAcceptanceComplete:false};
  });
  if(new Set(controllerAircraft.map(p=>p.controller+':'+p.aircraft)).size!==2)bad();
  return {
    schema:c.schema,readOnly:true,source:c.source,
    vendorPlatformVersion:c.vendorPlatformVersion,vendorCommit:c.vendorCommit,
    sdkSourceVersion:c.sdkSourceVersion,devkitJarVersion:c.devkitJarVersion,
    catalogVersion:c.catalogVersion,
    api2RuntimeVerified:false,hardwareVerified:false,flightReady:false,
    dispatchAllowed:false,accuracyVerified:false,validatedMissionExecution:false,
    deviceMission:'not-established',missionMedia:'not-established',deviceMedia:'not-established',
    devices,capabilities,controllerAircraft
  };
}
class SkyHubReadOnlyContractAdapter{
  constructor({client=new SkyHubDaaSClient()}={}){
    if(!client||typeof client.getCapabilities!=='function')throw new TypeError('GET client required');
    this.client=client;
  }
  async inspect(){
    // Do not cache past successful responses: any 401/schema drift must blank the UI.
    const value=await this.client.getCapabilities();
    return validateReadOnlyCapabilities(value);
  }
}
export {SkyHubReadOnlyContractAdapter,validateReadOnlyCapabilities};
