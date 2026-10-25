'use strict';
// Additional offline validation for template.kml mapping/payload sections.
// DJI Cloud-API-Doc: docs/en/60.api-reference/00.dji-wpml/20.template-kml.md
// No flight-path generation and no DJI hardware interaction.
const children=(node,name)=>node?node.children.filter(n=>n.name===name):[];
const child=(node,name)=>children(node,name)[0]||null;
const val=(node,name)=>child(node,'wpml:'+name)?.text.trim()??'';
const fail=(errors,path,message)=>errors.push({path,message});
const NUMBER=/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?$/;
function number(node,name,path,errors,{min=-100000,max=100000,required=false,integer=false}={}){
  const raw=val(node,name);
  if(!raw){
    if(required)fail(errors,path+'/'+name,'required field missing');
    return null;
  }
  if(!NUMBER.test(raw)||!Number.isFinite(Number(raw))||
     Number(raw)<min||Number(raw)>max||(integer&&!Number.isInteger(Number(raw)))){
    fail(errors,path+'/'+name,'numeric value out of range');
    return null;
  }
  return Number(raw);
}
function boolean(node,name,path,errors,{required=false}={}){
  const v=val(node,name);
  if(!v&&required)fail(errors,path+'/'+name,'required field missing');
  else if(v&&v!=='0'&&v!=='1')fail(errors,path+'/'+name,'expected 0 or 1');
  return v;
}
function enumeration(node,name,allowed,path,errors,{required=false}={}){
  const v=val(node,name);
  if(!v&&required)fail(errors,path+'/'+name,'required field missing');
  else if(v&&!allowed.includes(v))fail(errors,path+'/'+name,'unsupported enumeration');
  return v;
}
function lensList(node,name,path,errors,{required=false}={}){
  const raw=val(node,name);
  if(!raw&&required)fail(errors,path+'/'+name,'required field missing');
  if(raw){
    const allowed=['wide','zoom','ir','narrow_band','visible','visable'];
    const lenses=raw.split(',').map(s=>s.trim());
    if(!lenses.length||new Set(lenses).size!==lenses.length||
      lenses.some(l=>!allowed.includes(l)))
      fail(errors,path+'/'+name,'invalid or repeated payload lens');
  }
}
function payload(folder,path,errors){
  const node=child(folder,'wpml:payloadParam');
  if(!node)return;
  const p=path+'/payloadParam';
  number(node,'payloadPositionIndex',p,errors,{min:0,max:2,integer:true,required:true});
  enumeration(node,'focusMode',['firstPoint','custom'],p,errors);
  enumeration(node,'meteringMode',['average','spot'],p,errors);
  enumeration(node,'returnMode',['singleReturnStrongest','dualReturn','tripleReturn'],p,errors);
  enumeration(node,'scanningMode',['repetitive','nonRepetitive'],p,errors);
  boolean(node,'dewarpingEnable',p,errors);
  boolean(node,'modelColoringEnable',p,errors);
  const sampling=number(node,'samplingRate',p,errors,{min:60000,max:240000,integer:true});
  if(sampling!==null&&![60000,80000,120000,160000,180000,240000].includes(sampling))
    fail(errors,p+'/samplingRate','unsupported LiDAR sampling rate');
  lensList(node,'imageFormat',p,errors);
}
function mappingHeading(node,path,errors){
  if(!node)return;
  const p=path+'/mappingHeadingParam';
  const mode=enumeration(node,'mappingHeadingMode',['fixed','followWayline'],p,errors,{required:true});
  number(node,'mappingHeadingAngle',p,errors,{min:0,max:360,required:mode==='fixed'});
}
function overlaps(node,path,errors){
  if(!node)return;
  const names=['orthoLidarOverlapH','orthoLidarOverlapW','orthoCameraOverlapH',
    'orthoCameraOverlapW','inclinedLidarOverlapH','inclinedLidarOverlapW',
    'inclinedCameraOverlapH','inclinedCameraOverlapW'];
  for(const name of names)number(node,name,path+'/overlap',errors,{min:0,max:100});
}
function validateMappingPlacemark(pm,type,path,errors){
  const shoot=enumeration(pm,'shootType',['time','distance'],path,errors,{required:true});
  number(pm,'direction',path,errors,{min:0,max:360,required:true});
  number(pm,'margin',path,errors,{required:true});
  number(pm,'ellipsoidHeight',path,errors,{required:true});
  number(pm,'height',path,errors,{required:true});
  boolean(pm,'caliFlightEnable',path,errors);
  overlaps(child(pm,'wpml:overlap'),path,errors);
  if(type==='mapping2d'){
    boolean(pm,'elevationOptimizeEnable',path,errors,{required:true});
    boolean(pm,'smartObliqueEnable',path,errors);
    number(pm,'smartObliqueGimbalPitch',path,errors,{min:-180,max:90});
    boolean(pm,'facadeWaylineEnable',path,errors);
    mappingHeading(child(pm,'wpml:mappingHeadingParam'),path,errors);
    const mode=enumeration(pm,'gimbalPitchMode',['manual','fixed'],path,errors);
    number(pm,'gimbalPitchAngle',path,errors,{min:-90,max:-30,required:mode==='fixed'});
  }else if(type==='mapping3d'){
    number(pm,'inclinedGimbalPitch',path,errors,{min:-180,max:90,required:true});
    number(pm,'inclinedFlightSpeed',path,errors,{min:0.000001,max:100,required:true});
  }else if(type==='mappingStrip'){
    boolean(pm,'caliFlightEnable',path,errors,{required:true});
    boolean(pm,'singleLineEnable',path,errors,{required:true});
    boolean(pm,'boundaryOptimEnable',path,errors,{required:true});
    boolean(pm,'includeCenterEnable',path,errors,{required:true});
    boolean(pm,'stripUseTemplateAltitude',path,errors);
    number(pm,'cuttingDistance',path,errors,{min:0.000001,required:true});
    number(pm,'leftExtend',path,errors,{required:true});
    number(pm,'rightExtend',path,errors,{required:true});
  }
  return shoot;
}
function validateCoordinateGeometry(points,type,path,errors){
  // Accepted DJI samples sometimes omit an explicitly repeated closing point.
  // Require a real, non-degenerate shape, but do not generate or alter a route.
  const keys=points.map(p=>p.slice(0,2).join(','));
  if(new Set(keys).size<(type==='mappingStrip'?2:3))
    fail(errors,path,'degenerate mapping geometry');
  if(type!=='mappingStrip'&&points.length>=3){
    let area=0;
    for(let i=0;i<points.length;i++){
      const a=points[i],b=points[(i+1)%points.length];
      area+=a[0]*b[1]-b[0]*a[1];
    }
    if(Math.abs(area)<1e-12)fail(errors,path,'degenerate mapping polygon area');
  }
}
module.exports={validateMappingPlacemark,validateCoordinateGeometry,validatePayloadParam:payload};
