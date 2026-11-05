'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const zlib=require('node:zlib');
const fs=require('node:fs');
const path=require('node:path');
const planner=require('../../frontend/public/wpml-editor-core');
const importer=require('../../frontend/public/wpml-kmz-import-core');
const {crc32}=require('../wpml-kmz');

const models=planner.MODELS;
function plan(extra={}){
  return {name:'Roundtrip',model:'mavic3m',speed:6,takeoffHeight:25,finishAction:'noAction',
    timestamp:1792573200000,
    waypoints:[{lat:49.1234567,lon:8.6123456,height:60,photo:true},
      {lat:49.124,lon:8.613,height:60},{lat:49.125,lon:8.614,height:60,photo:true}],...extra};
}
// Deflate ZIP writer for test fixtures (DJI Pilot 2 compresses its KMZ entries).
function zip(entries){
  const locals=[],central=[];let offset=0;
  for(const [name,content] of entries){
    const data=Buffer.from(content,'utf8'),packed=zlib.deflateRawSync(data),n=Buffer.from(name);
    const crc=crc32(data);
    const l=Buffer.alloc(30);
    l.writeUInt32LE(0x04034b50,0);l.writeUInt16LE(20,4);l.writeUInt16LE(8,8);
    l.writeUInt32LE(crc,14);l.writeUInt32LE(packed.length,18);l.writeUInt32LE(data.length,22);
    l.writeUInt16LE(n.length,26);
    locals.push(l,n,packed);
    const c=Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50,0);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(8,10);
    c.writeUInt32LE(crc,16);c.writeUInt32LE(packed.length,20);c.writeUInt32LE(data.length,24);
    c.writeUInt16LE(n.length,28);c.writeUInt32LE(offset,42);
    central.push(c,n);
    offset+=30+n.length+packed.length;
  }
  const cd=Buffer.concat(central),e=Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50,0);e.writeUInt16LE(entries.length,8);e.writeUInt16LE(entries.length,10);
  e.writeUInt32LE(cd.length,12);e.writeUInt32LE(offset,16);
  return new Uint8Array(Buffer.concat([...locals,cd,e]));
}
const PILOT2_TEMPLATE=`<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:wpml="http://www.dji.com/wpmz/1.0.6">
<Document>
  <wpml:author>pilot</wpml:author>
  <wpml:missionConfig>
    <wpml:flyToWaylineMode>safely</wpml:flyToWaylineMode>
    <wpml:finishAction>goHome</wpml:finishAction>
    <wpml:exitOnRCLost>goContinue</wpml:exitOnRCLost>
    <wpml:takeOffSecurityHeight>20</wpml:takeOffSecurityHeight>
    <wpml:globalTransitionalSpeed>10</wpml:globalTransitionalSpeed>
    <wpml:globalRTHHeight>100</wpml:globalRTHHeight>
    <wpml:droneInfo><wpml:droneEnumValue>77</wpml:droneEnumValue><wpml:droneSubEnumValue>2</wpml:droneSubEnumValue></wpml:droneInfo>
    <wpml:payloadInfo><wpml:payloadEnumValue>68</wpml:payloadEnumValue><wpml:payloadPositionIndex>0</wpml:payloadPositionIndex></wpml:payloadInfo>
  </wpml:missionConfig>
  <Folder>
    <wpml:templateType>waypoint</wpml:templateType>
    <wpml:templateId>0</wpml:templateId>
    <wpml:waylineCoordinateSysParam><wpml:coordinateMode>WGS84</wpml:coordinateMode><wpml:heightMode>relativeToStartPoint</wpml:heightMode></wpml:waylineCoordinateSysParam>
    <wpml:autoFlightSpeed>7</wpml:autoFlightSpeed>
    <wpml:globalHeight>80</wpml:globalHeight>
    <wpml:gimbalPitchMode>usePointSetting</wpml:gimbalPitchMode>
    <wpml:globalWaypointHeadingParam><wpml:waypointHeadingMode>followWayline</wpml:waypointHeadingMode></wpml:globalWaypointHeadingParam>
    <wpml:globalWaypointTurnMode>toPointAndStopWithDiscontinuityCurvature</wpml:globalWaypointTurnMode>
    <Placemark><Point><coordinates>8.60,49.10</coordinates></Point><wpml:index>0</wpml:index>
      <wpml:ellipsoidHeight>230.5</wpml:ellipsoidHeight><wpml:height>80</wpml:height><wpml:useGlobalHeight>1</wpml:useGlobalHeight>
      <wpml:useGlobalSpeed>1</wpml:useGlobalSpeed><wpml:useGlobalHeadingParam>1</wpml:useGlobalHeadingParam><wpml:useGlobalTurnParam>1</wpml:useGlobalTurnParam>
      <wpml:actionGroup><wpml:actionGroupId>0</wpml:actionGroupId><wpml:actionGroupStartIndex>0</wpml:actionGroupStartIndex><wpml:actionGroupEndIndex>0</wpml:actionGroupEndIndex>
        <wpml:actionGroupMode>sequence</wpml:actionGroupMode><wpml:actionTrigger><wpml:actionTriggerType>reachPoint</wpml:actionTriggerType></wpml:actionTrigger>
        <wpml:action><wpml:actionId>0</wpml:actionId><wpml:actionActuatorFunc>gimbalRotate</wpml:actionActuatorFunc></wpml:action>
        <wpml:action><wpml:actionId>1</wpml:actionId><wpml:actionActuatorFunc>takePhoto</wpml:actionActuatorFunc></wpml:action>
      </wpml:actionGroup>
    </Placemark>
    <Placemark><Point><coordinates>8.601,49.101</coordinates></Point><wpml:index>1</wpml:index>
      <wpml:height>80</wpml:height><wpml:useGlobalHeight>1</wpml:useGlobalHeight>
      <wpml:useGlobalSpeed>0</wpml:useGlobalSpeed><wpml:waypointSpeed>3</wpml:waypointSpeed>
      <wpml:useGlobalHeadingParam>0</wpml:useGlobalHeadingParam><wpml:useGlobalTurnParam>1</wpml:useGlobalTurnParam>
      <wpml:actionGroup><wpml:actionGroupId>1</wpml:actionGroupId><wpml:actionGroupStartIndex>1</wpml:actionGroupStartIndex><wpml:actionGroupEndIndex>1</wpml:actionGroupEndIndex>
        <wpml:actionGroupMode>sequence</wpml:actionGroupMode><wpml:actionTrigger><wpml:actionTriggerType>reachPoint</wpml:actionTriggerType></wpml:actionTrigger>
        <wpml:action><wpml:actionId>0</wpml:actionId><wpml:actionActuatorFunc>takePhoto</wpml:actionActuatorFunc></wpml:action>
      </wpml:actionGroup>
    </Placemark>
    <Placemark><Point><coordinates>8.602,49.102</coordinates></Point><wpml:index>2</wpml:index>
      <wpml:height>80</wpml:height><wpml:useGlobalHeight>1</wpml:useGlobalHeight>
    </Placemark>
  </Folder>
</Document>
</kml>`;

