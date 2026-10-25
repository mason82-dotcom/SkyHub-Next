'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const path=require('node:path');
const {inspectFixture,runAudit,serviceReplyShape,REPORT_SCHEMA}=require('../dji-protocol-parity');
const fixtures=require('../data/dji-118-parity-fixtures.json');

test('all pinned synthetic DJI 1.18 topology and services_reply cases match',()=>{
  const report=runAudit(fixtures);
  assert.equal(report.schema,REPORT_SCHEMA);
  assert.equal(report.total,16);
  assert.equal(report.passed,16);
  assert.equal(report.failed,0);
  assert.equal(report.unresolvedModelCases,2);
  assert.equal(report.candidateReplyCases,1);
  assert.equal(report.classification,'bounded-synthetic-fixtures-only');
  assert.equal(report.hardwareVerified,false);
  assert.equal(report.flightReady,false);
  assert.equal(report.liveMqttUsed,false);
  assert.ok(report.cases.every(x=>x.result==='pass'));
});

test('RC Plus 2 and M4T are resolved only from fully typed topology',()=>{
  const full=inspectFixture(fixtures.cases.find(x=>x.id==='topology-rcplus2-m4t-complete'));
  assert.equal(full.gatewayModel,'DJI RC Plus 2 Enterprise');
  assert.equal(full.aircraftModel,'Matrice 4T');
  assert.equal(full.modelResolution,'resolved');
  assert.equal(full.replyEligible,true);
  const missing=inspectFixture(fixtures.cases.find(x=>x.id==='topology-rcplus2-missing-domain'));
  assert.equal(missing.gatewayModel,'DJI RC Plus 2 Enterprise');
  assert.equal(missing.aircraftModel,null);
  assert.equal(missing.modelResolution,'unknown-domain');
  // An eligible status_reply is not proof that a missing aircraft field was resolved.
  assert.equal(missing.replyEligible,true);
});

test('invalid transaction, retained packets and stale packets cannot earn ACK eligibility',()=>{
  for(const id of ['topology-invalid-transaction','topology-retained-packet',
    'topology-stale-packet','topology-invalid-subdevices']){
    const record=inspectFixture(fixtures.cases.find(x=>x.id===id));
    assert.equal(record.replyEligible,false,id);
  }
  assert.equal(inspectFixture(fixtures.cases.find(x=>
    x.id==='topology-invalid-transaction')).transactionValid,false);
  assert.equal(inspectFixture(fixtures.cases.find(x=>
    x.id==='topology-retained-packet')).intakeAccepted,false);
});

test('service reply shapes are observations, not a command executor',()=>{
  const forms=new Set(fixtures.cases.filter(x=>x.id.startsWith('service-'))
    .map(x=>inspectFixture(x).replyShape));
  for(const form of ['result-only','result-output','result-flat',
    'object-result-candidate','ambiguous-shape','invalid-shape','invalid-transaction']){
    assert.ok(forms.has(form),form);
  }
  assert.equal(serviceReplyShape({data:{result:0,output:{},extra:'x'}}),'ambiguous-shape');
  assert.equal(serviceReplyShape({data:{result:0,output:'wrong'}}),'ambiguous-shape');
  assert.equal(serviceReplyShape({data:{result:{code:'0'}}}),'invalid-shape');
});

test('parity report emits only approved status labels, never secrets, identifiers or payloads',()=>{
  const report=JSON.stringify(runAudit(fixtures));
  for(const forbidden of ['DUMMY_ONLY','SYNTHETIC_RC','SYNTHETIC_M4T',
    'device_secret','nonce','flighttask_prepare','licenses']){
    assert.ok(!report.includes(forbidden),'unexpected report field/value: '+forbidden);
  }
});

test('mutated expectation causes a reproducible nonzero audit mismatch',()=>{
  const copy=JSON.parse(JSON.stringify(fixtures));
  copy.cases[0].expect.aircraftModel='DJI NOT THE MAT RICE';
  const report=runAudit(copy);
  assert.equal(report.failed,1);
  assert.equal(report.passed,15);
  assert.deepEqual(report.cases[0].mismatchedFields,['aircraftModel']);
  assert.ok(!JSON.stringify(report).includes('DJI NOT THE MAT RICE'));
});

test('fixture collection rejects unknown expectation keys, duplicate IDs and oversized count',()=>{
  const duplicate=JSON.parse(JSON.stringify(fixtures));
  duplicate.cases[1].id=duplicate.cases[0].id;
  assert.throws(()=>runAudit(duplicate),/Invalid parity case/);
  const unknown=JSON.parse(JSON.stringify(fixtures));
  unknown.cases[0].expect.arbitraryRawPacket='sensitive';
  assert.throws(()=>runAudit(unknown),/Invalid parity expectation/);
  const oversized=JSON.parse(JSON.stringify(fixtures));
  oversized.cases=Array.from({length:65},(_,i)=>({...oversized.cases[0],id:'case-'+i}));
  assert.throws(()=>runAudit(oversized),/Invalid parity fixture collection/);
});

test('CLI prints machine-readable offline audit with no device identifiers',()=>{
  const file=path.join(__dirname,'../../scripts/dji-protocol-parity-audit.js');
  const stdout=execFileSync(process.execPath,[file],{encoding:'utf8',timeout:5000});
  const report=JSON.parse(stdout);
  assert.equal(report.failed,0);
  assert.equal(report.total,16);
  assert.equal(report.liveMqttUsed,false);
  assert.ok(!stdout.includes('SYNTHETIC_RC'));
});
