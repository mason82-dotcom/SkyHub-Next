'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const {Readable}=require('node:stream');
const {parseRJpeg,frameStats,djiParts,createThermalRouter}=require('../thermal');
const T=require('../../frontend/public/thermal-core');

const K=t=>Math.round((t+273.15)*64);
function segment(marker,data){
  const head=Buffer.alloc(4);head[0]=0xFF;head[1]=marker;head.writeUInt16BE(data.length+2,2);
  return Buffer.concat([head,data]);
}
// Synthetic DJI R-JPEG: XMP, raw frame split over APP3 segments, APP4 "iirp" with emissivity at 40.
function rjpeg({width=640,height=512,fill=20,hot=null,emissivity=0.95}={}){
  const raw=Buffer.alloc(width*height*2);
  for(let i=0;i<width*height;i++)raw.writeUInt16LE(K(fill),i*2);
  if(hot)raw.writeUInt16LE(K(hot.t),(hot.y*width+hot.x)*2);
  const parts=[Buffer.from([0xFF,0xD8])];
  parts.push(segment(0xE1,Buffer.from('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta><rdf:Description '+
    'drone-dji:DroneModel="M4T" drone-dji:ImageSource="InfraredCamera" drone-dji:LRFTargetDistance="4.161" '+
    'drone-dji:GimbalPitchDegree="+7.70"/></x:xmpmeta>','latin1')));
  for(let off=0;off<raw.length;off+=65000)parts.push(segment(0xE3,raw.subarray(off,off+65000)));
  const app4=Buffer.alloc(64);app4.write('\xff\xd2\xd1\xffiirp',0,'latin1');app4.writeFloatLE(emissivity,40);
  parts.push(segment(0xE4,app4),Buffer.from([0xFF,0xDA,0,2,0xFF,0xD9]));
  return Buffer.concat(parts);
}

test('R-JPEG parser reads the raw frame, emissivity and DJI XMP values',()=>{
  const frame=parseRJpeg(rjpeg({hot:{x:600,y:40,t:31.5}}));
  assert.equal(frame.width,640);assert.equal(frame.height,512);
  assert.equal(frame.emissivity,0.95);
  assert.equal(frame.meta.model,'M4T');
  assert.equal(frame.meta.lrfDistance,4.161);
  assert.equal(frame.meta.gimbalPitch,7.7);
  const s=frameStats(frame);
  assert.equal(s.hotspot.x,600);assert.equal(s.hotspot.y,40);
  assert.ok(Math.abs(s.max-31.5)<0.02);
  assert.ok(Math.abs(s.median-20)<0.02);
  assert.equal(s.histogram.reduce((a,b)=>a+b,0),640*512);
  assert.equal(parseRJpeg(Buffer.from([0xFF,0xD8,0xFF,0xD9])),null);
  assert.equal(parseRJpeg(Buffer.from('not a jpeg')),null);
});

test('DJI names give day, shot index and lens',()=>{
  assert.deepEqual(djiParts('DJI_20261022080518_0001_T.JPG'),{day:'20261022',time:'080518',index:'0001',lens:'T'});
  assert.equal(djiParts('org_abc_1.jpg'),null);
});

