'use strict';
// Orbit generator, POI heading, gimbal pitch and pass-through turns of the waypoint editor (DJI WPML common elements).
const test=require('node:test');
const assert=require('node:assert/strict');
const core=require('../../frontend/public/wpml-editor-core');
const {validateDocuments}=require('../wpml');
const {checkMission}=require('../mission-envelope');

const plan=o=>({name:'Orbit Test',model:'matrice4t',speed:4,waypoints:o.waypoints,turnMode:o.turnMode,turnDampingM:o.turnDampingM,timestamp:1792573200000});

test('orbit: closed circle, equal radius, nose and gimbal toward the POI',()=>{
  const o=core.orbit({center:{lat:49.1,lon:8.5},radiusM:30,points:12,heightM:40,poiHeightM:10});
  assert.equal(o.waypoints.length,13);
  assert.deepEqual([o.waypoints[0].lat,o.waypoints[0].lon],[o.waypoints[12].lat,o.waypoints[12].lon],'closed loop');
  assert.equal(o.waypoints[12].photo,false,'no duplicate photo at the closing point');
  assert.equal(o.gimbalPitch,-45);                                 // atan(30/30)
  for(const p of o.waypoints){
    const d=Math.hypot((p.lat-49.1)*111195,(p.lon-8.5)*111195*Math.cos(49.1*Math.PI/180));
    assert.ok(Math.abs(d-30)<0.3,String(d));
  }
  // counter-clockwise goes the other way round
  const ccw=core.orbit({center:{lat:49.1,lon:8.5},radiusM:30,points:12,heightM:40,direction:'ccw'});
  assert.ok(ccw.waypoints[1].lon<8.5&&o.waypoints[1].lon>8.5);
  assert.equal(core.orbit({center:{lat:49.1,lon:8.5},radiusM:20,points:8,heightM:20,poiHeightM:60}).gimbalPitch,35,'clamped to +35°');
  assert.throws(()=>core.orbit({center:{lat:49.1,lon:8.5},radiusM:2,points:8,heightM:40}),/radius/);
  assert.throws(()=>core.orbit({center:{lat:49.1,lon:8.5},radiusM:30,points:8,heightM:150}),/height/);
});

test('export: towardPOI, gimbalRotate before takePhoto, damping capped to the DJI segment rule; valid and releasable',()=>{
  const o=core.orbit({center:{lat:49.1,lon:8.5},radiusM:30,points:12,heightM:40,poiHeightM:10});
  const d=core.documents(plan(o));
  const marks=d.waylinesXml.match(/<Placemark>.*?<\/Placemark>/gs);
  assert.equal(marks.length,13);
  assert.match(marks[0],/<wpml:waypointHeadingMode>towardPOI<.*<wpml:waypointPoiPoint>49\.1000000,8\.5000000,0\.000000</s);
  assert.match(marks[0],/toPointAndStopWithDiscontinuityCurvature/,'first waypoint stops');
  assert.match(marks[12],/toPointAndStopWithDiscontinuityCurvature/,'last waypoint stops');
  const damping=Number(/<wpml:waypointTurnDampingDist>([\d.]+)</.exec(marks[1])[1]);
  assert.match(marks[1],/toPointAndPassWithContinuityCurvature/);
  assert.ok(damping<=0.45*o.segmentM+0.05&&damping<o.turnDampingM,'capped: '+damping);
  assert.match(marks[1],/gimbalRotate.*gimbalPitchRotateAngle>-45<.*takePhoto/s);
  assert.doesNotMatch(marks[12],/takePhoto/);
  assert.match(d.templateXml,/<wpml:useGlobalHeadingParam>0<\/wpml:useGlobalHeadingParam><wpml:waypointHeadingParam><wpml:waypointHeadingMode>towardPOI/);
  const v=validateDocuments(d.templateXml,d.waylinesXml);
  assert.deepEqual(v.errors,[]);
  const r=checkMission(Buffer.from(core.build(plan(o)).kmz));
  assert.equal(r.ok,true,JSON.stringify(r.errors));
});

test('plain routes are unchanged; invalid POI and pitch are refused',()=>{
  const base={name:'Plain',model:'mavic3e',speed:5,timestamp:1792573200000,
    waypoints:[{lat:49.1,lon:8.5,height:50},{lat:49.101,lon:8.5,height:50}]};
  const d=core.documents(base);
  assert.doesNotMatch(d.waylinesXml,/towardPOI|gimbalRotate|useStraightLine|PassWith/);
  assert.throws(()=>core.normalize({...base,waypoints:[{...base.waypoints[0],gimbalPitch:-100},base.waypoints[1]]}),/gimbalPitch/);
  assert.throws(()=>core.normalize({...base,waypoints:[{...base.waypoints[0],poi:{lat:49.1,lon:8.5}},base.waypoints[1]]}),/equals the waypoint/);
  assert.throws(()=>core.normalize({...base,turnMode:'loop'}),/turnMode/);
});
