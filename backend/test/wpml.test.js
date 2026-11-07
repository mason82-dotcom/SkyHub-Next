'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {validateDocuments,parseXml}=require('../wpml');
const {readKmz,inspectKmz,packageKmz}=require('../wpml-kmz');
const START='<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:wpml="http://www.dji.com/wpmz/1.0.2"><Document>';
const END='</Document></kml>';
const MISSION='<wpml:missionConfig><wpml:flyToWaylineMode>safely</wpml:flyToWaylineMode>'+
  '<wpml:finishAction>goHome</wpml:finishAction><wpml:exitOnRCLost>goContinue</wpml:exitOnRCLost>'+
  '<wpml:takeOffSecurityHeight>20</wpml:takeOffSecurityHeight>'+
  '<wpml:globalTransitionalSpeed>8</wpml:globalTransitionalSpeed>'+
  '<wpml:droneInfo><wpml:droneEnumValue>67</wpml:droneEnumValue>'+
  '<wpml:droneSubEnumValue>0</wpml:droneSubEnumValue></wpml:droneInfo>'+
  '<wpml:payloadInfo><wpml:payloadEnumValue>52</wpml:payloadEnumValue>'+
  '<wpml:payloadPositionIndex>0</wpml:payloadPositionIndex></wpml:payloadInfo></wpml:missionConfig>';
const POINT='<Point><coordinates>12.34,48.56</coordinates></Point>';
const ACTION='<wpml:actionGroup><wpml:actionGroupId>0</wpml:actionGroupId>'+
  '<wpml:actionGroupStartIndex>0</wpml:actionGroupStartIndex>'+
  '<wpml:actionGroupEndIndex>0</wpml:actionGroupEndIndex>'+
  '<wpml:actionGroupMode>sequence</wpml:actionGroupMode>'+
  '<wpml:actionTrigger><wpml:actionTriggerType>reachPoint</wpml:actionTriggerType></wpml:actionTrigger>'+
  '<wpml:action><wpml:actionId>0</wpml:actionId>'+
  '<wpml:actionActuatorFunc>takePhoto</wpml:actionActuatorFunc>'+
  '<wpml:actionActuatorFuncParam><wpml:payloadPositionIndex>0</wpml:payloadPositionIndex>'+
  '</wpml:actionActuatorFuncParam></wpml:action></wpml:actionGroup>';
const template=START+MISSION+'<Folder><wpml:templateType>waypoint</wpml:templateType>'+
  '<wpml:templateId>0</wpml:templateId><wpml:autoFlightSpeed>7</wpml:autoFlightSpeed>'+
  '<wpml:waylineCoordinateSysParam><wpml:coordinateMode>WGS84</wpml:coordinateMode>'+
  '<wpml:heightMode>relativeToStartPoint</wpml:heightMode></wpml:waylineCoordinateSysParam>'+
  '<Placemark>'+POINT+'<wpml:index>0</wpml:index>'+
  '<wpml:useGlobalHeight>1</wpml:useGlobalHeight>'+
  '<wpml:useGlobalSpeed>1</wpml:useGlobalSpeed></Placemark></Folder>'+END;
const waylines=START+MISSION+'<Folder><wpml:templateId>0</wpml:templateId>'+
  '<wpml:waylineId>0</wpml:waylineId><wpml:executeHeightMode>relativeToStartPoint</wpml:executeHeightMode>'+
  '<wpml:autoFlightSpeed>7</wpml:autoFlightSpeed>'+
  '<Placemark>'+POINT+'<wpml:index>0</wpml:index>'+
  '<wpml:executeHeight>40</wpml:executeHeight>'+
  '<wpml:waypointTurnParam><wpml:waypointTurnMode>toPointAndStopWithDiscontinuityCurvature</wpml:waypointTurnMode>'+
  '</wpml:waypointTurnParam>'+ACTION+'</Placemark></Folder>'+END;

