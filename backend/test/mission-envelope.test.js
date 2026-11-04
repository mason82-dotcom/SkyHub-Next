'use strict';
// Flight envelope and release gate against DJI WPML (Cloud API 1.18 / developer.dji.com dji-wpml pages, see mission-envelope.js).
const test=require('node:test');
const assert=require('node:assert/strict');
const planner=require('../../frontend/public/wpml-editor-core');
const {readKmz}=require('../wpml-kmz');
const {computeEnvelope,checkLimits,checkMission,limitsFromEnv,DEFAULT_LIMITS}=require('../mission-envelope');

function plan(over={}){
  return {name:'Feld Nord',model:'mavic3m',speed:5,transitionSpeed:5,takeoffHeight:30,finishAction:'goHome',timestamp:1792573200000,
    waypoints:[{lat:49.12345,lon:8.56789,height:50,photo:false},{lat:49.12445,lon:8.56889,height:50,photo:false},
      {lat:49.12545,lon:8.56989,height:50,photo:false}],...over};
}
const kmz=p=>Buffer.from(planner.build(p).kmz);
function docs(p=plan()){return readKmz(kmz(p));}
const check=(waylines,template)=>{
  const base=computeEnvelope(waylines,template),lim=checkLimits(base.envelope);
  return {errors:[...base.errors,...lim.errors],warnings:[...base.warnings,...lim.warnings],envelope:base.envelope};
};

test('editor route passes; envelope numbers match the geometry',()=>{
  const r=checkMission(kmz(plan()));
  assert.equal(r.ok,true,JSON.stringify(r.errors));
  const e=r.envelope;
  assert.equal(e.aircraft,'Mavic 3M');
  assert.equal(e.droneModelKey,'0-77-2');
  assert.deepEqual(e.payloadModelKeys,['1-68-0']);
  assert.equal(e.maxHeightAboveTakeoffM,50);
  assert.equal(e.waypoints,3);
  assert.ok(e.lengthM>260&&e.lengthM<270,String(e.lengthM));     // 2 × ~133 m
  assert.equal(e.estimatedDurationMin,0.9);                        // 266 m / 5 m/s
  assert.ok(r.warnings.some(w=>/relative to the take-off point/.test(w)),'terrain warning is always raised for relative heights');
});

test('height above 120 m and RTH above the limit block the release',()=>{
  const {waylines,template}=docs();
  const high=waylines.replace(/<wpml:executeHeight>50<\/wpml:executeHeight>/,'<wpml:executeHeight>121</wpml:executeHeight>');
  assert.ok(check(high,template).errors.some(e=>/height 121 m above take-off exceeds 120/.test(e)));
  const rth=waylines.replace(/<wpml:globalRTHHeight>100</,'<wpml:globalRTHHeight>150<');
  assert.ok(check(rth,template).errors.some(e=>/RTH height 150 m exceeds 120/.test(e)));
});

test('DJI required fields: globalRTHHeight, takeOffSecurityHeight range, RC-lost action',()=>{
  const {waylines,template}=docs();
  const noRth=waylines.replace(/<wpml:globalRTHHeight>[^<]*<\/wpml:globalRTHHeight>/,'');
  assert.ok(check(noRth,template).errors.some(e=>/globalRTHHeight missing/.test(e)));
  const low=waylines.replace(/<wpml:takeOffSecurityHeight>30</,'<wpml:takeOffSecurityHeight>1<');
  assert.ok(check(low,template).errors.some(e=>/remote-controller range \[1\.2, 1500\]/.test(e)));
  const noAction=waylines.replace(/<wpml:executeRCLostAction>[^<]*<\/wpml:executeRCLostAction>/,'');
  assert.ok(check(noAction,template).errors.some(e=>/executeRCLostAction missing/.test(e)));
  const cont=noAction.replace('executeLostAction','goContinue');
  const r=check(cont,template);
  assert.ok(!r.errors.some(e=>/RCLost/.test(e)),'goContinue needs no lost action');
  assert.ok(r.warnings.some(w=>/signal loss does not trigger return-to-home/.test(w)));
});

test('speed above 15 m/s and non-positive speed are errors',()=>{
  const {waylines,template}=docs();
  assert.ok(check(waylines.replace(/<wpml:waypointSpeed>5</,'<wpml:waypointSpeed>16<'),template).errors.some(e=>/speed 16 m\/s exceeds 15/.test(e)));
  assert.ok(check(waylines.replace(/<wpml:autoFlightSpeed>5</,'<wpml:autoFlightSpeed>0<'),template).errors.some(e=>/autoFlightSpeed missing or not positive/.test(e)));
});

