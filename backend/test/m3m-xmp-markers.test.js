'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {locateXmpFromIfd,classifyDJIXmp,summarizeXmp,recordStatus,
  validateXmpAggregateReport}
  =require('../m3m-xmp-markers');
const ns='http://www.dji.com/drone-dji/1.0/';
const wrap=(body)=>Buffer.from('<?xpacket begin=""?><x:xmpmeta>'+
  '<rdf:RDF xmlns:drone-dji="'+ns+'">'+body+'</rdf:RDF></x:xmpmeta>');

test('XMP TIFF tag 700 returns bounded offset only, not content',()=>{
  const head=Buffer.from([73,73,42,0,8,0,0,0]);
  const dir=Buffer.alloc(2+12+4);
  dir.writeUInt16LE(1,0);dir.writeUInt16LE(700,2);
  dir.writeUInt16LE(7,4);dir.writeUInt32LE(256,6);
  dir.writeUInt32LE(2048,10);
  assert.deepEqual(locateXmpFromIfd(head,dir,16384),{
    status:'ok',offset:2048,length:256
  });
  dir.writeUInt32LE(32769,6);
  assert.equal(locateXmpFromIfd(head,dir,16384).status,'xmpTooLarge');
  dir.writeUInt32LE(256,6);
  dir.writeUInt32LE(16300,10);
  assert.equal(locateXmpFromIfd(head,dir,16384).status,'invalidXmpPointer');
  dir.writeUInt32LE(2048,10);
  dir.writeUInt16LE(99,4);
  assert.equal(locateXmpFromIfd(head,dir,16384).status,'invalidXmpPointer');
});

test('XMP XML attribute form exposes only enumerated band and marker presence',()=>{
  const xmp=wrap('<rdf:Description drone-dji:ImageSource="MS_NIR_CAMERA" '+
    'drone-dji:BandName="NIR" drone-dji:SensorIndex="4" '+
    'drone-dji:Irradiance="SECRET_IRRADIANCE_123.4" '+
    'drone-dji:SensorGain="SECRET_GAIN" drone-dji:BlackCurrent="3200" '+
    'drone-dji:DroneSerialNumber="PRIVATE_SERIAL_XYZ" '+
    'drone-dji:GpsLatitude="PRIVATE_GPS" />');
  const rec=classifyDJIXmp(xmp);
  assert.equal(rec.status,'ok');
  assert.equal(rec.bandHint,'NIR');
  for(const name of ['ImageSource','BandName','Irradiance','SensorGain',
    'BlackCurrent','SensorIndex'])
    assert.equal(rec.djiFieldPresence[name],true);
  const report=summarizeXmp([rec]);
  assert.equal(report.bandHints.NIR,1);
  assert.equal(report.fieldPresenceCount.Irradiance,1);
  assert.doesNotMatch(JSON.stringify(report),
    /PRIVATE|SECRET|SERIAL|GPS|Irradiance_123|MS_NIR_CAMERA|3200/);
  for(const name of ['m3mSourceVerified','radiometricCalibrationVerified',
    'imagePayloadVerified','reflectanceReady','ndviReady','ndreReady'])
    assert.equal(report[name],false);
});

test('XMP element form supports fixed RedEdge without disclosing other metadata',()=>{
  const xmp=wrap('<drone-dji:ImageSource>MS_RE_CAMERA</drone-dji:ImageSource>'+
    '<drone-dji:BandName>RedEdge</drone-dji:BandName>'+
    '<drone-dji:IrradianceExposureTime>PRIVATE_EXPOSURE</drone-dji:IrradianceExposureTime>');
  const rec=classifyDJIXmp(xmp);
  assert.equal(rec.bandHint,'RE');
  assert.equal(rec.djiFieldPresence.IrradianceExposureTime,true);
  assert.doesNotMatch(JSON.stringify(rec),/PRIVATE|RedEdge|MS_RE_CAMERA/);
});

