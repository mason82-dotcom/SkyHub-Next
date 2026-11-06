'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const planar=require('../../frontend/public/wpml-planar-advanced-core');
const rect=[{lat:48,lon:8},{lat:48,lon:8.001},
  {lat:48.001,lon:8.001},{lat:48.001,lon:8}];
test('P0 optimizes independent scan segments and cannot authorize transit',()=>{
 const x=planar.optimize(rect,{spacing:20,optimize:true});
 assert.ok(x.evaluatedHeadingCount>=10);
 assert.ok(x.segmentCount>1);
 assert.equal(x.flightReady,false);
 assert.equal(x.dispatchAllowed,false);
 assert.equal(x.exportableAsWaylines,false);
 assert.ok(x.transitionCandidates.every(t=>!t.flyable&&!t.planned&&!t.safetyVerified));
 assert.equal(planar.optimize(rect,{spacing:20,heading:20}).headingDegrees,20);
});
test('P0 keeps holes and separated polygons without creating flyable gaps',()=>{
 const geo={type:'MultiPolygon',coordinates:[
  [[[8,48],[8.002,48],[8.002,48.002],[8,48.002],[8,48]],
   [[8.0006,48.0006],[8.0012,48.0006],[8.0012,48.0012],
    [8.0006,48.0012],[8.0006,48.0006]]],
  [[[8.003,48],[8.004,48],[8.004,48.001],[8.003,48.001],[8.003,48]]]
 ]};
 const r=planar.optimize(geo,{spacing:25,heading:0});
 assert.equal(r.holeCount,1);
 assert.equal(r.componentCount,2);
 assert.ok(r.unplannedTransitions.every(x=>!x.planned&&!x.flyable));
 assert.ok(r.transitionCandidates.every(x=>x.flightReady===false));
});
test('P1 five direction result needs explicit camera/height inputs and stays experimental',()=>{
 const r=planar.fiveDirection(rect,{spacing:20,heightAGLM:60,pitchDegrees:-60});
 assert.deepEqual(r.passes.map(x=>x.key),['nadir','north','east','south','west']);
 assert.ok(r.passes.every(x=>!x.flightReady&&!x.exportableAsWaylines));
 assert.equal(r.terrainVerified,false);
 assert.ok(r.estimatedCaptureLengthMeters>0);
 assert.throws(()=>planar.fiveDirection(rect,{spacing:20,heightAGLM:60,pitchDegrees:-20}),/pitch/);
});
test('P1 terrain reports missing samples as unknown, not verified clearance',()=>{
 assert.equal(planar.terrainAssessment({status:'unavailable'}).status,'unknown');
 assert.equal(planar.terrainAssessment({status:'ok',minAgl:{aglM:20},
   maxAgl:{aglM:90},profile:[{ground:null,agl:20}]}).status,'unknown');
 const x=planar.terrainAssessment({status:'ok',minAgl:{aglM:10},
   maxAgl:{aglM:125},samples:2,profile:[{ground:100,agl:10}]});
 assert.equal(x.below15m,true);
 assert.equal(x.above120m,true);
 assert.equal(x.flightReady,false);
 assert.equal(x.terrainVerified,false);
});
test('UI requests DEM only from explicit button, never dispatches missions',()=>{
 const dir=path.join(__dirname,'../../frontend/public');
 const h=fs.readFileSync(path.join(dir,'wpml-survey-preview.html'),'utf8');
 const s=fs.readFileSync(path.join(dir,'wpml-planar-ui.js'),'utf8');
 for(const pattern of [/wpml-planar-advanced-core\.js/,/wpml-planar-ui\.js/,
   /id="planar-sweep"/,/id="planar-five"/,/id="planar-terrain"/])
   assert.match(h,pattern);
 assert.match(s,/SkyHubTerrainClient\.profile/);
 assert.doesNotMatch(s,/createKmz|packageKmz|\/api\/mission\/|\/api\/wayline\//);
});