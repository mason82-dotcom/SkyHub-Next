'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const api = require('../public/smart-farming-map-lab.js');

const SHA = 'a'.repeat(64);
const manifest = () => ({
  schema: 'skyhub-m3m-private-mercator-map-lab-v1',
  classification: 'private-local-georeferenced-visualization-not-calibrated',
  projection: 'EPSG:3857', boundsMeters: [0,0,1000,1000],
  width: 3, height: 2,
  images: ['ndvi','ndre','gndvi','osavi'].map(index => ({
    index,filename:index+'.png',sha256:SHA
  })),
  sourceSealSha256:SHA, imagePixelsAreMeasurements:false,
  sourceRasterIntegrityRechecked:true,geolocationIsSensitive:true,
  mapTilesAvailable:false,radiometricCalibrationVerified:false,
  reflectanceReady:false,operationalUseAllowed:false,
  prescriptionExportAllowed:false,flightMissionAllowed:false
});
const mutate = fn => {const m=manifest();fn(m);
  assert.throws(()=>api.normalizeManifest(m),/INVALID_MAP_PACKAGE/);};

test('known schema strictly admits private visualization metadata only',()=>{
  const m=api.normalizeManifest(manifest());
  assert.equal(m.experimental,true);
  assert.equal(m.images.length,4);
  assert.deepEqual(m.boundsMeters,[0,0,1000,1000]);
  assert.equal(JSON.stringify(m).includes('GPS'),false);
});
test('untrusted calibration or tile metadata rejected',()=>{
  mutate(m=>{m.radiometricCalibrationVerified=true;});
  mutate(m=>{m.operationalUseAllowed=true;});
  mutate(m=>{m.mapTilesAvailable=true;});
  mutate(m=>{m.imagePixelsAreMeasurements=true;});
  mutate(m=>{m.sourceRasterIntegrityRechecked=false;});
  mutate(m=>{m.geolocationIsSensitive=false;});
  mutate(m=>{m.reflectionSecret='/s3/key';});
});
test('reject wrong projection, raster dimensions and extent',()=>{
  mutate(m=>{m.projection='EPSG:32632';});
  mutate(m=>{m.boundsMeters=[0,0,0,1000];});
  mutate(m=>{m.boundsMeters=[-3e7,0,1000,1000];});
  mutate(m=>{m.width=513;});
  mutate(m=>{m.height=0;});
  mutate(m=>{m.images.reverse();});
  mutate(m=>{m.images[0].filename='../private.png';});
  mutate(m=>{m.sourceSealSha256='wrong';});
});
test('accurate WebMercator inverse uses grid bounds, never PNG color',()=>{
  const m=api.normalizeManifest(manifest());
  const topLeft=api.projectedPoint(m,0,0);
  const bottomRight=api.projectedPoint(m,1,1);
  const middle=api.projectedPoint(m,.5,.5);
  assert.equal(topLeft[0],0);
  assert.ok(topLeft[1]>0);
  assert.ok(Math.abs(bottomRight[0] - 0.0089831528411952)<1e-9);
  assert.equal(bottomRight[1],0);
  assert.ok(Math.abs(middle[0]-0.0044915764205976)<1e-10);
  assert.ok(Math.abs(middle[1]-0.004491576416)<1e-8);
  assert.throws(()=>api.projectedPoint(m,-0.1,0),/INVALID_MAP_PACKAGE/);
  assert.throws(()=>api.projectedPoint(m,NaN,0),/INVALID_MAP_PACKAGE/);
});
test('point/field polygon drafts are georeferenced and no request is submitted',()=>{
  const m=api.normalizeManifest(manifest());
  const point=api.makeQuery(m,[[.4,.7]],'point');
  assert.equal(point.schema,'skyhub-m3m-geospatial-request-v1');
  assert.equal(point.geometry.type,'Point');
  assert.equal(point.geometry.coordinates.length,2);
  const polygon=api.makeQuery(m,[[.1,.1],[.9,.1],[.9,.9],[.1,.9]],'polygon');
  assert.equal(polygon.geometry.type,'Polygon');
  assert.equal(polygon.geometry.coordinates[0].length,5);
  assert.deepEqual(polygon.geometry.coordinates[0][0],
    polygon.geometry.coordinates[0][4]);
  assert.throws(()=>api.makeQuery(m,[[.1,.1],[.9,.9]],'polygon'),/INVALID_MAP_PACKAGE/);
  assert.throws(()=>api.makeQuery(m,[[.1,.1],[.9,.9],[.1,.9],[.9,.1]],'polygon'),/INVALID_MAP_PACKAGE/);
});
function png(width=3,height=2) {
  const b=Buffer.alloc(45);
  Buffer.from([137,80,78,71,13,10,26,10]).copy(b);
  b.writeUInt32BE(13,8);b.write('IHDR',12,'ascii');
  b.writeUInt32BE(width,16);b.writeUInt32BE(height,20);
  b[24]=8;b[25]=6;
  return b;
}
function fakeFile(name,buffer) {
  return {name,size:buffer.length,arrayBuffer:async()=>buffer.buffer.slice(
    buffer.byteOffset,buffer.byteOffset+buffer.byteLength)};
}
const sha=buffer=>crypto.createHash('sha256').update(buffer).digest('hex');
function packageFiles({tamper=false,calibrated=false}={}) {
  const m=manifest(), data=png();
  m.images.forEach(x=>{x.sha256=sha(data);});
  if(calibrated)m.radiometricCalibrationVerified=true;
  const bytes=Buffer.from(JSON.stringify(m)+'\n');
  const files=[fakeFile('viewport.json',bytes),
    ...m.images.map(x=>fakeFile(x.filename, data))];
  if(tamper)files[1]=fakeFile('ndvi.png',png(10,10));
  return {files,pin:sha(bytes)};
}
test('binary SHA256 verification requires an independent manifest pin',async()=>{
  const good=packageFiles();
  const verified=await api.verifyFiles(good.files,good.pin,crypto.webcrypto.subtle);
  assert.equal(verified.manifest.width,3);
  assert.equal(verified.images.size,4);
  assert.equal(verified.images.get('ndvi').type,'image/png');
  await assert.rejects(api.verifyFiles(good.files,SHA,crypto.webcrypto.subtle),/INVALID_MAP_PACKAGE/);
  await assert.rejects(api.verifyFiles(packageFiles({tamper:true}).files,
    packageFiles({tamper:true}).pin,crypto.webcrypto.subtle),/INVALID_MAP_PACKAGE/);
  const c=packageFiles({calibrated:true});
  await assert.rejects(api.verifyFiles(c.files,c.pin,crypto.webcrypto.subtle),/INVALID_MAP_PACKAGE/);
});
test('PNG raster size/signature and duplicate/extra local files rejected',async()=>{
  const p=packageFiles();
  assert.throws(()=>api.validatePng(png(50,50).buffer,3,2),/INVALID_MAP_PACKAGE/);
  await assert.rejects(api.verifyFiles([p.files[0],p.files[1],p.files[1],
    p.files[3],p.files[4]],p.pin,crypto.webcrypto.subtle),/INVALID_MAP_PACKAGE/);
});
test('page uses isolated CSP and never obtains remote data automatically',()=>{
  const script=fs.readFileSync(path.resolve(__dirname,
    '../public/smart-farming-map-lab.js'),'utf8');
  const html=fs.readFileSync(path.resolve(__dirname,
    '../public/smart-farming-map-lab.html'),'utf8');
  assert.doesNotMatch(script,/fetch\(|XMLHttpRequest|localStorage|sessionStorage|innerHTML|eval\(/);
  assert.match(html,/connect-src 'none'/);
  assert.match(html,/Privates Offline-Labor/);
  assert.match(html,/smart-farming-map-lab\.js/);
  assert.doesNotMatch(html,/<iframe|<script(?![^>]*src=)/i);
});
