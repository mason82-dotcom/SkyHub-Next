'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {validateDocuments}=require('../wpml');
const {validateMappingPlacemark,validateCoordinateGeometry,
  validatePayloadParam}=require('../wpml-mapping');

function node(name,fields){
  return {name,children:Object.entries(fields).map(([k,v])=>({name:'wpml:'+k,text:String(v),children:[]}))};
}
const COMMON={shootType:'distance',direction:'120',margin:'1',ellipsoidHeight:'153',
  height:'100',elevationOptimizeEnable:'0',smartObliqueEnable:'1'};
function check(fields,type){
  const errors=[];
  validateMappingPlacemark(node('Placemark',fields),type,'template.kml/Placemark',errors);
  return errors;
}
test('DJI mapping2d optional smart-oblique camera settings and required survey fields',()=>{
  assert.deepEqual(check(COMMON,'mapping2d'),[]);
  assert.equal(check({...COMMON,shootType:'everyFiveMeters'},'mapping2d')[0].path,
    'template.kml/Placemark/shootType');
  assert.equal(check({...COMMON,smartObliqueEnable:'2'},'mapping2d')[0].path,
    'template.kml/Placemark/smartObliqueEnable');
  assert.ok(check({...COMMON,direction:'361'},'mapping2d').some(e=>e.path.endsWith('/direction')));
  assert.ok(check({...COMMON,margin:'NaN'},'mapping2d').some(e=>e.path.endsWith('/margin')));
});
test('DJI mapping3d requires oblique gimbal pitch and oblique speed',()=>{
  const fields={...COMMON,inclinedGimbalPitch:'-45',inclinedFlightSpeed:'7'};
  assert.deepEqual(check(fields,'mapping3d'),[]);
  assert.ok(check({...fields,inclinedGimbalPitch:'-181'},'mapping3d').some(e=>e.path.endsWith('inclinedGimbalPitch')));
  assert.ok(check({...fields,inclinedFlightSpeed:'0'},'mapping3d').some(e=>e.path.endsWith('inclinedFlightSpeed')));
});
test('DJI mappingStrip requires corridor parameter group and correct boolean values',()=>{
  const fields={...COMMON,caliFlightEnable:'0',singleLineEnable:'1',boundaryOptimEnable:'0',
    includeCenterEnable:'1',cuttingDistance:'80',leftExtend:'3',rightExtend:'3'};
  assert.deepEqual(check(fields,'mappingStrip'),[]);
  assert.ok(check({...fields,cuttingDistance:'0'},'mappingStrip').some(e=>e.path.endsWith('cuttingDistance')));
  assert.ok(check({...fields,boundaryOptimEnable:'false'},'mappingStrip').some(e=>e.path.endsWith('boundaryOptimEnable')));
});
test('DJI payloadParam supports multispectral narrow_band and validates LiDAR',()=>{
  const container={children:[node('wpml:payloadParam',{payloadPositionIndex:0,imageFormat:'visible,narrow_band',
    returnMode:'dualReturn',samplingRate:120000,scanningMode:'nonRepetitive',
    dewarpingEnable:0,modelColoringEnable:1})]};
  const errors=[];
  validatePayloadParam(container,'template.kml/Folder',errors);
  assert.deepEqual(errors,[]);
  container.children[0]=node('wpml:payloadParam',{payloadPositionIndex:0,
    imageFormat:'visible,narrow_band,narrow_band',samplingRate:90000});
  const wrong=[];
  validatePayloadParam(container,'template.kml/Folder',wrong);
  assert.ok(wrong.some(x=>x.path.endsWith('/imageFormat')));
  assert.ok(wrong.some(x=>x.path.endsWith('/samplingRate')));
});
test('survey polygons must span a nonzero area; corridor requires distinct points',()=>{
  const errors=[];
  validateCoordinateGeometry([[12,48],[13,49],[14,50]],'mapping2d','polygon',errors);
  assert.ok(errors.some(x=>x.message.includes('polygon area')));
  const valid=[];
  validateCoordinateGeometry([[12,48],[13,48],[13,49],[12,48]],'mapping3d','polygon',valid);
  assert.deepEqual(valid,[]);
  const corridor=[];
  validateCoordinateGeometry([[12,48],[12,48]],'mappingStrip','corridor',corridor);
  assert.ok(corridor.some(x=>x.message.includes('degenerate')));
});
const prefix='<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:wpml="http://www.dji.com/wpmz/1.0.2"><Document>';
const suffix='</Document></kml>';
const cfg='<wpml:missionConfig><wpml:flyToWaylineMode>safely</wpml:flyToWaylineMode>'+
  '<wpml:finishAction>goHome</wpml:finishAction><wpml:exitOnRCLost>goContinue</wpml:exitOnRCLost>'+
  '<wpml:takeOffSecurityHeight>20</wpml:takeOffSecurityHeight>'+
  '<wpml:globalTransitionalSpeed>8</wpml:globalTransitionalSpeed>'+
  '<wpml:droneInfo><wpml:droneEnumValue>77</wpml:droneEnumValue>'+
  '<wpml:droneSubEnumValue>2</wpml:droneSubEnumValue></wpml:droneInfo>'+
  '<wpml:payloadInfo><wpml:payloadEnumValue>68</wpml:payloadEnumValue>'+
  '<wpml:payloadPositionIndex>0</wpml:payloadPositionIndex></wpml:payloadInfo></wpml:missionConfig>';