test('DJI WPML valid waypoint template/action and executable route',()=>{
  const x=validateDocuments(template,waylines);
  assert.equal(x.valid,true,JSON.stringify(x.errors));
  assert.equal(x.flightReady,false);
  assert.equal(x.validationScope,'offline-partial');
  assert.deepEqual(x.templates,[{templateId:0,templateType:'waypoint'}]);
  assert.equal(x.waylines[0].waypointCount,1);
  assert.equal(x.aircraft.droneType,67);
  assert.equal(x.fieldCoverage.referenceRows,250);
  assert.equal(x.fieldCoverage.documentedUniqueFields,160);
  assert.deepEqual(x.fieldCoverage.undocumentedFields,[]);
});
test('KMZ pack/inspect reads wpmz paths and validates CRC',()=>{
  const b=packageKmz(template,waylines);
  assert.equal(b.subarray(0,2).toString(),'PK');
  assert.equal(readKmz(b).template,template);
  const x=inspectKmz(b);
  assert.equal(x.valid,true,JSON.stringify(x.errors));
  assert.equal(x.resourceCount,0);
  const corrupted=Buffer.from(b);
  const index=corrupted.indexOf(Buffer.from('48.56'));
  assert.notEqual(index,-1);
  corrupted[index]=49;
  assert.throws(()=>readKmz(corrupted),/CRC32/);
});
test('XML DTD, entities and processing instructions cannot be executed',()=>{
  assert.throws(()=>parseXml('<!DOCTYPE kml [<!ENTITY x SYSTEM "file:///etc/passwd">]>'+template),/DTD/);
  assert.throws(()=>parseXml(template.replace('12.34','&leak;')),/entity/);
  assert.throws(()=>parseXml(template.replace('<Document>','<Document><?pi data?>')),/instruction/);
});
test('KMZ rejects missing or malformed archive and non-buffer values',()=>{
  assert.throws(()=>readKmz(Buffer.from('not a zip')),/size/);
  assert.throws(()=>readKmz('not a buffer'),/size/);
  assert.throws(()=>packageKmz(template,'<root />'),/invalid WPML/);
});
test('cross-file template ID and waypoint IDs must match DJI rules',()=>{
  const other=waylines.replace('<wpml:templateId>0','<wpml:templateId>1');
  assert.ok(validateDocuments(template,other).errors.some(e=>/no matching template/.test(e.message)));
  const index=waylines.replace('<wpml:index>0','<wpml:index>3');
  assert.ok(validateDocuments(template,index).errors.some(e=>/continuous/.test(e.message)));
});
test('invalid coordinates, speeds, height modes and safety modes are rejected',()=>{
  assert.equal(validateDocuments(template.replace('12.34,48.56','190,48.56'),waylines).valid,false);
  assert.equal(validateDocuments(template.replace('<wpml:autoFlightSpeed>7','<wpml:autoFlightSpeed>-3'),waylines).valid,false);
  assert.equal(validateDocuments(template,waylines.replace('relativeToStartPoint</wpml:executeHeightMode>',
    'EGM96</wpml:executeHeightMode>')).valid,false);
  assert.equal(validateDocuments(template.replace('goContinue','executeLostAction'),waylines).valid,false);
});
test('unsupported actuator and invalid action trigger are rejected',()=>{
  assert.equal(validateDocuments(template,waylines.replace('>takePhoto<','>launchAircraft<')).valid,false);
  const mod=waylines.replace('<wpml:actionTriggerType>reachPoint</wpml:actionTriggerType>',
    '<wpml:actionTriggerType>multipleTiming</wpml:actionTriggerType>');
  assert.equal(validateDocuments(template,mod).valid,false);
  assert.equal(validateDocuments(template,mod.replace('</wpml:actionTrigger>',
    '<wpml:actionTriggerParam>2</wpml:actionTriggerParam></wpml:actionTrigger>')).valid,true);
});
test('local heading towardPOI requires latitude/longitude/height',()=>{
  const before='<wpml:executeHeight>40</wpml:executeHeight>';
  const param='<wpml:waypointHeadingParam><wpml:waypointHeadingMode>towardPOI</wpml:waypointHeadingMode>'+
    '</wpml:waypointHeadingParam>';
  assert.equal(validateDocuments(template,waylines.replace(before,before+param)).valid,false);
  const withPoi=param.replace('</wpml:waypointHeadingParam>',
    '<wpml:waypointPoiPoint>48.5,12.3,0</wpml:waypointPoiPoint></wpml:waypointHeadingParam>');
  assert.equal(validateDocuments(template,waylines.replace(before,before+withPoi)).valid,true);
});


