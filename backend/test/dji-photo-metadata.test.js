'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {classifyCaptureName,readDjiXmp}=require('../dji-photo-metadata');
const name=tail=>'DJI_20261106010101_0001_'+tail;
test('Matrice 4T visible lenses and radiometric thermal frames stay separated',()=>{
  for(const lens of ['V.JPG','W.JPG','Z.JPG'])
    assert.equal(classifyCaptureName(name(lens)).kind,'visible');
  assert.deepEqual(classifyCaptureName(name('T.JPG')),{kind:'thermal',lens:'T'});
  assert.equal(classifyCaptureName('DJI_20261106010101_0001_T.JPEG').kind,'thermal');
});
test('Mavic 3M RGB is eligible; four multispectral TIFF bands are classified separately',()=>{
  assert.deepEqual(classifyCaptureName(name('D.JPG')),{kind:'visible',lens:'D'});
  for(const band of ['MS_G','MS_R','MS_RE','MS_NIR'])
    assert.deepEqual(classifyCaptureName(name(band+'.TIF')),{kind:'multispectral',lens:band});
  assert.equal(classifyCaptureName('other.jpg').kind,'unknown');
  assert.equal(classifyCaptureName(name('MS_R.JPG')).kind,'unknown');
});
test('M4T and M3M XMP properties: ProductName, explicit RTK and calibrated focal length',()=>{
  const sample=Buffer.from('<x:xmpmeta drone-dji:ProductName="M4T" '+
    'drone-dji:GpsLatitude="49.1672" drone-dji:GpsLongitude="8.5913" '+
    'drone-dji:RelativeAltitude="+83.1" drone-dji:AbsoluteAltitude="147.4" '+
    'drone-dji:GimbalPitchDegree="-90" drone-dji:GimbalYawDegree="15" '+
    'drone-dji:RtkFlag="34" drone-dji:CalibratedFocalLength="4183.5" '+
    'drone-dji:CaptureUUID="0123456789abcdef0123456789abcdef" ></x:xmpmeta>');
  const m=readDjiXmp(sample);
  assert.equal(m.model,'M4T');
  assert.equal(m.rtkFlag,34);
  assert.equal(m.calibratedFocalLength,4183.5);
  assert.equal(m.absAlt,147.4);
  assert.equal(m.captureUuid,'0123456789abcdef0123456789abcdef');
});
test('XMP property elements (M3M), malformed coordinates and missing tags remain explicit',()=>{
  const sample=Buffer.from('<x:xmpmeta>'+
    '<drone-dji:ProductName>M3M</drone-dji:ProductName>'+
    '<drone-dji:BandName>NIR</drone-dji:BandName>'+
    '<drone-dji:GpsLatitude>91</drone-dji:GpsLatitude>'+
    '<drone-dji:RelativeAltitude>-20.5</drone-dji:RelativeAltitude>'+
    '</x:xmpmeta>');
  const m=readDjiXmp(sample);
  assert.equal(m.model,'M3M');
  assert.equal(m.bandName,'NIR');
  assert.equal(m.lat,null);
  assert.equal(m.lon,null);
  assert.equal(m.relAlt,-20.5);
  assert.equal(m.absAlt,null);
  assert.equal(readDjiXmp(Buffer.from('<x:xmpmeta>unterminated')),null);
});