test('height modes: WGS84 needs a reference point, terrain follow only M3E/M3T/M3M mapping',()=>{
  const {waylines,template}=docs();
  const wgs=waylines.replace('<wpml:executeHeightMode>relativeToStartPoint<','<wpml:executeHeightMode>WGS84<');
  assert.ok(check(wgs,template).errors.some(e=>/WGS84 heights need wpml:takeOffRefPoint/.test(e)));
  // takeOffRefPoint lives in template.kml (lat,lon,ellipsoid height)
  const tpl=template.replace('</wpml:missionConfig>','<wpml:takeOffRefPoint>49.12300,8.56700,110</wpml:takeOffRefPoint></wpml:missionConfig>');
  const withRef=check(wgs.replace(/<wpml:executeHeight>50</g,'<wpml:executeHeight>160<'),tpl);
  assert.equal(withRef.envelope.maxHeightAboveTakeoffM,50);                 // 160 - 110
  assert.ok(withRef.warnings.some(w=>/actual take-off point/.test(w)));
  assert.ok(withRef.envelope.takeOffRefPoint);
  const follow=waylines.replace('<wpml:executeHeightMode>relativeToStartPoint<','<wpml:executeHeightMode>realTimeFollowSurface<');
  assert.ok(check(follow,template).errors.some(e=>/only applies to mapping templates/.test(e)),'waypoint template');
  const m4t=follow.replace('<wpml:droneEnumValue>77<','<wpml:droneEnumValue>99<').replace('<wpml:droneSubEnumValue>2<','<wpml:droneSubEnumValue>1<')
    .replace('<wpml:payloadEnumValue>68<','<wpml:payloadEnumValue>89<');
  assert.ok(check(m4t,template).errors.some(e=>/only supported by M3E\/M3T\/M3M/.test(e)));
  const bad=waylines.replace('<wpml:executeHeightMode>relativeToStartPoint<','<wpml:executeHeightMode>EGM96<');
  assert.ok(check(bad,template).errors.some(e=>/unknown executeHeightMode/.test(e)));
});

test('aircraft: missing, dock-only and mismatched payload are refused',()=>{
  const {waylines,template}=docs();
  assert.ok(check(waylines.replace(/<wpml:droneInfo>[\s\S]*?<\/wpml:droneInfo>/,''),template).errors.some(e=>/aircraft \(wpml:droneEnumValue\) missing/.test(e)));
  const m3d=waylines.replace('<wpml:droneEnumValue>77<','<wpml:droneEnumValue>91<').replace('<wpml:droneSubEnumValue>2<','<wpml:droneSubEnumValue>0<');
  assert.ok(check(m3d,template).errors.some(e=>/dock-only aircraft/.test(e)));
  const wrongCam=waylines.replace('<wpml:payloadEnumValue>68<','<wpml:payloadEnumValue>89<');
  assert.ok(check(wrongCam,template).errors.some(e=>/payloadEnumValue incompatible with Mavic 3M/.test(e)));
});

test('distance, duration and 0/0 coordinates',()=>{
  const far=plan({waypoints:[{lat:49.1,lon:8.5,height:50,photo:false},{lat:49.12,lon:8.5,height:50,photo:false}]});   // ~2.2 km
  const r=checkMission(kmz(far));
  assert.ok(r.errors.some(e=>/more than 2000 m/.test(e)),JSON.stringify(r.errors));
  const slow=plan({speed:1,waypoints:[{lat:49.1,lon:8.5,height:50,photo:false},{lat:49.1153,lon:8.5,height:50,photo:false}]}); // 1.7 km at 1 m/s
  assert.ok(checkMission(kmz(slow)).errors.some(e=>/estimated flight time .* exceeds 25 min/.test(e)));
  const {waylines,template}=docs();
  assert.ok(check(waylines.replace('<coordinates>8.56789,49.12345<','<coordinates>0,0<'),template).errors.some(e=>/0\/0 coordinates/.test(e)));
});

test('garbage KMZ is an error, not an exception',()=>{
  const r=checkMission(Buffer.from('kein zip'));
  assert.equal(r.ok,false);
  assert.match(r.errors[0],/KMZ unreadable/);
});

test('limits from the environment may only tighten the defaults',()=>{
  assert.deepEqual(limitsFromEnv({SKYHUB_MISSION_MAX_HEIGHT_M:'80'}),{maxHeightM:80});
  assert.throws(()=>limitsFromEnv({SKYHUB_MISSION_MAX_HEIGHT_M:'150'}),/\(0, 120\]/);
  assert.throws(()=>limitsFromEnv({SKYHUB_MISSION_MAX_SPEED_MS:'x'}));
  const r=checkMission(kmz(plan()),{maxHeightM:40});
  assert.ok(r.errors.some(e=>/exceeds 40 m/.test(e)));
  assert.equal(DEFAULT_LIMITS.maxHeightM,120);
});
