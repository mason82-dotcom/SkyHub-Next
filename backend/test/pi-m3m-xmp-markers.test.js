'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const path=require('node:path');
const {Script,runInNewContext}=require('node:vm');
const {Readable}=require('node:stream');
const {CHILD}=require('../../scripts/pi-m3m-xmp-markers-check');

function buildFakeTiff(){
  const ns='http://www.dji.com/drone-dji/1.0/';
  const xmp=Buffer.from('<x:xmpmeta><rdf:RDF xmlns:drone-dji="'+ns+'">'+
    '<rdf:Description drone-dji:BandName="RedEdge" '+
    'drone-dji:ImageSource="MS_RE_CAMERA" '+
    'drone-dji:Irradiance="SECRET_IRRADIANCE_500" '+
    'drone-dji:CaptureUUID="3377fb05b357448fb877023daebbaed3" '+
    'drone-dji:DroneSerialNumber="PRIVATE_SERIAL_12345" '+
    'drone-dji:GpsLatitude="PRIVATE_GPS" />'+
    '</rdf:RDF></x:xmpmeta>');
  const offset=2048;
  const img=Buffer.alloc(offset+xmp.length+16);
  Buffer.from([73,73,42,0,8,0,0,0]).copy(img,0);
  const ifd=Buffer.alloc(2+12+4);
  ifd.writeUInt16LE(1,0);ifd.writeUInt16LE(700,2);
  ifd.writeUInt16LE(7,4);ifd.writeUInt32LE(xmp.length,6);
  ifd.writeUInt32LE(offset,10);
  ifd.copy(img,8);
  xmp.copy(img,offset);
  return {img,xmpLength:xmp.length,offset};
}

async function executeEmbeddedReader({honorRanges=true,captureMode=false}={}){
  const {img,xmpLength,offset}=buildFakeTiff();
  const ranges=[];
  class GetObjectCommand{constructor(input){this.input=input;}}
  class S3Client{
    async send(cmd){
      assert.equal(cmd.input.Bucket,'dji-cloud');
      assert.equal(cmd.input.Key,'private/SECRET_IMAGE.TIF');
      const {Range}=cmd.input;
      ranges.push(Range);
      const m=/^bytes=(\d+)-(\d+)$/.exec(Range);
      assert.ok(m);
      const a=Number(m[1]),b=Number(m[2]);
      assert.ok(b-a+1<=32768);
      const buf=img.subarray(a,b+1);
      return {
        $metadata:{httpStatusCode:honorRanges?206:200},
        ContentRange:honorRanges?'bytes '+a+'-'+b+'/'+img.length:undefined,
        ContentLength:buf.length,
        Body:Readable.from([buf])
      };
    }
    destroy(){}
  }
  let output='',exitCode=0;
  const proc={
    env:{SKYHUB_S3_ENDPOINT:'http://internal:9000',
      SKYHUB_S3_ACCESS_KEY:'SECRET_TEST_KEY',
      SKYHUB_S3_SECRET_KEY:'SECRET_TEST_PASSWORD'},
    stdout:{write(s){output+=s;}},
    get exitCode(){return exitCode;},
    set exitCode(v){exitCode=v;}
  };
  const sandbox={
    require(name){
      if(name==='node:fs')return {readFileSync:()=>JSON.stringify({
        keys:['private/SECRET_IMAGE.TIF'],prefix:'private/',captureMode
      })};
      if(name==='@aws-sdk/client-s3')return {S3Client,GetObjectCommand};
      throw Error('Unexpected module');
    },
    process:proc,Buffer,AbortSignal,Set,Number,JSON,Error,RegExp,
    RangeError
  };
  await runInNewContext(CHILD,sandbox);
  return {output,exitCode,ranges,offset,xmpLength};
}

