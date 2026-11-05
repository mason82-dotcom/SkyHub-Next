'use strict';
// Photo coverage: footprints from DJI XMP/EXIF and gap detection.
const test=require('node:test');
const assert=require('node:assert/strict');
const {exifInfo,xmpInfo,footprint,computeCoverage}=require('../coverage');

const span=fp=>[Math.max(...fp.map(p=>p[0]))-Math.min(...fp.map(p=>p[0])),Math.max(...fp.map(p=>p[1]))-Math.min(...fp.map(p=>p[1]))];
test('nadir footprint at 100 m with 24 mm equivalent 4:3: about 144 m x 108 m, image width east-west when heading north',()=>{
  const [w,h]=span(footprint({relAlt:100,yaw:0,pitch:-90,roll:0,focal35:24,width:4000,height:3000}));
  assert.ok(Math.abs(w-144.2)<1,String(w));assert.ok(Math.abs(h-108.2)<1,String(h));
  const [w2,h2]=span(footprint({relAlt:100,yaw:90,pitch:-90,roll:0,focal35:24,width:4000,height:3000}));
  assert.ok(Math.abs(w2-108.2)<1&&Math.abs(h2-144.2)<1,'heading east swaps the axes');
});
test('oblique footprint lies ahead of the aircraft and is capped at the horizon',()=>{
  const fp=footprint({relAlt:100,yaw:0,pitch:-45,roll:0,focal35:24,width:4000,height:3000});
  assert.ok(fp.every(([,y])=>y>0),'all corners north (ahead)');
  const flat=footprint({relAlt:100,yaw:0,pitch:-5,roll:0,focal35:24,width:4000,height:3000});
  assert.ok(flat.every(([x,y])=>Math.hypot(x,y)<=400.1),'capped at 4 x height');
  assert.equal(footprint({relAlt:0.5,yaw:0,pitch:-90}),null);
});
test('EXIF 35 mm focal length and pixel size; DJI XMP fields',()=>{
  // TIFF (II) with IFD0 → ExifIFD (0x8769) → 0xA405=24, 0xA002=4032, 0xA003=3024
  const t=Buffer.alloc(8+2+12+4+2+3*12+4);
  t.write('II',0,'latin1');t.writeUInt16LE(42,2);t.writeUInt32LE(8,4);
  t.writeUInt16LE(1,8);t.writeUInt16LE(0x8769,10);t.writeUInt16LE(4,12);t.writeUInt32LE(1,14);t.writeUInt32LE(26,18);
  const ex=26;t.writeUInt16LE(3,ex);
  [[0xA405,3,24],[0xA002,4,4032],[0xA003,4,3024]].forEach(([tag,type,v],i)=>{const e=ex+2+i*12;t.writeUInt16LE(tag,e);t.writeUInt16LE(type,e+2);t.writeUInt32LE(1,e+4);
    if(type===3)t.writeUInt16LE(v,e+8);else t.writeUInt32LE(v,e+8);});
  const app1=Buffer.concat([Buffer.from('Exif\0\0','latin1'),t]);
  const seg=Buffer.concat([Buffer.from([0xFF,0xE1,(app1.length+2)>>8,(app1.length+2)&255]),app1]);
  const jpg=Buffer.concat([Buffer.from([0xFF,0xD8]),seg,Buffer.from([0xFF,0xDA,0,2])]);
  assert.deepEqual(exifInfo(jpg),{focal35:24,width:4032,height:3024});
  const x=xmpInfo(Buffer.from('<x:xmpmeta drone-dji:GpsLatitude="+49.167218744" drone-dji:GpsLongitude="+8.591312139" drone-dji:RelativeAltitude="+111.834" '+
    'drone-dji:GimbalYawDegree="+40.70" drone-dji:GimbalPitchDegree="-108.00" drone-dji:DroneModel="M4T"></x:xmpmeta>','latin1'));
  assert.deepEqual(x,{lat:49.167218744,lon:8.591312139,relAlt:111.834,yaw:40.7,pitch:-108,roll:0,model:'M4T'});
});
test('two strips with a gap between them: gap found inside the flown area, outside ignored',()=>{
  const photos=[];
  const dLat=1/111195;                      // 1 m north
  for(const strip of [0,1])for(let k=0;k<10;k++){
    // strips 300 m apart at 60 m height (footprint ~87 m wide): a ~210 m wide uncovered band between them
    photos.push({name:'p'+strip+'_'+k,info:{lat:49.1+k*30*dLat,lon:8.6+strip*300/(111195*Math.cos(49.1*Math.PI/180)),relAlt:60,yaw:0,pitch:-90,roll:0,focal35:24,width:4000,height:3000}});
  }
  const r=computeCoverage(photos,{cellM:2,minOverlap:2});
  assert.equal(r.status,'ok');assert.equal(r.used,20);
  assert.ok(r.stats.uncoveredPct>30,JSON.stringify(r.stats));
  assert.ok(r.gaps.length>=1&&r.gaps[0].areaM2>10000,JSON.stringify(r.gaps[0]));
  assert.ok(Math.abs(r.gaps[0].lon-(8.6+150/(111195*Math.cos(49.1*Math.PI/180))))<0.0008,'gap centred between the strips');
  assert.equal(Buffer.from(r.counts,'base64').length,r.width*r.height*2);
  assert.equal(computeCoverage([{name:'a',info:null}]).status,'skipped');
});
