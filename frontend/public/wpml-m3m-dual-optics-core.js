'use strict';
// Isolated, read-only comparison of INDEPENDENT manually supplied physical
// RGB/MS optics in Mavic 3M simultaneous imaging. No calibrated co-registration,
// executable WPML, camera RPC, navigation, coverage guarantee or safe route.
(function(root,factory){
  if(typeof module==='object'&&module.exports)
    module.exports=factory(require('./wpml-camera-reference-core'),
      require('./wpml-survey-preview-core'));
  else root.SkyHubM3MDualOptics=factory(root.SkyHubCameraReference,
    root.SkyHubSurveyPreview);
})(typeof globalThis==='object'?globalThis:this,function(reference,survey){
  const ERR='M3M dual-optics comparison invalid: ';
  const fail=s=>{throw new TypeError(ERR+s);};
  const allowed=Object.freeze(['sensorWidthMm','sensorHeightMm','focalLengthMm',
    'imageWidthPx','imageHeightPx','heightAGLM','sideOverlapPercent',
    'frontOverlapPercent','speedMps','cameraMinIntervalSeconds']);
  function normalizedInput(src,name,minInterval){
    if(!src||typeof src!=='object'||Array.isArray(src))
      fail(name+' manually supplied optics required');
    const c=Object.fromEntries(allowed.filter(x=>Object.hasOwn(src,x)).map(x=>[x,src[x]]));
    const v=c.cameraMinIntervalSeconds;
    if(v===undefined||v===null||v==='')c.cameraMinIntervalSeconds=minInterval;
    else {
      if((typeof v!=='number'&&
          (typeof v!=='string'||! /^\s*(?:\d+(?:\.\d*)?|\.\d+)\s*$/.test(v)))||
         !Number.isFinite(Number(v))||Number(v)<minInterval)
        fail(name+' minimum capture interval below mixed RGB/MS reference');
      c.cameraMinIntervalSeconds=Number(v);
    }
    return c;
  }
  function compare(inputs){
    if(!reference||typeof reference.bind!=='function')
      fail('manufacturer reference module missing');
    if(!inputs||typeof inputs!=='object'||Array.isArray(inputs))
      fail('both independent camera inputs required');
    const rgb=reference.bind('m3m-rgb-jpeg',
      normalizedInput(inputs.rgb,'rgb',2));
    const ms=reference.bind('m3m-rgb-ms-tiff',
      normalizedInput(inputs.multispectral,'multispectral',2));
    // Must refer to the SAME proposed nominal flight; do not compare different
    // AGL/speed trajectories as though they were simultaneous captures.
    if(Math.abs(rgb.optics.heightAGLM-ms.optics.heightAGLM)>1e-6)
      fail('RGB and multispectral AGL differ');
    if(Math.abs(rgb.optics.speedMps-ms.optics.speedMps)>1e-6)
      fail('RGB and multispectral airspeeds differ');

    const speed=ms.optics.speedMps;
    const nominalStripSpacingM=Math.min(rgb.optics.stripSpacingM,ms.optics.stripSpacingM);
    const nominalPhotoSpacingM=Math.min(
      rgb.optics.alongTrackTriggerDistanceM,ms.optics.alongTrackTriggerDistanceM);
    const effectiveMinIntervalSeconds=Math.max(
      rgb.configuredMinIntervalSeconds,ms.configuredMinIntervalSeconds);
    const nominalIntervalSeconds=nominalPhotoSpacingM/speed;
    // This boolean is only a numeric test; no actual camera mode, exposure,
    // gimbal alignment, firmware state or DJI action has been validated.
    const meetsNumericalCadence=nominalIntervalSeconds+1e-12>=effectiveMinIntervalSeconds;
    const summary=c=>Object.freeze({
      sensor:c.reference.sensor,
      imageWidthPx:c.reference.imageWidthPx,
      imageHeightPx:c.reference.imageHeightPx,
      gsdAcrossCmPerPx:c.optics.gsdAcrossCmPerPx,
      gsdAlongCmPerPx:c.optics.gsdAlongCmPerPx,
      groundWidthM:c.optics.groundWidthM,
      groundLengthM:c.optics.groundLengthM,
      individualStripSpacingM:c.optics.stripSpacingM,
      individualPhotoSpacingM:c.optics.alongTrackTriggerDistanceM,
      cameraHardwareVerified:false,
      opticalCalibrationVerified:false
    });
    return Object.freeze({
      aircraft:'mavic3m',
      mode:'m3m-rgb-ms-tiff',
      rgb:summary(rgb),multispectral:summary(ms),
      nominalStripSpacingM,nominalPhotoSpacingM,nominalIntervalSeconds,
      effectiveMinIntervalSeconds,
      maxTheoreticalSpeedMps:nominalPhotoSpacingM/effectiveMinIntervalSeconds,
      meetsNumericalCadence,
      assumedScene:'Two independently specified nadir sensors at equal AGL and equal cruise speed',
      coRegistrationVerified:false,relativeBoresightVerified:false,
      cameraHardwareVerified:false,pilot2HardwareVerified:false,
      opticalCalibrationVerified:false,
      terrainVerified:false,geofenceVerified:false,
      actualCaptureSupported:null,
      flightReady:false,exportableAsWaylines:false,dispatchAllowed:false,
      validationScope:'offline-unregistered-dual-sensor-optics-comparison-only',
      warning:'Minimum of nominal optical spacings is NOT a certified overlap/coverage guarantee. Relative sensor alignment, terrain, capture timing and DJI Pilot 2 support are unverified.'
    });
  }
  // Optional event/file count for an existing OFFLINE geometry with the
  // theoretically more restrictive two-sensor spacing. No photo centers,
  // DJI actions, live devices or transit segments are ever created.
  function estimate(input,geometry){
    const result=compare(input);
    if(!geometry||geometry.validationScope!=='approximate-2d-geometry-preview'||
       geometry.flightReady!==false||geometry.exportableAsWaylines!==false||
       !Array.isArray(geometry.segments)||!geometry.segments.length||
       geometry.segments.length>400||
       !Number.isFinite(geometry.lineSpacingMeters)||
       Math.abs(geometry.lineSpacingMeters-result.nominalStripSpacingM)>1e-6)
      fail('matching offline bounded survey geometry required');
    // A preview flag or a claimed length alone is not proof of the geometry.
    // Reconstruct the bounded survey from its declared outline and compare every
    // capture segment before computing counts. Excluded rings remain excluded.
    if(!survey||typeof survey.preview!=='function'||
       !geometry.outlineGeometry||
       !Number.isFinite(geometry.headingDegrees)||
       !Number.isInteger(geometry.segmentCount)||
       !Number.isInteger(geometry.stripeCount)||
       !Number.isFinite(geometry.areaSqMeters)||
       !Number.isFinite(geometry.previewSegmentLengthMeters))
      fail('replayable verified geometry required');
    let replay;
    try {
      replay=survey.preview(geometry.outlineGeometry,{
        spacing:geometry.lineSpacingMeters,heading:geometry.headingDegrees
      });
    }catch(_error){fail('outline geometry validation failed');}
    if(replay.segmentCount!==geometry.segments.length||
       replay.segmentCount!==geometry.segmentCount||
       replay.stripeCount!==geometry.stripeCount||
       Math.abs(replay.areaSqMeters-geometry.areaSqMeters)>0.01||
       Math.abs(replay.previewSegmentLengthMeters-
         geometry.previewSegmentLengthMeters)>0.01)
      fail('survey geometry totals disagree with bounded replay');
    for(let i=0;i<replay.segments.length;i++){
      const expected=replay.segments[i],actual=geometry.segments[i];
      if(!actual||actual.stripeIndex!==expected.stripeIndex||
         actual.kind!==expected.kind||
         !Number.isFinite(actual.lengthMeters)||
         Math.abs(actual.lengthMeters-expected.lengthMeters)>0.01||
         !actual.start||!actual.end||
         !Number.isFinite(actual.start.lat)||
         !Number.isFinite(actual.start.lon)||
         !Number.isFinite(actual.end.lat)||
         !Number.isFinite(actual.end.lon)||
         Math.abs(actual.start.lat-expected.start.lat)>1e-8||
         Math.abs(actual.start.lon-expected.start.lon)>1e-8||
         Math.abs(actual.end.lat-expected.end.lat)>1e-8||
         Math.abs(actual.end.lon-expected.end.lon)>1e-8)
        fail('coverage segments differ from bounded outline replay');
    }
    let events=0;
    for(const s of geometry.segments){
      if(!s||!Number.isFinite(s.lengthMeters)||s.lengthMeters<0.5||
         s.lengthMeters>3000||!Number.isInteger(s.stripeIndex)||
         s.stripeIndex<0||s.stripeIndex>=200)
        fail('invalid coverage-only segment');
      if(s.kind!==undefined&&s.kind!=='coverage-only')
        fail('non-coverage segment');
      events+=Math.ceil(s.lengthMeters/result.nominalPhotoSpacingM)+1;
      if(events>50000)fail('capture event budget exceeded');
    }
    return Object.freeze({
      nominalCaptureEvents:events,
      nominalRGBJpegFiles:events,
      nominalMultispectralTiffFiles:events*4,
      nominalTotalFiles:events*5,
      transitionCoverageIncluded:false,
      photoActionsGenerated:false,
      meetsNumericalCadence:result.meetsNumericalCadence,
      coRegistrationVerified:false,
      cameraHardwareVerified:false,pilot2HardwareVerified:false,
      flightReady:false,exportableAsWaylines:false,dispatchAllowed:false,
      validationScope:'unregistered-dual-sensor-count-estimate-only'
    });
  }
  return Object.freeze({compare,estimate});
});
