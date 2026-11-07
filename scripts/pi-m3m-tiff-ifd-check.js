#!/usr/bin/env node
'use strict';
// Opt-in: <=12 direct unknown TIFFs; two S3 ranged GETs max/object.
// Only fixed structural categories leave the backend container. No keys,
// metadata values, source bytes or credentials printed, no data changes.
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {firstIfdOffset,inspectClassicIfd,summarizeIfd}
  =require('../backend/m3m-tiff-ifd');
const {createApiStorage,discoverFirstPagePrefix,piInvoker}
  =require('./pi-m3m-s3-inventory-check');
const {collectUnknownTiffs,MAX_TIFF}
  =require('../backend/m3m-s3-tiff-candidates');

const CHILD=[
  "'use strict';",
  firstIfdOffset.toString()+';',
  inspectClassicIfd.toString()+';',
  "\nconst fs=require('node:fs');\nconst {S3Client,GetObjectCommand}=require('@aws-sdk/client-s3');\nconst UNKNOWN={dimensionClass:'unknown',sampleClass:'unknown',\n  bitsClass:'unknown',compressionClass:'unknown',\n  geoTagPresent:false,exifTagPresent:false,xmpTagPresent:false};\nclass RangeNotHonored extends Error {}\nasync function readRange(client,key,start,end){\n  if(!Number.isSafeInteger(start)||start<0||\n     !Number.isSafeInteger(end)||end<start||end-start>=1024)\n    throw Error('Unsafe bounds');\n  let res;\n  try{\n    res=await client.send(new GetObjectCommand({\n      Bucket:'dji-cloud',Key:key,Range:'bytes='+start+'-'+end\n    }),{abortSignal:AbortSignal.timeout(7000)});\n    const match=/^bytes (\\d+)-(\\d+)\\/(\\d+)$/.exec(String(res.ContentRange||''));\n    if(res.$metadata?.httpStatusCode!==206||!match)\n      throw new RangeNotHonored();\n    const [s,e,size]=match.slice(1).map(Number);\n    if(![s,e,size].every(Number.isSafeInteger)||s!==start||e>end||\n       e<start||size<=e||!Number.isInteger(res.ContentLength)||\n       res.ContentLength!==e-start+1)throw new RangeNotHonored();\n    const chunks=[];\n    let total=0;\n    for await(const chunk of res.Body){\n      total+=chunk.length;\n      if(total>1024||total>res.ContentLength)throw Error('Overlong response');\n      chunks.push(chunk);\n    }\n    if(total!==res.ContentLength)throw Error('Short response');\n    return {data:Buffer.concat(chunks),size};\n  }finally{res?.Body?.destroy?.();}\n}\n(async()=>{\n  let client;\n  try{\n    const req=JSON.parse(fs.readFileSync(0,'utf8'));\n    const e=process.env;\n    if(!req||typeof req.prefix!=='string'||\n       req.prefix.length<2||req.prefix.length>512||\n       !req.prefix.endsWith('/')||req.prefix.startsWith('/')||\n       req.prefix.includes('\\\\')||req.prefix.split('/').some(x=>x==='..')||\n       !Array.isArray(req.keys)||req.keys.length>12||\n       !e.SKYHUB_S3_ENDPOINT||!e.SKYHUB_S3_ACCESS_KEY||!e.SKYHUB_S3_SECRET_KEY)\n      throw Error('Unsafe request');\n    const keys=req.keys;\n    if(new Set(keys).size!==keys.length||\n       keys.some(k=>typeof k!=='string'||k.length>650||\n         !k.startsWith(req.prefix)||k.slice(req.prefix.length).includes('/')||\n         !/\\.tiff?$/i.test(k)))throw Error('Unsafe object key');\n    client=new S3Client({endpoint:e.SKYHUB_S3_ENDPOINT,region:'us-east-1',\n      forcePathStyle:true,\n      credentials:{accessKeyId:e.SKYHUB_S3_ACCESS_KEY,\n        secretAccessKey:e.SKYHUB_S3_SECRET_KEY},maxAttempts:1});\n    const records=[];\n    for(const key of keys){\n      let rec;\n      try{\n        const first=await readRange(client,key,0,15);\n        const offset=firstIfdOffset(first.data);\n        if(offset===null||offset>=first.size)\n          rec={status:'unprobeableHeaderOrOffset',...UNKNOWN};\n        else{\n          const last=Math.min(offset+1023,first.size-1);\n          const dir=await readRange(client,key,offset,last);\n          rec=inspectClassicIfd(first.data,dir.data);\n        }\n      }catch(err){\n        rec={status:err instanceof RangeNotHonored?'rangeNotHonored':'unavailable',\n          ...UNKNOWN};\n      }\n      records.push(rec);\n    }\n    process.stdout.write(JSON.stringify({records}));\n  }catch(_){process.exitCode=2;}\n  finally{client?.destroy();}\n})();",

].join('\n');

async function readOnlyIfdProbe(keys,prefix,composeDir){
  if(!Array.isArray(keys)||keys.length>MAX_TIFF)
    throw new RangeError('Too many TIFF candidates');
  const p=spawnSync('docker',[
    'compose','-p','skyhub-next','exec','-T','backend',
    'node','-e',CHILD
  ],{
    cwd:composeDir,encoding:'utf8',input:JSON.stringify({keys,prefix}),
    timeout:190000,maxBuffer:8192
  });
  if(p.error||p.status!==0||!p.stdout||p.stdout.length>8192)
    throw new Error('IFD probe unavailable');
  let output;
  try{output=JSON.parse(p.stdout);}catch(_){throw Error('Bad IFD response');}
  if(!Array.isArray(output.records)||output.records.length!==keys.length)
    throw Error('Invalid IFD report count');
  return summarizeIfd(output.records);
}
async function main(args){
  if(args.length===1&&args[0]==='--help'){
    console.log('Usage: node scripts/pi-m3m-tiff-ifd-check.js --auto-first-page');
    console.log('Read-only, <=12 TIFFs, max two S3 byte-ranges of 16 and 1024 bytes/object.');
    console.log('Outputs only fixed structural categories, no object keys, metadata values or exact dimensions.');
    return;
  }
  if(args.length!==1||args[0]!=='--auto-first-page')
    throw Error('Invalid IFD probe arguments');
  const dir=path.resolve(process.env.SKYHUB_COMPOSE_DIR||path.join(__dirname,'..'));
  const api=createApiStorage(piInvoker(dir));
  const prefix=await discoverFirstPagePrefix(api);
  const keys=await collectUnknownTiffs(api,prefix);
  const report=await readOnlyIfdProbe(keys,prefix,dir);
  console.log(JSON.stringify({...report,
    discoveryScope:'first-100-entries-only',
    examinedScope:'unknown-direct-TIFFs-in-one-prefix',
    maxRequestedBytesPerObject:1040,maxS3GetsPerObject:2
  },null,2));
}
if(require.main===module){
  main(process.argv.slice(2)).catch(()=>{
    console.error('IFD probe unavailable or unsafe. No objects changed.');
    process.exitCode=2;
  });
}
module.exports={CHILD,readOnlyIfdProbe,main};
