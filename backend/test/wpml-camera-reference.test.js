'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const reference=require('../../frontend/public/wpml-camera-reference-core');
const photo=require('../../frontend/public/wpml-photogrammetry-core');
const survey=require('../../frontend/public/wpml-survey-preview-core');

const rgb=Object.freeze({
  sensorWidthMm:13.2,sensorHeightMm:8.8,focalLengthMm:8.8,
  imageWidthPx:5280,imageHeightPx:3956,heightAGLM:60,
  sideOverlapPercent:70,frontOverlapPercent:80,speedMps:6
});
const ms=Object.freeze({...rgb,imageWidthPx:2592,imageHeightPx:1944});
const boundary=[{lat:48,lon:8},{lat:48,lon:8.001},
  {lat:48.001,lon:8.001},{lat:48.001,lon:8}];

test('DJI M3M mode catalog distinguishes RGB, RAW, 4-band TIFF, and combined five-image events',()=>{
  const modes=reference.MODES;
  assert.deepEqual(Object.keys(modes),[
    'm3m-rgb-jpeg','m3m-rgb-jpeg-raw','m3m-ms-tiff','m3m-rgb-ms-tiff'
  ]);
  assert.deepEqual(Object.values(modes).map(m=>m.minIntervalSeconds),[.7,3,2,2]);
  assert.deepEqual(Object.values(modes).map(m=>m.artifactsPerCapture),[1,2,4,5]);
  assert.deepEqual(modes['m3m-ms-tiff'].channels,['G','R','RE','NIR']);
  assert.equal(modes['m3m-rgb-ms-tiff'].mixedCapture,true);
  assert.ok(reference.SOURCES.specs.includes('dji.com'));
  assert.ok(reference.SOURCES.manual.includes('djicdn.com'));
  assert.ok(Object.isFrozen(modes));
});
test('manual physical optics mandatory; mode only adds conservative DJI cadence limit',()=>{
  const x=reference.bind('m3m-rgb-jpeg',rgb);
  assert.equal(x.configuredMinIntervalSeconds,.7);
  assert.equal(x.cadencePassesReference,true);
  assert.equal(x.reference.sensor,'rgb');
  assert.equal(x.opticalInputs.focalLengthMm,rgb.focalLengthMm);
  assert.equal(x.cameraHardwareVerified,false);
  assert.equal(x.pilot2HardwareVerified,false);
  assert.equal(x.opticalCalibrationVerified,false);
  assert.equal(x.flightReady,false);
  assert.equal(x.exportableAsWaylines,false);
  assert.equal(x.sourceScope,'manufacturer-published-synthetic-reference-not-device-acceptance');
});
test('multispectral pixel geometry is not silently conflated with 20MP RGB geometry',()=>{
  assert.throws(()=>reference.bind('m3m-ms-tiff',rgb),/image dimensions differ/);
  assert.throws(()=>reference.bind('m3m-rgb-jpeg',ms),/image dimensions differ/);
  const x=reference.bind('m3m-ms-tiff',ms);
  assert.equal(x.reference.sensor,'multispectral');
  assert.equal(x.optics.imageWidthPx,2592);
  assert.equal(x.optics.imageHeightPx,1944);
  assert.equal(x.configuredMinIntervalSeconds,2);
  const combined=reference.bind('m3m-rgb-ms-tiff',ms);
  assert.equal(combined.reference.artifactsPerCapture,5);
  assert.equal(combined.reference.mixedCapture,true);
  assert.equal(combined.opticalCalibrationVerified,false);
});
test('DJI minimum photo cadence may only be overridden conservatively, never downward',()=>{
  assert.throws(()=>reference.bind('m3m-ms-tiff',{
    ...ms,cameraMinIntervalSeconds:.7
  }),/shorter than DJI reference/);
  assert.throws(()=>reference.bind('m3m-rgb-jpeg-raw',{
    ...rgb,cameraMinIntervalSeconds:2
  }),/shorter than DJI reference/);
  const x=reference.bind('m3m-rgb-jpeg',{
    ...rgb,cameraMinIntervalSeconds:2
  });
  assert.equal(x.configuredMinIntervalSeconds,2);
  assert.throws(()=>reference.bind('m3m-ms-tiff',{
    ...ms,cameraMinIntervalSeconds:'Infinity'
  }),/minimum interval/);
  assert.throws(()=>reference.bind('m3m-ms-tiff',{
    ...ms,cameraMinIntervalSeconds:'-1'
  }),/minimum interval/);
});
test('camera references still require all independent physical sensor geometry parameters',()=>{
  for(const key of ['sensorWidthMm','sensorHeightMm','focalLengthMm','heightAGLM']){
    const x={...ms};delete x[key];
    assert.throws(()=>reference.bind('m3m-ms-tiff',x),
      /missing physical optics/);
  }
  assert.throws(()=>reference.bind('m4t-wide',rgb),/unknown or unsupported/);
  assert.throws(()=>reference.bind('m3m-ms-tiff',{...ms,focalLengthMm:0}),
    /Photogrammetry estimate invalid/);
});
test('combined M3M mode constrains multispectral layout; RGB footprint remains unknown',()=>{
  const nominal=photo.optics({...ms,cameraMinIntervalSeconds:2});
  const geometry=survey.preview(boundary,{heading:90,spacing:nominal.stripSpacingM});
  const r=reference.estimate('m3m-rgb-ms-tiff',ms,geometry);
  assert.equal(r.estimatedImageArtifacts,r.estimatedCaptureEvents*5);
  assert.deepEqual(r.channels,['RGB','G','R','RE','NIR']);
  assert.equal(r.primaryCaptureGeometry,'multispectral');
  assert.equal(r.otherSensorGeometryComputed,false);
  assert.equal(r.flightReady,false);
  assert.equal(r.exportableAsWaylines,false);
  assert.equal(r.validationScope,'reference-cadence-and-single-sensor-optics-only');
});
test('a geometrically attractive interval shorter than M3M multispectral limit fails reference cadence',()=>{
  const fast={...ms,speedMps:20};
  const x=reference.bind('m3m-ms-tiff',fast);
  assert.equal(x.cadencePassesReference,false);
  const geometry=survey.preview(boundary,{spacing:x.optics.stripSpacingM});
  const estimate=reference.estimate('m3m-ms-tiff',fast,geometry);
  assert.equal(estimate.cadencePassesReference,false);
  assert.equal(estimate.flightReady,false);
});
test('reference is a browser + Node pure module, no network or mission dispatch',()=>{
  const dir=path.join(__dirname,'../../frontend/public');
  const core=fs.readFileSync(path.join(dir,'wpml-camera-reference-core.js'),'utf8');
  assert.doesNotMatch(core,/fetch\s*\(|XMLHttpRequest|WebSocket|mqtt\.connect/);
  assert.doesNotMatch(core,/createKmz\s*\(|wpml:actionGroup|waylines\.wpml/);
});