function storage(objects){
  return {
    getObject:async(_bucket,key)=>{
      const body=objects[key];
      if(!body)throw Object.assign(new Error('Not found'),{status:404});
      return {body:Readable.from([body]),contentLength:body.length};
    }
  };
}
test('thermal API lists thermal images with their photo and serves stats and raw data',async()=>{
  const objects={'ws/media/s/org_1.jpg':rjpeg({hot:{x:10,y:20,t:40}}),'ws/media/s/org_2.jpg':Buffer.from('jpeg'),
    'ws/media/s/org_3.jpg':Buffer.from([0xFF,0xD8,0xFF,0xD9])};
  const index={bucket:'dji-cloud',objects:[
    {key:'ws/media/s/org_1.jpg',size:1,displayName:'DJI_20261022080518_0001_T.JPG',capturedAt:'2026-10-22T08:05:18+02:00'},
    {key:'ws/media/s/org_2.jpg',size:1,displayName:'DJI_20261022080518_0001_V.JPG'},
    {key:'ws/media/s/org_3.jpg',size:1,displayName:'DJI_20261022080600_0002_T.JPG'},
    {key:'other/x.png',size:1}]};
  const app=express();
  app.use('/api/thermal',createThermalRouter({storage:storage(objects),bucketIndex:async()=>index,buckets:async()=>['dji-cloud']}));
  const server=app.listen(0,'127.0.0.1');
  await new Promise(r=>server.once('listening',r));
  const base='http://127.0.0.1:'+server.address().port;
  try{
    const list=await (await fetch(base+'/api/thermal/list')).json();
    assert.equal(list.count,2);
    const first=list.items.find(i=>i.key==='ws/media/s/org_1.jpg');
    assert.equal(first.name,'DJI_20261022080518_0001_T.JPG');
    assert.equal(first.visualKey,'ws/media/s/org_2.jpg');
    assert.match(list.estimate,/Schätzung/);
    const meta=await (await fetch(base+'/api/thermal/meta?bucket=dji-cloud&key=ws%2Fmedia%2Fs%2Forg_1.jpg')).json();
    assert.equal(meta.width,640);assert.equal(meta.emissivity,0.95);
    assert.equal(meta.stats.hotspot.x,10);
    const raw=await fetch(base+'/api/thermal/raw?bucket=dji-cloud&key=ws%2Fmedia%2Fs%2Forg_1.jpg');
    assert.equal(raw.headers.get('x-thermal-width'),'640');
    assert.equal((await raw.arrayBuffer()).byteLength,640*512*2);
    assert.equal((await fetch(base+'/api/thermal/meta?bucket=dji-cloud&key=ws%2Fmedia%2Fs%2Forg_3.jpg')).status,422);
    assert.equal((await fetch(base+'/api/thermal/meta?bucket=dji-cloud&key=missing.jpg')).status,404);
    assert.equal((await fetch(base+'/api/thermal/meta')).status,400);
  }finally{server.close();}
});

test('thermal core: conversion, emissivity correction, regions, isotherm, palettes, CSV',()=>{
  assert.ok(Math.abs(T.rawToCelsius(K(20))-20)<0.02);
  assert.equal(T.correct(30,{epsFile:0.95,eps:0.95,reflected:20}),30);
  // Lower emissivity than recorded: a surface warmer than its surroundings is hotter than measured.
  assert.ok(T.correct(30,{epsFile:0.95,eps:0.85,reflected:20})>30);
  assert.ok(T.correct(10,{epsFile:0.95,eps:0.85,reflected:20})<10);
  const raw=new Uint16Array(4*3).fill(K(15));raw[5]=K(25);
  const temps=T.temperatures(raw);
  const all=T.regionStats(temps,4,3);
  assert.deepEqual(all.hot,{x:1,y:1});
  assert.ok(Math.abs(all.max-25)<0.02);
  const box=T.regionStats(temps,4,3,{x0:2,y0:0,x1:3,y1:2});
  assert.equal(box.pixels,6);assert.ok(Math.abs(box.max-15)<0.02);
  const px=T.render(temps,{min:10,max:30,palette:'iron',isotherm:{mode:'above',t1:20}});
  assert.deepEqual([...px.slice(20,24)],[0,255,120,255]);
  for(const name of T.PALETTES)assert.equal(T.lut(name).length,768);
  const csv=T.csv([['a',1.5],['b;c','x"y']]);
  assert.ok(csv.startsWith('﻿'));
  assert.match(csv,/a;1,50\r\n"b;c";"x""y"/);
  assert.equal(T.matrixCsv(temps,4,3).split('\r\n').length,4);
  assert.equal(T.histogram(temps,10,30,4).reduce((a,b)=>a+b,0),12);
});

test('SD-import hash folders are grouped; photo pairing needs the same shot time (±3 s)',()=>{
  const {groupFolder}=require('../thermal');
  const h='a'.repeat(64);
  assert.equal(groupFolder('wayline/sdimport-X/'+h+'/DJI_20241022172329_0438_T.JPG'),'wayline/sdimport-X/');
  assert.equal(groupFolder('ws/media/s/org_1.jpg'),'ws/media/s/');
  assert.equal(groupFolder('top.jpg'),'');
});
