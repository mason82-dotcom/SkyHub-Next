'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const survey=require('../../frontend/public/wpml-survey-preview-core');
const capture=require('../../frontend/public/wpml-capture-preview-core');
const optics=require('../../frontend/public/wpml-photogrammetry-core');
const CAMERA={sensorWidthMm:13.2,sensorHeightMm:8.8,focalLengthMm:8.8,
  imageWidthPx:5280,imageHeightPx:3956,heightAGLM:60,
  sideOverlapPercent:70,frontOverlapPercent:80,speedMps:6};
function area(span=.001){
  return [{lat:48,lon:8},{lat:48,lon:8+span},
    {lat:48+span,lon:8+span},{lat:48+span,lon:8}];
}
function plan(poly=area()){
  return survey.preview(poly,{heading:0,spacing:optics.optics(CAMERA).stripSpacingM});
}
test('theoretical photo centers match segment image counts and include segment endpoints',()=>{
  const geo=plan(),r=capture.plan(geo,CAMERA);
  assert.equal(r.estimatedImageCount,r.photoCenters.length);
  assert.equal(r.sampleOnly,false);
  assert.equal(r.flightReady,false);
  assert.equal(r.exportableAsWaylines,false);
  assert.equal(r.triggersGenerated,false);
  assert.equal(r.validationScope,'offline-geometric-photo-centers-preview');
  assert.ok(r.nominalMaximumSpacingMeters<=r.targetSpacingMeters*(1+1e-9));
  for(let i=0;i<geo.segments.length;i++){
    const seg=geo.segments[i],pts=r.photoCenters.filter(x=>x.segmentIndex===i);
    assert.equal(pts.length,Math.ceil(seg.lengthMeters/r.targetSpacingMeters)+1);
    assert.equal(pts[0].lat,seg.start.lat);
    assert.equal(pts[0].lon,seg.start.lon);
    assert.equal(pts.at(-1).lat,seg.end.lat);
    assert.equal(pts.at(-1).lon,seg.end.lon);
    for(let j=1;j<pts.length;j++){
      assert.equal(pts[j].photoIndex,j);
      const a=pts[j-1],b=pts[j];
      const distance=Math.hypot((b.lat-a.lat)*111132,
        (b.lon-a.lon)*111320*Math.cos((a.lat+b.lat)*Math.PI/360));
      assert.ok(distance<=r.targetSpacingMeters+0.1);
    }
  }
});
test('concave polygons keep disconnected segments separate and never invent turning legs',()=>{
  const coords=[[0,0],[100,0],[100,100],[70,100],[70,30],[30,30],[30,100],[0,100]];
  const poly=coords.map(([x,y])=>({lat:48+y/111132,
    lon:8+x/(111320*Math.cos(48*Math.PI/180))}));
  const g=survey.preview(poly,{heading:90,spacing:optics.optics(CAMERA).stripSpacingM});
  assert.ok(g.segmentCount>g.stripeCount);
  const result=capture.plan(g,CAMERA);
  assert.equal(result.segmentCount,g.segmentCount);
  assert.equal(result.photoCenters.filter(p=>p.photoIndex===0).length,g.segmentCount);
  assert.equal(result.triggersGenerated,false);
});
test('large camera survey caps map markers and discloses endpoint-only sampling',()=>{
  const large=plan(area(.014));
  const x=capture.plan(large,CAMERA);
  assert.ok(x.estimatedImageCount>2000);
  assert.equal(x.sampleOnly,true);
  assert.equal(x.displayedCenterCount,x.segmentCount*2);
  assert.ok(x.displayedCenterCount<=800);
  assert.match(x.sampleDescription,/endpoints only/);
  assert.equal(x.flightReady,false);
});
test('tampering with preview metadata, coordinates or optical assumptions fails closed',()=>{
  const good=plan(),segment=good.segments[0];
  assert.throws(()=>capture.plan({...good,flightReady:true},CAMERA),/Capture preview invalid/);
  assert.throws(()=>capture.plan({...good,exportableAsWaylines:true},CAMERA),/Capture preview invalid/);
  assert.throws(()=>capture.plan({...good,segments:[{...segment,start:{lat:95,lon:8}}]},CAMERA),
    /invalid segment coordinate/);
  assert.throws(()=>capture.plan({...good,segments:[{...segment,lengthMeters:300}]},CAMERA),
    /segment length inconsistent/);
  assert.throws(()=>capture.plan({...good,segments:[{...segment,stripeIndex:-1}]},CAMERA),
    /stripe index/);
  assert.throws(()=>capture.plan(good,{...CAMERA,sideOverlapPercent:60}),/do not match optical strip spacing/);
});
test('browser visuals and GeoJSON photo samples remain isolated from DJI action writers',()=>{
  const root=path.join(__dirname,'../../frontend/public');
  const html=readFileSync(path.join(root,'wpml-survey-preview.html'),'utf8');
  const ui=readFileSync(path.join(root,'wpml-survey-preview.js'),'utf8');
  const impl=readFileSync(path.join(root,'wpml-capture-preview-core.js'),'utf8');
  assert.match(html,/wpml-capture-preview-core\.js/);
  assert.match(html,/id="show-photo-centers"/);
  assert.match(ui,/capture\.plan\(report,camera\)/);
  assert.match(ui,/nominal-photo-centers-NOT-DJI-actions/);
  assert.doesNotMatch(ui,/\bfetch\s*\(|XMLHttpRequest|new\s+WebSocket|\/api\/mission\/create/);
  assert.doesNotMatch(impl,/\bfetch\s*\(|XMLHttpRequest|new\s+WebSocket|\/api\/mission\/create/);
  assert.doesNotMatch(ui,/createKmz\s*\(|packageKmz\s*\(/);
});
