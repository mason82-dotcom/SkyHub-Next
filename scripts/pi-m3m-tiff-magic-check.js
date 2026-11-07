#!/usr/bin/env node
'use strict';
// Only read TIFF signatures: no persistent files, no image pixels, no IFDs,
// no EXIF, no GPS, no printed S3 keys or full-image downloads.
// Never deploy/restart production SkyHub, change MinIO, or modify objects.
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {createApiStorage,discoverFirstPagePrefix,piInvoker}
  =require('./pi-m3m-s3-inventory-check');
const {collectUnknownTiffs,MAX_TIFF}=require('../backend/m3m-s3-tiff-candidates');
const {summarizeMagic}=require('../backend/m3m-tiff-magic');

// This code runs in the ALREADY-RUNNING backend, whose existing S3 reader
// environment and @aws-sdk/client-s3 are used without disclosing credentials.
const CHILD=[
"'use strict';",
"const fs=require('node:fs');",
"const {S3Client,GetObjectCommand}=require('@aws-sdk/client-s3');",
"const classes=['classicLittleEndian','classicBigEndian','bigTiffLittleEndian','bigTiffBigEndian','notTiff','tooShort','unavailable','rangeNotHonored'];",
"function classify(b){",
" if(b.length<4)return 'tooShort';",
" if(b[0]===73&&b[1]===73&&b[2]===42&&b[3]===0)return 'classicLittleEndian';",
" if(b[0]===77&&b[1]===77&&b[2]===0&&b[3]===42)return 'classicBigEndian';",
" if(b[0]===73&&b[1]===73&&b[2]===43&&b[3]===0)return 'bigTiffLittleEndian';",
" if(b[0]===77&&b[1]===77&&b[2]===0&&b[3]===43)return 'bigTiffBigEndian';",
" return 'notTiff';",
"}",
"(async()=>{",
" try{",
"  const req=JSON.parse(fs.readFileSync(0,'utf8'));",
"  const env=process.env;",
"  if(!req||typeof req.prefix!=='string'||req.prefix.length<2||!req.prefix.endsWith('/')||req.prefix.includes('..')||",
"    !Array.isArray(req.keys)||req.keys.length>12||!env.SKYHUB_S3_ENDPOINT||!env.SKYHUB_S3_ACCESS_KEY||!env.SKYHUB_S3_SECRET_KEY)throw Error();",
"  const keys=req.keys;",
"  if(keys.some(k=>typeof k!=='string'||k.length>650||!k.startsWith(req.prefix)||",
"    k.slice(req.prefix.length).includes('/')||!/\\.tiff?$/i.test(k)))throw Error();",
"  const client=new S3Client({endpoint:env.SKYHUB_S3_ENDPOINT,region:'us-east-1',forcePathStyle:true,",
"    credentials:{accessKeyId:env.SKYHUB_S3_ACCESS_KEY,secretAccessKey:env.SKYHUB_S3_SECRET_KEY},maxAttempts:1});",
"  const labels=[];",
"  for(const key of keys){",
"   let label='unavailable',obj;",
"   try{",
"    obj=await client.send(new GetObjectCommand({Bucket:'dji-cloud',Key:key,Range:'bytes=0-15'}),",
"      {abortSignal:AbortSignal.timeout(7000)});",
"    const range=/^bytes 0-(\\d{1,2})\\/(\\d+)$/.exec(String(obj.ContentRange||''));",
"    if(obj.$metadata?.httpStatusCode!==206||!range||Number(range[1])>15||",
"       !Number.isInteger(obj.ContentLength)||obj.ContentLength!==Number(range[1])+1){",
"      label='rangeNotHonored';",
"    }else{",
"      const parts=[];let total=0;",
"      for await(const part of obj.Body){",
"       total+=part.length;",
"       if(total>16)throw Error();",
"       parts.push(part);",
"      }",
"      label=total===obj.ContentLength?classify(Buffer.concat(parts)): 'unavailable';",
"    }",
"   }catch(_){label='unavailable';}",
"   finally{obj?.Body?.destroy?.();}",
"   labels.push(label);",
"  }",
"  client.destroy();",
"  if(labels.length!==keys.length||labels.some(x=>!classes.includes(x)))throw Error();",
"  process.stdout.write(JSON.stringify({labels}));",
" }catch(_){process.exitCode=2;}",
"})();"
].join('\n');

async function readOnlyProbe(keys,prefix,composeDir){
  if(!Array.isArray(keys)||keys.length>MAX_TIFF)
    throw new RangeError('TIFF probe candidate limit exceeded');
  const p=spawnSync('docker',[
    'compose','-p','skyhub-next','exec','-T','backend','node','-e',CHILD
  ],{
    cwd:composeDir,input:JSON.stringify({keys,prefix}),encoding:'utf8',
    timeout:125000,maxBuffer:2048
  });
  if(p.error||p.status!==0||!p.stdout||p.stdout.length>2048)
    throw new Error('TIFF header probe unavailable');
  let labels;
  try{labels=JSON.parse(p.stdout).labels;}catch(_){throw new Error('Bad probe response');}
  if(!Array.isArray(labels)||labels.length!==keys.length)
    throw new Error('Invalid probe count');
  return summarizeMagic(labels);
}

async function main(args){
  if(args.length===1&&args[0]==='--help'){
    console.log('Usage: node scripts/pi-m3m-tiff-magic-check.js --auto-first-page');
    console.log('Read-only: up to 12 unknown TIFF headers, maximum 16 S3 bytes each.');
    console.log('No object keys, prefixes, TIFF bytes, metadata values or credentials printed.');
    return;
  }
  if(args.length!==1||args[0]!=='--auto-first-page')
    throw new Error('Only bounded auto-first-page mode supported');
  const dir=path.resolve(process.env.SKYHUB_COMPOSE_DIR||path.join(__dirname,'..'));
  const api=createApiStorage(piInvoker(dir));
  const prefix=await discoverFirstPagePrefix(api);
  const keys=await collectUnknownTiffs(api,prefix);
  const report=await readOnlyProbe(keys,prefix,dir);
  console.log(JSON.stringify({...report,
    discoveryScope:'first-100-entries-only',
    examinedScope:'unknown-direct-TIFFs-in-one-prefix',
    maxRequestedBytesPerObject:16
  },null,2));
}
if(require.main===module){
  main(process.argv.slice(2)).catch(()=>{
    console.error('TIFF header probe unavailable or unsafe: no objects modified, no private data printed.');
    process.exitCode=2;
  });
}
module.exports={readOnlyProbe,main,CHILD};
