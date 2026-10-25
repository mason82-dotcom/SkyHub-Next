'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {classifyM3MGaps,GROUPS}=require('../m3m-gap-classifier');
const {fieldDefinitions}=require('../dji-properties');

test('M3M classification distinguishes thermography from multispectral NIR',()=>{
  const missing=[
    'osd:cameras.ir_metering_area',
    'osd:cameras.ir_metering_area.aver_temperature',
    'osd:cameras.ir_metering_point.temperature',
    'osd:cameras.ir_zoom_factor',
    'osd:cameras.zoom_focus_mode',
    'osd:cameras.liveview_world_region.left',
    'osd:cameras.wide_iso',
    'osd:cameras.screen_split_enable',
    'state:home_latitude',
    'osd:wind_direction'
  ];
  const report=classifyM3MGaps(missing);
  assert.equal(report.classified,missing.length);
  assert.equal(report.groups.thermalCamera.count,4);
  assert.equal(report.groups.zoomCamera.count,2);
  assert.equal(report.groups.rgbCameraControls.count,1);
  assert.equal(report.groups.otherCameraOptions.count,1);
  assert.equal(report.groups.eventState.count,1);
  assert.equal(report.groups.otherOsd.count,1);
  assert.equal(Object.values(report.groups).reduce((a,b)=>a+b.count,0),missing.length);
  assert.equal(GROUPS.length,6);
  assert.match(report.source,/enterprise.dji.com\/mavic-3-m\/specs/);
});

test('only whitelisted DJI names are classified and no untrusted keys leak',()=>{
  const output=classifyM3MGaps([
    'osd:cameras.ir_metering_mode',
    'osd:cameras.ir_metering_mode',
    'state:SECRET_SERIAL_12345','osd:latitude.PRIVATE_DEVICE',
    'osd:cameras.custom_imei', 'SECRET_API_TOKEN'
  ]);
  assert.equal(output.classified,1);
  assert.equal(output.groups.thermalCamera.count,1);
  const rendered=JSON.stringify(output);
  assert.doesNotMatch(rendered,/SECRET|PRIVATE|custom_imei|API_TOKEN|12345/);
  assert.equal(classifyM3MGaps(null),null);
});

test('every inspectable M3M catalog gap belongs to exactly one category',()=>{
  const fields=fieldDefinitions({domain:'0',type:77,subType:2}).fields;
  const pushByRoot=Object.fromEntries(fields.filter(x=>!x.path.includes('.')).map(x=>[x.path,x.push]));
  const all=fields.map(x=>(pushByRoot[x.path.split('.')[0]]===1?'state:':'osd:')+x.path);
  const report=classifyM3MGaps(all);
  assert.equal(report.classified,fields.length);
  assert.equal(Object.values(report.groups).reduce((n,g)=>n+g.count,0),fields.length);
  assert.equal(new Set(all).size,150);
});
