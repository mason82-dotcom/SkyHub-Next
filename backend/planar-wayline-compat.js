'use strict';
// Offline-only KMZ compatibility screen for the planar-wayline reference (MIT).
// Never rewrites XML, grants flight authority, exports waylines, or dispatches.
const {readKmz}=require('./wpml-kmz');
const {parseXml,WPML,WPML_REFERENCE_ONLY}=require('./wpml');
const {auditReferenceKmz}=require('./wpml-reference-audit');
const {FIXED}=require('./wpml-product-support');
const MODELS=Object.freeze({
  mavic3m:{drone:77,subtype:2,payload:68},
  matrice4t:{drone:99,subtype:1,payload:89},
  mavic3e:{drone:77,subtype:0,payload:66},
  mavic3t:{drone:77,subtype:1,payload:67},
  matrice4e:{drone:99,subtype:0,payload:88}
});
function one(n,k){return n?.children?.find(x=>x.name===k)||null;}
function field(n,k){return one(n,'wpml:'+k)?.text.trim()??null;}
function num(v){return typeof v==='string'&&/^(?:0|[1-9][0-9]{0,5})$/.test(v)?Number(v):null;}
function locked(data){return {...data,flightReady:false,dispatchAllowed:false,
  exportableAsWaylines:false,pilot2HardwareVerified:false,cameraHardwareVerified:false,
  photoActionsApproved:false,sourceAttributionVerified:false,originalXmlRewritten:false,
  privacy:'no route coordinates or mission names disclosed'};}
function reviewPlanarKmz(kmz,{targetModel=null}={}){
  if(targetModel!==null&&!Object.hasOwn(MODELS,targetModel))
    throw new TypeError('Unsupported target model');
  const archive=readKmz(kmz); // ZIP whitelist, bounds, CRC
  const audit=auditReferenceKmz(kmz);
  const codes=new Set(audit.findings);
  const namespace=audit.namespaceCheck==='upstream-alternate-unverified'?
    WPML_REFERENCE_ONLY:audit.namespaceCheck==='skyhub-recognized-1.0.2'?WPML:null;
  const base={schema:'skyhub-planar-wayline-compat-review-v1',
    reference:'Tao-tao520/planar-wayline@1599daca (MIT)',
    namespaceProfile:namespace,targetModel,status:'blocked',
    offlineReferenceStatus:audit.reviewStatus,offlineValid:audit.offlineValid,
    assessment:'reference-review-only'};
  if(!namespace){
    codes.add('UNSUPPORTED_NAMESPACE');
    return locked({...base,templateType:null,aircraft:null,sourceMatchesTarget:false,
      blockers:[...codes].sort()});
  }
  const roots=[archive.template,archive.waylines].map(xml=>parseXml(xml,namespace));
  const docs=roots.map(r=>one(r,'Document'));
  const templateType=field(one(docs[0],'Folder'),'templateType');
  if(!['mapping2d','mapping3d'].includes(templateType))codes.add('NOT_PLANAR_MAPPING');
  const devices=docs.map(d=>{
    const config=one(d,'wpml:missionConfig');
    const a=one(config,'wpml:droneInfo');
    const p=one(config,'wpml:payloadInfo');
    return {drone:num(field(a,'droneEnumValue')),
      subtype:num(field(a,'droneSubEnumValue')),
      payload:num(field(p,'payloadEnumValue')),
      position:num(field(p,'payloadPositionIndex'))};
  });
  const d=devices[0];
  if(devices.some(x=>Object.values(x).some(v=>v===null))||
     JSON.stringify(devices[0])!==JSON.stringify(devices[1]))
    codes.add('INCONSISTENT_DEVICE_METADATA');
  const profile=d.drone!==null&&d.subtype!==null?FIXED[d.drone+':'+d.subtype]:null;
  if(!profile||profile.payload!==d.payload||d.position!==0)
    codes.add('UNVERIFIED_DEVICE_PAYLOAD');
  const target=targetModel===null?null:MODELS[targetModel];
  const sourceMatchesTarget=!!target&&target.drone===d.drone&&
    target.subtype===d.subtype&&target.payload===d.payload&&d.position===0;
  if(target&&!sourceMatchesTarget)codes.add('SOURCE_TARGET_PROFILE_MISMATCH');
  if(d.drone===91&&d.subtype===1&&d.payload===81)
    codes.add('UPSTREAM_DEFAULT_M3TD');
  if(namespace===WPML_REFERENCE_ONLY)codes.add('WPML_106_INSPECT_ONLY');
  codes.add('PILOT2_AND_PROVENANCE_UNVERIFIED');
  return locked({...base,templateType,aircraft:profile?.model??null,
    observedDeviceEnums:d,sourceMatchesTarget,blockers:[...codes].sort()});
}
module.exports={MODELS,reviewPlanarKmz};