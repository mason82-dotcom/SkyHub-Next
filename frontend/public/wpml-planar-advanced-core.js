'use strict';
// Derived conceptually from Tao-tao520/planar-wayline (MIT, chengtao 2026).
// Integrates with SkyHub's stricter Polygon/MultiPolygon preview and never generates DJI WPML.
(function(root,factory){
  if(typeof module==='object'&&module.exports)
    module.exports=factory(require('./wpml-survey-preview-core'));
  else root.SkyHubPlanarAdvanced=factory(root.SkyHubSurveyPreview);
})(typeof globalThis==='object'?globalThis:this,function(survey){
  const RAD=Math.PI/180;
  function invalid(message){throw new TypeError('Planar preview invalid: '+message);}
  function numeric(x,label,lo,hi){
    if((typeof x!=='number'&&typeof x!=='string')||
       (typeof x==='string'&&!/^\s*[+]?(?:\d+(?:\.\d*)?|\.\d+)\s*$/.test(x)))
      invalid(label+' must be numeric');
    const n=Number(x);
    if(!Number.isFinite(n)||n<lo||n>hi)invalid(label+' out of range');
    return n;
  }
  function heading(x){return ((x%180)+180)%180;}
  function distance(a,b,g){
    return Math.hypot((b.lon-a.lon)*g.sx,(b.lat-a.lat)*g.sy);
  }
  function bearing(a,b,g){
    return heading(Math.atan2((b.lon-a.lon)*g.sx,(b.lat-a.lat)*g.sy)/RAD);
  }
  function candidates(g,manual){
    if(manual!==null)return [manual];
    const result=new Map();
    for(let a=0;a<180;a+=15)result.set(a.toFixed(3),a);
    for(const polygon of g.polygons)for(const ring of polygon.coordinates)
      for(let i=0;i<ring.length;i++){
        const a=ring[i],b=ring[(i+1)%ring.length];
        if(distance(a,b,g)<2)continue;
        const h=bearing(a,b,g);
        result.set(h.toFixed(3),h);
      }
    return [...result.values()].slice(0,96);
  }
  function pointLocation(p,ring){
    let inside=false;
    for(let i=0,j=ring.length-1;i<ring.length;j=i++){
      const a=ring[j],b=ring[i];
      const cross=(b.x-a.x)*(p.y-a.y)-(b.y-a.y)*(p.x-a.x);
      const dot=(p.x-a.x)*(p.x-b.x)+(p.y-a.y)*(p.y-b.y);
      if(Math.abs(cross)<=1e-7&&dot<=1e-7)return 0;
      if((a.y>p.y)!==(b.y>p.y)&&
        p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)inside=!inside;
    }
    return inside?1:-1;
  }
  function pointComponent(p,g){
    for(let k=0;k<g.polygons.length;k++){
      const rings=g.polygons[k].rings;
      if(pointLocation(p,rings[0])===-1)continue;
      if(rings.slice(1).some(r=>pointLocation(p,r)>=0))continue;
      return k;
    }
    return -1;
  }
  function orient(a,b,c){return (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);}
  function properCross(a,b,c,d){
    const s1=orient(a,b,c),s2=orient(a,b,d),s3=orient(c,d,a),s4=orient(c,d,b);
    return ((s1>1e-7&&s2< -1e-7)||(s2>1e-7&&s1< -1e-7))&&
      ((s3>1e-7&&s4< -1e-7)||(s4>1e-7&&s3< -1e-7));
  }
  function visible(a,b,g,component){
    const poly=g.polygons[component];
    for(const ring of poly.rings)
      for(let j=0;j<ring.length;j++)
        if(properCross(a,b,ring[j],ring[(j+1)%ring.length]))return false;
    // A boundary-tangent is a geometric candidate, never a cleared flight corridor.
    for(const t of [0.1,0.25,0.5,0.75,0.9]){
      const p={x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};
      if(pointLocation(p,poly.rings[0])===-1||
         poly.rings.slice(1).some(r=>pointLocation(p,r)===1))return false;
    }
    return true;
  }
  function transitionCandidate(gap,g){
    const xy=p=>({x:(p.lon-g.lon0)*g.sx,y:(p.lat-g.lat0)*g.sy});
    const start=xy(gap.from),end=xy(gap.to);
    const first=pointComponent(start,g),last=pointComponent(end,g);
    const blocked=(reason)=>({
      kind:'unverified-geometric-transition',status:'unresolved',reason,
      planned:false,safetyVerified:false,flyable:false,flightReady:false
    });
    if(first===-1||last!==first)return blocked('disconnected-or-excluded-area');
    const rings=g.polygons[first].rings;
    const vertices=rings.flat();
    if(vertices.length>80)return blocked('geometry-complexity-budget');
    const nodes=[start,end,...vertices];
    const d=Array(nodes.length).fill(Infinity),prev=Array(nodes.length).fill(-1),done=new Set();
    d[0]=0;
    for(let k=0;k<nodes.length;k++){
      let current=-1;
      for(let i=0;i<nodes.length;i++)
        if(!done.has(i)&&(current<0||d[i]<d[current]))current=i;
      if(current<0||!Number.isFinite(d[current]))break;
      if(current===1)break;
      done.add(current);
      for(let j=0;j<nodes.length;j++){
        if(done.has(j)||j===current||!visible(nodes[current],nodes[j],g,first))continue;
        const alt=d[current]+Math.hypot(nodes[j].x-nodes[current].x,nodes[j].y-nodes[current].y);
        if(alt<d[j]-1e-8){d[j]=alt;prev[j]=current;}
      }
    }
    if(!Number.isFinite(d[1]))return blocked('no-contained-candidate');
    const indexes=[];let node=1;
    while(node>=0&&indexes.length<=nodes.length){indexes.push(node);node=prev[node];}
    if(indexes.at(-1)!==0)return blocked('broken-predecessor-chain');
    const path=indexes.reverse().map(i=>({
      lat:g.lat0+nodes[i].y/g.sy,lon:g.lon0+nodes[i].x/g.sx
    }));
    return {
      kind:'unverified-geometric-transition',status:'candidate',
      distanceMeters:d[1],path,
      planned:false,safetyVerified:false,flyable:false,flightReady:false
    };
  }
  function optimize(geometry,options={}){
    if(!survey)invalid('SkyHub survey geometry module unavailable');
    const g=survey.validateGeometry(geometry);
    const spacing=numeric(options.spacing??20,'spacing',2,200);
    const angle=options.heading===undefined||options.heading===null?null:
      heading(numeric(options.heading,'heading',0,360));
    const angles=candidates(g,options.optimize===true?null:(angle??0));
    let selected=null,score=Infinity,checked=0;
    for(const deg of angles){
      let p;
      try{p=survey.preview(geometry,{spacing,heading:deg});}
      catch{continue;}
      checked++;
      const gaps=p.unplannedTransitions.reduce((s,x)=>s+x.directDistanceMeters,0);
      // Ranking only. Gap length is straight-line and NOT a flyable route length.
      const value=p.previewSegmentLengthMeters+gaps+8*p.segmentCount+4*p.stripeCount;
      if(value<score){selected=p;score=value;}
    }
    if(!selected)invalid('no valid sweep within geometry limits');
    const cap=Math.min(selected.unplannedTransitions.length,24);
    const transitionCandidates=selected.unplannedTransitions.slice(0,cap)
      .map(gap=>transitionCandidate(gap,g));
    return {...selected,
      schema:'skyhub-planar-advanced-preview-v1',
      optimizedHeadingDegrees:selected.headingDegrees,
      evaluatedHeadingCount:checked,rankingScoreMeters:score,
      estimatedDirectGapMeters:selected.unplannedTransitions
        .reduce((s,x)=>s+x.directDistanceMeters,0),
      transitionCandidates,unexaminedTransitionCount:
        selected.unplannedTransitions.length-cap,
      designReference:'Tao-tao520/planar-wayline (MIT)',
      transitionSafetyVerified:false,terrainVerified:false,
      cameraHardwareVerified:false,pilot2HardwareVerified:false,
      flightReady:false,dispatchAllowed:false,exportableAsWaylines:false,
      validationScope:'bounded-planar-photogrammetry-geometry-only'};
  }
  function offsetGeometry(geometry,northM,eastM){
    const g=survey.validateGeometry(geometry);
    const moved=g.outlineGeometry;
    const shift=x=>[x[0]+eastM/g.sx,x[1]+northM/g.sy];
    return moved.type==='Polygon'?
      {type:'Polygon',coordinates:moved.coordinates.map(r=>r.map(shift))}:
      {type:'MultiPolygon',coordinates:moved.coordinates.map(p=>p.map(r=>r.map(shift)))};
  }
  function fiveDirection(geometry,options={}){
    const agl=numeric(options.heightAGLM,'AGL height',2,500);
    const pitch=numeric(options.pitchDegrees,'gimbal pitch',-85,-40);
    const spacing=numeric(options.spacing??20,'spacing',2,200);
    const base=optimize(geometry,{spacing,heading:options.heading,
      optimize:options.optimize===true});
    const defs=[
      ['nadir',null,-90],['direction1',0,pitch],['direction2',90,pitch],
      ['direction3',180,pitch],['direction4',270,pitch]
    ];
    const offset=agl/Math.tan(Math.abs(pitch)*RAD);
    if(!Number.isFinite(offset)||offset>1500)invalid('oblique offset too large');
    const passes=defs.map(([key,delta,gimbalPitchDegrees],i)=>{
      const yaw=delta===null?null:(base.headingDegrees+delta)%360;
      const h=yaw===null?base.headingDegrees:heading(yaw);
      const shifted=yaw===null?geometry:
        offsetGeometry(geometry,-offset*Math.cos(yaw*RAD),-offset*Math.sin(yaw*RAD));
      const plan=yaw===null?base:optimize(shifted,{spacing,heading:h});
      return {id:i+1,key,gimbalPitchDegrees,headingDegrees:yaw,
        estimatedFootprintOffsetMeters:yaw===null?0:offset,
        preview:plan,
        flightReady:false,exportableAsWaylines:false,dispatchAllowed:false};
    });
    return {schema:'skyhub-planar-five-direction-preview-v1',
      passes,referencePolygon:base.outlineGeometry,baseHeadingDegrees:base.headingDegrees,
      heightAGLM:agl,gimbalPitchDegrees:pitch,
      estimatedCaptureLengthMeters:passes.reduce((sum,p)=>sum+p.preview.previewSegmentLengthMeters,0),
      assumptions:['Uniform terrain','User-supplied AGL and camera pitch','No verified camera footprint','No verified transit, obstacles or RC/Pilot 2 compatibility'],
      terrainVerified:false,obstacleClearanceVerified:false,cameraHardwareVerified:false,
      pilot2HardwareVerified:false,flightReady:false,exportableAsWaylines:false,
      dispatchAllowed:false};
  }
  // Strictly numeric; never coerce null or empty DEM fields into elevation zero.
  function terrainAssessment(response){
    const unknown=reason=>({
      status:'unknown',reason,terrainVerified:false,obstacleClearanceVerified:false,
      flightReady:false,dispatchAllowed:false,exportableAsWaylines:false
    });
    if(!response||response.status!=='ok'||!response.minAgl||!response.maxAgl||
       !Array.isArray(response.profile))return unknown('not-sampled');
    const min=response.minAgl.aglM,max=response.maxAgl.aglM;
    if(typeof min!=='number'||!Number.isFinite(min)||
       typeof max!=='number'||!Number.isFinite(max)||min>max)
      return unknown('invalid-agl-extrema');
    if(!Number.isSafeInteger(response.samples)||response.samples<2||
       response.samples>600||response.profile.length!==response.samples)
      return unknown('sample-count-mismatch');
    if(response.missing!==0)return unknown('missing-dem-heights');
    for(const point of response.profile){
      if(!point||typeof point!=='object'||
         !Number.isFinite(point.ground)||!Number.isFinite(point.flight)||
         !Number.isFinite(point.agl)||!Number.isFinite(point.d))
        return unknown('invalid-profile-point');
      if(Math.abs((point.flight-point.ground)-point.agl)>0.25)
        return unknown('inconsistent-height-reference');
    }
    if(typeof response.dataset!=='string'||!response.dataset||
       typeof response.assumedTakeoff!=='boolean')
      return unknown('unknown-dem-provenance');
    return {status:'sampled',minAglM:min,maxAglM:max,
      below15m:min<15,above120m:max>120,
      samples:response.samples,missing:0,dataset:response.dataset,
      assumedTakeoff:response.assumedTakeoff,
      coverage:'selected-scan-segment-only',terrainVerified:false,
      obstacleClearanceVerified:false,flightReady:false,dispatchAllowed:false,
      exportableAsWaylines:false};
  }
  // Aggregate only independent scan samples. Never bridge excluded zones
  // and never imply that sampling the first N strips certifies unexamined strips.
  function assessTerrainSegments(results,totalSegmentCount){
    if(!Number.isSafeInteger(totalSegmentCount)||totalSegmentCount<1||
       totalSegmentCount>400||!Array.isArray(results)||results.length<1||
       results.length>8||results.length>totalSegmentCount)
      invalid('terrain batch size/coverage');
    const sampled=results.filter(x=>x&&x.status==='sampled');
    const min=sampled.length?Math.min(...sampled.map(x=>x.minAglM)):null;
    const max=sampled.length?Math.max(...sampled.map(x=>x.maxAglM)):null;
    const unknownCount=results.length-sampled.length;
    return {
      schema:'skyhub-planar-segment-dem-sample-v1',
      status:sampled.length===0?'unknown':
        sampled.length===totalSegmentCount?'sampled-all':'partial',
      selectedSegmentCount:results.length,sampledSegmentCount:sampled.length,
      failedSegmentCount:unknownCount,
      notRequestedSegmentCount:totalSegmentCount-results.length,
      totalSegmentCount,
      minAglM:min,maxAglM:max,
      below15m:sampled.some(x=>x.below15m),
      above120m:sampled.some(x=>x.above120m),
      assumedTakeoff:sampled.some(x=>x.assumedTakeoff),
      datasetNames:[...new Set(sampled.map(x=>x.dataset))].sort(),
      coverage:'first-eight-independent-scan-segments-at-most',
      coverageComplete:sampled.length===totalSegmentCount,
      terrainVerified:false,obstacleClearanceVerified:false,
      cameraHardwareVerified:false,flightReady:false,dispatchAllowed:false,
      exportableAsWaylines:false
    };
  }
  return Object.freeze({optimize,fiveDirection,terrainAssessment,assessTerrainSegments,transitionCandidate});
});