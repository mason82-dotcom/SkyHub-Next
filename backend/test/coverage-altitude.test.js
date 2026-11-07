'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {parseTakeoff,terrainCorrectedPhotos,MAX_TERRAIN_PHOTOS}=require('../coverage-altitude');
const point=(name,lat,relAlt=80,absAlt=9999)=>({
  name,info:{lat,lon:8.60,relAlt,absAlt,yaw:0,pitch:-90,roll:0,focal35:24,width:4000,height:3000}
});
test('start position is explicit, numeric and never inferred from the first camera position',()=>{
  assert.equal(parseTakeoff({}),null);
  assert.deepEqual(parseTakeoff({takeoff:{lat:49.1,lon:8.6}}),{lat:49.1,lon:8.6});
  assert.throws(()=>parseTakeoff({takeoff:{lat:"49.1",lon:8.6}}),{status:400});
  assert.throws(()=>parseTakeoff({takeoff:{lat:99,lon:8.6}}),{status:400});
  assert.throws(()=>parseTakeoff({takeoff:{lat:49.1}}),{status:400});
});
test('same DEM difference corrects AGL without treating DJI AbsoluteAltitude as a datum',async()=>{
  const source=[point('one',49.101),point('two',49.102,80,-1000)];
  const takeoff={lat:49.1,lon:8.6};
  let requested;
  const terrain={config:{dataset:'cop30',public:false},elevations:async pts=>{requested=pts;return [100,140,80];}};
  const result=await terrainCorrectedPhotos(source,takeoff,terrain);
  assert.equal(result.status,'estimated');
  assert.deepEqual(requested,[takeoff,{lat:49.101,lon:8.6},{lat:49.102,lon:8.6}]);
  assert.equal(result.photos[0].aglM,40);
  assert.equal(result.photos[1].aglM,100);
  assert.equal(result.altitude.terrainDataset,'cop30');
  assert.equal(result.altitude.absoluteAltitudeDatum,'not-used');
  assert.equal(result.altitude.missing,0);
});
test('unavailable terrain never silently returns uncorrected relative heights',async()=>{
  const input=[point('one',49.101),point('two',49.102)];
  const p={lat:49.1,lon:8.6};
  assert.equal((await terrainCorrectedPhotos(input,p,null)).status,'unavailable');
  const publicTerrain={config:{public:true},elevations:()=>{throw new Error('should not call');}};
  assert.equal((await terrainCorrectedPhotos(input,p,publicTerrain)).status,'unavailable');
  const failed={config:{dataset:'cop30'},elevations:async()=>{throw new Error('offline');}};
  assert.equal((await terrainCorrectedPhotos(input,p,failed)).altitude.status,'unavailable');
  const missingStart={config:{dataset:'cop30'},elevations:async()=>[null,100,100]};
  assert.equal((await terrainCorrectedPhotos(input,p,missingStart)).status,'unavailable');
  assert.equal((await terrainCorrectedPhotos(new Array(MAX_TERRAIN_PHOTOS+1).fill(input[0]),p,failed)).status,'unavailable');
});
test('partial DEM coverage excludes missing/corrupt heights instead of falling back',async()=>{
  const input=[point('one',49.101),point('two',49.102),point('three',49.103)];
  const terrain={config:{dataset:'cop30'},elevations:async()=>[120,135,null,115]};
  const result=await terrainCorrectedPhotos(input,{lat:49.1,lon:8.6},terrain);
  assert.equal(result.status,'estimated');
  assert.equal(result.altitude.valid,2);
  assert.equal(result.altitude.missing,1);
  assert.equal(result.photos[0].aglM,65);
  assert.equal(result.photos[1].info,null);
  assert.equal(result.photos[2].aglM,85);
  assert.equal(input[1].info.relAlt,80,'input objects must remain unchanged');
});
