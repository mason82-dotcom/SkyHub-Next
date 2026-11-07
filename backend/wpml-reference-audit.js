'use strict';
// Read-only source-compatibility audit for DJI WPML KMZ. No writes, network,
// dispatch, raw mission values, route points or personal metadata in output.
// This is NOT a DJI Pilot 2 acceptance/certification or upstream Go execution.
const {readKmz}=require('./wpml-kmz');
const {parseXml,validateDocuments}=require('./wpml');
const {FIXED}=require('./wpml-product-support');

const SCHEMA='skyhub-wpml-reference-risk-audit-v1';
const SUPPORTED='http://www.dji.com/wpmz/1.0.2';
const ALT='http://www.dji.com/wpmz/1.0.6';
function rejected(){throw Error('WPML reference audit rejected: invalid or unsupported KMZ');}
function one(node,key){return node?.children?.find(child=>child.name===key)||null;}
function children(node,key){return node?.children?.filter(child=>child.name===key)||[];}
function field(node,key){return one(node,'wpml:'+key)?.text.trim()??'';}
function numeric(raw){
  if(!/^(?:0|[1-9]\d*)$/.test(raw))return null;
  const n=Number(raw);
  return Number.isSafeInteger(n)?n:null;
}
function base(){
  return {schema:SCHEMA,sourceReference:{
    repository:'motecshine/dji-waylines-sdk',
    commit:'dd9b12d26c4c200220165e8e6d409d6dafdbfa23'
  },flightReady:false,pilot2HardwareVerified:false,
  sdkOutputVerified:false,missionDispatchEnabled:false,
  privacy:'fixed diagnostic codes and boolean/aggregate properties only',
  scope:'offline-reference-risk-screen-not-flight-approval'};
}
function auditReferenceKmz(buffer){
  let archive;
  try{archive=readKmz(buffer);}catch{rejected();}
  // Try both *literal* namespace profiles without altering XML. The existing
  // parser enforces literal prefix bindings and rejects nested namespace
  // rebinding, so comments or arbitrary XML text cannot redirect this gate.
  let template,waylines,namespaceProfile=null;
  for(const candidate of [SUPPORTED,ALT]){
    try{
      const t=parseXml(archive.template,candidate);
      const w=parseXml(archive.waylines,candidate);
      template=t;waylines=w;namespaceProfile=candidate;
      break;
    }catch{
      // Never surface parse error text or raw attacker-controlled XML.
    }
  }
  if(!namespaceProfile){
    return {...base(),offlineValid:null,namespaceCheck:'unsupported-or-mixed',
      inspectionMode:'not-inspected',
      reviewStatus:'blocked',
      findings:['WPML_NAMESPACE_NOT_VALIDATED_BY_SKYHUB'],
      findingCount:1};
  }
  const alternate=namespaceProfile===ALT;
  let validation;
  try{validation=validateDocuments(archive.template,archive.waylines,namespaceProfile);}
  catch{rejected();}
  const codes=new Set(alternate?['WPML_NAMESPACE_NOT_VALIDATED_BY_SKYHUB']:[]);
  if(!validation.valid)codes.add('WPML_OFFLINE_VALIDATION_FAILED');
  const docs=[template,waylines];
  for(const root of docs){
    const doc=one(root,'Document');
    const config=one(doc,'wpml:missionConfig');
    if(!config){codes.add('WPML_MISSION_CONFIG_MISSING');continue;}
    if(field(config,'exitOnRCLost')!=='executeLostAction'||
       field(config,'executeRCLostAction')!=='goBack')
      codes.add('RC_LOSS_POLICY_DIFFERS_FROM_SKYHUB_EDITOR');
    const info=one(config,'wpml:droneInfo'),payload=one(config,'wpml:payloadInfo');
    const type=numeric(field(info,'droneEnumValue'));
    const subtype=numeric(field(info,'droneSubEnumValue'));
    const camera=numeric(field(payload,'payloadEnumValue'));
    if(type!==null && subtype!==null && camera!==null){
      const profile=Object.hasOwn(FIXED,type+':'+subtype)?FIXED[type+':'+subtype]:null;
      if(profile && profile.payload!==camera)
        codes.add('AIRCRAFT_SUBTYPE_PAYLOAD_CONFLICT');
      else if(!profile && [67,77,91,99,100].includes(type))
        codes.add('AIRCRAFT_SUBTYPE_UNRECOGNIZED');
    }
    if(field(config,'takeOffRefPoint'))
      codes.add('TAKEOFF_REFERENCE_REQUIRES_INDEPENDENT_PROVENANCE');
    if(field(config,'takeOffRefPoint') &&
       field(config,'takeOffRefPointAGLHeight')==='0')
      codes.add('TAKEOFF_AGL_ZERO_REQUIRES_REVIEW');
  }
  let ellipsoidFound=false,identicalHeightPairs=0;
  const doc=one(template,'Document');
  for(const folder of children(doc,'Folder')){
    for(const point of children(folder,'Placemark')){
      const ell=field(point,'ellipsoidHeight'),height=field(point,'height');
      if(ell==='')continue;
      ellipsoidFound=true;
      // Only a warning: equal values can be physically possible and do not
      // prove an error. The upstream converter copies relative height.
      if(height!=='' && Number.isFinite(Number(ell))&&Number.isFinite(Number(height))&&
         Number(ell)===Number(height))identicalHeightPairs++;
    }
  }
  if(ellipsoidFound)codes.add('ELLIPSOID_HEIGHT_PROVENANCE_UNVERIFIED');
  if(identicalHeightPairs>0)codes.add('ELLIPSOID_EQUALS_OTHER_HEIGHT_REQUIRES_REVIEW');
  for(const folder of children(one(waylines,'Document'),'Folder')){
    const declaredDistance=field(folder,'distance');
    if(declaredDistance!==''||field(folder,'duration')!=='')
      codes.add('WAYLINE_STATS_NOT_INDEPENDENTLY_VERIFIED');
    if(declaredDistance!==''){
      const pts=children(folder,'Placemark').map(p=>{
        const raw=one(one(p,'Point'),'coordinates')?.text.trim()??'';
        const parts=raw.split(',');
        if(parts.length!==2)return null;
        const lon=Number(parts[0]),lat=Number(parts[1]);
        return Number.isFinite(lat)&&Number.isFinite(lon)&&
          lat>=-90&&lat<=90&&lon>=-180&&lon<=180?{lat,lon}:null;
      });
      const reported=Number(declaredDistance);
      if(pts.length>=2&&pts.every(Boolean)&&
         /^\d+(?:\.\d+)?$/.test(declaredDistance)&&Number.isFinite(reported)){
        const rad=x=>x*Math.PI/180;
        let calculated=0;
        for(let i=1;i<pts.length;i++){
          const p=pts[i-1],q=pts[i];
          const dlat=rad(q.lat-p.lat),dlon=rad(q.lon-p.lon);
          const h=Math.sin(dlat/2)**2+Math.cos(rad(p.lat))*
            Math.cos(rad(q.lat))*Math.sin(dlon/2)**2;
          calculated+=2*6371008.8*Math.asin(Math.sqrt(Math.max(0,Math.min(1,h))));
        }
        // Coarse red-flag threshold, not a validated aircraft distance model.
        if(calculated>0&&Math.abs(reported-calculated)>Math.max(50,calculated*0.15))
          codes.add('WAYLINE_DISTANCE_DIFFERS_FROM_SPHERICAL_APPROXIMATION');
      }
    }
  }
  return {...base(),offlineValid:alternate?null:validation.valid,
    namespaceCheck:alternate?'upstream-alternate-unverified':'skyhub-recognized-1.0.2',
    inspectionMode:alternate?'explicit-alternate-namespace-read-only':'native-skyhub',
    reviewStatus:alternate||!validation.valid?'blocked':codes.size?'review-required':'no-listed-divergence-observed',
    findings:[...codes].sort(),findingCount:codes.size};
}
module.exports={auditReferenceKmz};
