'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const {Script}=require('node:vm');
const path=require('node:path');
const {classifyMagic,summarizeMagic}=require('../m3m-tiff-magic');
const {collectUnknownTiffs,collectAllTiffs}=require('../m3m-s3-tiff-candidates');
const {CHILD}=require('../../scripts/pi-m3m-tiff-magic-check');
const PREFIX='hidden/MISSION_SECRET/';
const files=[
  'SECRET_RENAMED_1.TIF',
  'SECRET_RENAMED_2.TIFF',
  'DJI_20261021190530_0001_MS_NIR.TIF'
];
function page(names,truncated=false,nextCursor=null){
  return {objects:names.map(n=>({key:PREFIX+n})),truncated,nextCursor};
}

test('four TIFF signatures are classified with no EXIF, IFD or image reading',()=>{
  const cases=[
    [[0x49,0x49,0x2a,0x00],'classicLittleEndian'],
    [[0x4d,0x4d,0x00,0x2a],'classicBigEndian'],
    [[0x49,0x49,0x2b,0x00],'bigTiffLittleEndian'],
    [[0x4d,0x4d,0x00,0x2b],'bigTiffBigEndian'],
    [[0xff,0xd8,0xff,0xe0],'notTiff'],
    [[0x49,0x49],'tooShort']
  ];
  for(const [bytes,result] of cases)
    assert.equal(classifyMagic(Buffer.from(bytes)),result);
  assert.equal(classifyMagic(null),'unavailable');
});

test('summary returns only bounded labels and always rejects index-readiness claims',()=>{
  const report=summarizeMagic([
    'classicLittleEndian','bigTiffBigEndian','notTiff','unavailable',
    'rangeNotHonored','tooShort'
  ]);
  assert.equal(report.examined,6);
  assert.equal(report.tiffSignatureConfirmed,2);
  assert.equal(Object.values(report.headerTypes).reduce((a,b)=>a+b,0),6);
  for(const key of ['imagePayloadVerified','exifOrXmpVerified',
    'm3mSourceVerified','radiometricCalibrationVerified',
    'reflectanceReady','ndviReady','ndreReady'])assert.equal(report[key],false);
  assert.doesNotMatch(JSON.stringify(report),/MISSION_SECRET|OBJECT_KEY|20261021/);
  assert.throws(()=>summarizeMagic(['SECRET_FILE']),RangeError);
  assert.throws(()=>summarizeMagic(Array(13).fill('unavailable')),RangeError);
});

test('TIFF probe candidate listing paginates, selects only unknown direct TIFFs',async()=>{
  const calls=[];
  const storage={
    objects:async(bucket,args)=>{
      calls.push({bucket,args});
      return !args.cursor?page(files.slice(0,2),true,'second'):
        page([files[2],'nested/PRIVATE.TIF','SECRET_JPEG.JPG']);
    }
  };
  const keys=await collectUnknownTiffs(storage,PREFIX);
  assert.deepEqual(keys,[PREFIX+files[0],PREFIX+files[1]]);
  assert.equal(calls.length,2);
  for(const call of calls){
    assert.equal(call.bucket,'dji-cloud');
    assert.equal(call.args.prefix,PREFIX);
    assert.equal(call.args.limit,200);
  }
});

test('TIFF candidate scan rejects incomplete, excessive or invalid inventory',async()=>{
  const mk=objects=>({objects:async()=>({objects,truncated:false,nextCursor:null})});
  await assert.rejects(collectUnknownTiffs(
    mk(Array.from({length:13},(_,i)=>({key:PREFIX+'PRIVATE_'+i+'.TIF'}))),
    PREFIX),RangeError);
  await assert.rejects(collectUnknownTiffs(mk([{key:'other/PRIVATE.TIF'}]),PREFIX));
  await assert.rejects(collectUnknownTiffs(mk([]),'../SECRET/'),{status:400});
  // Use distinct object keys per page: this must specifically exercise
  // the repeated continuation-token guard, not the duplicate-key guard.
  let pageNumber=0;
  const cycle={
    objects:async()=>page(['SECRET_PAGE_'+(++pageNumber)+'.TIF'],true,'repeat')
  };
  await assert.rejects(collectUnknownTiffs(cycle,PREFIX),/Invalid TIFF pagination/);
  assert.equal(pageNumber,2);

  // Identical object keys on different pages are an independent fail-closed
  // condition and must still be rejected (before inspecting more pages).
  let duplicateCalls=0;
  const duplicate={
    objects:async()=>{
      duplicateCalls++;
      return page([files[0]],true,'cursor-'+duplicateCalls);
    }
  };
  await assert.rejects(collectUnknownTiffs(duplicate,PREFIX),/Duplicate TIFF object key/);
  assert.equal(duplicateCalls,2);
});

test('Pi TIFF check CLI is offline in help mode and discloses no keys',()=>{
  const cli=path.resolve(__dirname,'../../scripts/pi-m3m-tiff-magic-check.js');
  const help=spawnSync(process.execPath,[cli,'--help'],{encoding:'utf8',timeout:5000});
  assert.equal(help.status,0,help.stderr);
  assert.match(help.stdout,/--auto-first-page/);
  assert.doesNotMatch(help.stdout,/SECRET|MISSION_SECRET|DJI_20261021/);
  const wrong=spawnSync(process.execPath,[cli,'--prefix','PRIVATE'],{
    encoding:'utf8',timeout:5000
  });
  assert.equal(wrong.status,2);
  assert.doesNotMatch(wrong.stderr,/PRIVATE/);
});

test('embedded container-only reader compiles and requests GET byte range, never writes',()=>{
  assert.doesNotThrow(()=>new Script(CHILD));
  assert.match(CHILD,/GetObjectCommand/);
  assert.match(CHILD,/Range:'bytes=0-15'/);
  assert.match(CHILD,/httpStatusCode!==206/);
  assert.match(CHILD,/ContentRange/);
  assert.doesNotMatch(CHILD,
    /PutObjectCommand|DeleteObjectCommand|CopyObjectCommand|process\.stderr\.write|console\.log/);
});


test('all-TIFF mode includes canonical DJI TIFFs without relaxing the 12-object cap',async()=>{
  const all=[...files,'ANOTHER_EXTRA.TIF','NESTED/SKIP.TIF'];
  const storage={objects:async(bucket,args)=>{
    assert.equal(bucket,'dji-cloud');
    assert.equal(args.prefix,PREFIX);
    assert.equal(args.limit,200);
    return page(all);
  }};
  const observed=await collectAllTiffs(storage,PREFIX);
  assert.deepEqual(observed,[
    PREFIX+files[0],PREFIX+files[1],PREFIX+files[2],
    PREFIX+'ANOTHER_EXTRA.TIF'
  ]);
  const unknown=await collectUnknownTiffs(storage,PREFIX);
  assert.equal(unknown.includes(PREFIX+files[2]),false);
  const oversized={objects:async()=>page(
    Array.from({length:13},(_,i)=>'PHOTO_'+i+'.TIF'))};
  await assert.rejects(collectAllTiffs(oversized,PREFIX),RangeError);
});

test('all-TIFF mode refuses truncated cyclic pagination',async()=>{
  let num=0;
  const storage={objects:async()=>page(
    ['SAMPLE_'+(++num)+'.TIF'],true,'REPEATED')};
  await assert.rejects(collectAllTiffs(storage,PREFIX),
    /Invalid TIFF pagination/);
  assert.equal(num,2);
});
