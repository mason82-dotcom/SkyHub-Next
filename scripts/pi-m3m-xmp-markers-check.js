#!/usr/bin/env node
'use strict';
// New opt-in *metadata* read: bounded to <=12 unknown TIFFs and <=33,808
// requested bytes/object. XMP may contain private coordinates/serials and
// never leaves the running backend; stdout is whitelisted aggregates only.
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {firstIfdOffset}=require('../backend/m3m-tiff-ifd');
const {
  MARKERS,STATUSES,BAND_HINTS,recordStatus,locateXmpFromIfd,
  extractEnumValue,bandFromName,bandFromSource,
  classifyDJIXmp,summarizeXmp,validateXmpAggregateReport
}=require('../backend/m3m-xmp-markers');
const {CAPTURE_BANDS,CAPTURE_STATUSES,captureUuidFromXmp,
  summarizeCaptureGroups,validateCaptureAggregate}
  =require('../backend/m3m-xmp-capture-groups');
const {createApiStorage,discoverFirstPagePrefix,piInvoker}
  =require('./pi-m3m-s3-inventory-check');
const {collectUnknownTiffs,collectAllTiffs,MAX_TIFF}
  =require('../backend/m3m-s3-tiff-candidates');

const CHILD=[
  "'use strict';",
  'const MARKERS='+JSON.stringify(MARKERS)+';',
  'const STATUSES='+JSON.stringify(STATUSES)+';',
  'const BAND_HINTS='+JSON.stringify(BAND_HINTS)+';',
  'const CAPTURE_BANDS='+JSON.stringify(CAPTURE_BANDS)+';',
  'const CAPTURE_STATUSES='+JSON.stringify(CAPTURE_STATUSES)+';',
  firstIfdOffset.toString()+';',
  recordStatus.toString()+';',
  locateXmpFromIfd.toString()+';',
  extractEnumValue.toString()+';',
  bandFromName.toString()+';',
  bandFromSource.toString()+';',
  classifyDJIXmp.toString()+';',
  summarizeXmp.toString()+';',
  captureUuidFromXmp.toString()+';',
  summarizeCaptureGroups.toString()+';',
  "\nconst fs=require('node:fs');\nconst {S3Client,GetObjectCommand}=require('@aws-sdk/client-s3');\nclass RangeNotHonored extends Error {}\nasync function safeRange(client,key,start,end,max){\n  if(!Number.isSafeInteger(start)||start<0||\n     !Number.isSafeInteger(end)||end<start||\n     !Number.isSafeInteger(max)||max<1||max>32768||\n     end-start+1>max)\n    throw Error('Unsafe S3 byte-range');\n  let response;\n  try{\n    response=await client.send(new GetObjectCommand({\n      Bucket:'dji-cloud',Key:key,Range:'bytes='+start+'-'+end\n    }),{abortSignal:AbortSignal.timeout(9000)});\n    const m=/^bytes (\\d+)-(\\d+)\\/(\\d+)$/.exec(String(response.ContentRange||''));\n    if(response.$metadata?.httpStatusCode!==206||!m)\n      throw new RangeNotHonored();\n    const [s,e,total]=m.slice(1).map(Number);\n    if(![s,e,total].every(Number.isSafeInteger)||s!==start||\n       e>end||e<start||total<=e||\n       !Number.isInteger(response.ContentLength)||\n       response.ContentLength!==e-start+1||response.ContentLength>max)\n      throw new RangeNotHonored();\n    const chunks=[];\n    let count=0;\n    for await(const chunk of response.Body){\n      count+=chunk.length;\n      if(count>max||count>response.ContentLength)\n        throw Error('Oversized S3 body');\n      chunks.push(chunk);\n    }\n    if(count!==response.ContentLength)throw Error('Truncated S3 body');\n    return {bytes:Buffer.concat(chunks),size:total};\n  }finally{\n    response?.Body?.destroy?.();\n  }\n}\n(async()=>{\n  let client;\n  try{\n    const req=JSON.parse(fs.readFileSync(0,'utf8'));\n    const captureMode=req.captureMode===true;\n    const env=process.env;\n    if(!req||typeof req.prefix!=='string'||req.prefix.length<2||\n       req.prefix.length>512||!req.prefix.endsWith('/')||\n       req.prefix.startsWith('/')||req.prefix.includes('\\\\')||\n       req.prefix.split('/').some(x=>x==='..')||\n       !Array.isArray(req.keys)||req.keys.length>12||\n       (req.captureMode!==true&&req.captureMode!==false&&req.captureMode!==undefined)||\n       !env.SKYHUB_S3_ENDPOINT||!env.SKYHUB_S3_ACCESS_KEY||\n       !env.SKYHUB_S3_SECRET_KEY)throw Error('Invalid request');\n    const keys=req.keys;\n    if(new Set(keys).size!==keys.length||keys.some(k=>\n      typeof k!=='string'||k.length>650||\n      !k.startsWith(req.prefix)||\n      k.slice(req.prefix.length).includes('/')||\n      !/\\.tiff?$/i.test(k)))throw Error('Invalid candidate');\n    client=new S3Client({\n      endpoint:env.SKYHUB_S3_ENDPOINT,region:'us-east-1',forcePathStyle:true,\n      credentials:{accessKeyId:env.SKYHUB_S3_ACCESS_KEY,\n        secretAccessKey:env.SKYHUB_S3_SECRET_KEY},maxAttempts:1});\n    const records=[];\n    for(const key of keys){\n      let record;\n      try{\n        const header=await safeRange(client,key,0,15,16);\n        const ifdPos=firstIfdOffset(header.bytes);\n        if(ifdPos===null||ifdPos>=header.size)\n          record=recordStatus('notClassicTiff');\n        else{\n          const last=Math.min(ifdPos+1023,header.size-1);\n          const ifd=await safeRange(client,key,ifdPos,last,1024);\n          const ref=locateXmpFromIfd(header.bytes,ifd.bytes,header.size);\n          if(ref.status!=='ok'){\n            record=recordStatus(ref.status);\n          }else{\n            const payload=await safeRange(client,key,ref.offset,\n              ref.offset+ref.length-1,32768);\n            record=classifyDJIXmp(payload.bytes);\n            if(captureMode)record={\n              status:record.status,bandHint:record.bandHint,\n              captureUuid:record.status==='ok'?captureUuidFromXmp(payload.bytes):null\n            };\n          }\n        }\n      }catch(err){\n        record=recordStatus(\n          err instanceof RangeNotHonored?'rangeNotHonored':'unavailable');\n      }\n      records.push(record);\n    }\n    process.stdout.write(JSON.stringify({report:captureMode?\n      summarizeCaptureGroups(records):summarizeXmp(records)}));\n  }catch(_){process.exitCode=2;}\n  finally{client?.destroy();}\n})();",

].join('\n');

