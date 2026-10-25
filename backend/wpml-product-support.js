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
function assessAircraft(droneType,droneSubtype,payloadType,payloadPositionIndex){
  if(droneType===null||payloadType===null)return {model:null,errors:[],warnings:[]};
  const key=String(droneType)+':'+String(droneSubtype);
  const profile=FIXED[key],errors=[],warnings=[];
  if(profile){
    if(profile.payload!==payloadType)
      errors.push('payloadEnumValue incompatible with '+profile.model);
    if(payloadPositionIndex!==0)
      errors.push('non-primary gimbal index on integrated camera aircraft');
  }else if(!MULTI.has(droneType)&&!([67,77,91,99,100].includes(droneType)))
    warnings.push('aircraft type not in validated product matrix');
  else if([67,77,91,99,100].includes(droneType))
    errors.push('unsupported aircraft subtype');
  return {model:profile?.model??null,errors,warnings};
}
module.exports={FIXED,assessAircraft};