test('SkyHub export re-imports into the identical editable plan',async()=>{
  const built=planner.build(plan());
  const result=await importer.importKmz(built.kmz,{fileName:'Feld Nord.kmz',models});
  assert.equal(result.flightReady,false);
  assert.equal(result.plan.name,'Feld Nord');
  assert.equal(result.plan.model,'mavic3m');
  assert.equal(result.plan.speed,6);
  assert.equal(result.plan.takeoffHeight,25);
  assert.equal(result.plan.finishAction,'noAction');
  assert.equal(result.localHeights,false);
  assert.equal(result.globalHeight,60);
  assert.deepEqual(result.plan.waypoints,plan().waypoints.map(p=>({...p,photo:p.photo===true})));
  assert.deepEqual(result.notes,[]);
  // The imported plan is accepted by the exporter again (dry-run used by the editor).
  planner.normalize(result.plan);
});

test('local heights and interval photos survive the roundtrip',async()=>{
  const local=plan({waypoints:[{lat:49.1,lon:8.6,height:40,ellipsoidHeight:290.25},
    {lat:49.101,lon:8.601,height:55,ellipsoidHeight:305.5}],
    intervalPhotos:{type:'multipleDistance',interval:'15'}});
  const result=await importer.importKmz(planner.build(local).kmz,{fileName:'x.kmz',models});
  assert.equal(result.localHeights,true);
  assert.deepEqual(result.plan.waypoints.map(p=>[p.height,p.ellipsoidHeight]),[[40,290.25],[55,305.5]]);
  assert.deepEqual(result.plan.intervalPhotos,{type:'multipleDistance',interval:'15'});
  planner.normalize(result.plan);
});

