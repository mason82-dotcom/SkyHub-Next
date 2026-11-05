'use strict';
// NDVI of a Mavic 3M capture: TIFF reading, calibration chain, alignment, status.
const test=require('node:test');
const assert=require('node:assert/strict');
const {readMsTiff,msXmp,calibrateBand,invert3,warp,computeNdvi,previewPng}=require('../ndvi');

// Minimal little-endian TIFF: 16-bit single band, one strip, XMP in tag 700.
function tiff(W,H,dn,xmp){
  const pix=Buffer.alloc(W*H*2);for(let k=0;k<W*H;k++)pix.writeUInt16LE(dn(k%W,Math.floor(k/W)),k*2);
  const x=Buffer.from(xmp,'utf8');
  const tags=[[256,4,1,W],[257,4,1,H],[258,3,1,16],[259,3,1,1],[262,3,1,1],[273,4,1,0],[277,3,1,1],[278,4,1,H],[279,4,1,pix.length],[700,1,x.length,0]];
  const ifdOff=8,ifdLen=2+tags.length*12+4,xOff=ifdOff+ifdLen,pOff=xOff+x.length+(x.length%2);
  const b=Buffer.alloc(pOff+pix.length);b.write('II',0,'latin1');b.writeUInt16LE(42,2);b.writeUInt32LE(ifdOff,4);b.writeUInt16LE(tags.length,ifdOff);
  tags.forEach(([tag,type,count,val],i)=>{const e=ifdOff+2+i*12;b.writeUInt16LE(tag,e);b.writeUInt16LE(type,e+2);b.writeUInt32LE(count,e+4);
    if(tag===273)b.writeUInt32LE(pOff,e+8);else if(tag===700)b.writeUInt32LE(xOff,e+8);else if(type===3)b.writeUInt16LE(val,e+8);else b.writeUInt32LE(val,e+8);});
  x.copy(b,xOff);pix.copy(b,pOff);return b;
}
const xmp=(band,o={})=>'<x:xmpmeta '+Object.entries({BandName:band,ImageSource:band==='NIR'?'MS_NIR_CAMERA':'MS_R_CAMERA',BlackLevel:3200,SensorGain:2,
  ExposureTime:1000,SensorGainAdjustment:1,Irradiance:0.8,VignettingData:'0, 0, 0, 0, 0, 0',CalibratedOpticalCenterX:40,CalibratedOpticalCenterY:30,
  CalibratedHMatrix:'1,0,0,0,1,0,0,0,1',GimbalPitchDegree:-90,GpsLatitude:49.15,GpsLongitude:8.6,DroneModel:'M3M',...o})
  .map(([k,v])=>'drone-dji:'+k+'="'+v+'"').join(' ')+'></x:xmpmeta>';
// textured scene so the alignment search has edges; vegetation reflects NIR 0.5, red 0.05 → NDVI 0.818
const scene=(x,y)=>((Math.floor(x/7)+Math.floor(y/5))%2?1:0.6)*(1+0.3*Math.sin(x/3)*Math.cos(y/4));

test('TIFF and XMP are read; DJI band names "Red"/"NIR"',()=>{
  const b=tiff(8,4,(x,y)=>3200+x+y*8,xmp('Red'));
  const t=readMsTiff(b);assert.equal(t.width,8);assert.equal(t.data[9],3209);
  const x=msXmp(t.xmp);assert.equal(x.band,'Red');assert.equal(x.black,3200);assert.deepEqual(x.vignetting,[0,0,0,0,0,0]);
});
test('calibration: black level, vignetting polynomial, gain/exposure, sunlight sensor; Irradiance 1.000 → relative',()=>{
  const img={width:3,height:1,data:new Uint16Array([3200,4200,65535])};
  const c=calibrateBand(img,{black:3200,gain:2,exposureUs:1000,gainAdj:1.2,irradiance:0.6,vignetting:[0.01,0,0,0,0,0],cx:0,cy:0});
  assert.ok(Number.isNaN(c.values[0]),'at black level');assert.ok(Number.isNaN(c.values[2]),'saturated');
  assert.ok(Math.abs(c.values[1]-1000*(1+0.01*1)/(2*0.001)*(1.2/0.6))<1e-3);assert.equal(c.calibrated,true);
  const rel=calibrateBand(img,{black:3200,gain:2,exposureUs:1000,gainAdj:1,irradiance:1,vignetting:[0,0,0,0,0,0],cx:0,cy:0});
  assert.equal(rel.calibrated,false);assert.match(rel.notes.join(),/Sonnenlichtsensor/);
});
test('homography warp and inverse',()=>{
  const inv=invert3([2,0,3,0,2,4,0,0,1]);assert.deepEqual(inv.map(v=>Math.round(v*100)/100+0),[0.5,0,-1.5,0,0.5,-2,0,0,1]);
  const v=new Float32Array(16).map((_,i)=>i);const w=warp(v,4,4,[1,0,1,0,1,0,0,0,1]);   // shift right by 1
  assert.equal(w[1],0);assert.ok(Number.isNaN(w[0]));
});
test('known vegetation reflectance gives NDVI ≈ 0.818, NIR band shifted by 3 px is realigned, status calibrated',()=>{
  const W=320,H=240,toDn=v=>Math.round(3200+v*2*1000*1e-3*0.8*20000);
  const r=tiff(W,H,(x,y)=>toDn(0.05*scene(x,y)),xmp('Red'));
  const n=tiff(W,H,(x,y)=>toDn(0.5*scene(x-3,y)),xmp('NIR'));
  const res=computeNdvi(r,n,{minCorrelation:0.3});
  assert.deepEqual([res.summary.alignment.dx,res.summary.alignment.dy],[3,0]);
  assert.ok(Math.abs(res.summary.median-0.818)<0.02,String(res.summary.median));
  assert.equal(res.summary.status,'calibrated',JSON.stringify(res.summary.notes));
  const png=previewPng(res.ndvi,W,H);assert.equal(png.subarray(1,4).toString('latin1'),'PNG');
  assert.throws(()=>computeNdvi(n,r),/Rot und NIR/);
});
