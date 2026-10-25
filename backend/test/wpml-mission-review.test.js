'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const review=require('../../frontend/public/wpml-mission-review');
const planner=require('../../frontend/public/wpml-editor-core');

const p=(lat,lon,other={})=>({lat,lon,height:50,...other});
const draft=(waypoints=[p(49,8),p(49.0009,8.0009)],other={})=>({
  name:'Synthetic route',model:'mavic3e',speed:5,globalHeight:50,
  takeoffHeight:30,finishAction:'goHome',localHeights:false,
  photoTrigger:'reachPoint',photoInterval:null,cameraMinIntervalSeconds:null,
  waypoints,...other
});
test('valid nominal draft is only a review, never ready or dispatchable',()=>{
  const result=review.analyze(draft());
  assert.equal(result.status,'review-only');
  assert.equal(result.waypointCount,2);
  assert.ok(result.horizontalDistanceMeters>0);
  assert.ok(result.nominalStraightTravelSeconds>0);
  assert.equal(result.flightReady,false);
  assert.equal(result.hardwareVerified,false);
  assert.equal(result.flightTimeEstimated,false);
  assert.equal(result.missionDispatchEnabled,false);
  assert.equal(Object.isFrozen(result),true);
  assert.equal(Object.isFrozen(result.issueCodes),true);
  assert.throws(()=>{result.flightReady=true},TypeError);
});
test('empty and single waypoint drafts remain explicitly incomplete',()=>{
  for(const points of [[],[p(49,8)]]){
    const r=review.analyze(draft(points));
    assert.equal(r.status,'incomplete');
    assert.ok(r.issueCodes.includes('insufficient-waypoints'));
  }
});
test('all common invalid coordinates, speed, model and duplicates are flagged',()=>{
  for(const data of [
    draft([p(91,8),p(49,8)]),
    draft([p(49,8),p(49,8)]),
    draft(undefined,{speed:0}),
    draft(undefined,{model:'mavic99'}),
    draft(undefined,{photoTrigger:'takeoff'})
  ]) {
    const r=review.analyze(data);
    assert.equal(r.status,'invalid');
    assert.equal(r.flightReady,false);
  }
  assert.equal(review.analyze(draft([p(91,8),p(49,8)])).horizontalDistanceMeters,null);
});
test('local heights require supplied WGS84 values, not derived guesses',()=>{
  const bad=review.analyze(draft([p(49,8,{height:48}),p(49.001,8.001,{height:55,ellipsoidHeight:200})],
    {localHeights:true}));
  assert.equal(bad.status,'invalid');
  assert.ok(bad.issueCodes.includes('missing-ellipsoid'));
  const good=review.analyze(draft([
    p(49,8,{height:48,ellipsoidHeight:198}),
    p(49.001,8.001,{height:55,ellipsoidHeight:200})
  ],{localHeights:true}));
  assert.equal(good.status,'review-only');
  assert.equal(good.flightReady,false);
});
test('antimeridian uses the short great-circle arc and warns about map display',()=>{
  const r=review.analyze(draft([p(10,179.9),p(10,-179.9)]));
  assert.ok(r.horizontalDistanceMeters>21000 && r.horizontalDistanceMeters<23000);
  assert.ok(r.issueCodes.includes('antimeridian'));
  assert.ok(r.issueCodes.includes('long-segment'));
});
test('2 km segment review warning is not treated as an aircraft restriction',()=>{
  const r=review.analyze(draft([p(49,8),p(49.025,8)]));
  assert.equal(r.status,'review-only');
  assert.ok(r.issueCodes.includes('long-segment'));
  assert.match(review.issueLabel('long-segment'),/kein DJI-Limit/);
});
test('periodic photo count is never fabricated from route distance',()=>{
  const r=review.analyze(draft([p(49,8,{photo:true}),p(49.0009,8.0009,{photo:true})],
    {photoTrigger:'multipleDistance'}));
  assert.equal(r.periodicPhotoMode,true);
  assert.equal(r.waypointPhotoCount,0);
  assert.equal(r.flightReady,false);
});
test('review returns aggregates only, not raw positions, keys or import payloads',()=>{
  const input=draft([p(49.1234567,8.9876543,{projectToken:'SENSITIVE'}),
    p(49.1239999,8.9879999)],{projectToken:'SENSITIVE'});
  const r=review.analyze(input);
  const serialized=JSON.stringify(r);
  for(const secret of ['49.1234567','8.9876543','SENSITIVE','projectToken'])
    assert.ok(!serialized.includes(secret),secret);
  assert.equal(review.issueLabel('constructor'),null);
  assert.equal(review.issueLabel('__proto__'),null);
});
test('fail closed for oversized, malformed and non-finite inputs',()=>{
  for (const x of [null,[],42,{waypoints:new Array(501).fill(p(49,8))},
     {waypoints:'not an array'}])
    assert.throws(()=>review.analyze(x),TypeError);
  const bad=review.analyze(draft([p(49,8),p(NaN,Infinity)]));
  assert.equal(bad.status,'invalid');
  assert.equal(bad.horizontalDistanceMeters,null);
});
test('review detects missing name, takeoff and unsupported finish action',()=>{
  for(const [field,value,issue] of [
    ['name','   ','invalid-name'],
    ['name','A'.repeat(71),'invalid-name'],
    ['takeoffHeight',0,'invalid-takeoff-height'],
    ['takeoffHeight',121,'invalid-takeoff-height'],
    ['finishAction','autoLand','invalid-finish-action']
  ]){
    const r=review.analyze(draft(undefined,{[field]:value}));
    assert.equal(r.status,'invalid');
    assert.ok(r.issueCodes.includes(issue),issue);
    assert.equal(r.flightReady,false);
  }
});
test('periodic camera interval obeys same bounds as WPML exporter',()=>{
  for(const [photoTrigger,photoInterval,cameraMinIntervalSeconds,issue] of [
    ['multipleDistance',0,null,'invalid-photo-interval'],
    ['multipleDistance',1001,null,'invalid-photo-interval'],
    ['multipleTiming',61,null,'invalid-photo-interval'],
    ['multipleTiming',3,0,'invalid-camera-min-interval'],
    ['multipleTiming',3,61,'invalid-camera-min-interval'],
    ['multipleDistance',12,4,'camera-interval-too-short'],
    ['multipleTiming',2,3,'camera-interval-too-short']
  ]){
    const r=review.analyze(draft(undefined,{photoTrigger,photoInterval,cameraMinIntervalSeconds}));
    assert.equal(r.status,'invalid');
    assert.ok(r.issueCodes.includes(issue));
    assert.equal(r.flightReady,false);
    assert.equal(r.waypointPhotoCount,0);
  }
});
test('unknown camera cadence is a warning, not evidence of camera verification',()=>{
  const r=review.analyze(draft(undefined,{
    photoTrigger:'multipleDistance',photoInterval:12,cameraMinIntervalSeconds:null
  }));
  assert.equal(r.status,'review-only');
  assert.ok(r.issueCodes.includes('camera-interval-unverified'));
  assert.equal(r.periodicPhotoMode,true);
  assert.equal(r.hardwareVerified,false);
});
test('periodic and per-waypoint photo actions cannot silently coexist',()=>{
  const r=review.analyze(draft([p(49,8,{photo:true}),p(49.001,8.001)],{
    photoTrigger:'multipleTiming',photoInterval:3
  }));
  assert.equal(r.status,'invalid');
  assert.ok(r.issueCodes.includes('photo-mode-conflict'));
});
test('authoritative offline WPML normalizer also rejects inputs flagged by the early review',()=>{
  const base=draft();
  const cases=[
    [{name:''},'invalid-name'],
    [{speed:16},'invalid-speed'],
    [{takeoffHeight:0},'invalid-takeoff-height'],
    [{finishAction:'autoLand'},'invalid-finish-action'],
    [{waypoints:[p(49,8),p(49,8)]},'duplicate-neighbors']
  ];
  for(const [mutation,code] of cases){
    const input={...base,...mutation};
    const result=review.analyze(input);
    assert.equal(result.status,'invalid',code);
    assert.ok(result.issueCodes.includes(code));
    assert.throws(()=>planner.normalize(input),TypeError,code);
  }
  assert.equal(review.analyze(base).status,'review-only');
  assert.doesNotThrow(()=>planner.normalize(base));
});
test('periodic-photo conflicts and cadence violations mirror actual WPML serializer checks',()=>{
  const base=draft(undefined,{photoTrigger:'multipleDistance',photoInterval:12,
    cameraMinIntervalSeconds:4});
  const early=review.analyze(base);
  assert.ok(early.issueCodes.includes('camera-interval-too-short'));
  assert.equal(early.status,'invalid');
  const buildInput={name:base.name,model:base.model,speed:base.speed,
    takeoffHeight:base.takeoffHeight,finishAction:base.finishAction,
    waypoints:base.waypoints,intervalPhotos:{
      type:base.photoTrigger,interval:base.photoInterval,
      cameraMinIntervalSeconds:base.cameraMinIntervalSeconds
    }};
  assert.throws(()=>planner.build(buildInput),/theoretical trigger interval shorter/);
  const valid=draft(undefined,{photoTrigger:'multipleDistance',photoInterval:12,
    cameraMinIntervalSeconds:1});
  const preview=review.analyze(valid);
  assert.equal(preview.status,'review-only');
  assert.equal(preview.flightReady,false);
  const built=planner.build({...buildInput,
    intervalPhotos:{...buildInput.intervalPhotos,cameraMinIntervalSeconds:1}});
  assert.equal(built.flightReady,false);
});
test('editor page and controller present a local-only review, without flight API calls',()=>{
  const root=path.resolve(__dirname,'../../frontend/public');
  const html=fs.readFileSync(path.join(root,'wpml-editor.html'),'utf8');
  const app=fs.readFileSync(path.join(root,'wpml-editor.js'),'utf8');
  const code=fs.readFileSync(path.join(root,'wpml-mission-review.js'),'utf8');
  assert.match(html,/id="mission-review"/);
  assert.match(html,/src="\/wpml-mission-review\.js"/);
  assert.ok(html.indexOf('/wpml-mission-review.js')<html.indexOf('/wpml-editor.js'));
  assert.match(app,/reviewCore\.analyze/);
  assert.match(app,/mission-review/);
  assert.match(app,/reviewCore\.issueLabel/);
  assert.doesNotMatch(code,/\bfetch\s*\(|\bWebSocket\s*\(|\bXMLHttpRequest\b|\bpostMessage\s*\(|\bMQTT\b/i);
  // Existing source comments mention MQTT; reject executable transport calls instead.
  assert.doesNotMatch(app,/\bfetch\s*\(|\bWebSocket\s*\(|\bXMLHttpRequest\b|\bpostMessage\s*\(|\bmqtt\s*\.\s*(?:connect|publish)\s*\(/i);
  assert.doesNotMatch(html,/paas\.js|window\.FH2/);
});
