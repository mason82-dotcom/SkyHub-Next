#!/usr/bin/env node
'use strict';
// Read-only Raspberry Pi test of the existing authenticated SkyHub media API.
// Runs inventory logic from this checkout, without deploying it to production.
// Object names flow only between the existing backend container and this
// parent process over bounded in-memory pipes, NEVER to terminal or disk.
const {spawnSync}=require('node:child_process');
const path=require('node:path');
const {inventoryM3MFromS3,validatePrefix}=require('../backend/m3m-s3-inventory');
const {identify}=require('../backend/m3m-media-inventory');

const FETCH_PAGE=String.raw`'use strict';
(async()=>{
  try{
    const req=JSON.parse(require('node:fs').readFileSync(0,'utf8'));
    const token=process.env.SKYHUB_VIEW_TOKEN;
    if(!token||req.bucket!=='dji-cloud'||typeof req.prefix!=='string'||
       !Number.isInteger(req.limit)||req.limit<1||req.limit>200) {
      process.exitCode=1;return;
    }
    const url=new URL('http://127.0.0.1:4000/api/media/objects');
    url.searchParams.set('bucket','dji-cloud');
    url.searchParams.set('prefix',req.prefix);
    url.searchParams.set('limit',String(req.limit));
    if(req.cursor!==undefined)url.searchParams.set('cursor',req.cursor);
    const response=await fetch(url,{
      headers:{Authorization:'Bearer '+token},
      signal:AbortSignal.timeout(10000)
    });
    if(!response.ok){process.exitCode=2;return;}
    const json=await response.json();
    const output=JSON.stringify(json);
    if(output.length>300000){process.exitCode=3;return;}
    process.stdout.write(output);
  }catch(_){process.exitCode=4;}
})();`;

function createApiStorage(invoke){
  return {
    async objects(bucket,options){
      if(bucket!=='dji-cloud'||!options||typeof options.prefix!=='string')
        throw new Error('Unsupported inventory request');
      const page=await invoke({
        bucket,prefix:options.prefix,limit:options.limit,
        ...(options.cursor?{cursor:options.cursor}:{})
      });
      if(!page||!Array.isArray(page.objects))
        throw new Error('Invalid media API response');
      return page;
    }
  };
}

function piInvoker(composeDir){
  return async request=>{
    const p=spawnSync('docker',[
      'compose','-p','skyhub-next','exec','-T','backend',
      'node','-e',FETCH_PAGE
    ],{
      cwd:composeDir,encoding:'utf8',input:JSON.stringify(request),
      timeout:16000,maxBuffer:512*1024
    });
    if(p.error||p.status!==0||!p.stdout)
      throw new Error('Existing authenticated media API unavailable');
    try{return JSON.parse(p.stdout);}
    catch(_){throw new Error('Invalid media API response');}
  };
}

/**
 * Discovery is intentionally restricted to the first 100 entries in the
 * existing READ-ONLY dji-cloud list API. Never claim to find every media
 * folder in the bucket. A unique prefix must contain at least two matching
 * filenames in the sample; ambiguous/unverified choices fail closed.
 * Neither keys nor the selected prefix are logged or returned to the CLI.
 */
async function discoverFirstPagePrefix(storage){
  const data=await storage.objects('dji-cloud',{prefix:'',limit:100});
  if(!data||!Array.isArray(data.objects)||data.objects.length>100||
     typeof data.truncated!=='boolean')
    throw new Error('Invalid prefix discovery sample');
  const directories=new Map();
  for(const obj of data.objects){
    const key=obj?.key;
    if(typeof key!=='string'||key.length>650)continue;
    const slash=key.lastIndexOf('/');
    if(slash<1||slash===key.length-1)continue;
    const prefix=key.slice(0,slash+1);
    const name=key.slice(slash+1);
    if(!identify(name))continue;
    try{validatePrefix(prefix);}catch(_){continue;}
    directories.set(prefix,(directories.get(prefix)||0)+1);
  }
  const matches=[...directories].filter(([,count])=>count>=2);
  if(matches.length!==1)
    throw new Error('No unambiguous M3M directory in first page');
  return matches[0][0];
}
async function main(args){
  if(args.length===1&&args[0]==='--help'){
    console.log('Usage: node scripts/pi-m3m-s3-inventory-check.js --prefix missions/KNOWN-M3M-FOLDER/');
    console.log('   or: node scripts/pi-m3m-s3-inventory-check.js --auto-first-page');
    console.log('Auto: only first 100 bucket entries, requires exactly one media folder with >=2 M3M filename matches.');
    console.log('Reads existing backend media API only; outputs aggregate counts, no filenames or S3 keys.');
    return;
  }
  const auto=args.length===1&&args[0]==='--auto-first-page';
  if(!auto&&(args.length!==2||args[0]!=='--prefix'))
    throw new Error('Invalid CLI arguments');
  if(!auto)validatePrefix(args[1]);
  const cwd=path.resolve(process.env.SKYHUB_COMPOSE_DIR||path.join(__dirname,'..'));
  const storage=createApiStorage(piInvoker(cwd));
  const prefix=auto?await discoverFirstPagePrefix(storage):args[1];
  const report=await inventoryM3MFromS3(storage,prefix);
  // Prefix and all object keys remain private, including on errors.
  console.log(JSON.stringify(auto?
    {...report,discoveryScope:'first-100-entries-only',discoveryCandidates:1}:
    report,null,2));
}
if(require.main===module){
  main(process.argv.slice(2)).catch(()=>{
    // Never print paths, query parameters, object keys or exception details.
    console.error('M3M S3 inventory failed: check prefix, read-only media API and bounded pagination. No data changed.');
    process.exitCode=2;
  });
}
module.exports={createApiStorage,discoverFirstPagePrefix,piInvoker,main};
