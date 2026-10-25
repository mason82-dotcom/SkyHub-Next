'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const survey=require('../../frontend/public/wpml-survey-preview-core');

function rectangle(){
  return [
    {lat:48.0000,lon:8.0000},
    {lat:48.0000,lon:8.0010},
    {lat:48.0010,lon:8.0010},
    {lat:48.0010,lon:8.0000}
  ];
}
test('bounded 2D coverage preview clips parallel strips to a small rectangle',()=>{
  const result=survey.preview(rectangle(),{heading:0,spacing:20});
  assert.equal(result.flightReady,false);
  assert.equal(result.exportableAsWaylines,false);
  assert.equal(result.validationScope,'approximate-2d-geometry-preview');
  assert.ok(result.areaSqMeters>7000&&result.areaSqMeters<10000);
  assert.ok(result.stripeCount>=3);
  assert.equal(result.segmentCount,result.stripeCount);
  assert.ok(result.previewSegmentLengthMeters>0);
  for(const s of result.segments){
    for(const p of [s.start,s.end]){
      assert.ok(p.lat>=47.99999&&p.lat<=48.00101);
      assert.ok(p.lon>=7.99999&&p.lon<=8.00101);
    }
  }
});
test('preview heading controls orientation and is deterministic for identical inputs',()=>{
  const a=survey.preview(rectangle(),{heading:90,spacing:20});
  const b=survey.preview(rectangle(),{heading:90,spacing:20});
  assert.deepEqual(a,b);
  assert.ok(a.segmentCount>1);
  assert.equal(a.headingDegrees,90);
  const c=survey.preview(rectangle(),{heading:0,spacing:20});
  assert.notDeepEqual(a.segments,c.segments);
});
test('concave polygon produces separate disconnected stripe segments rather than fictitious turns',()=>{
  // U-shaped concave area: top indentation cuts some horizontal strips in two.
  const lat0=48,lon0=8;
  const coords=[[0,0],[100,0],[100,100],[70,100],[70,30],[30,30],[30,100],[0,100]];
  const polygon=coords.map(([x,y])=>({lat:lat0+y/111132,
    lon:lon0+x/(111320*Math.cos(lat0*Math.PI/180))}));
  const data=survey.preview(polygon,{heading:90,spacing:12});
  assert.ok(data.segmentCount>data.stripeCount);
  assert.ok(data.areaSqMeters>5000);
  assert.equal(data.exportableAsWaylines,false);
});
test('invalid surveys fail closed before UI displays simulated lines',()=>{
  const invalids=[
    [],
    rectangle().slice(0,2),
    [...rectangle(),...Array(77).fill(rectangle()[0])],
    [{lat:90,lon:8},...rectangle().slice(0,3)],
    [{lat:'',lon:8},...rectangle().slice(0,3)],
    [{lat:48,lon:8},{lat:48.001,lon:8.001},
      {lat:48,lon:8.001},{lat:48.001,lon:8}],
    [{lat:48,lon:8},{lat:48,lon:8.00000001},
      {lat:48.001,lon:8.001},{lat:48.001,lon:8}],
    [{lat:48,lon:8},{lat:48,lon:8.03},
      {lat:48.01,lon:8.03},{lat:48.01,lon:8}]
  ];
  for(const poly of invalids)
    assert.throws(()=>survey.preview(poly),/Survey preview invalid/);
  assert.throws(()=>survey.preview(rectangle(),{spacing:0}),/line spacing/);
  assert.throws(()=>survey.preview(rectangle(),{spacing:300}),/line spacing/);
  assert.throws(()=>survey.preview(rectangle(),{heading:361}),/heading/);
  assert.throws(()=>survey.preview(rectangle(),{heading:'NaN'}),/heading/);
});
test('polygon can contain explicit closing vertex without redundant segment',()=>{
  const polygon=rectangle();
  const a=survey.preview(polygon,{spacing:15,heading:25});
  const b=survey.preview([...polygon,polygon[0]],{spacing:15,heading:25});
  assert.deepEqual(a,b);
});
test('2D preview HTML and JS contain no KMZ export or DJI mission dispatch',()=>{
  const root=path.join(__dirname,'../../frontend/public');
  const html=readFileSync(path.join(root,'wpml-survey-preview.html'),'utf8');
  const client=readFileSync(path.join(root,'wpml-survey-preview.js'),'utf8');
  assert.match(html,/wpml-survey-preview-core\.js/);
  assert.match(html,/wpml-survey-preview\.js/);
  assert.match(html,/GeoJSON/);
  assert.match(client,/engine\.preview/);
  assert.doesNotMatch(client,/\bfetch\s*\(|XMLHttpRequest|new\s+WebSocket|\/api\/mission\/create/);
  assert.doesNotMatch(client,/createKmz\s*\(|packageKmz\s*\(|waylines\.wpml/);
  assert.doesNotMatch(html,/action="\/api\/mission\/create"/);
});
