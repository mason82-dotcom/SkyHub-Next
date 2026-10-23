'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {identify,inventoryMediaNames}=require('../m3m-media-inventory');
const CLI=path.resolve(__dirname,'../../scripts/pi-m3m-media-inventory.js');

const key='DJI_20261021190530_0001';
const full=[
  key+'_D.JPG',
  ...['G','R','RE','NIR'].map(b=>key+'_MS_'+b+'.TIF')
];
test('realistic five-channel DJI image filenames group without claiming reflectance',()=>{
  const report=inventoryMediaNames(full);
  assert.equal(report.totalEntries,5);
  assert.equal(report.classified,5);
  assert.equal(report.captureGroups,1);
  assert.equal(report.spectralSets,1);
  assert.equal(report.fiveChannelSets,1);
  assert.equal(report.duplicateSets,0);
  assert.equal(report.partialSets,0);
  assert.equal(report.missingBands.RGB,0);
  for(const b of ['RGB','G','R','RE','NIR'])assert.equal(report.bandCounts[b],1);
  assert.equal(report.radiometricCalibrationVerified,false);
  assert.equal(report.bandCoregistrationVerified,false);
  assert.equal(report.reflectanceReady,false);
  assert.equal(report.ndviReady,false);
  assert.equal(report.ndreReady,false);
  assert.doesNotMatch(JSON.stringify(report),/20261021190530|0001|home_latitude|SECRET/);
});
test('partial spectral group remains unavailable for index calculations',()=>{
  const r=inventoryMediaNames([key+'_MS_NIR.TIF',key+'_MS_R.TIF']);
  assert.equal(r.spectralSets,0);
  assert.equal(r.fiveChannelSets,0);
  assert.equal(r.partialSets,1);
  assert.equal(r.missingBands.R,0);
  assert.equal(r.missingBands.NIR,0);
  assert.equal(r.missingBands.RE,1);
  assert.equal(r.ndviReady,false);
});
test('duplicate channel does not inflate complete sets or expose capture IDs',()=>{
  const r=inventoryMediaNames([...full,full[3]]);
  assert.equal(r.classified,6);
  assert.equal(r.duplicateSets,1);
  assert.equal(r.fiveChannelSets,0);
  assert.equal(r.spectralSets,0);
  assert.equal(r.partialSets,1);
  assert.equal(r.bandCounts.RE,2);
  assert.doesNotMatch(JSON.stringify(r),/20261021190530|0001/);
});
test('mixed captures do not join across different sequence or time keys',()=>{
  const r=inventoryMediaNames([...full,full[4].replace('_0001_','_0002_'),
    'DJI_20261021190531_0001_MS_NIR.TIF']);
  assert.equal(r.captureGroups,3);
  assert.equal(r.fiveChannelSets,1);
  assert.equal(r.spectralSets,1);
  assert.equal(r.partialSets,2);
});
test('unknown names, geographic metadata and path traversal are never reflected',()=>{
  assert.equal(identify('DJI_0001_MS_NIR.TIF'),null);
  assert.equal(identify('../DJI_20261021190530_0001_MS_G.TIF'),null);
  assert.equal(identify('DJI_20261021190530_0001_MS_BLUE.TIF'),null);
  assert.equal(identify('DJI_20261021190530_0001_MS_NIR.JPG'),null);
  assert.equal(identify('DJI_20261021190530_0001_NDVI.JPG'),null);
  const r=inventoryMediaNames(['SECRET_SERIAL_1234.jpg','../PRIVATE_COORDS',
    'DJI_20261021190530_0001_MS_G.TIF','API_TOKEN.TXT']);
  assert.equal(r.classified,1);
  assert.equal(r.unrecognized,2);
  assert.equal(r.invalid,1);
  assert.doesNotMatch(JSON.stringify(r),/SECRET|SERIAL|PRIVATE|API_TOKEN|20261021190530/);
});
test('oversized inputs and malformed values fail safe',()=>{
  assert.throws(()=>inventoryMediaNames(Array(20001).fill(key+'_MS_G.TIF')),RangeError);
  assert.throws(()=>inventoryMediaNames('SECRET_SERIAL'),RangeError);
  assert.equal(inventoryMediaNames([null,5,undefined]).invalid,3);
});
test('optional Pi CLI reads directory entries only, ignores symlinks, redacts path',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'m3m-secret-name-'));
  try{
    for(const name of full)fs.writeFileSync(path.join(dir,name),'not a real image');
    fs.symlinkSync(path.join(dir,full[0]),path.join(dir,'SECRET_LINK'));
    fs.mkdirSync(path.join(dir,'PRIVATE_SUBDIRECTORY'));
    const child=spawnSync(process.execPath,[CLI,'--directory',dir],{encoding:'utf8',timeout:5000});
    assert.equal(child.status,0,child.stderr);
    const data=JSON.parse(child.stdout);
    assert.equal(data.fiveChannelSets,1);
    assert.equal(data.ignoredNonregularEntries,2);
    assert.doesNotMatch(child.stdout,(/SECRET|PRIVATE|m3m-secret-name|20261021/));
    const fail=spawnSync(process.execPath,[CLI,'--directory','../SECRET'],{encoding:'utf8',timeout:5000});
    assert.equal(fail.status,2);
    assert.doesNotMatch(fail.stderr,/SECRET/);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
