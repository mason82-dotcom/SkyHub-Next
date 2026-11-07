'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveDeviceModel } = require('../catalog');

test('model lookup uses domain and both type components', () => {
  assert.equal(resolveDeviceModel({domain:0,type:77,subType:0}), 'Mavic 3E');
  assert.equal(resolveDeviceModel({domain:0,type:77,subType:1}), 'Mavic 3T');
  assert.equal(resolveDeviceModel({domain:0,type:99,subType:0}), 'Matrice 4E');
  assert.equal(resolveDeviceModel({domain:0,type:99,subType:1}), 'Matrice 4T');
  assert.equal(resolveDeviceModel({domain:2,type:174,subType:0}), 'DJI RC Plus 2 Enterprise');
  assert.equal(resolveDeviceModel({domain:1,type:89,subType:0}), 'Matrice 4T Camera');
  assert.equal(resolveDeviceModel({domain:0,type:89,subType:0}), 'Matrice 350 RTK');
  assert.equal(resolveDeviceModel({domain:1,type:68,subType:0}), null);
});

test('Mavic 3M aircraft observed via RC Pro resolves by domain/type/sub_type',()=>{
  assert.equal(resolveDeviceModel({domain:'0',type:77,subType:2}),'Mavic 3M');
  assert.equal(resolveDeviceModel({domain:'1',type:77,subType:2}),null);
});

test('payload, FPV, vision-assist and dock cameras follow the DJI Product Support list',()=>{
  const expected=[
    [20,'Zenmuse Z30'],[26,'Zenmuse XT2'],[41,'Zenmuse XTS'],[42,'Zenmuse H20'],
    [43,'Zenmuse H20T'],[61,'Zenmuse H20N'],[82,'Zenmuse H30'],[83,'Zenmuse H30T'],
    [52,'Matrice 30 Camera'],[53,'Matrice 30T Camera'],[129,'Mavic 3TA Camera'],
    [80,'Matrice 3D Camera'],[81,'Matrice 3TD Camera'],[98,'Matrice 4D Camera'],
    [99,'Matrice 4TD Camera'],[39,'Aircraft FPV Camera'],[176,'Vision Assist Camera'],
    [165,'DJI Dock Camera']
  ];
  for(const [type,name] of expected)
    assert.equal(resolveDeviceModel({domain:1,type,subType:0}),name,name);
  // The unconfirmed Mavic 3M camera ID stays unmapped; payload IDs never fall back to aircraft names.
  assert.equal(resolveDeviceModel({domain:1,type:68,subType:0}),null);
  assert.equal(resolveDeviceModel({domain:1,type:77,subType:0}),null);
});

test('the O4 Ground Station base station (domain 8) is a known device category',()=>{
  const {category}=require('../catalog');
  assert.equal(resolveDeviceModel({domain:8,type:135,subType:0}),'DJI O4 Ground Station');
  assert.equal(resolveDeviceModel({domain:'8',type:135,subType:0}),'DJI O4 Ground Station');
  assert.equal(category('8'),'base-station');
  assert.equal(category(8),'base-station');
  assert.equal(resolveDeviceModel({domain:8,type:1,subType:0}),null);
  assert.equal(resolveDeviceModel({domain:9,type:135,subType:0}),null);
});
