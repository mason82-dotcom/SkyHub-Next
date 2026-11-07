'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {createHash}=require('node:crypto');
const A=require('../../scripts/dji-tsdk-parity-audit');

const WIDTH=320,HEIGHT=256,PIXELS=WIDTH*HEIGHT;
function raw(temp=20){
  const b=Buffer.alloc(PIXELS*4);
  for(let i=0;i<PIXELS;i++)b.writeFloatLE(temp,i*4);
  return b;
}

test('equal float32 frames pass parity without claiming measurement accuracy',()=>{
  const x=raw(19.25),out=A.compareMatrices(x,Buffer.from(x),WIDTH,HEIGHT);
  assert.equal(out.status,'PASS');
  assert.equal(out.pixels,81920);
  assert.equal(out.baselineCelsius.min,19.25);
  assert.equal(out.candidateCelsius.max,19.25);
  assert.equal(out.deltaKelvin.maxAbs,0);
  assert.equal(out.deltaKelvin.p95Abs,0);
});

test('systematic drift and isolated extreme outlier obey both explicit thresholds',()=>{
  const old=raw(20),shifted=raw(20.75);
  let r=A.compareMatrices(old,shifted,WIDTH,HEIGHT);
  assert.equal(r.status,'FAIL');
  assert.equal(r.deltaKelvin.p95Abs,0.75);
  r=A.compareMatrices(old,shifted,WIDTH,HEIGHT,{p95LimitK:1,maxLimitK:2});
  assert.equal(r.status,'PASS');
  shifted.fill(0);
  for(let i=0;i<PIXELS;i++)shifted.writeFloatLE(20,i*4);
  shifted.writeFloatLE(23,400*4);
  r=A.compareMatrices(old,shifted,WIDTH,HEIGHT);
  assert.equal(r.deltaKelvin.p95Abs,0);
  assert.equal(r.deltaKelvin.maxAbs,3);
  assert.equal(r.status,'FAIL');
});

test('reject malformed matrix, unsafe values, unsupported frame or bad limits',()=>{
  assert.throws(()=>A.compareMatrices(Buffer.alloc(3),raw(),WIDTH,HEIGHT),/length/);
  assert.throws(()=>A.compareMatrices(raw(),raw(),4,4),/unsupported frame/);
  let b=raw();b.writeFloatLE(NaN,100*4);
  assert.throws(()=>A.compareMatrices(raw(),b,WIDTH,HEIGHT),/pixel 100/);
  b=raw();b.writeFloatLE(2025,8);
  assert.throws(()=>A.compareMatrices(raw(),b,WIDTH,HEIGHT),/implausible/);
  assert.throws(()=>A.compareMatrices(raw(),raw(),WIDTH,HEIGHT,{p95LimitK:-1,maxLimitK:1}),/invalid comparison/);
});

test('bounded offline file audit records only hashes and rejects non-JPEG input',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'skyhub-tsdk-parity-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const image=path.join(dir,'source.JPG'),baseline=path.join(dir,'baseline.raw'),
        candidate=path.join(dir,'candidate.raw');
  fs.writeFileSync(image,Buffer.from([0xff,0xd8,0xff,0xd9]));
  fs.writeFileSync(baseline,raw(18));
  fs.writeFileSync(candidate,raw(18));
  const result=A.auditFiles({source:image,baseline,candidate,width:WIDTH,height:HEIGHT});
  assert.equal(result.status,'PASS');
  assert.equal(result.sdkExecutionVerified,false);
  assert.equal(result.accuracyVerified,false);
  assert.match(result.sourceSha256,/^[0-9a-f]{64}$/);
  assert.equal(result.baselineSha256,result.candidateSha256);
  assert.equal(Object.keys(result).includes('sourcePath'),false);
  fs.writeFileSync(image,Buffer.from('notjpeg'));
  assert.throws(()=>A.auditFiles({source:image,baseline,candidate,width:WIDTH,height:HEIGHT}),/not a JPEG/);
});

test('CLI requires explicit inputs and safe threshold numbers',()=>{
  const base=['--baseline','a','--candidate','b','--source','c','--width','320','--height','256'];
  assert.equal(A.parseCli(base).maxLimitK,2);
  assert.equal(A.parseCli([...base,'--p95-limit-k','0']).p95LimitK,0);
  assert.throws(()=>A.parseCli([...base,'--max-limit-k=-1']),/decimal/);
  assert.throws(()=>A.parseCli([...base,'--p95-limit-k','3']),/max limit/);
  assert.throws(()=>A.parseCli(base.slice(0,8)),/missing/);
});


