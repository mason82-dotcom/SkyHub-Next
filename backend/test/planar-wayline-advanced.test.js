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
 assert.deepEqual(r.passes.map(x=>x.key),['nadir','direction1','direction2','direction3','direction4']);
 assert.ok(r.passes.every(x=>!x.flightReady&&!x.exportableAsWaylines));
 assert.equal(r.terrainVerified,false);
 assert.ok(r.estimatedCaptureLengthMeters>0);
 assert.throws(()=>planar.fiveDirection(rect,{spacing:20,heightAGLM:60,pitchDegrees:-20}),/pitch/);
});
function validTerrain(min=10,max=125){
 return {status:'ok',minAgl:{aglM:min},maxAgl:{aglM:max},
   dataset:'eudem25m',samples:2,missing:0,assumedTakeoff:false,
   profile:[{d:0,ground:100,flight:110,agl:10},
     {d:100,ground:101,flight:109,agl:8}]};
}
test('P3 DEM rejects null, incomplete, inconsistent and ambiguous heights',()=>{
 assert.equal(planar.terrainAssessment({status:'unavailable'}).status,'unknown');
 const t=validTerrain();
 for(const bad of [
   {...t,minAgl:{aglM:null}},
   {...t,minAgl:{aglM:'10'}},
   {...t,samples:3},
   {...t,missing:1},
   {...t,profile:[]},
   {...t,profile:[...t.profile.slice(0,1),{d:99,ground:null,flight:100,agl:10}]},
   {...t,profile:[...t.profile.slice(0,1),{d:99,ground:100,flight:100,agl:10}]},
   {...t,assumedTakeoff:undefined}
 ])assert.equal(planar.terrainAssessment(bad).status,'unknown',JSON.stringify(bad));
 const valid=planar.terrainAssessment(validTerrain());
 assert.equal(valid.below15m,true);
 assert.equal(valid.above120m,true);
 assert.equal(valid.terrainVerified,false);
 assert.equal(valid.flightReady,false);
});
test('P3 independent scan aggregation never implies unchecked strips are safe',()=>{
 const x=planar.terrainAssessment(validTerrain());
 const partial=planar.assessTerrainSegments([x,{status:'unknown'}],10);
 assert.equal(partial.status,'partial');
 assert.deepEqual([partial.sampledSegmentCount,partial.failedSegmentCount,
   partial.notRequestedSegmentCount],[1,1,8]);
 assert.equal(partial.coverageComplete,false);
 assert.equal(partial.minAglM,10);
 assert.equal(partial.maxAglM,125);
 assert.equal(partial.terrainVerified,false);
 assert.equal(partial.flightReady,false);
 const complete=planar.assessTerrainSegments([x,x],2);
 assert.equal(complete.status,'sampled-all');
 assert.equal(complete.coverageComplete,true);
 assert.equal(complete.obstacleClearanceVerified,false);
 assert.equal(complete.exportableAsWaylines,false);
 const unknown=planar.assessTerrainSegments([{status:'unknown'}],3);
 assert.equal(unknown.status,'unknown');
 assert.equal(unknown.minAglM,null);
 assert.throws(()=>planar.assessTerrainSegments(Array(9).fill(x),9),/batch size/);
});
test('UI requests DEM only from explicit button, never dispatches missions',()=>{
 const dir=path.join(__dirname,'../../frontend/public');
 const h=fs.readFileSync(path.join(dir,'wpml-survey-preview.html'),'utf8');
 const s=fs.readFileSync(path.join(dir,'wpml-planar-ui.js'),'utf8');
 for(const pattern of [/wpml-planar-advanced-core\.js/,/wpml-planar-ui\.js/,
   /id="planar-sweep"/,/id="planar-five"/,/id="planar-terrain"/])
   assert.match(h,pattern);
 assert.match(s,/terrain\.profile/);
 assert.doesNotMatch(s,/createKmz|packageKmz|\/api\/mission\/|\/api\/wayline\//);
});
test('P3 UI shows opt-in candidates and requires explicit takeoff position',()=>{
 const base=path.join(__dirname,'../../frontend/public');
 const html=fs.readFileSync(path.join(base,'wpml-survey-preview.html'),'utf8');
 const ui=fs.readFileSync(path.join(base,'wpml-planar-ui.js'),'utf8');
 const survey=fs.readFileSync(path.join(base,'wpml-survey-preview.js'),'utf8');
 for(const id of ['planar-show-candidates','planar-takeoff-lat',
   'planar-takeoff-lon','planar-terrain'])
   assert.match(html,new RegExp('id="'+id+'"'));
 assert.match(ui,/readTakeoff\(\)/);
 assert.match(ui,/segments\.slice\(0,8\)/);
 assert.match(ui,/terrain\.profile\(points,\{takeoff:ref,signal:ctrl\.signal\}\)/);
 assert.match(ui,/assessTerrainSegments\(results,current\.segmentCount\)/);
 assert.match(ui,/window\.addEventListener\('skyhub-survey-invalidated',invalidate\)/);
 assert.match(survey,/window\.dispatchEvent\(new Event\('skyhub-survey-invalidated'\)\)/);
 assert.match(survey,/showCandidates&&Array\.isArray/);
 assert.doesNotMatch(ui,/createKmz|packageKmz|wayline\/api|\/api\/mission\/create/);
});
test('P3 DEM client forwards explicit start coordinate and AbortSignal without URL changes',async()=>{
 const vm=require('node:vm');
 const source=fs.readFileSync(path.join(__dirname,'../../frontend/public/wpml-terrain-client.js'),'utf8');
 const captured=[];
 const fakeWindow={};
 const fakeFetch=async(url,opts)=>{
   captured.push({url,opts});
   return {ok:true,status:200,json:async()=>({status:'ok'})};
 };
 vm.runInNewContext(source,{window:fakeWindow,fetch:fakeFetch});
 const points=[{lat:48,lon:8,h:50},{lat:48.0001,lon:8.0001,h:50}];
 const ctrl=new AbortController();
 const r=await fakeWindow.SkyHubTerrainClient.profile(points,{
   takeoff:{lat:48,lon:8},signal:ctrl.signal
 });
 assert.equal(r.status,'ok');
 assert.equal(captured[0].url,'/api/terrain/profile');
 assert.equal(captured[0].opts.method,'POST');
 assert.equal(captured[0].opts.signal,ctrl.signal);
 assert.deepEqual(JSON.parse(captured[0].opts.body),{points,takeoff:{lat:48,lon:8}});
 await fakeWindow.SkyHubTerrainClient.profile(points);
 assert.deepEqual(JSON.parse(captured[1].opts.body),{points});
});
