'use strict';
// Conservative regression cases: GeoJSON topology and non-dispatch transitions.
// No drone, DJI control API or live network is used in these tests.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const survey=require('../../frontend/public/wpml-survey-preview-core');

const LAT=48,LON=8;
const xm=111320*Math.cos(LAT*Math.PI/180),ym=111132;
const point=(x,y)=>[LON+x/xm,LAT+y/ym];
function ring(points){return [...points.map(([x,y])=>point(x,y)),point(...points[0])];}
const outer=ring([[0,0],[120,0],[120,120],[0,120]]);
const hole=ring([[40,40],[80,40],[80,80],[40,80]]);
const polygon=(rings=[outer])=>({type:'Polygon',coordinates:rings});
const geom=(rings,heading=90,spacing=20)=>survey.preview(polygon(rings),{heading,spacing});

test('GeoJSON Polygon preserves the legacy coverage geometry and returns a closed outline',()=>{
  const legacy=outer.slice(0,-1).map(([lon,lat])=>({lat,lon}));
  const old=survey.preview(legacy,{heading:90,spacing:20});
  const modern=geom([outer]);
  assert.deepEqual(modern.segments,old.segments);
  assert.equal(modern.areaSqMeters,old.areaSqMeters);
  assert.deepEqual(modern.outlineGeometry,{type:'Polygon',coordinates:[outer]});
  assert.equal(modern.holeCount,0);
  assert.equal(modern.componentCount,1);
  assert.equal(modern.exportableAsWaylines,false);
  assert.equal(modern.flightReady,false);
});

test('an interior hole subtracts coverage and area without phantom lines across exclusion',()=>{
  const result=geom([outer,hole]);
  assert.equal(result.componentCount,1);
  assert.equal(result.holeCount,1);
  assert.ok(Math.abs(result.areaSqMeters-(120*120-40*40))<1);
  assert.ok(result.segmentCount>result.stripeCount);
  assert.equal(result.outlineGeometry.type,'Polygon');
  assert.equal(result.outlineGeometry.coordinates.length,2);
  const inHole=(p)=>{
    const x=(p.lon-LON)*xm,y=(p.lat-LAT)*ym;
    return x>40.001&&x<79.999&&y>40.001&&y<79.999;
  };
  for(const segment of result.segments){
    const midpoint={lat:(segment.start.lat+segment.end.lat)/2,
      lon:(segment.start.lon+segment.end.lon)/2};
    assert.equal(inHole(midpoint),false,'capture segment midpoint inside excluded ring');
    assert.equal(segment.kind,'coverage-only');
  }
  assert.equal(result.exportableAsWaylines,false);
  assert.equal(result.flightReady,false);
});

test('disjoint GeoJSON MultiPolygon yields independent coverage segments and non-flyable gaps',()=>{
  const left=ring([[0,0],[40,0],[40,60],[0,60]]);
  const right=ring([[80,0],[120,0],[120,60],[80,60]]);
  const input={type:'MultiPolygon',coordinates:[[left],[right]]};
  const result=survey.preview(input,{heading:90,spacing:12});
  assert.equal(result.componentCount,2);
  assert.equal(result.holeCount,0);
  assert.ok(Math.abs(result.areaSqMeters-4800)<1);
  assert.equal(result.outlineGeometry.type,'MultiPolygon');
  assert.ok(result.segmentCount>result.stripeCount);
  assert.equal(result.unplannedTransitions.length,result.segments.length-1);
  for(let i=0;i<result.unplannedTransitions.length;i++){
    const gap=result.unplannedTransitions[i];
    assert.deepEqual(gap.from,result.segments[i].end);
    assert.deepEqual(gap.to,result.segments[i+1].start);
    assert.equal(gap.kind,'unplanned-transition-gap');
    assert.equal(gap.planned,false);
    assert.equal(gap.safetyVerified,false);
    assert.equal(gap.flyable,false);
    assert.ok(Number.isFinite(gap.directDistanceMeters));
    assert.ok(gap.directDistanceMeters>=0);
  }
  assert.equal(result.exportableAsWaylines,false);
  assert.equal(result.flightReady,false);
});

test('rejects holes outside or touching the boundary, holes overlapping and nested holes',()=>{
  const outside=ring([[130,10],[140,10],[140,20],[130,20]]);
  const touching=ring([[0,40],[30,40],[30,70],[0,70]]);
  const overlap=ring([[60,60],[100,60],[100,100],[60,100]]);
  const insideHole=ring([[50,50],[70,50],[70,70],[50,70]]);
  for(const rings of [
    [outer,outside],[outer,touching],[outer,hole,overlap],
    [outer,hole,insideHole]
  ]) assert.throws(()=>geom(rings),/Survey preview invalid/);
});

