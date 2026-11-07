'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const survey=require('../../frontend/public/wpml-survey-preview-core');
const {optics,estimate}=require('../../frontend/public/wpml-photogrammetry-core');
const rectangle=[
  {lat:48,lon:8},{lat:48,lon:8.001},
  {lat:48.001,lon:8.001},{lat:48.001,lon:8}
];
// Synthetic optical parameters only. NOT specifications for any DJI model.
const CAMERA=Object.freeze({
  sensorWidthMm:13.2,sensorHeightMm:8.8,focalLengthMm:8.8,
  imageWidthPx:5280,imageHeightPx:3956,heightAGLM:60,
  sideOverlapPercent:70,frontOverlapPercent:80,speedMps:6
});
test('nadir optics compute ground footprint, GSD and overlap spacing without DJI assumptions',()=>{
  const x=optics(CAMERA);
  assert.ok(Math.abs(x.groundWidthM-90)<1e-10);
  assert.ok(Math.abs(x.groundLengthM-60)<1e-10);
  assert.ok(Math.abs(x.stripSpacingM-27)<1e-10);
  assert.ok(Math.abs(x.alongTrackTriggerDistanceM-12)<1e-10);
  assert.ok(Math.abs(x.estimatedTriggerIntervalSeconds-2)<1e-10);
  assert.ok(Math.abs(x.gsdAcrossCmPerPx-90*100/5280)<1e-10);
  assert.ok(Math.abs(x.gsdAlongCmPerPx-60*100/3956)<1e-10);
  assert.ok(x.horizontalFovDegrees>x.verticalFovDegrees);
  assert.equal(x.calibratedFromDevice,false);
  assert.equal(x.cameraProfileSource,'manually-entered-optical-parameters');
  assert.equal(x.flightReady,false);
  assert.equal(x.exportableAsWaylines,false);
});
test('optical strip spacing feeds existing bounded survey preview and image estimates',()=>{
  const x=optics(CAMERA);
  const preview=survey.preview(rectangle,{heading:0,spacing:x.stripSpacingM});
  const a=estimate(preview,CAMERA);
  const b=estimate(preview,CAMERA);
  assert.deepEqual(a,b);
  assert.equal(a.flightReady,false);
  assert.equal(a.exportableAsWaylines,false);
  assert.equal(a.validationScope,'optics-based-estimate-only');
  assert.equal(a.estimatedImagesPerSegment.length,preview.segmentCount);
  assert.ok(a.estimatedImageCount>preview.segmentCount);
  assert.ok(a.approximateStraightCaptureTimeSeconds>0);
  assert.ok(a.estimatedImageCount<=50000);
});
test('user-provided camera minimum interval is checked rather than guessed',()=>{
  assert.equal(optics({...CAMERA,cameraMinIntervalSeconds:1.5})
    .cameraIntervalSatisfiesConstraint,true);
  assert.equal(optics({...CAMERA,cameraMinIntervalSeconds:2.5})
    .cameraIntervalSatisfiesConstraint,false);
  assert.equal(optics(CAMERA).cameraIntervalSatisfiesConstraint,null);
});
test('missing or fabricated optical calibration values cannot silently become zeros',()=>{
  for(const key of ['sensorWidthMm','sensorHeightMm','focalLengthMm',
    'imageWidthPx','imageHeightPx','heightAGLM',
    'sideOverlapPercent','frontOverlapPercent','speedMps']){
    const x={...CAMERA};delete x[key];
    assert.throws(()=>optics(x),/Photogrammetry estimate invalid/,key);
    x[key]='';
    assert.throws(()=>optics(x),/Photogrammetry estimate invalid/,key);
  }
  assert.throws(()=>optics({...CAMERA,imageWidthPx:235.3}),/image width/);
  assert.throws(()=>optics({...CAMERA,focalLengthMm:0}),/focal length/);
  assert.throws(()=>optics({...CAMERA,heightAGLM:'NaN'}),/height above ground/);
  assert.throws(()=>optics({...CAMERA,sideOverlapPercent:99}),/side overlap/);
  assert.throws(()=>optics({...CAMERA,frontOverlapPercent:-1}),/front overlap/);
  assert.throws(()=>optics({...CAMERA,speedMps:0}),/cruise speed/);
  assert.throws(()=>optics({...CAMERA,cameraMinIntervalSeconds:'0'}),/camera minimum/);
});
test('geometry rejects too dense strips and implausibly frequent photos',()=>{
  assert.throws(()=>optics({...CAMERA,sideOverlapPercent:95,heightAGLM:5}),
    /computed strip spacing/);
  assert.throws(()=>optics({...CAMERA,sensorHeightMm:1,focalLengthMm:250,
    heightAGLM:5,sideOverlapPercent:0}),/computed strip spacing/);
});
test('estimate cannot be used on unrelated geometry, mismatched parameters or fake flight clearance',()=>{
  const x=optics(CAMERA),preview=survey.preview(rectangle,{spacing:x.stripSpacingM});
  assert.throws(()=>estimate({...preview,flightReady:true},CAMERA),/geometric preview/);
  assert.throws(()=>estimate({...preview,exportableAsWaylines:true},CAMERA),/geometric preview/);
  assert.throws(()=>estimate({...preview,validationScope:'flight-authorized'},CAMERA),/geometric preview/);
  assert.throws(()=>estimate(survey.preview(rectangle,{spacing:20}),CAMERA),
    /do not match optical strip spacing/);
});
test('all survey optical computation stays client-side and never creates DJI waylines',()=>{
  const base=path.join(__dirname,'../../frontend/public');
  const ui=fs.readFileSync(path.join(base,'wpml-survey-preview.js'),'utf8');
  const html=fs.readFileSync(path.join(base,'wpml-survey-preview.html'),'utf8');
  const core=fs.readFileSync(path.join(base,'wpml-photogrammetry-core.js'),'utf8');
  assert.match(html,/wpml-photogrammetry-core\.js/);
  assert.match(html,/id="optics-enable"/);
  assert.match(ui,/optics\.estimate/);
  assert.doesNotMatch(ui,/\bfetch\s*\(|XMLHttpRequest|new\s+WebSocket|\/api\/mission\/create/);
  assert.doesNotMatch(ui,/createKmz\s*\(|packageKmz\s*\(|waylines\.wpml/);
  assert.doesNotMatch(core,/createKmz\s*\(|packageKmz\s*\(|waylines\.wpml/);
});
