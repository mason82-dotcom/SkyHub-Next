'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const T=require('../../frontend/public/thermal-core');

// Pixel values deliberately differ, making geometry and coordinate errors visible.
const frame=new Float32Array(Array.from({length:25},(_,i)=>i));
const roi=(type,rect,temps=frame,w=5,h=5)=>T.shapeStats(temps,w,h,type,rect);

test('line measurement uses bounded Bresenham and includes both endpoints',()=>{
  const t=roi('line',{x0:0,y0:0,x1:4,y1:4});
  assert.equal(t.pixels,5);
  assert.equal(t.min,0);assert.equal(t.max,24);assert.equal(t.mean,12);
  assert.deepEqual(t.hot,{x:4,y:4});assert.deepEqual(t.cold,{x:0,y:0});
  const reverse=roi('line',{x0:4,y0:4,x1:0,y1:0});
  assert.deepEqual([reverse.pixels,reverse.min,reverse.max,reverse.mean],
    [t.pixels,t.min,t.max,t.mean]);
  const horizontal=roi('line',{x0:0,y0:2,x1:4,y1:2});
  assert.equal(horizontal.pixels,5);
  assert.equal(horizontal.mean,12);
});

test('circle uses inscribed radius and ellipse uses independent radii',()=>{
  const circle=roi('circle',{x0:0,y0:0,x1:4,y1:4});
  assert.equal(circle.pixels,13);
  assert.equal(circle.min,2);assert.equal(circle.max,22);
  const ellipse=roi('ellipse',{x0:0,y0:0,x1:4,y1:2});
  assert.equal(ellipse.pixels,7);
  assert.equal(ellipse.min,2);assert.equal(ellipse.max,12);
  const wide=roi('circle',{x0:0,y0:0,x1:4,y1:2});
  assert.equal(wide.pixels,5); // circle centre (2,1), radius 1
});

test('reject invalid matrix, nonfinite geometry and unknown tools',()=>{
  assert.throws(()=>roi('polygon',{x0:0,y0:0,x1:2,y1:2}),RangeError);
  assert.throws(()=>roi('line',{x0:0,y0:0,x1:Infinity,y1:2}),RangeError);
  assert.throws(()=>T.shapeStats(new Float32Array(3),2,2,'line',{x0:0,y0:0,x1:1,y1:1}),RangeError);
  assert.equal(roi('ellipse',{x0:1,y0:1,x1:1,y1:3}),null);
  assert.equal(roi('line',{x0:0,y0:0,x1:1,y1:1},new Float32Array(25).fill(NaN)),null);
});

test('out-of-frame coordinates stay within the matrix and nonfinite samples are skipped',()=>{
  const line=roi('line',{x0:-99,y0:2,x1:99,y1:2});
  assert.equal(line.pixels,5);assert.equal(line.min,10);assert.equal(line.max,14);
  const data=frame.slice();data[12]=NaN;
  const ring=roi('circle',{x0:0,y0:0,x1:4,y1:4},data);
  assert.equal(ring.pixels,12);
  assert.equal(Number.isFinite(ring.mean),true);
});

test('ROI values come from the supplied float matrix without reapplying estimation',()=>{
  const sdk=new Float32Array([11.5,-4.25,8.75,90]);
  const line=T.shapeStats(sdk,2,2,'line',{x0:0,y0:0,x1:1,y1:1});
  assert.equal(line.min,11.5);assert.equal(line.max,90);
  assert.equal(line.mean,50.75);
});
