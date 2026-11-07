'use strict';
// Public, bounded projection of the revision-pinned P0 catalog.
// Never reads device state, secrets, MQTT, database, filesystem, or a DJI SDK.
const {CATALOG,validateContract}=require('./cloud-api2-contracts');
const SCHEMA='skyhub.cloudapi2.readonly-adapter.v1';
function projectPublicContract(){
  validateContract();
  return {
    schema:SCHEMA,readOnly:true,source:'pinned-offline-dji-reference-not-runtime',
    vendorPlatformVersion:CATALOG.source.platformVersion,
    vendorCommit:CATALOG.source.commit,
    sdkSourceVersion:CATALOG.source.sdkSourceVersion,
    devkitJarVersion:CATALOG.source.devkitPrebuiltJarVersion,
    catalogVersion:CATALOG.catalogVersion,
    api2RuntimeVerified:false,hardwareVerified:false,flightReady:false,
    dispatchAllowed:false,accuracyVerified:false,validatedMissionExecution:false,
    deviceMission:'not-established',missionMedia:'not-established',deviceMedia:'not-established',
    devices:CATALOG.deviceMatrix.map(d=>({
      id:d.id,name:d.name,vendorSupport:d.vendorSupport,
      hardwareVerified:false,flightReady:false
    })),
    capabilities:CATALOG.capabilityMatrix.map(c=>({
      id:c.id,vendorModule:c.vendorModule,skyhubMode:c.skyhubMode,
      api2RuntimeVerified:false,commandEnabled:false,flightReady:false
    })),
    controllerAircraft:CATALOG.controllerAircraftMatrix.map(p=>({
      controller:p.controller,aircraft:p.aircraft,
      api2PairingVerified:false,hardwareAcceptanceComplete:false
    }))
  };
}
module.exports={SCHEMA,projectPublicContract};
