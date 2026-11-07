'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {pvInspect}=require('../aeronexus-pv-lab');
const source={kind:'synthetic',sha256:'a'.repeat(64)};
test('P2 4-neighbor hotspots are bounded and remain unverified',()=>{
  const grid=Float32Array.from([20,20,20,20,20,30,31,20,20,20,20,20,20,20,20,20]);
  const r=pvInspect({width:4,height:4,temperatures:grid,region:{x:0,y:0,w:4,h:4},source});
  assert.equal(r.hotspots.length,1);assert.equal(r.hotspots[0].pixels,2);
  assert.equal(r.hotspots[0].peakCelsius,31);assert.equal(r.referenceMedianCelsius,20);
  assert.equal(r.pvDefectVerified,false);assert.equal(r.measuredTemperaturesVerified,false);
});
test('P2 excludes a one-pixel spike and fails closed on missing data',()=>{
  const grid=new Float32Array(16).fill(21);grid[5]=40;
  assert.equal(pvInspect({width:4,height:4,temperatures:grid,region:{x:0,y:0,w:4,h:4},source}).hotspots.length,0);
  assert.throws(()=>pvInspect({width:4,height:4,temperatures:grid,region:{x:0,y:0,w:5,h:4},source}));
  assert.throws(()=>pvInspect({width:4,height:4,temperatures:grid,region:{x:0,y:0,w:4,h:4},
    source:{kind:'raw-estimate',sha256:source.sha256}}));
});
