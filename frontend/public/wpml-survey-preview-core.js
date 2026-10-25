'use strict';
// Pure 2D coverage visualization: NOT DJI WPML/waylines generation.
// Fixed local tangent/equirectangular approximation for short survey polygons.
// No elevation, camera optics, geofence, collision or aircraft performance inputs.
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.SkyHubSurveyPreview=factory();
})(typeof globalThis==='object'?globalThis:this,function(){
  const DEG=Math.PI/180;
  function invalid(message){throw new TypeError('Survey preview invalid: '+message);}
  function num(input,label,min,max){
    if((typeof input!=='number'&&typeof input!=='string')||
       (typeof input==='string'&&!/^\s*[-+]?(?:\d+(?:\.\d*)?|\.\d+)\s*$/.test(input)))
      invalid(label+' must be numeric');
    const x=Number(input);
    if(!Number.isFinite(x)||x<min||x>max)invalid(label+' out of range');
    return x;
  }
  function cross(a,b,c){
    return (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
  }
  function onSegment(a,b,c){
    return Math.min(a.x,b.x)-1e-8<=c.x&&c.x<=Math.max(a.x,b.x)+1e-8&&
      Math.min(a.y,b.y)-1e-8<=c.y&&c.y<=Math.max(a.y,b.y)+1e-8;
  }
  function intersects(a,b,c,d){
    const c1=cross(a,b,c),c2=cross(a,b,d),c3=cross(c,d,a),c4=cross(c,d,b);
    if((c1>1e-8&&c2< -1e-8||c1< -1e-8&&c2>1e-8)&&
       (c3>1e-8&&c4< -1e-8||c3< -1e-8&&c4>1e-8))return true;
    return Math.abs(c1)<=1e-8&&onSegment(a,b,c)||
      Math.abs(c2)<=1e-8&&onSegment(a,b,d)||
      Math.abs(c3)<=1e-8&&onSegment(c,d,a)||
      Math.abs(c4)<=1e-8&&onSegment(c,d,b);
  }
  function validatePolygon(vertices){
    if(!Array.isArray(vertices)||vertices.length<3||vertices.length>80)
      invalid('polygon requires 3–80 vertices');
    const points=vertices.map((p,i)=>{
      if(!p||typeof p!=='object'||Array.isArray(p))invalid('vertex '+i);
      return {lat:num(p.lat,'latitude '+i,-85,85),
        lon:num(p.lon,'longitude '+i,-180,180)};
    });
    if(points.length>3&&points[0].lat===points[points.length-1].lat&&
       points[0].lon===points[points.length-1].lon)points.pop();
    if(points.length<3)invalid('too few distinct vertices');
    const lat0=points.reduce((a,p)=>a+p.lat,0)/points.length;
    const lon0=points.reduce((a,p)=>a+p.lon,0)/points.length;
    const sx=111320*Math.cos(lat0*DEG),sy=111132;
    const xy=points.map(p=>({x:(p.lon-lon0)*sx,y:(p.lat-lat0)*sy}));
    if(xy.some((p,i)=>i>0&&Math.hypot(p.x-xy[i-1].x,p.y-xy[i-1].y)<0.5)||
       Math.hypot(xy[0].x-xy[xy.length-1].x,xy[0].y-xy[xy.length-1].y)<0.5)
      invalid('nearly identical adjacent vertices');
    const xs=xy.map(p=>p.x),ys=xy.map(p=>p.y);
    if(Math.max(...xs)-Math.min(...xs)>2000||Math.max(...ys)-Math.min(...ys)>2000)
      invalid('survey extent exceeds 2 km local approximation');
    for(let i=0;i<xy.length;i++){
      const a=xy[i],b=xy[(i+1)%xy.length];
      for(let j=i+1;j<xy.length;j++){
        if(j===i+1||(i===0&&j===xy.length-1))continue;
        if(intersects(a,b,xy[j],xy[(j+1)%xy.length]))
          invalid('self-intersecting survey polygon');
      }
    }
    let twiceArea=0;
    for(let i=0;i<xy.length;i++){
      const a=xy[i],b=xy[(i+1)%xy.length];
      twiceArea+=a.x*b.y-a.y*b.x;
    }
    const area=Math.abs(twiceArea)/2;
    if(!Number.isFinite(area)||area<10)invalid('degenerate or tiny survey polygon');
    return {points,xy,lat0,lon0,sx,sy,area};
  }
  // Only RFC 7946 Polygon/MultiPolygon coordinates or the original legacy point
  // array are accepted. GeoJSON properties, features and geometry collections do
  // not implicitly become executable missions or trusted camera information.
  function validateGeometry(input){
    const legacy=Array.isArray(input);
    let components;
    if(legacy)components=[[input]];
    else if(input&&input.type==='Polygon'&&Array.isArray(input.coordinates))
      components=[input.coordinates];
    else if(input&&input.type==='MultiPolygon'&&Array.isArray(input.coordinates))
      components=input.coordinates;
    else invalid('expected point array or GeoJSON Polygon/MultiPolygon geometry');

    if(!components.length||components.length>4)
      invalid('requires 1–4 disjoint components');
    let totalVertices=0,ringCount=0;
    const parsed=components.map((component,componentIndex)=>{
      if(!Array.isArray(component)||component.length<1||component.length>8)
        invalid('component '+componentIndex+' requires 1–8 rings');
      ringCount+=component.length;
      return component.map((raw,ringIndex)=>{
        if(!Array.isArray(raw))invalid('ring must be coordinate array');
        totalVertices+=raw.length;
        if(totalVertices>160||ringCount>16)
          invalid('geometry complexity budget exceeded');
        const points=legacy?raw:raw.map((coordinate,i)=>{
          if(!Array.isArray(coordinate)||coordinate.length!==2||
             coordinate.some(v=>typeof v!=='number'||!Number.isFinite(v)))
            invalid('invalid GeoJSON coordinate '+i);
          return {lon:coordinate[0],lat:coordinate[1]};
        });
        const ring=validatePolygon(points);
        return ring.points;
      });
    });
    const all=parsed.flat(2);
    const lat0=all.reduce((n,p)=>n+p.lat,0)/all.length;
    const lon0=all.reduce((n,p)=>n+p.lon,0)/all.length;
    const sx=111320*Math.cos(lat0*DEG),sy=111132;
    const project=p=>({x:(p.lon-lon0)*sx,y:(p.lat-lat0)*sy});
    const polygons=parsed.map(component=>({
      rings:component.map(points=>points.map(project)),
      coordinates:component.map(points=>points.map(p=>({...p})))
    }));
    const flat=polygons.flatMap(p=>p.rings.flat());
    if(Math.max(...flat.map(p=>p.x))-Math.min(...flat.map(p=>p.x))>2000||
       Math.max(...flat.map(p=>p.y))-Math.min(...flat.map(p=>p.y))>2000)
      invalid('combined extent exceeds 2 km local approximation');

    function signedArea(ring){
      let sum=0;
      for(let i=0;i<ring.length;i++){
        const a=ring[i],b=ring[(i+1)%ring.length];
        sum+=a.x*b.y-a.y*b.x;
      }
      return sum/2;
    }
    function location(point,ring){
      let inside=false;
      for(let i=0,j=ring.length-1;i<ring.length;j=i++){
        const a=ring[j],b=ring[i];
        if(Math.abs(cross(a,b,point))<=1e-8&&onSegment(a,b,point))
          return 0; // Boundary touch is not an accepted survey exclusion.
        if((a.y>point.y)!==(b.y>point.y)&&
           point.x<(b.x-a.x)*(point.y-a.y)/(b.y-a.y)+a.x)
          inside=!inside;
      }
      return inside?1:-1;
    }
    function touches(a,b){
      for(let i=0;i<a.length;i++)
        for(let j=0;j<b.length;j++)
          if(intersects(a[i],a[(i+1)%a.length],
                        b[j],b[(j+1)%b.length]))return true;
      return false;
    }
    let area=0,holeCount=0;
    for(const p of polygons){
      const [outer,...holes]=p.rings;
      let componentArea=Math.abs(signedArea(outer));
      for(const hole of holes){
        if(touches(outer,hole)||location(hole[0],outer)!==1)
          invalid('hole must be strictly inside its outer ring');
        componentArea-=Math.abs(signedArea(hole));
      }
      for(let i=0;i<holes.length;i++){
        for(let j=i+1;j<holes.length;j++){
          if(touches(holes[i],holes[j])||
             location(holes[i][0],holes[j])!==-1||
             location(holes[j][0],holes[i])!==-1)
            invalid('holes may not overlap, touch or nest');
        }
      }
      if(componentArea<10)invalid('component has insufficient usable area');
      area+=componentArea;
      holeCount+=holes.length;
    }
    for(let i=0;i<polygons.length;i++){
      for(let j=i+1;j<polygons.length;j++){
        const a=polygons[i].rings[0],b=polygons[j].rings[0];
        if(touches(a,b)||location(a[0],b)!==-1||location(b[0],a)!==-1)
          invalid('components may not overlap, touch or nest');
      }
    }
    const toClosed=points=>[...points.map(p=>[p.lon,p.lat]),
      [points[0].lon,points[0].lat]];
    const coordinateGroups=polygons.map(p=>p.coordinates.map(toClosed));
    return {
      polygons,lat0,lon0,sx,sy,area,holeCount,
      componentCount:polygons.length,
      polygon:polygons[0].coordinates[0].map(p=>({...p})),
      outlineGeometry:polygons.length===1?
        {type:'Polygon',coordinates:coordinateGroups[0]}:
        {type:'MultiPolygon',coordinates:coordinateGroups}
    };
  }
  function preview(polygon,options={}){
    const g=validateGeometry(polygon);
    const spacing=num(options.spacing??20,'line spacing',2,200);
    const heading=num(options.heading??0,'heading',0,360)*DEG;
    const sin=Math.sin(heading),cos=Math.cos(heading);
    // u is along-track, v is cross-track. Heading is clockwise from north.
    const components=g.polygons.map(component=>component.rings.map(ring=>
      ring.map(p=>({u:p.x*sin+p.y*cos,v:p.x*cos-p.y*sin}))));
    const vs=components.flat(2).map(p=>p.v);
    const low=Math.min(...vs),high=Math.max(...vs),width=high-low;
    const stripes=[];
    if(width<=spacing)stripes.push((low+high)/2);
    else for(let v=low+spacing/2;v<high;v+=spacing){
      if(stripes.length>=200)invalid('more than 200 preview strips');
      stripes.push(v);
    }
    if(!stripes.length)stripes.push((low+high)/2);
    const lines=[];let total=0;
    function geo(u,v){
      const x=u*sin+v*cos,y=u*cos-v*sin;
      return {lat:g.lat0+y/g.sy,lon:g.lon0+x/g.sx};
    }
    for(const [index,v] of stripes.entries()){
      const spans=[];
      for(const component of components){
        // Parity across the strictly nested rings subtracts holes without
        // fabricating a continuous line across their excluded interiors.
        const hits=[];
        for(const ring of component){
          for(let i=0;i<ring.length;i++){
            const a=ring[i],b=ring[(i+1)%ring.length];
            if((a.v<=v&&b.v>v)||(b.v<=v&&a.v>v)){
              const factor=(v-a.v)/(b.v-a.v);
              hits.push(a.u+factor*(b.u-a.u));
            }
          }
        }
        hits.sort((a,b)=>a-b);
        if(hits.length%2)invalid('unpaired polygon intersections');
        for(let i=0;i<hits.length;i+=2){
          const len=hits[i+1]-hits[i];
          if(len>=0.5)spans.push([hits[i],hits[i+1]]);
        }
      }
      spans.sort((a,b)=>a[0]-b[0]);
      for(let i=1;i<spans.length;i++)
        if(spans[i][0]<spans[i-1][1]-1e-8)
          invalid('overlapping survey spans');
      const forwards=index%2===0;
      const ordered=forwards?spans:spans.reverse();
      for(const span of ordered){
        const from=forwards?span[0]:span[1],to=forwards?span[1]:span[0];
        lines.push({start:geo(from,v),end:geo(to,v),lengthMeters:Math.abs(to-from),
          stripeIndex:index,kind:'coverage-only'});
        total+=Math.abs(to-from);
        if(lines.length>400)invalid('more than 400 preview line segments');
      }
    }
    if(!lines.length)invalid('no usable coverage segments');

    // Reporting a direct gap is NOT planning a turn or safe path. These
    // transitions may cross excluded rings, buildings or no-fly areas.
    const unplannedTransitions=lines.slice(1).map((seg,i)=>{
      const prev=lines[i],a=prev.end,b=seg.start;
      const dx=(b.lon-a.lon)*g.sx,dy=(b.lat-a.lat)*g.sy;
      return {
        from:{...a},to:{...b},directDistanceMeters:Math.hypot(dx,dy),
        kind:'unplanned-transition-gap',planned:false,safetyVerified:false,
        flyable:false
      };
    });
    return {
      polygon:g.polygon,
      outlineGeometry:g.outlineGeometry,
      componentCount:g.componentCount,
      holeCount:g.holeCount,
      segments:lines,
      unplannedTransitions,
      areaSqMeters:g.area,
      previewSegmentLengthMeters:total,
      lineSpacingMeters:spacing,
      headingDegrees:heading/DEG,
      stripeCount:stripes.length,
      segmentCount:lines.length,
      flightReady:false,
      exportableAsWaylines:false,
      validationScope:'approximate-2d-geometry-preview',
      warning:'Coverage segments are independent. Direct transition gaps are NOT routes. No terrain, geofence, obstacles, camera compatibility or flight clearance.'
    };
  }
  return Object.freeze({preview,validatePolygon,validateGeometry});
});