test('compressed Pilot 2 style 1.0.6 KMZ imports with every lossy change listed',async()=>{
  const bytes=zip([['wpmz/template.kml',PILOT2_TEMPLATE],['wpmz/res/icon.png','PNG']]);
  const result=await importer.importKmz(bytes,{fileName:'Pilot\u0007 Mission.kmz',models});
  assert.equal(result.plan.name,'Pilot Mission');
  assert.equal(result.plan.speed,7);
  assert.equal(result.globalHeight,80);
  assert.equal(result.localHeights,false);
  assert.deepEqual(result.plan.waypoints.map(p=>p.photo),[false,true,false]);
  assert.ok(result.plan.waypoints.every(p=>p.ellipsoidHeight===undefined));
  const notes=result.notes.join('\n');
  // The source's globalRTHHeight (100 m, within 20–120 m) is now taken over instead of dropped.
  assert.equal(result.plan.rthHeight,100);
  assert.doesNotMatch(notes,/RTH-Höhe/);
  for(const pattern of [/1\.0\.6/,/RC-Signalverlust: Quelle „goContinue/,
    /Übergangsgeschwindigkeit 10/,/usePointSetting/,/eigener Geschwindigkeit/,/eigener Ausrichtung/,
    /Ellipsoidhöhen der Quelle werden ignoriert/,/Nicht übernommene Aktionsgruppen \(1\): WP 1: reachPoint → gimbalRotate, takePhoto/,
    /Ressourcendatei/])assert.match(notes,pattern);
  planner.normalize(result.plan);
});

test('unsupported mission semantics fail closed with a clear reason',async()=>{
  const cases=[
    [PILOT2_TEMPLATE.replace('<wpml:templateType>waypoint','<wpml:templateType>mapping2d'),/keine Wegpunktmission/],
    [PILOT2_TEMPLATE.replace('<wpml:heightMode>relativeToStartPoint','<wpml:heightMode>EGM96'),/Höhenreferenz „EGM96/],
    [PILOT2_TEMPLATE.replace('<wpml:finishAction>goHome','<wpml:finishAction>autoLand'),/Missionsende „autoLand/],
    [PILOT2_TEMPLATE.replace('<wpml:droneEnumValue>77','<wpml:droneEnumValue>12'),/nicht unterstützt/],
    [PILOT2_TEMPLATE.replace('<wpml:index>2</wpml:index>','<wpml:index>5</wpml:index>'),/lückenlos/],
    [PILOT2_TEMPLATE.replace('<coordinates>8.601,49.101','<coordinates>8.601,99'),/außerhalb/],
    [PILOT2_TEMPLATE.replace('<wpml:useGlobalHeight>1</wpml:useGlobalHeight>\n      <wpml:useGlobalSpeed>0',
      '<wpml:useGlobalHeight>0</wpml:useGlobalHeight>\n      <wpml:useGlobalSpeed>0'),/Ellipsoidhöhe/],
    [PILOT2_TEMPLATE.replace('<?xml version="1.0" encoding="UTF-8"?>','<?xml version="1.0"?><!DOCTYPE kml [<!ENTITY x "y">]>'),/DTD/],
    [PILOT2_TEMPLATE.replace('wpmz/1.0.6','wpmz/9.9'),/Namespace/]
  ];
  for(const [xml,pattern] of cases){
    await assert.rejects(importer.importKmz(zip([['wpmz/template.kml',xml]]),{models}),pattern);
  }
});

