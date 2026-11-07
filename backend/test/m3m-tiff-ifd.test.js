'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const {Script,runInNewContext}=require('node:vm');
const {Readable}=require('node:stream');
const path=require('node:path');
const {firstIfdOffset,inspectClassicIfd,summarizeIfd}
  =require('../m3m-tiff-ifd');
const {CHILD}=require('../../scripts/pi-m3m-tiff-ifd-check');

function fixture(entries,{le=true,offset=8}={}){
  const head=Buffer.alloc(16);
  head.set(le?[73,73,42,0]:[77,77,0,42]);
  le?head.writeUInt32LE(offset,4):head.writeUInt32BE(offset,4);
  const dir=Buffer.alloc(2+entries.length*12+4);
  const u16=(n,p)=>le?dir.writeUInt16LE(n,p):dir.writeUInt16BE(n,p);
  const u32=(n,p)=>le?dir.writeUInt32LE(n,p):dir.writeUInt32BE(n,p);
  u16(entries.length,0);
  for(const [i,e] of entries.entries()){
    const p=2+i*12;
    u16(e.tag,p);u16(e.type??4,p+2);u32(e.count??1,p+4);
    if((e.type??4)===3&&e.count!==2)
      u16(e.value??0,p+8);
    else u32(e.value??0,p+8);
  }
  return {head,dir};
}
function scalar(tag,value,type=4){return {tag,value,type};}
const entries=[
  scalar(256,4096),scalar(257,3072),
  scalar(258,16,3),scalar(277,1,3),
  scalar(259,1,3),scalar(34735,123,4),
  scalar(34665,1000),scalar(700,300)
];

test('first IFD is read only from classic endian header and bounded offset',()=>{
  for(const le of [true,false]){
    const data=fixture(entries,{le});
    assert.equal(firstIfdOffset(data.head),8);
    const result=inspectClassicIfd(data.head,data.dir);
    assert.deepEqual(result,{
      status:'ok',dimensionClass:'5To25MP',sampleClass:'one',
      bitsClass:'bits16',compressionClass:'uncompressed',
      geoTagPresent:true,exifTagPresent:true,xmpTagPresent:true
    });
  }
  assert.equal(firstIfdOffset(Buffer.from('SECRET')),null);
  const high=fixture(entries,{offset:262145});
  assert.equal(firstIfdOffset(high.head),null);
  assert.equal(inspectClassicIfd(high.head,high.dir).status,'unprobeableHeaderOrOffset');
});

test('inline scalar checks avoid pointers and pixel values',()=>{
  const data=fixture([
    scalar(256,2048),scalar(257,2048),
    {tag:258,type:3,count:2,value:900},
    scalar(277,3,3),scalar(259,5,3)
  ]);
  const result=inspectClassicIfd(data.head,data.dir);
  assert.equal(result.dimensionClass,'upTo5MP');
  assert.equal(result.sampleClass,'three');
  assert.equal(result.bitsClass,'externalOrMixed');
  assert.equal(result.compressionClass,'compressedOrOther');
  assert.equal(result.geoTagPresent,false);
});

test('IFD parser safely refuses truncation, excessive tags and duplicate tags',()=>{
  const {head,dir}=fixture(entries);
  assert.equal(inspectClassicIfd(head,dir.subarray(0,14)).status,'truncatedIfd');
  const large=Buffer.from(dir);
  large.writeUInt16LE(65,0);
  assert.equal(inspectClassicIfd(head,large).status,'tooManyTags');
  const dup=fixture([scalar(256,3),scalar(256,4)]);
  assert.equal(inspectClassicIfd(dup.head,dup.dir).status,'malformedIfd');
  const missing=Buffer.alloc(16);
  assert.equal(inspectClassicIfd(missing,dir).status,'unprobeableHeaderOrOffset');
});

