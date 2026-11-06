'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
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