test('mixed or contradictory band metadata are not assigned to a band',()=>{
  const conflicting=wrap('<rdf:Description drone-dji:BandName="Red" '+
    'drone-dji:ImageSource="MS_NIR_CAMERA" />');
  assert.equal(classifyDJIXmp(conflicting).bandHint,'inconsistent');
  const repeated=wrap('<rdf:Description drone-dji:BandName="NIR" />'+
    '<rdf:Description drone-dji:BandName="NIR" />');
  assert.equal(classifyDJIXmp(repeated).bandHint,'unknown');
  const arbitrary=wrap('<rdf:Description drone-dji:BandName="SECRET_SERIAL_123" />');
  assert.equal(classifyDJIXmp(arbitrary).bandHint,'unknown');
});

test('missing DJI namespace or invalid packet fails closed',()=>{
  for(const raw of [
    Buffer.from('drone-dji:BandName="Red"'),
    Buffer.from('<x:xmpmeta><rdf:RDF><rdf:Description drone-dji:BandName="Red" /></rdf:RDF></x:xmpmeta>'),
    Buffer.from('<x:xmpmeta>drone-dji:BandName="SECRET"</x:xmpmeta>'),
    Buffer.alloc(32769,88),
    Buffer.from([])
  ]){
    assert.notEqual(classifyDJIXmp(raw).status,'ok');
  }
});

test('XMP summary only allows fixed statuses and boolean allowlist fields',()=>{
  const records=[recordStatus('unavailable'),recordStatus('xmpTooLarge'),
    recordStatus('rangeNotHonored')];
  const result=summarizeXmp(records);
  assert.equal(result.examined,3);
  assert.equal(result.status.unavailable,1);
  assert.equal(result.status.xmpTooLarge,1);
  assert.equal(result.bandHints.unknown,3);
  assert.throws(()=>summarizeXmp([{...records[0],bandHint:'SECRET'}]),RangeError);
  assert.throws(()=>summarizeXmp(Array(13).fill(records[0])),RangeError);
});


test('XMP band hints fail closed if one of two band fields is duplicated or invalid',()=>{
  const ambiguous=wrap(
    '<rdf:Description drone-dji:ImageSource="MS_G_CAMERA" />'+
    '<rdf:Description drone-dji:BandName="Green" />'+
    '<rdf:Description drone-dji:BandName="Red" />');
  assert.equal(classifyDJIXmp(ambiguous).bandHint,'unknown');
  const invalid=wrap(
    '<rdf:Description drone-dji:ImageSource="MS_RE_CAMERA" '+
    'drone-dji:BandName="SECRET_OBJECT_SN" />');
  assert.equal(classifyDJIXmp(invalid).bandHint,'unknown');
  const one=wrap('<rdf:Description drone-dji:BandName="Red" />');
  assert.equal(classifyDJIXmp(one).bandHint,'R');
});

test('aggregate validator refuses unknown keys, fabricated counts, private strings and true readiness',()=>{
  const good=summarizeXmp([
    classifyDJIXmp(wrap('<rdf:Description drone-dji:BandName="Green" />')),
    recordStatus('xmpTagMissing')
  ]);
  const verified=validateXmpAggregateReport(good,2);
  assert.deepEqual(verified,good);
  assert.equal(verified.status.ok,1);
  for(const bad of [
    {...good,privateObjectKey:'SECRET_FILENAME'},
    {...good,examined:3},
    {...good,bandHints:{...good.bandHints,SECRET:1}},
    {...good,bandHints:{...good.bandHints,G:2}},
    {...good,fieldPresenceCount:{...good.fieldPresenceCount,BandName:2}},
    {...good,reflectanceReady:true},
    {...good,caveat:'SECRET_META_VALUE'},
    {...good,status:{...good.status,ok:3}}
  ])assert.throws(()=>validateXmpAggregateReport(bad,2),RangeError);
});
