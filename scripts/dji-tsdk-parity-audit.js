#!/usr/bin/env node
'use strict';
// Read-only, offline parity audit for two independently produced dji_irp float32 raw files.
// Deliberately does NOT invoke the SDK, infer a camera model, or claim temperature accuracy.
const fs=require('node:fs');
const {createHash}=require('node:crypto');
const {parseArgs}=require('node:util');

const FRAMES=new Set(['320x256','640x512','1280x1024']);
const MAX_SOURCE=20*1024*1024;
const DEFAULT_LIMITS=Object.freeze({p95LimitK:0.5,maxLimitK:2});
function sha256(buf){return createHash('sha256').update(buf).digest('hex');}
function finiteLimit(raw,name){
  if(typeof raw!=='string'||!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw))throw new Error(name+' must be a nonnegative decimal');
  const n=Number(raw);
  if(!Number.isFinite(n)||n>1000)throw new Error(name+' outside supported range');
  return n;
}
function frameSize(width,height){
  if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||!FRAMES.has(width+'x'+height))
    throw new Error('unsupported frame dimensions');
  return width*height*4;
}
function matrix(buffer,width,height,label){
  if(!Buffer.isBuffer(buffer)||buffer.length!==frameSize(width,height))
    throw new Error(label+' has incorrect float32 byte length');
  const values=new Float64Array(width*height);
  for(let i=0;i<values.length;i++){
    const v=buffer.readFloatLE(i*4);
    if(!Number.isFinite(v)||v<-273.15||v>2000)
      throw new Error(label+' contains non-finite or implausible temperature at pixel '+i);
    values[i]=v;
  }
  return values;
}
function statistics(values){
  const sorted=Array.from(values).sort((a,b)=>a-b);
  let sum=0;
  for(const v of values)sum+=v;
  const n=sorted.length;
  return {min:sorted[0],mean:sum/n,median:n%2?sorted[(n-1)/2]:(sorted[n/2-1]+sorted[n/2])/2,max:sorted[n-1]};
}
function percentileSorted(sorted,fraction){
  return sorted[Math.max(0,Math.ceil(fraction*sorted.length)-1)];
}
function compareMatrices(oldBuffer,newBuffer,width,height,limits=DEFAULT_LIMITS){
  if(!limits||![limits.p95LimitK,limits.maxLimitK].every(n=>Number.isFinite(n)&&n>=0))
    throw new Error('invalid comparison limits');
  const old=matrix(oldBuffer,width,height,'baseline');
  const next=matrix(newBuffer,width,height,'candidate');
  const diffs=new Array(old.length);
  let sumAbs=0,sumSq=0;
  for(let i=0;i<old.length;i++){
    const d=Math.abs(old[i]-next[i]);
    diffs[i]=d;sumAbs+=d;sumSq+=d*d;
  }
  diffs.sort((a,b)=>a-b);
  const delta={meanAbs:sumAbs/old.length,rmse:Math.sqrt(sumSq/old.length),
    p50Abs:percentileSorted(diffs,0.5),p95Abs:percentileSorted(diffs,0.95),
    p99Abs:percentileSorted(diffs,0.99),maxAbs:diffs[diffs.length-1]};
  const pass=delta.p95Abs<=limits.p95LimitK&&delta.maxAbs<=limits.maxLimitK;
  return {status:pass?'PASS':'FAIL',width,height,pixels:old.length,
    baselineCelsius:statistics(old),candidateCelsius:statistics(next),
    deltaKelvin:delta,thresholdsKelvin:{...limits}};
}
function boundedRead(path,expected,label){
  const stat=fs.statSync(path);
  if(!stat.isFile()||stat.size!==expected)throw new Error(label+' must be exactly '+expected+' bytes');
  return fs.readFileSync(path);
}
function auditFiles({baseline,candidate,source,width,height,p95LimitK=DEFAULT_LIMITS.p95LimitK,maxLimitK=DEFAULT_LIMITS.maxLimitK}){
  const size=frameSize(width,height);
  const imageStat=fs.statSync(source);
  if(!imageStat.isFile()||imageStat.size<4||imageStat.size>MAX_SOURCE)throw new Error('invalid source JPEG size');
  const jpeg=fs.readFileSync(source);
  if(jpeg[0]!==0xff||jpeg[1]!==0xd8)throw new Error('source is not a JPEG');
  const old=boundedRead(baseline,size,'baseline');
  const next=boundedRead(candidate,size,'candidate');
  return {schema:'skyhub-tsdk-parity-audit-v1',classification:'offline-two-output-comparison',
    sdkExecutionVerified:false,hardwareVerified:false,accuracyVerified:false,
    sourceSha256:sha256(jpeg),sourceBytes:jpeg.length,
    baselineSha256:sha256(old),candidateSha256:sha256(next),
    ...compareMatrices(old,next,width,height,{p95LimitK,maxLimitK})};
}
function parseCli(argv){
  const {values}=parseArgs({args:argv,strict:true,allowPositionals:false,options:{
    baseline:{type:'string'},candidate:{type:'string'},source:{type:'string'},
    width:{type:'string'},height:{type:'string'},'p95-limit-k':{type:'string'},
    'max-limit-k':{type:'string'},report:{type:'string'}}});
  for(const key of ['baseline','candidate','source','width','height'])
    if(!values[key])throw new Error('missing --'+key);
  if(!/^\d+$/.test(values.width)||!/^\d+$/.test(values.height))throw new Error('invalid resolution');
  const p95LimitK=values['p95-limit-k']===undefined?DEFAULT_LIMITS.p95LimitK:finiteLimit(values['p95-limit-k'],'p95 limit');
  const maxLimitK=values['max-limit-k']===undefined?DEFAULT_LIMITS.maxLimitK:finiteLimit(values['max-limit-k'],'max limit');
  if(maxLimitK<p95LimitK)throw new Error('max limit must be >= p95 limit');
  return {baseline:values.baseline,candidate:values.candidate,source:values.source,
    width:Number(values.width),height:Number(values.height),p95LimitK,maxLimitK,report:values.report};
}
function main(argv){
  const args=parseCli(argv);
  const report=auditFiles(args);
  const json=JSON.stringify(report,null,2)+'\n';
  if(args.report)fs.writeFileSync(args.report,json,{flag:'wx',mode:0o600});
  process.stdout.write(json);
  return report.status==='PASS'?0:1;
}
if(require.main===module){
  try{process.exitCode=main(process.argv.slice(2));}
  catch(error){process.stderr.write('TSDK parity audit: '+error.message+'\n');process.exitCode=2;}
}
module.exports={DEFAULT_LIMITS,frameSize,matrix,statistics,compareMatrices,auditFiles,parseCli,main};
