'use strict';
// Aircraft/payload mappings from DJI Cloud API 1.18 product support and WPML tables.
// Controllers are NOT WPML droneEnumValue values.
const FIXED=Object.freeze({
  '67:0':{model:'Matrice 30',payload:52},
  '67:1':{model:'Matrice 30T',payload:53},
  '77:0':{model:'Mavic 3E',payload:66},
  '77:1':{model:'Mavic 3T',payload:67},
  '77:2':{model:'Mavic 3M',payload:68},
  '77:3':{model:'Mavic 3TA',payload:129},
  '91:0':{model:'Matrice 3D',payload:80},
  '91:1':{model:'Matrice 3TD',payload:81},
  '99:0':{model:'Matrice 4E',payload:88},
  '99:1':{model:'Matrice 4T',payload:89},
  '100:0':{model:'Matrice 4D',payload:98},
  '100:1':{model:'Matrice 4TD',payload:99}
});
const MULTI=new Set([60,89,103]);
function assessAircraft(droneType,droneSubtype,payloadType,payloadPositionIndex,{cameraDecides=false}={}){
  if(droneType===null||payloadType===null)return {model:null,errors:[],warnings:[]};
  const key=String(droneType)+':'+String(droneSubtype);
  const profile=FIXED[key],errors=[],warnings=[];
  let effectiveSubtype;
  if(profile){
    // Only for routes DJI Pilot 2 itself uploaded (origin pilot2); converters and SkyHub's own files stay strict.
    const sibling=cameraDecides&&profile.payload!==payloadType?Object.entries(FIXED).find(([k,p])=>p.payload===payloadType&&k.split(':')[0]===String(droneType)):null;
    if(sibling){
      // Seen 05.11.2026 in routes DJI Pilot 2 itself wrote (Feb/Mar 2025, Matrice 4T): droneSubEnumValue 0 (= 4E) with the 4T camera 89.
      // Pilot 2 lists them as M4T, i.e. the camera decides within one aircraft family. SkyHub follows that and warns.
      effectiveSubtype=Number(sibling[0].split(':')[1]);
      warnings.push('droneSubEnumValue '+droneSubtype+' ('+profile.model+') does not match camera '+payloadType+' of the '+sibling[1].model+
        ': treated as '+sibling[1].model+' like DJI Pilot 2 does; check the aircraft in Pilot 2');
      if(payloadPositionIndex!==0)errors.push('non-primary gimbal index on integrated camera aircraft');
      return {model:sibling[1].model,errors,warnings,effectiveSubtype};
    }
    if(profile.payload!==payloadType){
      // Name the aircraft the camera belongs to, e.g. a Matrice 4T camera in a Matrice 4E mission.
      const owner=Object.entries(FIXED).find(([,p])=>p.payload===payloadType);
      errors.push('payloadEnumValue incompatible with '+profile.model+' ('+key.replace(':','-')+')'+
        (owner?': payload '+payloadType+' belongs to '+owner[1].model+' ('+owner[0].replace(':','-')+
          '); set droneSubEnumValue '+owner[0].split(':')[1]+' or the matching camera':''));
    }
    if(payloadPositionIndex!==0)
      errors.push('non-primary gimbal index on integrated camera aircraft');
  }else if(!MULTI.has(droneType)&&!([67,77,91,99,100].includes(droneType)))
    warnings.push('aircraft type not in validated product matrix');
  else if([67,77,91,99,100].includes(droneType))
    errors.push('unsupported aircraft subtype');
  return {model:profile?.model??null,errors,warnings,effectiveSubtype};
}
module.exports={FIXED,assessAircraft};
