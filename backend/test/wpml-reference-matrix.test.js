'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {runReferenceMatrix,MODELS,CASES}=require('../wpml-reference-matrix');
const planner=require('../../frontend/public/wpml-editor-core');
const {compareKmz}=require('../wpml-compare');
const {auditReferenceKmz}=require('../wpml-reference-audit');
const by=(r,model,scenario)=>r.cases.find(c=>c.model===model&&c.scenario===scenario);
test('synthetic, provenance-labeled matrix is deterministic, bounded and offline-only',()=>{
  const r=runReferenceMatrix();
  assert.equal(r.schema,'skyhub-wpml-synthetic-compat-matrix-v1');
  assert.equal(r.modelCount,5);
  assert.equal(r.scenarioCount,6);
  assert.equal(r.caseCount,30);
  assert.equal(r.cases.length,30);
  assert.deepEqual(MODELS,['mavic3e','mavic3t','mavic3m','matrice4e','matrice4t']);
  assert.equal(r.actualGoSdkExecutableRun,false);
  assert.equal(r.actualPilot2ImportTest,false);
  assert.equal(r.noReferenceHardwareOrRemoteOperations,true);
  assert.equal(r.flightReady,false);
  assert.equal(r.source,'synthetic-skyhub-generated-mutations-only');
  assert.equal(JSON.stringify(r),JSON.stringify(runReferenceMatrix()));
  for(const entry of r.cases){
    assert.ok(MODELS.includes(entry.model));
    assert.ok(CASES.includes(entry.scenario));
    assert.equal(entry.flightReady,false);
    assert.ok(['no-listed-divergence-observed','review-required','blocked'].includes(entry.reviewStatus));
    assert.ok(entry.findings.every(s=>/^[A-Z][A-Z0-9_]+$/.test(s)));
  }
  const json=JSON.stringify(r);
  assert.doesNotMatch(json,/"(?:latitude|longitude|lat|lon|height|missionName)"\s*:/i);
  assert.doesNotMatch(json,/Synthetic offline regression|49\.000|8\.040|<kml/);
});
test('model subtypes are safely separated from payload enums',()=>{
  const r=runReferenceMatrix();
  for(const model of MODELS){
    const base=by(r,model,'skyhub-baseline');
    assert.equal(base.offlineValid,true,model);
    assert.equal(base.reviewStatus,'no-listed-divergence-observed',model);
    const subtype=by(r,model,'sdk-style-subtype-zero');
    if(['mavic3t','mavic3m','matrice4t'].includes(model)){
      assert.equal(subtype.reviewStatus,'blocked',model);
      assert.ok(subtype.findings.includes('AIRCRAFT_SUBTYPE_PAYLOAD_CONFLICT'),model);
    }else{
      assert.equal(subtype.reviewStatus,'no-listed-divergence-observed',model);
    }
  }
});
test('RC defaults, copied altitude references and degree-distance approximations remain review-only',()=>{
  const r=runReferenceMatrix();
  for(const model of MODELS){
    const rc=by(r,model,'sdk-style-rc-loss');
    assert.equal(rc.reviewStatus,'review-required',model);
    assert.ok(rc.findings.includes('RC_LOSS_POLICY_DIFFERS_FROM_SKYHUB_EDITOR'),model);
    const height=by(r,model,'sdk-style-height-copy');
    assert.equal(height.reviewStatus,'review-required',model);
    assert.ok(height.findings.includes('ELLIPSOID_HEIGHT_PROVENANCE_UNVERIFIED'),model);
    assert.ok(height.findings.includes('ELLIPSOID_EQUALS_OTHER_HEIGHT_REQUIRES_REVIEW'),model);
    const distance=by(r,model,'sdk-style-degree-distance');
    assert.equal(distance.reviewStatus,'review-required',model);
    assert.ok(distance.findings.includes('WAYLINE_DISTANCE_DIFFERS_FROM_SPHERICAL_APPROXIMATION'),model);
  }
});
test('synthetic 1.0.6 reference inputs are blocked, not normalized into export-ready files',()=>{
  const r=runReferenceMatrix();
  for(const model of MODELS){
    const alt=by(r,model,'sdk-style-namespace-1.0.6');
    assert.equal(alt.reviewStatus,'blocked',model);
    assert.equal(alt.offlineValid,null);
    assert.equal(alt.namespaceCheck,'upstream-alternate-unverified');
    assert.ok(alt.findings.includes('WPML_NAMESPACE_NOT_VALIDATED_BY_SKYHUB'),model);
  }
});
test('M3M and M4T waypoint photos and interval captures are structural, not camera confirmation',()=>{
  for(const model of ['mavic3m','matrice4t']){
    const plan={model,name:'Synthetic camera-actions only',speed:5,takeoffHeight:30,
      waypoints:[{lat:49.1,lon:8.5,height:50,photo:false},
        {lat:49.2,lon:8.6,height:50,photo:false}]};
    const base=Buffer.from(planner.build(plan).kmz);
    const interval=Buffer.from(planner.build({...plan,
      intervalPhotos:{type:'multipleDistance',interval:12}}).kmz);
    const report=compareKmz(base,interval);
    assert.equal(report.summary.flightReady,false);
    assert.equal(report.summary.cameraActionSummariesDiffer,true);
    assert.equal(report.summary.bothOfflineValid,true);
    assert.equal(report.right.cameraActionSummary.periodicDistancePhotoActions,1);
    assert.equal(auditReferenceKmz(interval).flightReady,false);
    const timing=Buffer.from(planner.build({...plan,
      intervalPhotos:{type:'multipleTiming',interval:3}}).kmz);
    const summary=compareKmz(base,timing).right.cameraActionSummary;
    assert.equal(summary.periodicTimePhotoActions,1);
    assert.equal(summary.cameraHardwareVerified,false);
  }
});
test('CLI never emits private coordinates and cannot call drone APIs',()=>{
  const file=path.resolve(__dirname,'../../scripts/wpml-reference-matrix.js');
  const proc=spawnSync(process.execPath,[file],{encoding:'utf8',timeout:20000});
  assert.equal(proc.status,0,proc.stderr);
  assert.equal(JSON.parse(proc.stdout).caseCount,30);
  assert.doesNotMatch(proc.stdout,/"lat"|"lon"|49\.000|8\.040/);
  const code=fs.readFileSync(path.resolve(__dirname,'../wpml-reference-matrix.js'),'utf8');
  const cli=fs.readFileSync(file,'utf8');
  assert.doesNotMatch(code+cli,/\bfetch\s*\(|XMLHttpRequest|WebSocket|mqtt\.publish|\/api\/mission\/create/);
});
