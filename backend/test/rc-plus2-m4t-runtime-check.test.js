'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {makeRuntimeEvidence}=require('../rc-plus2-m4t-evidence');

const cli=path.resolve(__dirname,'../../scripts/pi-rc-plus2-m4t-check.js');
const fakeDocker=String.raw`#!/usr/bin/env node
'use strict';
const {createRequire}=require('node:module');
const args=process.argv.slice(2);
const index=args.indexOf('-e');
if(index<0||!args[index+1])process.exit(4);
if(process.env.TEST_INJECT_PRIVATE==='1'){
  process.stdout.write(JSON.stringify({
    schema:'skyhub-rcplus2-m4t-runtime-check-v1',
    evaluatorAvailable:true,evidenceAvailable:true,PRIVATE_TOKEN:'SECRET'
  }));
}else{
  const normalRequire=createRequire(process.env.TEST_BACKEND_ENTRY);
  const mockedRequire=id=>{
    if(process.env.TEST_MISSING_MODULE==='evaluator'&&
        id==='./rc-plus2-m4t-hardware-validation')throw Error('PRIVATE_SECRET');
    if(process.env.TEST_MISSING_MODULE==='evidence'&&
        id==='./rc-plus2-m4t-evidence')throw Error('PRIVATE_SECRET');
    if(process.env.TEST_STUB_EVIDENCE==='1'&&
        id==='./rc-plus2-m4t-evidence')return {makeLiveEvidence:()=>{}};
    return normalRequire(id);
  };
  new Function('require',args[index+1])(mockedRequire);
}
`;
function execute(extraArgs=[],env={}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'skyhub-runtimecheck-'));
  try{
    fs.writeFileSync(path.join(dir,'docker'),fakeDocker,{mode:0o700});
    return spawnSync(process.execPath,[cli,'--runtime-check',...extraArgs],{
      cwd:dir,encoding:'utf8',timeout:10000,
      env:{...process.env,PATH:dir+path.delimiter+process.env.PATH,
        SKYHUB_COMPOSE_DIR:dir,
        SKYHUB_VIEW_TOKEN:'',
        TEST_BACKEND_ENTRY:path.resolve(__dirname,'../server.js'),
        ...env}
    });
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
test('runtime check requires no DJI devices, API token or network GET',()=>{
  const result=execute();
  assert.equal(result.status,0,result.stderr);
  assert.match(result.stdout,/Live-Evaluator ladbar: JA/);
  assert.match(result.stdout,/JSON-Evidence-Modul ladbar: JA/);
  assert.match(result.stdout,/Live-JSON-Module: BEREIT/);
});
test('runtime check JSON is strict and never implies flight or hardware clearance',()=>{
  const result=execute(['--json']);
  assert.equal(result.status,0,result.stderr);
  const receipt=JSON.parse(result.stdout);
  assert.equal(receipt.mode,'runtime-module-check');
  assert.equal(receipt.result,'READY');
  assert.deepEqual(receipt.checks,{evaluatorAvailable:true,evidenceAvailable:true});
  assert.equal(receipt.hardwareAcceptanceComplete,false);
  assert.equal(receipt.flightReady,false);
  assert.equal(receipt.dispatchAllowed,false);
});
test('individual unavailable modules fail closed with exit 3 and no error leak',()=>{
  for(const mod of ['evaluator','evidence']){
    const result=execute(['--json'],{TEST_MISSING_MODULE:mod});
    assert.equal(result.status,3,result.stderr);
    const receipt=JSON.parse(result.stdout);
    assert.equal(receipt.result,'INCOMPLETE');
    assert.equal(receipt.checks[mod==='evaluator'?
      'evaluatorAvailable':'evidenceAvailable'],false);
    assert.doesNotMatch(result.stdout+result.stderr,/PRIVATE_SECRET|PRIVATE_TOKEN/);
  }
});
test('unknown runtime output with additional private keys is never printed',()=>{
  const result=execute(['--json'],{TEST_INJECT_PRIVATE:'1'});
  assert.equal(result.status,1,result.stderr);
  assert.equal(result.stdout,'');
  assert.doesNotMatch(result.stderr,/PRIVATE_TOKEN|SECRET/);
});
test('runtime check rejects malformed evidence before creating receipt',()=>{
  const valid={schema:'skyhub-rcplus2-m4t-runtime-check-v1',
    evaluatorAvailable:true,evidenceAvailable:true};
  assert.equal(makeRuntimeEvidence(valid,new Date('2026-10-24T10:00:00Z')).result,'READY');
  assert.throws(()=>makeRuntimeEvidence({...valid,evidenceAvailable:'true'}));
  assert.throws(()=>makeRuntimeEvidence({...valid,extra:'PRIVATE_SECRET'}));
  assert.throws(()=>makeRuntimeEvidence({},new Date('invalid')));
});
test('runtime check cannot be mixed with --preflight or duplicated',()=>{
  for(const args of [['--preflight'],['--runtime-check'],['--json','--json']]){
    const result=execute(args);
    assert.equal(result.status,2,result.stderr);
    assert.equal(result.stdout,'');
  }
});

test('module file without required validator export is not accepted as ready',()=>{
  const r=execute(['--json'],{TEST_STUB_EVIDENCE:'1'});
  assert.equal(r.status,3,r.stderr);
  const receipt=JSON.parse(r.stdout);
  assert.equal(receipt.checks.evidenceAvailable,false);
  assert.equal(receipt.result,'INCOMPLETE');
});