test('hostile or broken archives are rejected',async()=>{
  const good=planner.build(plan()).kmz;
  await assert.rejects(importer.importKmz(new Uint8Array(10),{models}),/keine gültige/);
  await assert.rejects(importer.importKmz(new TextEncoder().encode('x'.repeat(100)),{models}),/ZIP-Verzeichnis/);
  const corrupt=good.slice();corrupt[60]^=0xff;
  await assert.rejects(importer.importKmz(corrupt,{models}),/CRC32/);
  await assert.rejects(importer.importKmz(zip([['../template.kml','x']]),{models}),/unsicherer Pfad/);
  await assert.rejects(importer.importKmz(zip([['wpmz/waylines.wpml','x']]),{models}),/template\.kml fehlt/);
  await assert.rejects(importer.importKmz(zip([['wpmz/template.kml','x'],['template.kml','y']]),{models}),/mehrdeutig/);
  await assert.rejects(importer.importKmz(new Uint8Array(13*1024*1024),{models}),/12 MiB/);
});

test('editor wires KMZ upload and MinIO library without DJI dispatch paths',()=>{
  const root=path.resolve(__dirname,'../../frontend/public');
  const html=fs.readFileSync(path.join(root,'wpml-editor.html'),'utf8');
  const editor=fs.readFileSync(path.join(root,'wpml-editor.js'),'utf8');
  const client=fs.readFileSync(path.join(root,'wpml-mission-store-client.js'),'utf8');
  const importer=fs.readFileSync(path.join(root,'wpml-kmz-import-core.js'),'utf8');
  assert.match(html,/wpml-kmz-import-core\.js/);
  assert.match(html,/wpml-mission-store-client\.js/);
  assert.match(html,/id="kmz-import-file"/);
  assert.match(html,/id="kmz-import-apply"/);
  assert.doesNotMatch(html,/id="store-token"|type="password"/,'no token field in the home network');
  assert.match(editor,/kmzImport\.importKmz\(/);
  assert.match(editor,/core\.normalize\(result\.plan\)/);
  // The editor and the importer never open network connections themselves.
  for(const code of [editor,importer])
    assert.doesNotMatch(code,/\bfetch\s*\(|XMLHttpRequest|new\s+WebSocket|mqtt\.connect|flighttask|\/api\/mission\/create/i);
  // The client only talks to the authenticated SkyHub mission library.
  assert.match(client,/const STORE='\/api\/wpml\/missions'/);
  const urls=[...client.matchAll(/request\(([^,)]+)/g)].map(m=>m[1].trim()).filter(u=>u!=='url');
  assert.ok(urls.length>=4);
  for(const url of urls)assert.match(url,/^STORE\b/,url);
  assert.doesNotMatch(client,/XMLHttpRequest|new\s+WebSocket|mqtt\.connect|flighttask|wayline\/api/i);
  for(const code of [editor,client])
    assert.doesNotMatch(code,/localStorage|sessionStorage|document\.cookie/,'the access token is never persisted');
});

// Synthetic mapping route as DJI Pilot 2 (RC Plus 2, Matrice 4T, WPML 1.0.6) writes it; coordinates are invented.
const MAPPING_TEMPLATE=`<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:wpml="http://www.dji.com/wpmz/1.0.6">
  <Document>
    <wpml:missionConfig>
      <wpml:flyToWaylineMode>safely</wpml:flyToWaylineMode><wpml:finishAction>goHome</wpml:finishAction>
      <wpml:exitOnRCLost>executeLostAction</wpml:exitOnRCLost><wpml:executeRCLostAction>goBack</wpml:executeRCLostAction>
      <wpml:takeOffSecurityHeight>40</wpml:takeOffSecurityHeight><wpml:globalTransitionalSpeed>15</wpml:globalTransitionalSpeed>
      <wpml:droneInfo><wpml:droneEnumValue>99</wpml:droneEnumValue><wpml:droneSubEnumValue>1</wpml:droneSubEnumValue></wpml:droneInfo>
      <wpml:payloadInfo><wpml:payloadEnumValue>89</wpml:payloadEnumValue><wpml:payloadSubEnumValue>0</wpml:payloadSubEnumValue><wpml:payloadPositionIndex>0</wpml:payloadPositionIndex></wpml:payloadInfo>
    </wpml:missionConfig>
    <Folder>
      <wpml:templateType>mapping2d</wpml:templateType><wpml:templateId>0</wpml:templateId>
      <wpml:waylineCoordinateSysParam><wpml:coordinateMode>WGS84</wpml:coordinateMode><wpml:heightMode>relativeToStartPoint</wpml:heightMode>
        <wpml:globalShootHeight>70</wpml:globalShootHeight><wpml:surfaceFollowModeEnable>1</wpml:surfaceFollowModeEnable></wpml:waylineCoordinateSysParam>
      <wpml:autoFlightSpeed>10</wpml:autoFlightSpeed>
      <Placemark>
        <wpml:smartObliqueEnable>1</wpml:smartObliqueEnable><wpml:shootType>time</wpml:shootType><wpml:direction>112</wpml:direction>
        <wpml:overlap><wpml:orthoCameraOverlapH>80</wpml:orthoCameraOverlapH><wpml:orthoCameraOverlapW>70</wpml:orthoCameraOverlapW></wpml:overlap>
        <Polygon><outerBoundaryIs><LinearRing><coordinates>
          8.600000,49.100000,0 8.601000,49.100000,0 8.601000,49.101000,0 8.600000,49.101000,0 8.600000,49.100000,0
        </coordinates></LinearRing></outerBoundaryIs></Polygon>
        <wpml:height>70</wpml:height>
      </Placemark>
    </Folder>
  </Document>
</kml>`;
const MAPPING_WAYLINES=`<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:wpml="http://www.dji.com/wpmz/1.0.6">
  <Document><Folder>
    <Placemark><Point><coordinates>8.600100,49.100100</coordinates></Point><wpml:index>0</wpml:index></Placemark>
    <Placemark><Point><coordinates>8.600900,49.100100</coordinates></Point><wpml:index>1</wpml:index></Placemark>
    <Placemark><Point><coordinates>8.600900,49.100900</coordinates></Point><wpml:index>2</wpml:index></Placemark>
  </Folder></Document>
</kml>`;

test('mapping routes: import refuses with templateType, preview shows area, flight lines and figures read-only',async()=>{
  const bytes=zip([['wpmz/template.kml',MAPPING_TEMPLATE],['wpmz/waylines.wpml',MAPPING_WAYLINES]]);
  await assert.rejects(importer.importKmz(bytes,{fileName:'x.kmz',models}),e=>e.templateType==='mapping2d'&&/keine Wegpunktmission/.test(e.message));
  const p=await importer.previewKmz(bytes,{fileName:'Michaels_berg.v2.kmz',models});
  assert.equal(p.kind,'mapping');assert.equal(p.label,'Flächenkartierung (2D)');assert.equal(p.wpmlVersion,'1.0.6');
  assert.equal(p.flightReady,false);
  assert.equal(p.name,'Michaels berg v2','DJI name rule (no _ .)');
  assert.equal(p.area.length,4,'closing point removed');assert.equal(p.path.length,3);
  // 0.001° x 0.001° at 49.1° N ≈ 72.9 m x 111.2 m ≈ 0.81 ha
  assert.ok(Math.abs(p.stats.areaM2-8100)<150,String(p.stats.areaM2));
  assert.ok(Math.abs(p.stats.lengthM-(58+89))<5,String(p.stats.lengthM));
  assert.deepEqual([p.stats.shootHeightM,p.stats.terrainFollow,p.stats.overlapH,p.stats.overlapW,p.stats.direction,p.stats.smartOblique,p.stats.speedMs],
    [70,true,80,70,112,true,10]);
  assert.match(p.aircraft,/Matrice 4T|drone 99\/1/);
  // Waypoint routes are not previewed as mapping; broken coordinates fail clearly.
  await assert.rejects(importer.previewKmz(zip([['wpmz/template.kml',MAPPING_TEMPLATE.replace('mapping2d','waypoint')]]),{models}),/keine Kartierungs/);
  await assert.rejects(importer.previewKmz(zip([['wpmz/template.kml',MAPPING_TEMPLATE.replace('8.601000,49.100000,0','8.601,99,0')]]),{models}),/außerhalb/);
});
