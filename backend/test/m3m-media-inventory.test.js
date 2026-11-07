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


test('unrecognized S3 image/other formats are tallied using fixed privacy-safe categories',()=>{
  const names=[
    'DJI_20261021190530_0001_MS_G.TIF',
    'DJI_20261021190530_0001_D.JPG',
    'DJI_20261021190530_0001_F.JPG',
    'DJI_RENAMED_128_MS_NIR.TIFF',
    'SECRET_CUSTOM_CAMERA_SERIAL.JPG',
    'MASKED_ORTHO.TIF',
    'RAW_IMAGE.DNG',
    'MASKED_CHART.PNG',
    'VIDEO.MP4',
    'VIDEO.MOV',
    'AUXILIARY.LRF',
    'GPS_OVERLAY.SRT',
    'PRIVATE_DATA.JSON',
    'LAYERS.XML',
    'FLIGHT.KMZ',
    'TOKEN.ABC',
    'NOEXT',
    '../PRIVATE.JPG'
  ];
  const report=inventoryMediaNames(names);
  assert.equal(report.classified,2);
  assert.equal(report.unrecognized,15);
  assert.equal(report.invalid,1);
  assert.deepEqual(report.unrecognizedFormats,{
    JPEG:2,TIFF:2,DNG:1,PNG:1,MP4:1,MOV:1,LRF:1,
    SRT:1,JSON:1,XML:1,KMZ:1,OTHER_EXTENSION:1,NO_EXTENSION:1
  });
  assert.equal(report.unrecognizedDjiPrefixedImages,2);
  assert.equal(report.unrecognizedOtherImages,4);
  assert.deepEqual(report.unrecognizedImagesByPrefix,{
    djiPrefixed:{JPEG:1,TIFF:1,DNG:0,PNG:0},
    other:{JPEG:1,TIFF:1,DNG:1,PNG:1}
  });
  assert.equal(Object.values(report.unrecognizedImagesByPrefix.djiPrefixed)
    .reduce((n,x)=>n+x,0),report.unrecognizedDjiPrefixedImages);
  assert.equal(Object.values(report.unrecognizedImagesByPrefix.other)
    .reduce((n,x)=>n+x,0),report.unrecognizedOtherImages);
  assert.equal(Object.values(report.unrecognizedFormats).reduce((n,x)=>n+x,0),
    report.unrecognized);
  assert.doesNotMatch(JSON.stringify(report),
    /SECRET|PRIVATE|TOKEN|MASKED|DJI_RENAMED|VIDEO|CUSTOM_CAMERA_SERIAL|20261021/);
});

test('unknown format histogram reports only bounded labels, never attacker-defined extensions',()=>{
  const report=inventoryMediaNames([
    'PRIVATE_ONE.HIDDENPAYLOAD',
    'DJI_PRIVATE_SN.XYZ',
    'noext-PII'
  ]);
  assert.equal(report.unrecognizedFormats.OTHER_EXTENSION,2);
  assert.equal(report.unrecognizedFormats.NO_EXTENSION,1);
  assert.equal(report.unrecognizedDjiPrefixedImages,0);
  assert.doesNotMatch(JSON.stringify(report),/HIDDENPAYLOAD|XYZ|noext-PII|PRIVATE/);
});


test('M3M unknown filename cross-tab stays consistent with format totals for all four image types',()=>{
  const input=[
    'DJI_UNKNOWN.JPG','DJI_OTHER.TIF','DJI_BLA.DNG','DJI_BLA.PNG',
    'OTHER.JPG','OTHER.TIFF','OTHER.DNG','OTHER.PNG',
    'OTHER.KMZ','OTHER.JPG'
  ];
  const report=inventoryMediaNames(input);
  for(const key of ['JPEG','TIFF','DNG','PNG']){
    assert.equal(
      report.unrecognizedImagesByPrefix.djiPrefixed[key]+
      report.unrecognizedImagesByPrefix.other[key],
      report.unrecognizedFormats[key]
    );
  }
  assert.equal(report.unrecognizedDjiPrefixedImages,4);
  assert.equal(report.unrecognizedOtherImages,5);
  assert.equal(report.unrecognizedFormats.KMZ,1);
  assert.deepEqual(Object.keys(report.unrecognizedImagesByPrefix).sort(),[
    'djiPrefixed','other'
  ]);
  assert.doesNotMatch(JSON.stringify(report),/DJI_UNKNOWN|DJI_OTHER|OTHER.JPG|PRIVATE/);
});


test('unknown TIFF naming hints classify six synthetic candidates without revealing stems',()=>{
  const names=[
    'PRIVATE_MS_G.TIF',
    'PRIVATE_MS_RE.TIFF',
    'SECRET_NDVI.TIF',
    'PRIVATE_ORTHOMOSAIC.TIF',
    'PRIVATE_DSM.TIF',
    'PERSONAL_ABC123.TIF',
    'DJI_20261021190530_0001_MS_G.TIF'
  ];
  const report=inventoryMediaNames(names);
  assert.equal(report.unrecognizedFormats.TIFF,6);
  assert.equal(report.classified,1);
  assert.deepEqual(report.unrecognizedTiffNameHints,{
    spectralBandSuffix:{G:1,R:0,RE:1,NIR:0},
    vegetationIndex:1,
    mosaicOrElevation:2,
    other:1
  });
  assert.equal(
    Object.values(report.unrecognizedTiffNameHints.spectralBandSuffix)
      .reduce((sum,x)=>sum+x,0)+
      report.unrecognizedTiffNameHints.vegetationIndex+
      report.unrecognizedTiffNameHints.mosaicOrElevation+
      report.unrecognizedTiffNameHints.other,
    report.unrecognizedFormats.TIFF);
  assert.doesNotMatch(JSON.stringify(report),
    /PRIVATE|SECRET|PERSONAL|20261021190530|ABC123/);
  for(const flag of ['radiometricCalibrationVerified','bandCoregistrationVerified',
    'reflectanceReady','ndviReady','ndreReady'])
    assert.equal(report[flag],false);
});

test('TIFF naming hints use bounded complete tokens and do not infer NIR from arbitrary text',()=>{
  const report=inventoryMediaNames([
    'SERIAL_NIRPOWER.TIF',
    'GROWING.TIF',
    'MOSAICSHOTS.TIF',
    'SECRET_MS_NIR_extra.TIF',
    'SECRET_MS_NIR.TIF',
    'SECRET_NDRE_report.TIFF',
    'SECRET_DEM.TIF'
  ]);
  assert.equal(report.unrecognizedTiffNameHints.other,4);
  assert.equal(report.unrecognizedTiffNameHints.spectralBandSuffix.NIR,1);
  assert.equal(report.unrecognizedTiffNameHints.vegetationIndex,1);
  assert.equal(report.unrecognizedTiffNameHints.mosaicOrElevation,1);
  assert.doesNotMatch(JSON.stringify(report),/SERIAL|GROWING|SHOTS|SECRET/);
});
