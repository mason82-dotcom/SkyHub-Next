'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const dual=require('../../frontend/public/wpml-m3m-dual-optics-core');
const survey=require('../../frontend/public/wpml-survey-preview-core');

// Synthetic mm values used to exercise math. NOT verified M3M calibration.
const rgb=Object.freeze({
  sensorWidthMm:13.2,sensorHeightMm:8.8,focalLengthMm:8.8,
  imageWidthPx:5280,imageHeightPx:3956,heightAGLM:60,
  sideOverlapPercent:70,frontOverlapPercent:80,speedMps:5
});
const ms=Object.freeze({
  sensorWidthMm:6,sensorHeightMm:4.5,focalLengthMm:5,
  imageWidthPx:2592,imageHeightPx:1944,heightAGLM:60,
  sideOverlapPercent:70,frontOverlapPercent:80,speedMps:5
});
const input=()=>({rgb:{...rgb},multispectral:{...ms}});
const area=[{lat:48,lon:8},{lat:48,lon:8.001},
  {lat:48.001,lon:8.001},{lat:48.001,lon:8}];

test('compares two independent optical footprints, never deriving RGB from MS optics',()=>{
  const r=dual.compare(input());
  assert.equal(r.rgb.imageWidthPx,5280);
  assert.equal(r.multispectral.imageWidthPx,2592);
  assert.ok(Math.abs(r.rgb.groundWidthM-90)<1e-9);
  assert.ok(Math.abs(r.multispectral.groundWidthM-72)<1e-9);
  assert.ok(Math.abs(r.nominalStripSpacingM-21.6)<1e-8);
  assert.ok(Math.abs(r.nominalPhotoSpacingM-10.8)<1e-8);
  assert.ok(Math.abs(r.nominalIntervalSeconds-2.16)<1e-8);
  assert.ok(Math.abs(r.maxTheoreticalSpeedMps-5.4)<1e-8);
  assert.equal(r.effectiveMinIntervalSeconds,2);
  assert.equal(r.meetsNumericalCadence,true);
  assert.equal(r.coRegistrationVerified,false);
  assert.equal(r.relativeBoresightVerified,false);
  assert.equal(r.cameraHardwareVerified,false);
  assert.equal(r.pilot2HardwareVerified,false);
  assert.equal(r.opticalCalibrationVerified,false);
  assert.equal(r.terrainVerified,false);
  assert.equal(r.geofenceVerified,false);
  assert.equal(r.actualCaptureSupported,null);
  assert.equal(r.flightReady,false);
  assert.equal(r.exportableAsWaylines,false);
  assert.equal(r.dispatchAllowed,false);
  assert.ok(Object.isFrozen(r));
});
test('fast cruise speed and stricter user camera interval fail cadence without flight approval',()=>{
  const fast=input();
  fast.rgb.speedMps=8;fast.multispectral.speedMps=8;
  const a=dual.compare(fast);
  assert.equal(a.meetsNumericalCadence,false);
  assert.equal(a.flightReady,false);
  const slow=input();
  slow.multispectral.cameraMinIntervalSeconds=3;
  const b=dual.compare(slow);
  assert.equal(b.effectiveMinIntervalSeconds,3);
  assert.equal(b.meetsNumericalCadence,false);
  assert.equal(b.flightReady,false);
  const stricter=input();
  stricter.rgb.cameraMinIntervalSeconds=4;
  const c=dual.compare(stricter);
  assert.equal(c.effectiveMinIntervalSeconds,4);
});
test('refuses camera confusion, cadence understatement, missing optical details and mismatched flight assumptions',()=>{
  assert.throws(()=>dual.compare({}),/manually supplied optics required/);
  const missing=input();delete missing.rgb.focalLengthMm;
  assert.throws(()=>dual.compare(missing),/Camera reference invalid/);
  const badPixels=input();badPixels.rgb.imageWidthPx=2592;
  assert.throws(()=>dual.compare(badPixels),/image dimensions differ/);
  const badCadence=input();badCadence.rgb.cameraMinIntervalSeconds=0.7;
  assert.throws(()=>dual.compare(badCadence),/below mixed RGB\/MS reference/);
  const mismatchAGL=input();mismatchAGL.rgb.heightAGLM=61;
  assert.throws(()=>dual.compare(mismatchAGL),/AGL differ/);
  const mismatchSpeed=input();mismatchSpeed.multispectral.speedMps=6;
  assert.throws(()=>dual.compare(mismatchSpeed),/airspeeds differ/);
});
test('count estimate uses only bounded coverage segments with five theoretical files per event',()=>{
  const r=dual.compare(input());
  const geo=survey.preview(area,{heading:0,spacing:r.nominalStripSpacingM});
  const count=dual.estimate(input(),geo);
  assert.ok(count.nominalCaptureEvents>0);
  assert.equal(count.nominalRGBJpegFiles,count.nominalCaptureEvents);
  assert.equal(count.nominalMultispectralTiffFiles,count.nominalCaptureEvents*4);
  assert.equal(count.nominalTotalFiles,count.nominalCaptureEvents*5);
  assert.equal(count.transitionCoverageIncluded,false);
  assert.equal(count.photoActionsGenerated,false);
  assert.equal(count.coRegistrationVerified,false);
  assert.equal(count.flightReady,false);
  assert.equal(count.dispatchAllowed,false);
});
test('rejects geometry spoofing and any mismatched strip spacing',()=>{
  const r=dual.compare(input());
  const geo=survey.preview(area,{heading:0,spacing:r.nominalStripSpacingM});
  assert.throws(()=>dual.estimate(input(),{...geo,flightReady:true}),
    /matching offline bounded survey geometry/);
  assert.throws(()=>dual.estimate(input(),{...geo,exportableAsWaylines:true}),
    /matching offline bounded survey geometry/);
  assert.throws(()=>dual.estimate(input(),{...geo,lineSpacingMeters:40}),
    /matching offline bounded survey geometry/);
  const invalid={...geo,segments:[{...geo.segments[0],kind:'transit'}]};
  assert.throws(()=>dual.estimate(input(),invalid),
    /M3M dual-optics comparison invalid/);
});
test('the dual comparison has no transport, camera actions, DJI dispatch or KMZ generation',()=>{
  const code=fs.readFileSync(path.join(__dirname,
    '../../frontend/public/wpml-m3m-dual-optics-core.js'),'utf8');
  assert.doesNotMatch(code,/\bfetch\s*\(|XMLHttpRequest|WebSocket|mqtt\.connect|\/api\/mission\/create/);
  assert.doesNotMatch(code,/\bcreateKmz\s*\(|\bpackageKmz\s*\(|waylines\.wpml/);
});

test('geometry replay rejects forged segment lengths, positions, headings and totals',()=>{
  const r=dual.compare(input());
  const valid=survey.preview(area,{spacing:r.nominalStripSpacingM,heading:20});
  assert.ok(dual.estimate(input(),valid).nominalCaptureEvents>0);
  const first=valid.segments[0];
  const attempts=[
    {...valid,segments:[{...first,lengthMeters:first.lengthMeters+42},
      ...valid.segments.slice(1)]},
    {...valid,segments:[{...first,start:{...first.start,lon:first.start.lon+0.001}},
      ...valid.segments.slice(1)]},
    {...valid,segments:[{...first,end:{lat:0,lon:0}},...valid.segments.slice(1)]},
    {...valid,previewSegmentLengthMeters:valid.previewSegmentLengthMeters+30},
    {...valid,areaSqMeters:valid.areaSqMeters+90},
    {...valid,segmentCount:valid.segmentCount+1},
    {...valid,stripeCount:valid.stripeCount+1},
    {...valid,headingDegrees:55},
    {...valid,outlineGeometry:{type:'Polygon',coordinates:[[
      [8,48],[8.0005,48],[8.0005,48.0005],[8,48.0005],[8,48]
    ]]}}
  ];
  for(const fake of attempts)
    assert.throws(()=>dual.estimate(input(),fake),
      /M3M dual-optics comparison invalid/);
});

test('polygon holes remain excluded in replayed dual-sensor offline capture count',()=>{
  const LAT=48,LON=8,xm=111320*Math.cos(LAT*Math.PI/180),ym=111132;
  const ring=coords=>[...coords,coords[0]].map(([x,y])=>[LON+x/xm,LAT+y/ym]);
  const geometry={type:'Polygon',coordinates:[
    ring([[0,0],[120,0],[120,120],[0,120]]),
    ring([[40,40],[80,40],[80,80],[40,80]])]};
  const spacing=dual.compare(input()).nominalStripSpacingM;
  const preview=survey.preview(geometry,{heading:90,spacing});
  const estimate=dual.estimate(input(),preview);
  assert.ok(preview.segmentCount>preview.stripeCount);
  assert.equal(estimate.flightReady,false);
  assert.equal(estimate.photoActionsGenerated,false);
  assert.equal(estimate.transitionCoverageIncluded,false);
  const fake={...preview,outlineGeometry:{type:'Polygon',
    coordinates:[geometry.coordinates[0]]}};
  assert.throws(()=>dual.estimate(input(),fake),
    /M3M dual-optics comparison invalid/);
});