test('rejects MultiPolygon overlap, touching, nesting and overlarge combined bounds',()=>{
  const left=ring([[0,0],[50,0],[50,50],[0,50]]);
  const overlap=ring([[40,0],[90,0],[90,50],[40,50]]);
  const touch=ring([[50,0],[90,0],[90,50],[50,50]]);
  const nested=ring([[10,10],[20,10],[20,20],[10,20]]);
  const far=ring([[3000,0],[3050,0],[3050,50],[3000,50]]);
  for(const other of [overlap,touch,nested,far]){
    const input={type:'MultiPolygon',coordinates:[[left],[other]]};
    assert.throws(()=>survey.preview(input,{heading:90,spacing:10}),
      /Survey preview invalid/);
  }
});

test('rejects invalid types, holes crossing their parent and coordinate ambiguities',()=>{
  const crossing=ring([[90,60],[140,60],[140,90],[90,90]]);
  for(const geometry of [
    {type:'GeometryCollection',geometries:[]},
    {type:'Polygon',coordinates:[]},
    {type:'MultiPolygon',coordinates:[]},
    polygon([outer,crossing]),
    polygon([[[8,48],[8.001,48],[8.001,48.001]]].map(r=>r.map(([lon,lat])=>[lon,lat,1]))),
    polygon([[[8,48],[8.001,'48'],[8.001,48.001]]]),
    {type:'MultiPolygon',coordinates:Array.from({length:5},()=>[outer])}
  ])assert.throws(()=>survey.preview(geometry),/Survey preview invalid/);
});

test('preview cannot become a drone command merely from valid topology',()=>{
  const result=geom([outer,hole]);
  assert.equal(result.validationScope,'approximate-2d-geometry-preview');
  assert.equal(result.flightReady,false);
  assert.equal(result.exportableAsWaylines,false);
  assert.ok(result.warning.includes('NOT routes'));
  assert.ok(!Object.hasOwn(result,'waylines'));
  assert.ok(!Object.hasOwn(result,'kmz'));
});

function pointWithinRing(pos,coordinateRing){
  const x=pos.lon,y=pos.lat;
  let included=false;
  for(let i=0,j=coordinateRing.length-1;i<coordinateRing.length;j=i++){
    const a=coordinateRing[i],b=coordinateRing[j];
    if((a[1]>y)!==(b[1]>y)&&
       x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])
      included=!included;
  }
  return included;
}
function reverseRing(r){
  const open=r.slice(0,-1).reverse();
  return [...open,open[0]];
}

test('sampling across rotations never places coverage segment interiors inside a hole',()=>{
  // Fixed geometric fixtures and headings deliberately avoid reliance on DJI data.
  for(const heading of [0,15,37,45,90,135,225,270,359]){
    const result=geom([outer,hole],heading,11);
    assert.ok(result.segmentCount>=3);
    for(const segment of result.segments){
      for(const t of [0.07,0.29,0.5,0.71,0.93]){
        const sample={lat:segment.start.lat*(1-t)+segment.end.lat*t,
          lon:segment.start.lon*(1-t)+segment.end.lon*t};
        assert.ok(pointWithinRing(sample,outer),
          'coverage sample outside outer ring, heading '+heading);
        assert.equal(pointWithinRing(sample,hole),false,
          'coverage sample inside exclusion, heading '+heading);
      }
      assert.equal(segment.kind,'coverage-only');
    }
    assert.equal(result.unplannedTransitions.every(g=>
      g.planned===false&&g.safetyVerified===false&&g.flyable===false),true);
    assert.equal(result.flightReady,false);
    assert.equal(result.exportableAsWaylines,false);
  }
});

test('ring winding reversal does not change coverage area or number of segments',()=>{
  for(const heading of [0,45,90,180]){
    const normal=geom([outer,hole],heading,13);
    const reversed=geom([reverseRing(outer),reverseRing(hole)],heading,13);
    assert.ok(Math.abs(normal.areaSqMeters-reversed.areaSqMeters)<1e-6);
    assert.equal(normal.segmentCount,reversed.segmentCount);
    assert.equal(normal.stripeCount,reversed.stripeCount);
    assert.ok(Math.abs(normal.previewSegmentLengthMeters-
      reversed.previewSegmentLengthMeters)<1e-6);
  }
});

test('hole in one MultiPolygon component does not alter the disjoint component',()=>{
  const nextOuter=ring([[150,0],[250,0],[250,120],[150,120]]);
  const geometry={type:'MultiPolygon',coordinates:[[outer,hole],[nextOuter]]};
  const result=survey.preview(geometry,{heading:90,spacing:17});
  assert.equal(result.componentCount,2);
  assert.equal(result.holeCount,1);
  assert.ok(Math.abs(result.areaSqMeters-(12800+12000))<1);
  assert.equal(result.outlineGeometry.type,'MultiPolygon');
  const xs=result.segments.map(s=>((s.start.lon+s.end.lon)/2-LON)*xm);
  assert.ok(xs.some(x=>x<120));
  assert.ok(xs.some(x=>x>150));
  assert.equal(result.flightReady,false);
});
