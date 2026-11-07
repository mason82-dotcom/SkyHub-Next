'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {spawnSync}=require('node:child_process');
const planner=require('../../frontend/public/wpml-editor-core');
const {buildEvidenceReport}=require('../wpml-reference-evidence');
const SCRIPT=path.resolve(__dirname,'../../scripts/wpml-reference-evidence.js');
function plan(name='Synthetic privacy sensitive name',speed=5){
  return {name,model:'matrice4t',speed,transitionSpeed:speed,takeoffHeight:30,
    timestamp:1792573200000,waypoints:[
      {lat:49.12345,lon:8.56789,height:50,photo:true},
      {lat:49.12445,lon:8.56889,height:50,photo:false}]};
}
const kmz=(name,speed=5)=>Buffer.from(planner.build(plan(name,speed)).kmz);
function alternateNamespace(){
  const {templateXml,waylinesXml}=planner.documents(plan());
  return Buffer.from(planner.createKmz(
    templateXml.replace('http://www.dji.com/wpmz/1.0.2','http://www.dji.com/wpmz/1.0.6'),
    waylinesXml.replace('http://www.dji.com/wpmz/1.0.2','http://www.dji.com/wpmz/1.0.6')));
}
function withFixtures(fn){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'skyhub-evidence-private-'));
  try{return fn(dir);}finally{fs.rmSync(dir,{recursive:true,force:true});}
}
function run(dir,manifest){
  const manifestPath=path.join(dir,'private-manifest.json');
  fs.writeFileSync(manifestPath,JSON.stringify(manifest));
  return spawnSync(process.execPath,[SCRIPT,manifestPath],{encoding:'utf8',timeout:20000});
}
const spec=(files)=>({schema:'skyhub-wpml-reference-fixtures-v1',files});
function assertPrivate(data){
  assert.doesNotMatch(data,/49\.12345|8\.56789|Synthetic privacy sensitive name|skyhub-evidence-private-|private-manifest\.json/);
}
test('two independent-looking operator files differing only volatile metadata get no difference but no certification',()=>{
  withFixtures(dir=>{
    fs.writeFileSync(path.join(dir,'skyhub.kmz'),kmz('Synthetic privacy sensitive name'));
    fs.writeFileSync(path.join(dir,'pilot2.kmz'),kmz('Another mission name'));
    const proc=run(dir,spec({skyhub:'skyhub.kmz',pilot2:'pilot2.kmz'}));
    assert.equal(proc.status,0,proc.stderr);
    const r=JSON.parse(proc.stdout);
    assert.equal(r.schema,'skyhub-wpml-reference-evidence-v1');
    assert.equal(r.roleCount,2);
    assert.equal(r.pairCount,1);
    assert.equal(r.actualPilot2ImportTest,false);
    assert.equal(r.actualGoSdkExecutableRun,false);
    assert.equal(r.pilot2HardwareVerified,false);
    assert.equal(r.flightReady,false);
    assert.equal(r.summary.reviewStatus,'no-listed-divergence-observed');
    assert.equal(r.summary.allFilesIndependentlyVerified,false);
    assert.equal(r.comparisons[0].comparisonStatus,'compared');
    assert.equal(r.comparisons[0].structuralEqual,true);
    assert.equal(r.comparisons[0].inputBytesIdentical,false);
    assert.equal(r.inputs.find(x=>x.role==='pilot2').provenance,'operator-declared-unverified');
    assertPrivate(proc.stdout+proc.stderr);
  });
});
test('structural speed discrepancy changes exit to review-required without logging private values',()=>{
  withFixtures(dir=>{
    fs.writeFileSync(path.join(dir,'skyhub.kmz'),kmz('Mission A',5));
    fs.writeFileSync(path.join(dir,'pilot2.kmz'),kmz('Mission B',6));
    const p=run(dir,spec({skyhub:'skyhub.kmz',pilot2:'pilot2.kmz'}));
    assert.equal(p.status,1,p.stderr);
    const r=JSON.parse(p.stdout);
    assert.equal(r.summary.reviewStatus,'review-required');
    assert.ok(r.comparisons[0].structuralDifferenceCount>0);
    assert.equal(r.comparisons[0].structuralEqual,false);
    assertPrivate(p.stdout+p.stderr);
  });
});
test('same KMZ bytes across declared sources cannot establish independent evidence',()=>{
  const bytes=kmz('Same byte artifact');
  const result=buildEvidenceReport([{role:'goSdk',bytes},{role:'pilot2',bytes:Buffer.from(bytes)}]);
  assert.equal(result.summary.reviewStatus,'review-required');
  assert.equal(result.summary.anyInputByteIdentical,true);
  assert.equal(result.comparisons[0].inputBytesIdentical,true);
  assert.equal(result.comparisons[0].independentlyProvenanced,false);
});
test('1.0.6 source is audited but blocked for cross-version structural comparison',()=>{
  withFixtures(dir=>{
    fs.writeFileSync(path.join(dir,'skyhub.kmz'),kmz('SkyHub'));
    fs.writeFileSync(path.join(dir,'go-sdk.kmz'),alternateNamespace());
    const p=run(dir,spec({skyhub:'skyhub.kmz',goSdk:'go-sdk.kmz'}));
    assert.equal(p.status,2,p.stderr);
    const r=JSON.parse(p.stdout);
    assert.equal(r.summary.reviewStatus,'blocked');
    assert.equal(r.comparisons[0].comparisonStatus,'skipped-noncomparable-or-blocked');
    assert.equal(r.comparisons[0].structuralEqual,null);
    const go=r.inputs.find(x=>x.role==='goSdk');
    assert.equal(go.namespaceCheck,'upstream-alternate-unverified');
    assert.equal(go.offlineValid,null);
    assert.ok(go.findings.includes('WPML_NAMESPACE_NOT_VALIDATED_BY_SKYHUB'));
    assertPrivate(p.stdout+p.stderr);
  });
});
test('three-role manifest generates three pairwise comparisons, never a Pilot 2 validation',()=>{
  withFixtures(dir=>{
    fs.writeFileSync(path.join(dir,'a.kmz'),kmz('A'));
    fs.writeFileSync(path.join(dir,'b.kmz'),kmz('B'));
    fs.writeFileSync(path.join(dir,'c.kmz'),kmz('C'));
    const p=run(dir,spec({skyhub:'a.kmz',goSdk:'b.kmz',pilot2:'c.kmz'}));
    assert.equal(p.status,0,p.stderr);
    const r=JSON.parse(p.stdout);
    assert.equal(r.roleCount,3);
    assert.equal(r.pairCount,3);
    assert.equal(r.actualPilot2ImportTest,false);
    assert.ok(r.comparisons.every(c=>c.structuralEqual===true));
  });
});
test('malformed and unknown manifest fields never echo file names or content',()=>{
  withFixtures(dir=>{
    fs.writeFileSync(path.join(dir,'good.kmz'),kmz('A'));
    for(const files of [
      {skyhub:'../private-49.12345.kmz',pilot2:'good.kmz'},
      {skyhub:'/tmp/private.kmz',pilot2:'good.kmz'},
      {skyhub:'good.kmz',pilot2:'good.kmz',unknown:'good.kmz'},
      {skyhub:'good.kmz'},
      {skyhub:'good.kmz',pilot2:'../../something.kmz'}
    ]){
      const p=run(dir,spec(files));
      assert.equal(p.status,2,p.stdout+p.stderr);
      assert.equal(p.stdout,'');
      assertPrivate(p.stderr);
    }
    const p=run(dir,{...spec({skyhub:'good.kmz',pilot2:'good.kmz'}),metadata:'private'});
    assert.equal(p.status,2);
    assert.equal(p.stdout,'');
  });
});
test('symlinks, non-KMZ inputs and repeated role names are rejected',()=>{
  withFixtures(dir=>{
    fs.writeFileSync(path.join(dir,'real.kmz'),kmz('A'));
    fs.symlinkSync('real.kmz',path.join(dir,'alias.kmz'));
    let p=run(dir,spec({skyhub:'real.kmz',pilot2:'alias.kmz'}));
    assert.equal(p.status,2);
    assert.equal(p.stdout,'');
    fs.writeFileSync(path.join(dir,'not-kmz.kmz'),'Private location 49.12345');
    p=run(dir,spec({skyhub:'real.kmz',pilot2:'not-kmz.kmz'}));
    assert.equal(p.status,2);
    assertPrivate(p.stderr);
    assert.throws(()=>buildEvidenceReport([{role:'pilot2',bytes:kmz('1')},
      {role:'pilot2',bytes:kmz('2')}]),/evidence rejected/);
  });
});
test('duplicate manifest keys cannot silently override operator role',()=>{
  withFixtures(dir=>{
    const pathname=path.join(dir,'private-manifest.json');
    fs.writeFileSync(pathname,
      '{"schema":"skyhub-wpml-reference-fixtures-v1","files":{"skyhub":"a","skyhub":"b","pilot2":"c"}}');
    const p=spawnSync(process.execPath,[SCRIPT,pathname],{encoding:'utf8',timeout:15000});
    assert.equal(p.status,2);
    assert.equal(p.stdout,'');
    assertPrivate(p.stderr);
  });
});
test('no transport, flight command, or unredacted error path exists in evidence implementation',()=>{
  const moduleCode=fs.readFileSync(path.resolve(__dirname,'../wpml-reference-evidence.js'),'utf8');
  const cliCode=fs.readFileSync(SCRIPT,'utf8');
  assert.doesNotMatch(moduleCode+cliCode,/\bfetch\s*\(|XMLHttpRequest|WebSocket|mqtt\.publish|\/api\/mission\/create|\.publish\s*\(/);
  assert.doesNotMatch(moduleCode,/console\.log|process\.stdout|\.toString\('utf8'\)/);
});