// Append a stored resource to the existing two-entry KMZ, preserving ZIP offsets.
// This fixture never touches the file system or any DJI endpoint.
function withResource(kmz,resource='wpmz/res/photo.bin',bytes=Buffer.from([1,2,3,4])){
  const e=kmz.length-22;
  const oldDir=kmz.readUInt32LE(e+16);
  const name=Buffer.from(resource);
  const checksum=require('../wpml-kmz').crc32(bytes);
  const local=Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50,0);
  local.writeUInt16LE(20,4);
  local.writeUInt16LE(0x800,6);
  local.writeUInt32LE(checksum,14);
  local.writeUInt32LE(bytes.length,18);
  local.writeUInt32LE(bytes.length,22);
  local.writeUInt16LE(name.length,26);
  const directory=Buffer.alloc(46);
  directory.writeUInt32LE(0x02014b50,0);
  directory.writeUInt16LE(20,4);
  directory.writeUInt16LE(20,6);
  directory.writeUInt16LE(0x800,8);
  directory.writeUInt32LE(checksum,16);
  directory.writeUInt32LE(bytes.length,20);
  directory.writeUInt32LE(bytes.length,24);
  directory.writeUInt16LE(name.length,28);
  directory.writeUInt32LE(oldDir,42);
  const eocd=Buffer.from(kmz.subarray(e));
  eocd.writeUInt16LE(3,8);
  eocd.writeUInt16LE(3,10);
  eocd.writeUInt32LE(kmz.readUInt32LE(e+12)+directory.length+name.length,12);
  const localBytes=Buffer.concat([local,name,bytes]);
  eocd.writeUInt32LE(oldDir+localBytes.length,16);
  return Buffer.concat([kmz.subarray(0,oldDir),localBytes,
    kmz.subarray(oldDir,e),directory,name,eocd]);
}
test('KMZ resource data are verified even when not exposed to API callers',()=>{
  const kmz=withResource(packageKmz(template,waylines));
  const parsed=readKmz(kmz);
  assert.equal(parsed.resourceCount,1);
  assert.equal(inspectKmz(kmz).valid,true);
  assert.equal(JSON.stringify(parsed).includes('photo.bin'),false);
  const modified=Buffer.from(kmz);
  const member=modified.indexOf(Buffer.from([1,2,3,4]));
  assert.notEqual(member,-1);
  modified[member]^=0x30;
  assert.throws(()=>readKmz(modified),/CRC32/);
});
test('KMZ rejects unsafe resource paths and mismatched local headers',()=>{
  const original=packageKmz(template,waylines);
  assert.throws(()=>readKmz(withResource(original,'wpmz/res/../data.bin')),/Unsafe/);
  const kmz=withResource(original);
  const changed=Buffer.from(kmz);
  const directoryOffset=original.readUInt32LE(original.length-22+16);
  changed.writeUInt16LE(8,directoryOffset+8);
  assert.throws(()=>readKmz(changed),/ZIP headers disagree/);
  const flags=Buffer.from(kmz);
  flags.writeUInt16LE(1,directoryOffset+6);
  assert.throws(()=>readKmz(flags),/ZIP flags disagree/);
});

test('DJI LiDAR recordPointCloud requires a valid capture operation',()=>{
  const lidar=waylines.replace('>takePhoto<','>recordPointCloud<')
    .replace('</wpml:actionActuatorFuncParam>',
      '<wpml:recordPointCloudOperate>startRecord</wpml:recordPointCloudOperate>'+
      '</wpml:actionActuatorFuncParam>');
  const good=validateDocuments(template,lidar);
  assert.equal(good.valid,true,JSON.stringify(good.errors));
  assert.equal(validateDocuments(template,lidar.replace('>startRecord</wpml:recordPointCloudOperate>',
    '>launch</wpml:recordPointCloudOperate>')).valid,false);
  assert.equal(validateDocuments(template,waylines.replace('>takePhoto<','>recordPointCloud<')).valid,false);
});
test('focus coordinates and sensor flag obey DJI 0–1 normalized range',()=>{
  const focus=waylines.replace('>takePhoto<','>focus<')
    .replace('</wpml:actionActuatorFuncParam>',
      '<wpml:isPointFocus>1</wpml:isPointFocus><wpml:focusX>0.5</wpml:focusX>'+
      '<wpml:focusY>0.5</wpml:focusY></wpml:actionActuatorFuncParam>');
  assert.equal(validateDocuments(template,focus).valid,true);
  const invalid=focus.replace('<wpml:focusX>0.5','<wpml:focusX>1.5');
  assert.ok(validateDocuments(template,invalid).errors.some(x=>x.path.endsWith('/focusX')));
});

test('DJI Waylines global transition speed is capped at 15 m/s',()=>{
  const fast=waylines.replace('<wpml:globalTransitionalSpeed>8',
    '<wpml:globalTransitionalSpeed>16');
  assert.ok(validateDocuments(template,fast).errors.some(e=>
    e.path.endsWith('/globalTransitionalSpeed')));
});
test('DJI straight-line through-waypoint turns require a damping distance',()=>{
  const pass=waylines.replace(
    'toPointAndStopWithDiscontinuityCurvature</wpml:waypointTurnMode>',
    'toPointAndPassWithContinuityCurvature</wpml:waypointTurnMode>')
    .replace('</wpml:waypointTurnParam>',
      '</wpml:waypointTurnParam><wpml:useStraightLine>1</wpml:useStraightLine>');
  const missing=validateDocuments(template,pass);
  assert.ok(missing.errors.some(e=>e.path.endsWith('/waypointTurnDampingDist')));
  const withDamping=pass.replace('</wpml:waypointTurnParam>',
    '<wpml:waypointTurnDampingDist>2</wpml:waypointTurnDampingDist></wpml:waypointTurnParam>');
  assert.equal(validateDocuments(template,withDamping).valid,true);
});
test('POI with an empty coordinate component is never silently interpreted as zero',()=>{
  const param='<wpml:waypointHeadingParam><wpml:waypointHeadingMode>towardPOI</wpml:waypointHeadingMode>'+
    '<wpml:waypointPoiPoint>48.5,,0</wpml:waypointPoiPoint></wpml:waypointHeadingParam>';
  const route=waylines.replace('<wpml:executeHeight>40</wpml:executeHeight>',
    '<wpml:executeHeight>40</wpml:executeHeight>'+param);
  assert.ok(validateDocuments(template,route).errors.some(e=>e.path.endsWith('/waypointPoiPoint')));
});