test('isolated Pi runner has valid Bash syntax and rejects missing inputs',()=>{
  const script=path.resolve(__dirname,'../../scripts/dji-tsdk-parity-run.sh');
  const syntax=spawnSync('bash',['-n',script],{encoding:'utf8'});
  assert.equal(syntax.status,0,syntax.stderr);
  const missing=spawnSync('bash',[script,'--baseline-sdk','/nonexistent'],{encoding:'utf8'});
  assert.equal(missing.status,2);
  assert.match(missing.stderr,/Usage:/);
});


test('Pi runner pins one private JPEG snapshot even if the original changes between SDK calls',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'skyhub-tsdk-pinned-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const scripts=path.join(dir,'scripts'),backend=path.join(dir,'backend'),bin=path.join(dir,'fake-bin');
  fs.mkdirSync(scripts);fs.mkdirSync(backend);fs.mkdirSync(bin);
  fs.copyFileSync(path.resolve(__dirname,'../../scripts/dji-tsdk-parity-run.sh'),path.join(scripts,'dji-tsdk-parity-run.sh'));
  fs.copyFileSync(path.resolve(__dirname,'../../scripts/dji-tsdk-parity-audit.js'),path.join(scripts,'dji-tsdk-parity-audit.js'));
  fs.copyFileSync(path.resolve(__dirname,'../thermal-sdk.js'),path.join(backend,'thermal-sdk.js'));

  // Mock only external system dependencies: no Docker engine or DJI binaries are invoked.
  const fakeWrapper=String.raw`#!/usr/bin/env bash
set -Eeuo pipefail
sdk='' input='' output=''
while [[ $# -gt 0 ]]; do
  case "$1" in
    --sdk) sdk="$2";shift 2;;
    --input) input="$2";shift 2;;
    --output) output="$2";shift 2;;
    --) shift;break;;
    *) shift;;
  esac
done
[[ -n "$sdk" && -n "$input" && -n "$output" ]] || exit 2
sha256sum "$input" >> "$TRACE"
# Model an external writer replacing the original while the baseline SDK is busy.
if [[ "$sdk" == *sdk17 ]]; then printf '\377\330CHANGED\377\331' > "$ORIGINAL"; fi
node -e 'const fs=require("node:fs");const b=Buffer.alloc(320*256*4);for(let i=0;i<320*256;i++)b.writeFloatLE(20,i*4);fs.writeFileSync(process.argv[1],b)' "$output/temperatures.raw"
`;
  fs.writeFileSync(path.join(scripts,'dji-tsdk-run.sh'),fakeWrapper,{mode:0o755});
  fs.writeFileSync(path.join(bin,'uname'),'#!/bin/sh\necho aarch64\n',{mode:0o755});
  fs.writeFileSync(path.join(bin,'docker'),'#!/bin/sh\nexit 0\n',{mode:0o755});
  const oldSdk=path.join(dir,'sdk17'),newSdk=path.join(dir,'sdk19');
  for(const sdk of [oldSdk,newSdk]){
    fs.mkdirSync(path.join(sdk,'bin'),{recursive:true});
    fs.writeFileSync(path.join(sdk,'bin','dji_irp'),'mock');
  }
  const original=path.join(dir,'source.JPG'),trace=path.join(dir,'inputs.sha256');
  fs.writeFileSync(original,Buffer.from([0xff,0xd8,65,66,67,0xff,0xd9]));
  const before=createHash('sha256').update(fs.readFileSync(original)).digest('hex');
  const result=spawnSync('bash',[path.join(scripts,'dji-tsdk-parity-run.sh'),
    '--baseline-sdk',oldSdk,'--candidate-sdk',newSdk,'--input',original,
    '--width','320','--height','256'],{
    encoding:'utf8',timeout:30000,env:{...process.env,PATH:bin+':'+process.env.PATH,TRACE:trace,ORIGINAL:original}
  });
  assert.equal(result.status,0,result.stderr);
  const report=JSON.parse(result.stdout);
  assert.equal(report.status,'PASS');
  assert.equal(report.sourceSha256,before,'audit must identify the same pinned JPEG used in both runs');
  const inputs=fs.readFileSync(trace,'utf8').trim().split('\n').map(line=>line.slice(0,64));
  assert.deepEqual(inputs,[before,before]);
  assert.notEqual(createHash('sha256').update(fs.readFileSync(original)).digest('hex'),before,
    'the simulated external writer should have changed the original');
  assert.equal(report.sdkExecutionVerified,false,'mocked SDK execution must not count as hardware acceptance');
});