test('all IFD outputs remain bounded aggregates with no metadata values',()=>{
  const a=inspectClassicIfd(...Object.values(fixture(entries)));
  const report=summarizeIfd([a,{
    status:'rangeNotHonored',
    dimensionClass:'unknown',sampleClass:'unknown',
    bitsClass:'unknown',compressionClass:'unknown',
    geoTagPresent:false,exifTagPresent:false,xmpTagPresent:false
  }]);
  assert.equal(report.examined,2);
  assert.equal(report.status.ok,1);
  assert.equal(report.status.rangeNotHonored,1);
  assert.equal(report.geoTagPresentCount,1);
  for(const x of ['ndviReady','ndreReady','imagePayloadVerified',
    'm3mSourceVerified','radiometricCalibrationVerified','reflectanceReady'])
    assert.equal(report[x],false);
  assert.doesNotMatch(JSON.stringify(report),
    /4096|3072|MISSION_SECRET|PRIVATE|GPS|LatLong|1234/);
  assert.throws(()=>summarizeIfd(Array(13).fill(a)),RangeError);
  assert.throws(()=>summarizeIfd([{...a,dimensionClass:'SECRET_OBJECT'}]),RangeError);
});

test('container script compiles and only contains ranged S3 reads',()=>{
  assert.doesNotThrow(()=>new Script(CHILD));
  assert.match(CHILD,/GetObjectCommand/);
  assert.match(CHILD,/httpStatusCode!==206/);
  assert.match(CHILD,/ContentRange/);
  assert.match(CHILD,/end-start>=1024/);
  assert.doesNotMatch(CHILD,
    /PutObjectCommand|DeleteObjectCommand|CopyObjectCommand|process\.stderr\.write|console\.log/);
});

test('Pi IFD CLI help runs offline and invalid arguments are redacted',()=>{
  const cli=path.resolve(__dirname,'../../scripts/pi-m3m-tiff-ifd-check.js');
  const help=spawnSync(process.execPath,[cli,'--help'],{encoding:'utf8',timeout:5000});
  assert.equal(help.status,0,help.stderr);
  assert.match(help.stdout,/--auto-first-page/);
  const reject=spawnSync(process.execPath,[cli,'--prefix','SECRET_DIR'],{
    encoding:'utf8',timeout:5000
  });
  assert.equal(reject.status,2);
  assert.doesNotMatch(reject.stderr,/SECRET_DIR/);
});

test('embedded reader gets only 16 header bytes plus one <=1024-byte IFD range',async()=>{
  const fixtureData=fixture(entries);
  const image=Buffer.alloc(2048);
  fixtureData.head.copy(image,0);
  fixtureData.dir.copy(image,8);
  // Header IFD pointer and directory may overlap in first 16 bytes,
  // matching valid TIFF structure.
  const requests=[];
  class GetObjectCommand{constructor(input){this.input=input;}}
  class S3Client{
    async send(cmd){
      const {Bucket,Key,Range}=cmd.input;
      assert.equal(Bucket,'dji-cloud');
      assert.equal(Key,'private/one/SECRET.TIF');
      requests.push(Range);
      const match=/^bytes=(\d+)-(\d+)$/.exec(Range);
      assert.ok(match);
      const start=Number(match[1]),end=Number(match[2]);
      assert.ok(end-start<1024);
      const body=image.subarray(start,end+1);
      return {
        $metadata:{httpStatusCode:206},
        ContentRange:'bytes '+start+'-'+end+'/'+image.length,
        ContentLength:body.length,
        Body:Readable.from([body])
      };
    }
    destroy(){}
  }
  let output='',exitCode=0;
  const proc={
    env:{SKYHUB_S3_ENDPOINT:'http://internal:9000',
      SKYHUB_S3_ACCESS_KEY:'TEST_ONLY',SKYHUB_S3_SECRET_KEY:'TEST_ONLY'},
    stdout:{write(s){output+=s;}},
    set exitCode(v){exitCode=v;},get exitCode(){return exitCode;}
  };
  const sandbox={
    require(name){
      if(name==='node:fs')return {readFileSync:()=>JSON.stringify({
        keys:['private/one/SECRET.TIF'],prefix:'private/one/'
      })};
      if(name==='@aws-sdk/client-s3')return {S3Client,GetObjectCommand};
      throw Error('Unexpected module');
    },
    process:proc,Buffer,AbortSignal,Set,Number,JSON,Error
  };
  await runInNewContext(CHILD,sandbox);
  assert.equal(proc.exitCode,0);
  assert.equal(requests.length,2);
  assert.equal(requests[0],'bytes=0-15');
  assert.equal(requests[1],'bytes=8-1031');
  const data=JSON.parse(output);
  assert.equal(data.records[0].status,'ok');
  assert.equal(data.records[0].dimensionClass,'5To25MP');
  assert.doesNotMatch(output,/SECRET|private\/one|4096|3072|TEST_ONLY/);
});
