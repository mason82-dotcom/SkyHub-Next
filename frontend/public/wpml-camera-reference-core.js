'use strict';
// Offline reference-mode gate: DJI specification timing is not proof of pilot/aircraft
// compatibility. No manufacturer-equivalent focal lengths are interpreted as
// physical focal lengths or physical sensor dimensions.
(function(root,factory){
  if(typeof module==='object'&&module.exports)
    module.exports=factory(require('./wpml-photogrammetry-core'));
  else root.SkyHubCameraReference=factory(root.SkyHubPhotoGeometry);
})(typeof globalThis==='object'?globalThis:this,function(photogrammetry){
  function invalid(message){throw new TypeError('Camera reference invalid: '+message);}
  // Source: DJI Mavic 3M specifications and DJI Mavic 3M user manual (2024).
  // Different imaging modes and formats intentionally remain distinct.
  const SOURCES=Object.freeze({
    specs:'https://enterprise.dji.com/mavic-3-m/specs',
    manual:'https://dl.djicdn.com/downloads/DJI_Mavic_3_Enterprise/20240814/DJI_Mavic_3M_User_Manual_EN.pdf'
  });
  const MODES=Object.freeze({
    'm3m-rgb-jpeg':Object.freeze({
      aircraft:'mavic3m',sensor:'rgb',format:'JPEG',imageWidthPx:5280,
      imageHeightPx:3956,minIntervalSeconds:0.7,artifactsPerCapture:1,
      channels:Object.freeze(['RGB']),mixedCapture:false
    }),
    'm3m-rgb-jpeg-raw':Object.freeze({
      aircraft:'mavic3m',sensor:'rgb',format:'JPEG+DNG',imageWidthPx:5280,
      imageHeightPx:3956,minIntervalSeconds:3,artifactsPerCapture:2,
      channels:Object.freeze(['RGB_JPEG','RGB_DNG']),mixedCapture:false
    }),
    'm3m-ms-tiff':Object.freeze({
      aircraft:'mavic3m',sensor:'multispectral',format:'TIFF',imageWidthPx:2592,
      imageHeightPx:1944,minIntervalSeconds:2,artifactsPerCapture:4,
      channels:Object.freeze(['G','R','RE','NIR']),mixedCapture:false
    }),
    'm3m-rgb-ms-tiff':Object.freeze({
      aircraft:'mavic3m',sensor:'multispectral',format:'RGB_JPEG+4xTIFF',
      imageWidthPx:2592,imageHeightPx:1944,minIntervalSeconds:2,
      artifactsPerCapture:5,
      channels:Object.freeze(['RGB','G','R','RE','NIR']),mixedCapture:true
    })
  });
  const REQUIRED=Object.freeze(['sensorWidthMm','sensorHeightMm','focalLengthMm',
    'imageWidthPx','imageHeightPx','heightAGLM','sideOverlapPercent',
    'frontOverlapPercent','speedMps']);
  function mode(id){
    if(typeof id!=='string'||!Object.hasOwn(MODES,id))
      invalid('unknown or unsupported acquisition mode');
    return MODES[id];
  }
  function bind(id,manual){
    const ref=mode(id);
    if(!manual||typeof manual!=='object'||Array.isArray(manual))
      invalid('explicit optical parameters are required');
    if(REQUIRED.some(k=>!Object.hasOwn(manual,k)))
      invalid('missing physical optics or survey parameter');
    if(!photogrammetry||typeof photogrammetry.optics!=='function')
      invalid('optical geometry module unavailable');
    // The physical focal and sensor dimensions MUST be manually entered.
    // DJI's 24/25-mm 35-mm equivalent focal length cannot substitute for them.
    const input=Object.fromEntries(REQUIRED.map(k=>[k,manual[k]]));
    const n=manual.cameraMinIntervalSeconds;
    if(n!==undefined&&n!==null&&n!==''){
      const provided=Number(n);
      if(typeof n!=='number'&&
         (typeof n!=='string'||!/^\s*(?:\d+(?:\.\d*)?|\.\d+)\s*$/.test(n)))
        invalid('minimum interval is not a positive number');
      if(!Number.isFinite(provided)||provided<ref.minIntervalSeconds)
        invalid('configured minimum interval is shorter than DJI reference');
      input.cameraMinIntervalSeconds=provided;
    }else input.cameraMinIntervalSeconds=ref.minIntervalSeconds;
    const optics=photogrammetry.optics(input);
    if(optics.imageWidthPx!==ref.imageWidthPx||
       optics.imageHeightPx!==ref.imageHeightPx)
      invalid('image dimensions differ from selected sensor and acquisition mode');
    const opticalInputs=Object.freeze(Object.fromEntries(
      [...REQUIRED,'cameraMinIntervalSeconds'].map(k=>[k,optics[k]])));
    return Object.freeze({
      id,
      reference:ref,
      opticalInputs,
      optics,
      specMinIntervalSeconds:ref.minIntervalSeconds,
      configuredMinIntervalSeconds:optics.cameraMinIntervalSeconds,
      referenceSourceUrls:SOURCES,
      cadencePassesReference:optics.cameraIntervalSatisfiesConstraint,
      cameraHardwareVerified:false,
      pilot2HardwareVerified:false,
      opticalCalibrationVerified:false,
      flightReady:false,
      exportableAsWaylines:false,
      sourceScope:'manufacturer-published-synthetic-reference-not-device-acceptance'
    });
  }
  function estimate(id,manual,geometry){
    const resolved=bind(id,manual);
    const survey=photogrammetry.estimate(geometry,resolved.opticalInputs);
    const images=survey.estimatedImageCount*
      resolved.reference.artifactsPerCapture;
    if(!Number.isSafeInteger(images)||images>250000)
      invalid('reference artifact estimate over budget');
    return Object.freeze({
      id,
      selectedSensor:resolved.reference.sensor,
      primaryCaptureGeometry:resolved.reference.sensor,
      channels:resolved.reference.channels,
      estimatedCaptureEvents:survey.estimatedImageCount,
      estimatedImageArtifacts:images,
      artifactsPerCapture:resolved.reference.artifactsPerCapture,
      configuredMinIntervalSeconds:resolved.configuredMinIntervalSeconds,
      cadencePassesReference:resolved.cadencePassesReference,
      otherSensorGeometryComputed:false,
      geometry:surePreview(survey),
      cameraHardwareVerified:false,
      pilot2HardwareVerified:false,
      flightReady:false,
      exportableAsWaylines:false,
      validationScope:'reference-cadence-and-single-sensor-optics-only',
      warning:'Capture counts are synthetic. No physical camera calibration, second-sensor footprint, firmware cadence or DJI flight validation.'
    });
  }
  function surePreview(result){
    // Include bounded optical summary but NOT any permission to create DJI actions.
    return Object.freeze({
      gsdAcrossCmPerPx:result.optics.gsdAcrossCmPerPx,
      gsdAlongCmPerPx:result.optics.gsdAlongCmPerPx,
      stripSpacingM:result.optics.stripSpacingM,
      estimatedTriggerIntervalSeconds:result.optics.estimatedTriggerIntervalSeconds
    });
  }
  return Object.freeze({SOURCES,MODES,mode,bind,estimate});
});