async function runXmpProbe(keys,prefix,composeDir,captureMode=false){
  if(!Array.isArray(keys)||keys.length>MAX_TIFF)
    throw new RangeError('Unsafe TIFF candidate count');
  const p=spawnSync('docker',[
    'compose','-p','skyhub-next','exec','-T','backend','node','-e',CHILD
  ],{
    cwd:composeDir,input:JSON.stringify({keys,prefix,captureMode}),
    encoding:'utf8',timeout:240000,maxBuffer:16384
  });
  if(p.error||p.status!==0||!p.stdout||p.stdout.length>16384)
    throw Error('XMP metadata reader unavailable');
  let data;
  try{data=JSON.parse(p.stdout);}
  catch(_){throw Error('Malformed XMP reader response');}
  return captureMode?validateCaptureAggregate(data.report,keys.length):
    validateXmpAggregateReport(data.report,keys.length);
}
async function main(args){
  if(args.length===1&&args[0]==='--help'){
    console.log('Usage: node scripts/pi-m3m-xmp-markers-check.js --auto-first-page');
    console.log('   or: node scripts/pi-m3m-xmp-markers-check.js --all-tiffs-first-page');
    console.log('   or: node scripts/pi-m3m-xmp-markers-check.js --capture-groups-first-page');
    console.log('Read-only opt-in: <=12 TIFFs, <=3 ranged GETs, <=33,808 requested bytes/object.');
    console.log('Private XMP may be read in backend memory; only fixed field-presence counters and band hints printed.');
    return;
  }
  const capture=args.length===1&&args[0]==='--capture-groups-first-page';
  const all=capture||(args.length===1&&args[0]==='--all-tiffs-first-page');
  if(args.length!==1||(!all&&args[0]!=='--auto-first-page'))
    throw Error('Unsupported XMP probe argument');
  const dir=path.resolve(process.env.SKYHUB_COMPOSE_DIR||path.join(__dirname,'..'));
  const storage=createApiStorage(piInvoker(dir));
  const prefix=await discoverFirstPagePrefix(storage);
  const keys=all?await collectAllTiffs(storage,prefix):
    await collectUnknownTiffs(storage,prefix);
  const report=await runXmpProbe(keys,prefix,dir,capture);
  console.log(JSON.stringify({...report,
    discoveryScope:'first-100-entries-only',
    examinedScope:capture?'capture-uuid-candidates-all-direct-TIFFs-in-one-prefix':
      all?'all-direct-TIFFs-in-one-prefix':
      'unknown-direct-TIFFs-in-one-prefix',
    maxRequestedBytesPerObject:33808,
    maxS3GetsPerObject:3
  },null,2));
}
if(require.main===module){
  main(process.argv.slice(2)).catch(()=>{
    console.error('XMP marker probe unavailable or unsafe; no objects changed.');
    process.exitCode=2;
  });
}
module.exports={CHILD,runXmpProbe,main};