test('embedded XMP probe only requests 16, 1024 and one declared XMP range',async()=>{
  assert.doesNotThrow(()=>new Script(CHILD));
  const result=await executeEmbeddedReader();
  assert.equal(result.exitCode,0);
  assert.equal(result.ranges.length,3);
  assert.equal(result.ranges[0],'bytes=0-15');
  assert.equal(result.ranges[1],'bytes=8-1031');
  assert.equal(result.ranges[2],
    'bytes='+result.offset+'-'+(result.offset+result.xmpLength-1));
  const parsed=JSON.parse(result.output);
  assert.equal(parsed.report.examined,1);
  assert.equal(parsed.report.status.ok,1);
  assert.equal(parsed.report.bandHints.RE,1);
  assert.equal(parsed.report.fieldPresenceCount.Irradiance,1);
  assert.equal(parsed.records,undefined);
  assert.doesNotMatch(result.output,
    /PRIVATE|SECRET|GPS|SERIAL|IRRADIANCE_500|MS_RE_CAMERA|RedEdge/);
});

test('XMP embedded reader does not accept ignored byte range',async()=>{
  const result=await executeEmbeddedReader({honorRanges:false});
  assert.equal(result.exitCode,0);
  assert.deepEqual(result.ranges,['bytes=0-15']);
  assert.equal(JSON.parse(result.output).report.status.rangeNotHonored,1);
  assert.equal(JSON.parse(result.output).report.bandHints.unknown,1);
});

test('XMP probe only has GET and fixed counters, no writes or raw metadata output',()=>{
  assert.match(CHILD,/GetObjectCommand/);
  assert.match(CHILD,/ContentRange/);
  assert.match(CHILD,/httpStatusCode!==206/);
  assert.doesNotMatch(CHILD,
    /PutObjectCommand|DeleteObjectCommand|CopyObjectCommand|console\.log|process\.stderr\.write/);
  const cli=path.resolve(__dirname,'../../scripts/pi-m3m-xmp-markers-check.js');
  const help=spawnSync(process.execPath,[cli,'--help'],{encoding:'utf8',timeout:5000});
  assert.equal(help.status,0,help.stderr);
  assert.match(help.stdout,/--auto-first-page/);
  assert.match(help.stdout,/--all-tiffs-first-page/);
  const fail=spawnSync(process.execPath,[cli,'--prefix','PRIVATE'],{
    encoding:'utf8',timeout:5000
  });
  assert.equal(fail.status,2);
  assert.doesNotMatch(fail.stderr,/PRIVATE/);
});


test('no individual XMP results cross the process boundary',async()=>{
  const {output,exitCode}=await executeEmbeddedReader();
  assert.equal(exitCode,0);
  const root=JSON.parse(output);
  assert.deepEqual(Object.keys(root),['report']);
  assert.deepEqual(Object.keys(root.report).sort(),[
    'bandCoregistrationVerified','bandHints','caveat','classification',
    'examined','fieldPresenceCount','imagePayloadVerified',
    'm3mSourceVerified','ndreReady','ndviReady',
    'radiometricCalibrationVerified','reflectanceReady','schema',
    'status'
  ].sort());
  assert.doesNotMatch(output,
    /private|SECRET_IMAGE|PRIVATE_GPS|RedEdge|MS_RE_CAMERA|SERIAL_12345/);
});


test('capture UUID aggregation happens in backend and UUID never leaves Docker IPC',async()=>{
  const result=await executeEmbeddedReader({captureMode:true});
  assert.equal(result.exitCode,0);
  assert.equal(result.ranges.length,3);
  const out=JSON.parse(result.output);
  assert.deepEqual(Object.keys(out),['report']);
  const report=out.report;
  assert.equal(report.schema,'skyhub-m3m-capture-uuid-hints-v1');
  assert.equal(report.examined,1);
  assert.equal(report.withCaptureUuid,1);
  assert.equal(report.withoutCaptureUuid,0);
  assert.equal(report.uniqueCaptureUuidGroups,1);
  assert.equal(report.bandHints.RE,1);
  assert.equal(report.redNirCandidateGroups,0);
  assert.equal(report.fullFourBandHintGroups,0);
  assert.doesNotMatch(result.output,
    /3377fb05|SECRET|PRIVATE|MS_RE_CAMERA|GpsLatitude|GPS|drone-dji/);
  assert.equal(report.ndviReady,false);
  assert.equal(report.ndreReady,false);
});
