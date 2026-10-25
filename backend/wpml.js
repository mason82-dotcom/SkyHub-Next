'use strict';
// DJI WPML 1.18: offline structural/semantic validation. No network or flight control.
// Reference: https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/dji-wpml/
const KML='http://www.opengis.net/kml/2.2';
const WPML='http://www.dji.com/wpmz/1.0.2';
const WPML_REFERENCE_ONLY='http://www.dji.com/wpmz/1.0.6';
const {assessAircraft}=require('./wpml-product-support');
const {validateMappingPlacemark,validateCoordinateGeometry,validatePayloadParam}=require('./wpml-mapping');
const WPML_CATALOG=require('./data/dji-wpml-fields.json');
const KNOWN_FIELDS=new Set(WPML_CATALOG.fields.map(field=>field.field));
const MODES={
  templateType:['waypoint','mapping2d','mapping3d','mappingStrip'],
  flyToWaylineMode:['safely','pointToPoint'],
  finishAction:['goHome','noAction','autoLand','gotoFirstWaypoint'],
  exitOnRCLost:['goContinue','executeLostAction'],
  executeRCLostAction:['goBack','landing','hover'],
  executeHeightMode:['WGS84','relativeToStartPoint','realTimeFollowSurface'],
  heightMode:['EGM96','relativeToStartPoint','aboveGroundLevel','realTimeFollowSurface'],
  waypointHeadingMode:['followWayline','manually','fixed','smoothTransition','towardPOI'],
  waypointHeadingPathMode:['clockwise','counterClockwise','followBadArc'],
  waypointTurnMode:['coordinateTurn','toPointAndStopWithDiscontinuityCurvature',
    'toPointAndStopWithContinuityCurvature','toPointAndPassWithContinuityCurvature'],
  actionTriggerType:['reachPoint','betweenAdjacentPoints','multipleTiming','multipleDistance'],
  actionActuatorFunc:['takePhoto','startRecord','stopRecord','focus','zoom',
    'customDirName','gimbalRotate','rotateYaw','hover','gimbalEvenlyRotate',
    'accurateShoot','orientedShoot','panoShot','searchlight','recordPointCloud'],
  actionGroupMode:['sequence'],
  coordinateMode:['WGS84']
};
function xmlError(message){throw new Error('Invalid WPML XML: '+message);}
function decodeEntities(input){
  if(/&(?!(?:amp|lt|gt|apos|quot|#\d+|#x[0-9a-fA-F]+);)/.test(input))xmlError('invalid entity');
  return input.replace(/&(amp|lt|gt|apos|quot|#\d+|#x[0-9a-fA-F]+);/g,(_,s)=>{
    if(s==='amp')return '&';
    if(s==='lt')return '<';
    if(s==='gt')return '>';
    if(s==='apos')return "'";
    if(s==='quot')return '"';
    const n=s.startsWith('#x')?parseInt(s.slice(2),16):Number(s.slice(1));
    if(!Number.isInteger(n)||n<1||n>0x10ffff||(n>=0xd800&&n<=0xdfff)||
       (n<32&&n!==9&&n!==10&&n!==13))xmlError('invalid codepoint');
    return String.fromCodePoint(n);
  });
}
function parseXml(xml, expectedWpmlNamespace=WPML){
  // The alternate namespace is accepted ONLY when a caller explicitly opts
  // into read-only analysis. No automatic conversion/export/flight approval.
  if(expectedWpmlNamespace!==WPML&&expectedWpmlNamespace!==WPML_REFERENCE_ONLY)
    xmlError('unsupported WPML namespace profile');
  if(typeof xml!=='string'||Buffer.byteLength(xml,'utf8')>2*1024*1024)xmlError('size limit');
  if(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(xml))xmlError('control character');
  let i=0,root=null,count=0;
  const stack=[];
  while(i<xml.length){
    if(xml.startsWith('<!--',i)){
      const end=xml.indexOf('-->',i+4);
      if(end<0||xml.slice(i+4,end).includes('--'))xmlError('invalid comment');
      i=end+3;continue;
    }
    if(xml.startsWith('<?',i)){
      const end=xml.indexOf('?>',i+2);
      if(end<0)xmlError('unterminated instruction');
      if(!/^<\?xml\s+version\s*=\s*["']1\.[01]["']/.test(xml.slice(i,end+2))||
        root||stack.length)xmlError('unsupported instruction');
      i=end+2;continue;
    }
    if(xml.startsWith('<![CDATA[',i)){
      const end=xml.indexOf(']]>',i+9);
      if(end<0||!stack.length)xmlError('invalid CDATA');
      stack[stack.length-1].text+=xml.slice(i+9,end);
      i=end+3;continue;
    }
    if(xml[i]!=='<'){
      const end=xml.indexOf('<',i);
      const next=end<0?xml.length:end;
      const str=decodeEntities(xml.slice(i,next));
      if(stack.length)stack[stack.length-1].text+=str;
      else if(str.trim())xmlError('content outside root');
      i=next;continue;
    }
    if(xml.startsWith('<!',i))xmlError('DTD/entities forbidden');
    let end=i+1,quote=null;
    for(;end<xml.length;end++){
      const c=xml[end];
      if(quote){if(c===quote)quote=null;}
      else if(c==='"'||c==="'")quote=c;
      else if(c==='>')break;
      else if(c==='<')xmlError('nested markup');
    }
    if(end===xml.length||quote)xmlError('unterminated tag');
    const raw=xml.slice(i+1,end);
    if(raw.startsWith('!'))xmlError('DTD/entities forbidden');
    if(raw.startsWith('/')){
      const match=/^\/([A-Za-z_][\w.:-]*)\s*$/.exec(raw);
      if(!match||!stack.length||stack[stack.length-1].name!==match[1])
        xmlError('unbalanced closing tag');
      stack.pop();i=end+1;continue;
    }
    const match=/^([A-Za-z_][\w.:-]*)([\s\S]*)$/.exec(raw);
    if(!match)xmlError('invalid opening tag');
    const selfClose=/\/\s*$/.test(match[2]);
    const attrs=(selfClose?match[2].replace(/\/\s*$/,''):match[2]);
    const attributes={};let offset=0;
    while(offset<attrs.length){
      if(/^\s*$/.test(attrs.slice(offset)))break;
      const a=/^\s+([A-Za-z_][\w.:-]*)\s*=\s*("[^"]*"|'[^']*')/.exec(attrs.slice(offset));
      if(!a)xmlError('invalid attribute');
      if(Object.hasOwn(attributes,a[1]))xmlError('duplicate attribute');
      attributes[a[1]]=decodeEntities(a[2].slice(1,-1));
      offset+=a[0].length;
    }
    // This parser matches literal element QNames, not expanded W3C namespace
    // names. A nested rebinding would change their meaning. Refuse it.
    if(stack.length>0&&(Object.hasOwn(attributes,'xmlns')||
       Object.hasOwn(attributes,'xmlns:wpml')))
      xmlError('nested namespace rebinding is not supported');
    if(++count>20000||stack.length>=48)xmlError('complexity limit');
    const node={name:match[1],attributes,children:[],text:''};
    if(stack.length)stack[stack.length-1].children.push(node);
    else if(root)xmlError('multiple roots');
    else root=node;
    if(!selfClose)stack.push(node);
    i=end+1;
  }
  if(stack.length||!root)xmlError('incomplete document');
  if(root.name!=='kml'||root.attributes.xmlns!==KML||
     root.attributes['xmlns:wpml']!==expectedWpmlNamespace)
    xmlError('DJI KML/WPML namespace missing');
  return root;
}
const kids=(node,name)=>node?node.children.filter(c=>c.name===name):[];
const one=(node,name)=>kids(node,name)[0]||null;
const value=(node,name)=>one(node,'wpml:'+name)?.text.trim()||'';
const pathError=(errors,path,message)=>errors.push({path,message});
function required(node,name,path,errors){
  const result=value(node,name);
  if(!result)pathError(errors,path+'/'+name,'required field missing');
  return result;
}
function numeric(raw,min,max,path,errors,integer=false){
  if(raw===''||!/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?$/.test(raw)||
     !Number.isFinite(Number(raw))||(integer&&!Number.isInteger(Number(raw)))||
     Number(raw)<min||Number(raw)>max){
    pathError(errors,path,'numeric value out of range');
    return null;
  }
  return Number(raw);
}
function fieldNumber(node,name,min,max,path,errors,mandatory=false,integer=false){
  const raw=mandatory?required(node,name,path,errors):value(node,name);
  if(!raw)return null;
  return numeric(raw,min,max,path+'/'+name,errors,integer);
}
function fieldEnum(node,name,path,errors,mandatory=false){
  const raw=mandatory?required(node,name,path,errors):value(node,name);
  if(raw&&!MODES[name].includes(raw))pathError(errors,path+'/'+name,'unsupported enumeration');
  return raw;
}
function optionalBool(node,name,path,errors){
  const raw=value(node,name);
  if(raw&&raw!=='0'&&raw!=='1')pathError(errors,path+'/'+name,'expected 0 or 1');
  return raw;
}
function coordinateList(raw,hasHeight,path,errors,minPoints=1){
  const tokens=raw.trim().split(/\s+/).filter(Boolean);
  if(tokens.length<minPoints){pathError(errors,path,'insufficient coordinates');return [];}
  const points=[];
  for(const [index,token] of tokens.entries()){
    const parts=token.split(',');
    if(parts.length<(hasHeight?3:2)||parts.length>3){
      pathError(errors,path+'/'+index,'expected longitude,latitude[,height]');continue;
    }
    const coords=parts.map(Number);
    if(parts.some(p=>p.trim()==='')||coords.some(x=>!Number.isFinite(x))||
       coords[0]<-180||coords[0]>180||coords[1]<-90||coords[1]>90){
      pathError(errors,path+'/'+index,'coordinate out of range');continue;
    }
    points.push(coords);
  }
  return points;
}
function mission(document,file,errors){
  const path=file+'/missionConfig';
  const config=one(document,'wpml:missionConfig');
  if(!config){pathError(errors,path,'mission configuration missing');return null;}
  ['flyToWaylineMode','finishAction','exitOnRCLost'].forEach(n=>fieldEnum(config,n,path,errors,true));
  if(value(config,'exitOnRCLost')==='executeLostAction')
    fieldEnum(config,'executeRCLostAction',path,errors,true);
  else fieldEnum(config,'executeRCLostAction',path,errors);
  fieldNumber(config,'takeOffSecurityHeight',1.2,1500,path,errors,true);
  fieldNumber(config,'globalTransitionalSpeed',0.000001,file==='waylines.wpml'?15:100,path,errors,true);
  const drone=one(config,'wpml:droneInfo');
  const payload=one(config,'wpml:payloadInfo');
  if(!drone)pathError(errors,path+'/droneInfo','required element missing');
  if(!payload)pathError(errors,path+'/payloadInfo','required element missing');
  const droneType=drone?fieldNumber(drone,'droneEnumValue',0,65535,path+'/droneInfo',errors,true,true):null;
  const droneSubtype=drone?fieldNumber(drone,'droneSubEnumValue',0,65535,path+'/droneInfo',errors,
    [67,77,91,99,100].includes(droneType),true):null;
  const payloadType=payload?fieldNumber(payload,'payloadEnumValue',0,65535,path+'/payloadInfo',errors,true,true):null;
  const payloadPosition=payload?fieldNumber(payload,'payloadPositionIndex',0,255,
    path+'/payloadInfo',errors,true,true):null;
  const reroute=one(config,'wpml:autoRerouteInfo');
  if(reroute)for(const n of ['missionAutoRerouteMode','transitionalAutoRerouteMode'])
    if(!optionalBool(reroute,n,path+'/autoRerouteInfo',errors))
      pathError(errors,path+'/autoRerouteInfo/'+n,'required reroute mode missing');
  return {droneType,droneSubtype,payloadType,payloadPosition};
}
function heading(node,path,errors){
  if(!node)return;
  const mode=fieldEnum(node,'waypointHeadingMode',path,errors,true);
  if(mode==='smoothTransition')fieldNumber(node,'waypointHeadingAngle',-180,180,path,errors,true);
  else fieldNumber(node,'waypointHeadingAngle',-180,180,path,errors);
  if(mode==='towardPOI'){
    const poi=required(node,'waypointPoiPoint',path,errors);
    if(poi){
      const a=poi.split(',').map(Number);
      if(a.length!==3||poi.split(',').some(x=>x.trim()==='')||
        a.some(x=>!Number.isFinite(x))||Math.abs(a[0])>90||Math.abs(a[1])>180)
        pathError(errors,path+'/waypointPoiPoint','expected latitude,longitude,altitude');
    }
  }
  fieldEnum(node,'waypointHeadingPathMode',path,errors);
}
function turn(node,path,errors,useStraightLine){
  if(!node)return;
  const mode=fieldEnum(node,'waypointTurnMode',path,errors,true);
  const dist=value(node,'waypointTurnDampingDist');
  if(mode==='coordinateTurn'||
     (mode==='toPointAndPassWithContinuityCurvature'&&useStraightLine==='1'))
    fieldNumber(node,'waypointTurnDampingDist',0,100000,path,errors,true);
  else if(dist)numeric(dist,0,100000,path+'/waypointTurnDampingDist',errors);
}
function actionGroups(container,path,errors){
  for(const [i,group] of kids(container,'wpml:actionGroup').entries()){
    checkGroup(group,path+'/actionGroup/'+i,errors);
  }
}
function checkGroup(group,path,errors){
  fieldNumber(group,'actionGroupId',0,65535,path,errors,true,true);
  const start=fieldNumber(group,'actionGroupStartIndex',0,65535,path,errors,true,true);
  const end=fieldNumber(group,'actionGroupEndIndex',0,65535,path,errors,true,true);
  if(start!==null&&end!==null&&end<start)pathError(errors,path,'end index precedes start index');
  fieldEnum(group,'actionGroupMode',path,errors,true);
  const trigger=one(group,'wpml:actionTrigger');
  if(!trigger)pathError(errors,path+'/actionTrigger','required element missing');
  else{
    const type=fieldEnum(trigger,'actionTriggerType',path+'/actionTrigger',errors,true);
    if(['multipleTiming','multipleDistance'].includes(type))
      fieldNumber(trigger,'actionTriggerParam',0.000001,100000,path+'/actionTrigger',errors,true);
  }
  const actions=kids(group,'wpml:action'),used=new Set();
  if(!actions.length)pathError(errors,path,'action list missing');
  for(const [i,action] of actions.entries()){
    const p=path+'/action/'+i;
    const id=fieldNumber(action,'actionId',0,65535,p,errors,true,true);
    if(id!==null){if(used.has(id))pathError(errors,p,'duplicate action ID');used.add(id);}
    const type=fieldEnum(action,'actionActuatorFunc',p,errors,true);
    if(['zoom','takePhoto','startRecord','gimbalRotate','orientedShoot','recordPointCloud'].includes(type)&&
      !one(action,'wpml:actionActuatorFuncParam'))
      pathError(errors,p+'/actionActuatorFuncParam','action parameter missing');
    checkActionParams(one(action,'wpml:actionActuatorFuncParam'),type,p,errors);
  }
}
function checkActionParams(param,type,path,errors){
  if(!param)return;
  const p=path+'/actionActuatorFuncParam';
  if(['takePhoto','startRecord','stopRecord','focus','zoom','customDirName','gimbalRotate',
    'gimbalEvenlyRotate','searchlight','recordPointCloud'].includes(type))
    fieldNumber(param,'payloadPositionIndex',0,7,p,errors,true,true);
  if(type==='zoom')fieldNumber(param,'focalLength',0.000001,10000,p,errors,true);
  if(type==='recordPointCloud'){
    const operation=value(param,'recordPointCloudOperate');
    if(!['startRecord','pauseRecord','resumeRecord','stopRecord'].includes(operation))
      pathError(errors,p+'/recordPointCloudOperate','unsupported or missing point-cloud operation');
  }
  if(type==='focus'){
    ['focusX','focusY','focusRegionWidth','focusRegionHeight'].forEach(name=>
      fieldNumber(param,name,0,1,p,errors));
    optionalBool(param,'isInfiniteFocus',p,errors);
  }
  if(type==='focus')optionalBool(param,'isPointFocus',p,errors);
  if(type==='hover')fieldNumber(param,'hoverTime',0.000001,3600,p,errors,true);
  if(type==='rotateYaw')fieldNumber(param,'aircraftHeading',-180,180,p,errors,true);
  if(type==='customDirName')required(param,'directoryName',p,errors);
  if(type==='searchlight'){
    fieldNumber(param,'searchlightOperateType',0,2,p,errors,true,true);
    fieldNumber(param,'searchlightBrightness',0,100,p,errors,true,true);
  }
  if(type==='gimbalRotate'){
    ['gimbalPitchRotateEnable','gimbalRollRotateEnable','gimbalYawRotateEnable',
      'gimbalRotateTimeEnable'].forEach(n=>optionalBool(param,n,p,errors));
    for(const n of ['gimbalPitchRotateAngle','gimbalRollRotateAngle','gimbalYawRotateAngle'])
      fieldNumber(param,n,-360,360,p,errors);
  }
  if(['takePhoto','startRecord','stopRecord'].includes(type)){
    optionalBool(param,'useGlobalPayloadLensIndex',p,errors);
    const lenses=value(param,'payloadLensIndex');
    if(lenses&&!lenses.split(',').every(x=>
      ['zoom','wide','ir','narrow_band','visible','visable'].includes(x.trim())))
      pathError(errors,p+'/payloadLensIndex','invalid camera lens selection');
  }
}
function validatePoint(placemark,path,errors,executable){
  const point=one(placemark,'Point');
  const coord=point?one(point,'coordinates')?.text.trim():'';
  if(!coord)pathError(errors,path+'/Point','point coordinates missing');
  else{
    const p=coordinateList(coord,false,path+'/Point',errors,1);
    if(p.length!==1)pathError(errors,path+'/Point','exactly one point required');
  }
  const headingNode=one(placemark,'wpml:waypointHeadingParam');
  heading(headingNode,path+'/waypointHeadingParam',errors);
  turn(one(placemark,'wpml:waypointTurnParam'),path+'/waypointTurnParam',errors,
    value(placemark,'useStraightLine'));
  optionalBool(placemark,'useGlobalSpeed',path,errors);
  optionalBool(placemark,'useGlobalHeight',path,errors);
  optionalBool(placemark,'useGlobalHeadingParam',path,errors);
  optionalBool(placemark,'useGlobalTurnParam',path,errors);
  optionalBool(placemark,'useStraightLine',path,errors);
  optionalBool(placemark,'isRisky',path,errors);
  if(executable){
    fieldNumber(placemark,'executeHeight',-10000,100000,path,errors,true);
    if(value(placemark,'useGlobalSpeed')==='0'||value(placemark,'waypointSpeed'))
      fieldNumber(placemark,'waypointSpeed',0.000001,100,path,errors,true);
    if(!headingNode&&value(placemark,'useGlobalHeadingParam')==='0')
      pathError(errors,path,'local heading param required');
    if(!one(placemark,'wpml:waypointTurnParam'))
      pathError(errors,path,'waypoint turn param required');
  }else{
    if(value(placemark,'useGlobalHeight')==='0'){
      fieldNumber(placemark,'ellipsoidHeight',-10000,100000,path,errors,true);
      fieldNumber(placemark,'height',-10000,100000,path,errors,true);
    }
    if(value(placemark,'useGlobalSpeed')==='0')
      fieldNumber(placemark,'waypointSpeed',0.000001,100,path,errors,true);
  }
  actionGroups(placemark,path,errors);
}
function fieldInventoryCoverage(documents){
  const seen=new Set();
  function walk(node){
    if(node.name.startsWith('wpml:')&&node.children.length===0)seen.add(node.name);
    for(const child of node.children)walk(child);
  }
  for(const doc of documents)walk(doc);
  const elements=[...seen].sort();
  return {
    referenceRows:WPML_CATALOG.count,
    documentedUniqueFields:KNOWN_FIELDS.size,
    presentFields:elements.length,
    undocumentedFields:elements.filter(name=>!KNOWN_FIELDS.has(name))
  };
}
function validateDocuments(templateXml,waylinesXml,expectedWpmlNamespace=WPML){
  const errors=[],warnings=[],templates=[],waylines=[];
  let template,execution;
  try{template=parseXml(templateXml,expectedWpmlNamespace);}catch(e){pathError(errors,'template.kml',e.message);}
  try{execution=parseXml(waylinesXml,expectedWpmlNamespace);}catch(e){pathError(errors,'waylines.wpml',e.message);}
  if(!template||!execution)return {valid:false,flightReady:false,validationScope:'offline-partial',errors,warnings,templates,waylines};
  const fieldCoverage=fieldInventoryCoverage([template,execution]);
  if(fieldCoverage.undocumentedFields.length)
    warnings.push('Input contains WPML elements absent from the reference inventory');
  const td=one(template,'Document'),wd=one(execution,'Document');
  if(!td)pathError(errors,'template.kml','Document missing');
  if(!wd)pathError(errors,'waylines.wpml','Document missing');
  if(!td||!wd)return {valid:false,flightReady:false,validationScope:'offline-partial',errors,warnings,templates,waylines};
  const meta=mission(td,'template.kml',errors);
  const execMeta=mission(wd,'waylines.wpml',errors);
  if(meta){
    const assessment=assessAircraft(meta.droneType,meta.droneSubtype,meta.payloadType,meta.payloadPosition);
    meta.model=assessment.model;
    for(const msg of assessment.errors)pathError(errors,'template.kml/missionConfig',msg);
    warnings.push(...assessment.warnings);
  }
  if(execMeta){
    const assessment=assessAircraft(execMeta.droneType,execMeta.droneSubtype,execMeta.payloadType,
      execMeta.payloadPosition);
    execMeta.model=assessment.model;
    for(const msg of assessment.errors)pathError(errors,'waylines.wpml/missionConfig',msg);
  }
  if(meta&&execMeta&&JSON.stringify(meta)!==JSON.stringify(execMeta))
    pathError(errors,'waylines.wpml/missionConfig','aircraft/payload differs from template');
  const templateIds=new Set(),waylineIds=new Set(),actionGroupIds=new Set();
  for(const [i,folder] of kids(td,'Folder').entries()){
    const p='template.kml/Folder/'+i;
    const id=fieldNumber(folder,'templateId',0,65535,p,errors,true,true);
    const type=fieldEnum(folder,'templateType',p,errors,true);
    if(id!==null){
      if(templateIds.has(id))pathError(errors,p,'duplicate template ID');
      templateIds.add(id);
    }
    fieldNumber(folder,'autoFlightSpeed',0.000001,100,p,errors,true);
    const coord=one(folder,'wpml:waylineCoordinateSysParam');
    if(!coord)pathError(errors,p+'/waylineCoordinateSysParam','coordinate system missing');
    else{
      fieldEnum(coord,'coordinateMode',p+'/waylineCoordinateSysParam',errors,true);
      fieldEnum(coord,'heightMode',p+'/waylineCoordinateSysParam',errors,true);
    }
    heading(one(folder,'wpml:globalWaypointHeadingParam'),p+'/globalWaypointHeadingParam',errors);
    validatePayloadParam(folder,p,errors);
    if(type==='waypoint'){
      const placemarks=kids(folder,'Placemark');
      if(!placemarks.length)pathError(errors,p,'waypoint template has no points');
      for(const [j,pm] of placemarks.entries()){
        fieldNumber(pm,'index',0,65535,p+'/Placemark/'+j,errors,true,true);
        validatePoint(pm,p+'/Placemark/'+j,errors,false);
      }
    }else if(['mapping2d','mapping3d','mappingStrip'].includes(type)){
      const pm=kids(folder,'Placemark');
      if(!pm.length)pathError(errors,p,'mapping template has no geometry');
      for(const [j,place] of pm.entries()){
        const pp=p+'/Placemark/'+j;
        const shape=type==='mappingStrip'?'LineString':'Polygon';
        const geom=one(place,shape);
        const ring=shape==='Polygon'?one(one(geom,'outerBoundaryIs'),'LinearRing'):geom;
        const c=one(ring,'coordinates')?.text;
        if(!c)pathError(errors,pp,'mapping geometry missing');
        else {
          const points=coordinateList(c,false,pp,errors,shape==='Polygon'?3:2);
          if(points.length>=(shape==='Polygon'?3:2))
            validateCoordinateGeometry(points,type,pp,errors);
        }
        validateMappingPlacemark(place,type,pp,errors);
      }
    }
    templates.push({templateId:id,templateType:type});
  }
  if(!templates.length)pathError(errors,'template.kml','no template folders');
  for(const [i,folder] of kids(wd,'Folder').entries()){
    const p='waylines.wpml/Folder/'+i;
    const id=fieldNumber(folder,'templateId',0,65535,p,errors,true,true);
    const waylineId=fieldNumber(folder,'waylineId',0,65535,p,errors,true,true);
    const heightMode=fieldEnum(folder,'executeHeightMode',p,errors,true);
    fieldNumber(folder,'autoFlightSpeed',0.000001,100,p,errors,true);
    if(id!==null&&!templateIds.has(id))pathError(errors,p,'template ID has no matching template');
    if(waylineId!==null){
      if(waylineIds.has(waylineId))pathError(errors,p,'duplicate wayline ID');
      waylineIds.add(waylineId);
    }
    const placemarks=kids(folder,'Placemark');
    if(!placemarks.length)pathError(errors,p,'executable route has no waypoints');
    if(placemarks.length>65536)pathError(errors,p,'too many waypoints');
    for(const [j,pm] of placemarks.entries()){
      const pp=p+'/Placemark/'+j;
      const index=fieldNumber(pm,'index',0,65535,pp,errors,true,true);
      if(index!==null&&index!==j)pathError(errors,pp+'/index','indices must be continuous from 0');
      validatePoint(pm,pp,errors,true);
      for(const g of kids(pm,'wpml:actionGroup')){
        const groupKey=value(g,'actionGroupId');
        if(/^\d+$/.test(groupKey)){
          if(actionGroupIds.has(groupKey))
            pathError(errors,pp+'/actionGroup','duplicate action group ID across waylines');
          actionGroupIds.add(groupKey);
        }
        const from=Number(value(g,'actionGroupStartIndex'));
        const to=Number(value(g,'actionGroupEndIndex'));
        if(from>=placemarks.length||to>=placemarks.length)
          pathError(errors,pp+'/actionGroup','action index outside route');
      }
    }
    for(const g of kids(folder,'wpml:startActionGroup')){
      checkGroup(g,p+'/startActionGroup',errors);
      const groupKey=value(g,'actionGroupId');
      if(/^\d+$/.test(groupKey)){
        if(actionGroupIds.has(groupKey))
          pathError(errors,p+'/startActionGroup','duplicate action group ID across waylines');
        actionGroupIds.add(groupKey);
      }
    }
    waylines.push({templateId:id,waylineId,executeHeightMode:heightMode,waypointCount:placemarks.length});
  }
  if(!waylines.length)pathError(errors,'waylines.wpml','no executable folders');
  if(templates.some(t=>t.templateType==='mapping3d')&&waylines.length!==5)
    warnings.push('mapping3d commonly generates five executable waylines; verify with DJI Pilot 2');
  warnings.push('Static validation is not aircraft compatibility certification or flight authorization');
  return {valid:errors.length===0,flightReady:false,validationScope:'offline-partial',errors,warnings,aircraft:meta,templates,waylines,fieldCoverage};
}
module.exports={parseXml,validateDocuments,MODES};
