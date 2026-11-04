'use strict';
// Temperature TIFF export (Float32 °C + EXIF GPS) and the batch job with a fake Thermal SDK.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {writeTemperatureTiff,createThermalExport,crc32}=require('../thermal-export');

function readTiff(buf){
  assert.equal(buf.toString('latin1',0,2),'II');assert.equal(buf.readUInt16LE(2),42);
  const ifd=off=>{const n=buf.readUInt16LE(off),tags={};
    for(let i=0;i<n;i++){const p=off+2+i*12,tag=buf.readUInt16LE(p),type=buf.readUInt16LE(p+2),count=buf.readUInt32LE(p+4);
      const size={1:1,2:1,3:2,4:4,5:8}[type]*count,at=size<=4?p+8:buf.readUInt32LE(p+8);
      let v;
      if(type===2)v=buf.toString('latin1',at,at+count-1);
      else if(type===5)v=[...Array(count)].map((_,k)=>buf.readUInt32LE(at+k*8)/buf.readUInt32LE(at+k*8+4));
      else v=[...Array(count)].map((_,k)=>type===3?buf.readUInt16LE(at+k*2):type===1?buf.readUInt8(at+k):buf.readUInt32LE(at+k*4));
      tags[tag]=v;}
    return tags;};
  return {ifd0:ifd(buf.readUInt32LE(4)),ifd};
}

test('TIFF: Float32 °C pixels, one strip, EXIF GPS in degrees/minutes/seconds',()=>{
  const temps=new Float32Array([20.5,21,-3.25,99.75,0,1,2,3]);
  const buf=writeTemperatureTiff({width:4,height:2,temps,meta:{model:'M4T',datetime:'2026-11-04T10:15:30Z',latitude:49.0123456,longitude:-8.5,altitude:245.2}});
  const {ifd0,ifd}=readTiff(buf);
  assert.deepEqual([ifd0[256][0],ifd0[257][0],ifd0[258][0],ifd0[259][0],ifd0[277][0],ifd0[339][0]],[4,2,32,1,1,3]);
  const off=ifd0[273][0];
  assert.deepEqual([...new Float32Array(buf.buffer.slice(buf.byteOffset+off,buf.byteOffset+off+32))],[...temps]);
  assert.equal(ifd0[272],'M4T');assert.equal(ifd0[306],'2026:11:04 10:15:30');
  const gps=ifd(ifd0[34853][0]);
  assert.equal(gps[1],'N');assert.equal(gps[3],'W');
  const [d,m,s]=gps[2];assert.ok(Math.abs(d+m/60+s/3600-49.0123456)<1e-7);
  assert.ok(Math.abs(gps[6][0]-245.2)<1e-3);
  // without a position: no GPS IFD (0/0 is DJI's "no fix")
  assert.equal(readTiff(writeTemperatureTiff({width:4,height:2,temps,meta:{latitude:0,longitude:0}})).ifd0[34853],undefined);
  assert.throws(()=>writeTemperatureTiff({width:3,height:2,temps}),/matrix/);
});

test('batch: TIFF per image + positions.csv in a valid ZIP, failures listed, one job at a time',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'thx-'));
  const sources={'a/DJI_0001_T.JPG':'ok','a/DJI_0002_T.JPG':'bad'};
  const ex=createThermalExport({dir,
    fetchSource:async(b,k)=>({buffer:Buffer.from(sources[k]),version:'v'}),
    parse:buf=>buf.toString()==='ok'?{meta:{model:'M4T',latitude:49.1,longitude:8.5,absoluteAltitude:200,gimbalPitch:-90}}:null,
    sdk:{measure:async()=>({width:2,height:2,temps:new Float32Array([10,20,30,40])})}});
  const job=ex.start([{bucket:'b',key:'a/DJI_0001_T.JPG'},{bucket:'b',key:'a/DJI_0002_T.JPG'}],{emissivity:0.95});
  assert.throws(()=>ex.start([{bucket:'b',key:'x'}],{}),/bereits/);
  for(let i=0;i<50&&ex.status(job.id).status!=='done';i++)await new Promise(r=>setTimeout(r,10));
  const st=ex.status(job.id);
  assert.equal(st.status,'done');assert.equal(st.done,2);assert.equal(st.failed,1);
  assert.match(st.errors[0].error,/kein radiometrisches/);
  const zip=fs.readFileSync(ex.file(job.id));
  // central directory: 3 entries (1 TIFF, CSV, README), CRCs consistent
  const eocd=zip.length-22;assert.equal(zip.readUInt32LE(eocd),0x06054b50);assert.equal(zip.readUInt16LE(eocd+10),3);
  let p=0;const names=[];
  while(zip.readUInt32LE(p)===0x04034b50){
    const n=zip.readUInt16LE(p+26),size=zip.readUInt32LE(p+18),name=zip.toString('utf8',p+30,p+30+n),data=zip.subarray(p+30+n,p+30+n+size);
    assert.equal(crc32(data),zip.readUInt32LE(p+14));names.push(name);
    if(name==='positions.csv'){const lines=data.toString().trim().split('\n');assert.equal(lines.length,2);assert.match(lines[1],/^DJI_0001_T\.tif,a\/DJI_0001_T\.JPG,49\.1,8\.5,200,,-90,,,,10\.00,40\.00,25\.00$/);}
    p+=30+n+size;
  }
  assert.deepEqual(names,['DJI_0001_T.tif','positions.csv','README.txt']);
  fs.rmSync(dir,{recursive:true,force:true});
});
