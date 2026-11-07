'use strict';
// Optics-only nadir/flat-ground photogrammetry estimates for a precomputed 2D survey preview.
// No DJI-specific camera defaults, no terrain model and no executable flight planning.
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.SkyHubPhotoGeometry=factory();
})(typeof globalThis==='object'?globalThis:this,function(){
  function reject(s){throw new TypeError('Photogrammetry estimate invalid: '+s);}
  function number(raw,name,low,high,integer=false){
    if(typeof raw!=='number'&&typeof raw!=='string')reject(name+' must be a number');
    if(typeof raw==='string'&&!/^\s*[-+]?(?:\d+(?:\.\d*)?|\.\d+)\s*$/.test(raw))
      reject(name+' must be a number');
    const n=Number(raw);
    if(!Number.isFinite(n)||n<low||n>high||(integer&&!Number.isInteger(n)))
      reject(name+' outside accepted range');
    return n;
  }
  function optics(input){
    if(!input||typeof input!=='object'||Array.isArray(input))reject('calibration required');
    // These parameters must be supplied explicitly from the selected physical camera.
    // Different Mavic 3M bands/camera modules must not be silently conflated.
    const sensorWidthMm=number(input.sensorWidthMm,'sensor width',1,70);
    const sensorHeightMm=number(input.sensorHeightMm,'sensor height',1,70);
    const focalLengthMm=number(input.focalLengthMm,'focal length',1,250);
    const imageWidthPx=number(input.imageWidthPx,'image width',128,20000,true);
    const imageHeightPx=number(input.imageHeightPx,'image height',128,20000,true);
    const heightAGLM=number(input.heightAGLM,'height above ground',2,500);
    const sideOverlapPercent=number(input.sideOverlapPercent,'side overlap',0,95);
    const frontOverlapPercent=number(input.frontOverlapPercent,'front overlap',0,95);
    const speedMps=number(input.speedMps,'cruise speed',0.2,20);
    const groundWidthM=heightAGLM*sensorWidthMm/focalLengthMm;
    const groundLengthM=heightAGLM*sensorHeightMm/focalLengthMm;
    const stripSpacingM=groundWidthM*(1-sideOverlapPercent/100);
    const alongTrackTriggerDistanceM=groundLengthM*(1-frontOverlapPercent/100);
    if(stripSpacingM<2||stripSpacingM>200)
      reject('computed strip spacing outside geometric preview limits (2–200 m)');
    if(alongTrackTriggerDistanceM<0.1)
      reject('computed picture distance shorter than 0.1 m');
    const estimatedTriggerIntervalSeconds=alongTrackTriggerDistanceM/speedMps;
    // No implied compatibility with the aircraft's shutter speed or SD card speed.
    const requiredMinInterval=input.cameraMinIntervalSeconds===undefined?null:
      number(input.cameraMinIntervalSeconds,'camera minimum picture interval',0.1,60);
    const cameraIntervalSatisfiesConstraint=requiredMinInterval===null?null:
      estimatedTriggerIntervalSeconds>=requiredMinInterval;
    return {
      sensorWidthMm,sensorHeightMm,focalLengthMm,imageWidthPx,imageHeightPx,
      heightAGLM,sideOverlapPercent,frontOverlapPercent,speedMps,
      groundWidthM,groundLengthM,
      horizontalFovDegrees:2*Math.atan(sensorWidthMm/(2*focalLengthMm))*180/Math.PI,
      verticalFovDegrees:2*Math.atan(sensorHeightMm/(2*focalLengthMm))*180/Math.PI,
      gsdAcrossCmPerPx:100*groundWidthM/imageWidthPx,
      gsdAlongCmPerPx:100*groundLengthM/imageHeightPx,
      stripSpacingM,alongTrackTriggerDistanceM,estimatedTriggerIntervalSeconds,
      cameraMinIntervalSeconds:requiredMinInterval,cameraIntervalSatisfiesConstraint,
      calibratedFromDevice:false,
      cameraProfileSource:'manually-entered-optical-parameters',
      assumedScene:'nadir camera, flat terrain, fixed AGL and fixed speed',
      flightReady:false,exportableAsWaylines:false
    };
  }
  function estimate(preview,optical){
    if(!preview||preview.validationScope!=='approximate-2d-geometry-preview'||
       preview.flightReady!==false||preview.exportableAsWaylines!==false||
       !Array.isArray(preview.segments)||!preview.segments.length)
      reject('geometric preview required');
    // Validate input again if caller passes unsanitized options.
    const camera=optics(optical);
    if(Math.abs(preview.lineSpacingMeters-camera.stripSpacingM)>1e-6)
      reject('survey strips do not match optical strip spacing');
    let total=0;
    const expectedImagesPerSegment=[];
    for(const segment of preview.segments){
      const length=number(segment.lengthMeters,'preview segment length',0.5,3000);
      // Endpoint-inclusive upper estimate. No images are created or triggered.
      const count=Math.ceil(length/camera.alongTrackTriggerDistanceM)+1;
      total+=count;
      if(total>50000)reject('estimated image count exceeds 50000');
      expectedImagesPerSegment.push(count);
    }
    return {
      optics:camera,
      estimatedImageCount:total,
      estimatedImagesPerSegment:expectedImagesPerSegment,
      approximateStraightCaptureTimeSeconds:
        preview.previewSegmentLengthMeters/camera.speedMps,
      previewSegmentLengthMeters:preview.previewSegmentLengthMeters,
      limitations:['No turns, transit legs, camera triggering latency or acceleration',
        'No terrain/geoid/DEM/GSD variation or gimbal tilt',
        'No camera compatibility, exposure or aircraft confirmation',
        'Geometry preview is not a DJI mapping route'],
      flightReady:false,exportableAsWaylines:false,
      validationScope:'optics-based-estimate-only'
    };
  }
  return Object.freeze({optics,estimate});
});
