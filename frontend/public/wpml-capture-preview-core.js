'use strict';
// Theoretical photo centres for existing offline survey preview strips.
// Never construct DJI actionGroups, waylines, KMZ, flight commands or turn segments.
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(
    require('./wpml-photogrammetry-core'));
  else root.SkyHubCapturePreview=factory(root.SkyHubPhotoGeometry);
})(typeof globalThis==='object'?globalThis:this,function(photogrammetry){
  function invalid(message){throw new TypeError('Capture preview invalid: '+message);}
  function coordinate(p){
    if(!p||!Number.isFinite(p.lat)||!Number.isFinite(p.lon)||
       Math.abs(p.lat)>85||Math.abs(p.lon)>180)invalid('invalid segment coordinate');
  }
  function plan(geometry,manualOptics){
    if(!photogrammetry||typeof photogrammetry.estimate!=='function')
      invalid('photogrammetry module unavailable');
    if(!geometry||!Array.isArray(geometry.segments)||geometry.segments.length<1||
       geometry.segments.length>400||geometry.flightReady!==false||
       geometry.exportableAsWaylines!==false||
       geometry.validationScope!=='approximate-2d-geometry-preview')
      invalid('only approved non-flight survey geometry is accepted');
    const estimate=photogrammetry.estimate(geometry,manualOptics);
    const along=estimate.optics.alongTrackTriggerDistanceM;
    const counts=estimate.estimatedImagesPerSegment;
    const full=estimate.estimatedImageCount<=2000;
    const points=[];
    let observed=0,segmentCount=0,maximumNominalIntervalMeters=0;
    for(const [idx,seg] of geometry.segments.entries()){
      coordinate(seg.start);coordinate(seg.end);
      if(!Number.isInteger(seg.stripeIndex)||seg.stripeIndex<0||seg.stripeIndex>=200)
        invalid('invalid stripe index');
      if(!Number.isFinite(seg.lengthMeters)||seg.lengthMeters<0.5||
         seg.lengthMeters>3000)invalid('invalid segment length');
      const a=seg.start,b=seg.end;
      const lat=(a.lat+b.lat)/2*Math.PI/180;
      const planar=Math.hypot((b.lat-a.lat)*111132,
        (b.lon-a.lon)*111320*Math.cos(lat));
      if(Math.abs(planar-seg.lengthMeters)>Math.max(0.6,seg.lengthMeters*0.03))
        invalid('segment length inconsistent with coordinates');
      const count=counts[idx];
      if(!Number.isSafeInteger(count)||count<2||count>50000)
        invalid('invalid photo count');
      const step=seg.lengthMeters/(count-1);
      maximumNominalIntervalMeters=Math.max(maximumNominalIntervalMeters,step);
      if(step>along*(1+1e-9))invalid('photo spacing exceeds target');
      // For large surveys retain only both endpoints of each independent segment.
      // Never silently imply that a 2000-marker sample equals the full plan.
      const indices=full?Array.from({length:count},(_,i)=>i):[0,count-1];
      for(const photoIndex of indices){
        const t=photoIndex/(count-1);
        const p=photoIndex===0?a:photoIndex===count-1?b:
          {lat:a.lat+(b.lat-a.lat)*t,lon:a.lon+(b.lon-a.lon)*t};
        coordinate(p);
        points.push({lat:p.lat,lon:p.lon,segmentIndex:idx,
          stripeIndex:seg.stripeIndex,photoIndex,segmentPhotoCount:count});
      }
      segmentCount++;
      observed+=count;
    }
    if(observed!==estimate.estimatedImageCount)
      invalid('image summary mismatch');
    if(points.length>2000)invalid('preview marker count over budget');
    return {
      photoCenters:points,
      displayedCenterCount:points.length,
      estimatedImageCount:estimate.estimatedImageCount,
      segmentCount,
      estimatedCameraIntervalSeconds:estimate.optics.estimatedTriggerIntervalSeconds,
      requiredCameraMinIntervalSeconds:estimate.optics.cameraMinIntervalSeconds,
      cameraIntervalSatisfiesConstraint:estimate.optics.cameraIntervalSatisfiesConstraint,
      nominalMaximumSpacingMeters:maximumNominalIntervalMeters,
      targetSpacingMeters:along,
      sampleOnly:!full,
      sampleDescription:full?'all nominal photo centers':'segment endpoints only (not all photo centers)',
      validationScope:'offline-geometric-photo-centers-preview',
      flightReady:false,
      exportableAsWaylines:false,
      triggersGenerated:false,
      warning:'Nominal geometric point estimates only; no camera actions, surveyed ground coverage, or DJI flight authorization.'
    };
  }
  return Object.freeze({plan});
});