const survey=prefix+cfg+'<Folder><wpml:templateType>mapping2d</wpml:templateType>'+
  '<wpml:templateId>3</wpml:templateId>'+
  '<wpml:autoFlightSpeed>5</wpml:autoFlightSpeed>'+
  '<wpml:payloadParam><wpml:payloadPositionIndex>0</wpml:payloadPositionIndex>'+
  '<wpml:imageFormat>visible,narrow_band</wpml:imageFormat></wpml:payloadParam>'+
  '<wpml:waylineCoordinateSysParam><wpml:coordinateMode>WGS84</wpml:coordinateMode>'+
  '<wpml:heightMode>relativeToStartPoint</wpml:heightMode></wpml:waylineCoordinateSysParam>'+
  '<Placemark><Polygon><outerBoundaryIs><LinearRing><coordinates>'+
  '12.0,48.0,100 12.01,48.0,100 12.01,48.01,100 12.0,48.0,100'+
  '</coordinates></LinearRing></outerBoundaryIs></Polygon>'+
  Object.entries(COMMON).map(([k,v])=>'<wpml:'+k+'>'+v+'</wpml:'+k+'>').join('')+
  '</Placemark></Folder>'+suffix;
const route=prefix+cfg+'<Folder><wpml:templateId>3</wpml:templateId>'+
  '<wpml:waylineId>3</wpml:waylineId><wpml:executeHeightMode>relativeToStartPoint</wpml:executeHeightMode>'+
  '<wpml:autoFlightSpeed>5</wpml:autoFlightSpeed>'+
  '<Placemark><Point><coordinates>12.0,48.0</coordinates></Point><wpml:index>0</wpml:index>'+
  '<wpml:executeHeight>100</wpml:executeHeight><wpml:waypointTurnParam>'+
  '<wpml:waypointTurnMode>toPointAndStopWithDiscontinuityCurvature</wpml:waypointTurnMode>'+
  '</wpml:waypointTurnParam></Placemark></Folder>'+suffix;
test('end-to-end Mavic 3M multispectral mapping template and precomputed wayline pair',()=>{
  const report=validateDocuments(survey,route);
  assert.equal(report.valid,true,JSON.stringify(report.errors));
  assert.equal(report.aircraft.model,'Mavic 3M');
  assert.equal(report.templates[0].templateType,'mapping2d');
  assert.equal(report.waylines[0].templateId,3);
});
test('invalid DJI mapping survey geometry causes offline inspection to fail',()=>{
  const bad=survey.replace('12.01,48.01,100','12.02,48.0,100');
  const report=validateDocuments(bad,route);
  assert.equal(report.valid,false);
  assert.ok(report.errors.some(e=>e.message.includes('degenerate mapping polygon')));
});
