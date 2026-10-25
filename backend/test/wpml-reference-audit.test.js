'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const planner=require('../../frontend/public/wpml-editor-core');
const {auditReferenceKmz}=require('../wpml-reference-audit');

function plan(model='mavic3t'){
  return {name:'Private Mission 49.12345',model,speed:5,
    takeoffHeight:30,finishAction:'goHome',timestamp:1792573200000,
    waypoints:[{lat:49.12345,lon:8.56789,height:50,photo:true},
      {lat:49.12395,lon:8.56889,height:50,photo:false}]};
}
function kmz(modifier,model){
  const {templateXml,waylinesXml}=planner.documents(plan(model));
  const docs=modifier?modifier(templateXml,waylinesXml):[templateXml,waylinesXml];
  return Buffer.from(planner.createKmz(...docs));
}
function fixedFields(report){
  const txt=JSON.stringify(report);
  assert.doesNotMatch(txt,/49\.12345|8\.56789|Private Mission|\b30\.0\b/);
  assert.equal(report.flightReady,false);
  assert.equal(report.pilot2HardwareVerified,false);
  assert.equal(report.sdkOutputVerified,false);
  assert.equal(report.missionDispatchEnabled,false);
  assert.equal(report.schema,'skyhub-wpml-reference-risk-audit-v1');
  assert.equal(report.findingCount,report.findings.length);
}
test('ordinary SkyHub offline waypoint KMZ has no listed SDK divergences, never flight-ready',()=>{
  for(const model of ['mavic3e','mavic3t','mavic3m','matrice4e','matrice4t']){
    const report=auditReferenceKmz(kmz(null,model));
    fixedFields(report);
    assert.equal(report.offlineValid,true);
    assert.equal(report.reviewStatus,'no-listed-divergence-observed');
    assert.deepEqual(report.findings,[]);
  }
});
test('Go-style RC-loss policy is reported without calling a valid XML an invalid flight',()=>{
  const report=auditReferenceKmz(kmz((a,b)=>[a,b].map(xml=>
    xml.replace('<wpml:exitOnRCLost>executeLostAction</wpml:exitOnRCLost>',
      '<wpml:exitOnRCLost>goContinue</wpml:exitOnRCLost>')
      .replace('<wpml:executeRCLostAction>goBack</wpml:executeRCLostAction>',
        '<wpml:executeRCLostAction>hover</wpml:executeRCLostAction>'))));
  fixedFields(report);
  assert.equal(report.offlineValid,true);
  assert.equal(report.reviewStatus,'review-required');
  assert.deepEqual(report.findings,['RC_LOSS_POLICY_DIFFERS_FROM_SKYHUB_EDITOR']);
});
test('Go converter subtype zero with a T payload is flagged by the profile matrix',()=>{
  const report=auditReferenceKmz(kmz((a,b)=>[a,b].map(xml=>
    xml.replace('<wpml:droneSubEnumValue>1</wpml:droneSubEnumValue>',
      '<wpml:droneSubEnumValue>0</wpml:droneSubEnumValue>'))));
  fixedFields(report);
  assert.equal(report.reviewStatus,'blocked');
  assert.ok(report.findings.includes('AIRCRAFT_SUBTYPE_PAYLOAD_CONFLICT'));
  assert.ok(report.findings.includes('WPML_OFFLINE_VALIDATION_FAILED'));
});
test('ellipsoid equal to relative height is a provenance question, not proof of wrong altitude',()=>{
  const report=auditReferenceKmz(kmz((a,b)=>[
    a.replace('<wpml:height>50</wpml:height>',
      '<wpml:ellipsoidHeight>50</wpml:ellipsoidHeight><wpml:height>50</wpml:height>'),b]));
  fixedFields(report);
  assert.ok(report.findings.includes('ELLIPSOID_HEIGHT_PROVENANCE_UNVERIFIED'));
  assert.ok(report.findings.includes('ELLIPSOID_EQUALS_OTHER_HEIGHT_REQUIRES_REVIEW'));
});
test('takeoff fallback and SDK distance fields require independent inspection',()=>{
  const modify=xml=>xml.replace('</wpml:missionConfig>',
    '<wpml:takeOffRefPoint>49.12345,8.56789,50</wpml:takeOffRefPoint>'+
    '<wpml:takeOffRefPointAGLHeight>0</wpml:takeOffRefPointAGLHeight>'+
    '</wpml:missionConfig>');
  const report=auditReferenceKmz(kmz((a,b)=>[
    modify(a),modify(b).replace('</Folder>',
      '<wpml:distance>111000</wpml:distance>'+
      '<wpml:duration>22200</wpml:duration></Folder>')]));
  fixedFields(report);
  assert.ok(report.findings.includes('TAKEOFF_REFERENCE_REQUIRES_INDEPENDENT_PROVENANCE'));
  assert.ok(report.findings.includes('TAKEOFF_AGL_ZERO_REQUIRES_REVIEW'));
  assert.ok(report.findings.includes('WAYLINE_STATS_NOT_INDEPENDENTLY_VERIFIED'));
});
test('upstream alternate namespace is recorded but never assumed accepted by SkyHub or DJI',()=>{
  const report=auditReferenceKmz(kmz((a,b)=>[a,b].map(xml=>
    xml.replace('http://www.dji.com/wpmz/1.0.2','http://www.dji.com/wpmz/1.0.6'))));
  fixedFields(report);
  assert.equal(report.offlineValid,null);
  assert.equal(report.reviewStatus,'blocked');
  assert.equal(report.namespaceCheck,'upstream-alternate-unverified');
  assert.deepEqual(report.findings,['WPML_NAMESPACE_NOT_VALIDATED_BY_SKYHUB']);
});
test('1.0.6 reference input remains blocked but reports source-aware risks without leaking data',()=>{
  const broken=kmz((a,b)=>[a,b].map(xml=>
    xml.replace('http://www.dji.com/wpmz/1.0.2','http://www.dji.com/wpmz/1.0.6')
      .replace('<wpml:droneSubEnumValue>1</wpml:droneSubEnumValue>',
        '<wpml:droneSubEnumValue>0</wpml:droneSubEnumValue>')
      .replace('<wpml:exitOnRCLost>executeLostAction</wpml:exitOnRCLost>',
        '<wpml:exitOnRCLost>goContinue</wpml:exitOnRCLost>')));
  const report=auditReferenceKmz(broken);
  fixedFields(report);
  assert.equal(report.offlineValid,null);
  assert.equal(report.namespaceCheck,'upstream-alternate-unverified');
  assert.equal(report.inspectionMode,'explicit-alternate-namespace-read-only');
  assert.equal(report.reviewStatus,'blocked');
  assert.ok(report.findings.includes('WPML_NAMESPACE_NOT_VALIDATED_BY_SKYHUB'));
  assert.ok(report.findings.includes('AIRCRAFT_SUBTYPE_PAYLOAD_CONFLICT'));
  assert.ok(report.findings.includes('RC_LOSS_POLICY_DIFFERS_FROM_SKYHUB_EDITOR'));
  assert.ok(report.findings.includes('WPML_OFFLINE_VALIDATION_FAILED'));
});
test('SDK-style longitude-degree distance overestimate is flagged only as a review',()=>{
  const base=plan();
  base.waypoints=[{lat:49,lon:8,height:50},{lat:49,lon:8.04,height:50}];
  const docs=planner.documents(base);
  const mark=docs.waylinesXml.replace('</Folder>',
    '<wpml:distance>4440</wpml:distance><wpml:duration>888</wpml:duration></Folder>');
  const report=auditReferenceKmz(Buffer.from(planner.createKmz(docs.templateXml,mark)));
  fixedFields(report);
  assert.equal(report.offlineValid,true);
  assert.equal(report.reviewStatus,'review-required');
  assert.ok(report.findings.includes('WAYLINE_STATS_NOT_INDEPENDENTLY_VERIFIED'));
  assert.ok(report.findings.includes('WAYLINE_DISTANCE_DIFFERS_FROM_SPHERICAL_APPROXIMATION'));
  const plausible=docs.waylinesXml.replace('</Folder>',
    '<wpml:distance>2918</wpml:distance></Folder>');
  const ok=auditReferenceKmz(Buffer.from(planner.createKmz(docs.templateXml,plausible)));
  assert.ok(ok.findings.includes('WAYLINE_STATS_NOT_INDEPENDENTLY_VERIFIED'));
  assert.ok(!ok.findings.includes('WAYLINE_DISTANCE_DIFFERS_FROM_SPHERICAL_APPROXIMATION'));
});
test('mixed and unknown WPML namespaces are blocked before any shim conversion',()=>{
  const mixed=auditReferenceKmz(kmz((a,b)=>[
    a.replace('http://www.dji.com/wpmz/1.0.2','http://www.dji.com/wpmz/1.0.6'),b]));
  assert.equal(mixed.reviewStatus,'blocked');
  assert.equal(mixed.inspectionMode,'not-inspected');
  assert.equal(mixed.offlineValid,null);
  assert.deepEqual(mixed.findings,['WPML_NAMESPACE_NOT_VALIDATED_BY_SKYHUB']);
});
test('untrusted files fail closed; no filenames or mission metadata in errors',()=>{
  assert.throws(()=>auditReferenceKmz(Buffer.from('private coordinates 49.12345')),/audit rejected/);
  assert.throws(()=>auditReferenceKmz(null),/audit rejected/);
});
test('CLI has deterministic exit codes; reports are privacy-redacted',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'skyhub-ref-risk-'));
  const command=path.resolve(__dirname,'../../scripts/wpml-reference-audit.js');
  const run=file=>spawnSync(process.execPath,[command,file],{encoding:'utf8',timeout:15000});
  try{
    const good=path.join(dir,'private-49.12345.kmz');
    fs.writeFileSync(good,kmz());
    let proc=run(good);
    assert.equal(proc.status,0,proc.stderr);
    fixedFields(JSON.parse(proc.stdout));
    fs.writeFileSync(good,kmz((a,b)=>[a,b].map(xml=>
      xml.replace('<wpml:exitOnRCLost>executeLostAction</wpml:exitOnRCLost>',
        '<wpml:exitOnRCLost>goContinue</wpml:exitOnRCLost>'))));
    proc=run(good);
    assert.equal(proc.status,1,proc.stderr);
    assert.ok(JSON.parse(proc.stdout).findingCount>0);
    fs.writeFileSync(good,Buffer.from('private-49.12345'));
    proc=run(good);
    assert.equal(proc.status,2);
    assert.equal(proc.stdout,'');
    assert.doesNotMatch(proc.stderr,/private|49\.12345/);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('audit and CLI have no transport, DJI MQTT, dispatch or secret data output',()=>{
  const code=fs.readFileSync(path.resolve(__dirname,'../wpml-reference-audit.js'),'utf8');
  const cli=fs.readFileSync(path.resolve(__dirname,'../../scripts/wpml-reference-audit.js'),'utf8');
  assert.doesNotMatch(code+cli,/\bfetch\s*\(|XMLHttpRequest|WebSocket|mqtt\.publish|\/api\/mission\/create|publish\s*\(/);
  assert.doesNotMatch(code,/console\.log\s*\(|process\.stdout/);
});
