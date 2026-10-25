'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const planner=require('../../frontend/public/wpml-editor-core');
const {parseXml,validateDocuments}=require('../wpml');
const {auditReferenceKmz}=require('../wpml-reference-audit');

const V102='http://www.dji.com/wpmz/1.0.2';
const V106='http://www.dji.com/wpmz/1.0.6';
function documentPair(){
  return planner.documents({model:'matrice4t',name:'Private flight name 49.12345',
    speed:5,takeoffHeight:30,waypoints:[
      {lat:49.12345,lon:8.56789,height:50,photo:true},
      {lat:49.12395,lon:8.56889,height:50,photo:false}]});
}
const alternate=xml=>xml.replace(V102,V106);
const kmz=(a,b)=>Buffer.from(planner.createKmz(a,b));
test('DJI example 1.0.2 is default; only read-only caller can explicitly inspect 1.0.6',()=>{
  const {templateXml:t,waylinesXml:w}=documentPair();
  assert.equal(validateDocuments(t,w).valid,true);
  assert.equal(validateDocuments(t,w).flightReady,false);
  const at=alternate(t),aw=alternate(w);
  assert.throws(()=>parseXml(at),/namespace missing/);
  const native=validateDocuments(at,aw);
  assert.equal(native.valid,false);
  assert.ok(native.errors.length>=1);
  assert.equal(parseXml(at,V106).attributes['xmlns:wpml'],V106);
  const alternateReview=validateDocuments(at,aw,V106);
  assert.equal(alternateReview.valid,true,JSON.stringify(alternateReview.errors));
  assert.equal(alternateReview.flightReady,false);
  const report=auditReferenceKmz(kmz(at,aw));
  assert.equal(report.reviewStatus,'blocked');
  assert.equal(report.offlineValid,null);
  assert.equal(report.inspectionMode,'explicit-alternate-namespace-read-only');
  assert.equal(report.pilot2HardwareVerified,false);
  assert.equal(report.flightReady,false);
});
test('namespace cannot be switched by an XML comment preceding the real root',()=>{
  const {templateXml:t,waylinesXml:w}=documentPair();
  const comment='<!-- <kml xmlns:wpml="'+V106+'"> deceptive namespace -->';
  const inject=xml=>xml.replace('<kml ',comment+'\n<kml ');
  const report=auditReferenceKmz(kmz(inject(t),inject(w)));
  assert.equal(report.namespaceCheck,'skyhub-recognized-1.0.2');
  assert.equal(report.inspectionMode,'native-skyhub');
  assert.equal(report.reviewStatus,'no-listed-divergence-observed');
});
test('nested WPML namespace shadowing is rejected under both recognized versions',()=>{
  const {templateXml:t,waylinesXml:w}=documentPair();
  for(const version of [V102,V106]){
    const first=version===V102?t:alternate(t);
    const last=version===V102?w:alternate(w);
    const inject=xml=>xml.replace('<Document>',
      '<Document xmlns:wpml="http://example.invalid/evil">');
    assert.throws(()=>parseXml(inject(first),version),/nested namespace rebinding/);
    const report=auditReferenceKmz(kmz(inject(first),inject(last)));
    assert.equal(report.reviewStatus,'blocked');
    assert.equal(report.offlineValid,null);
    assert.deepEqual(report.findings,['WPML_NAMESPACE_NOT_VALIDATED_BY_SKYHUB']);
  }
});
test('nested KML default namespace rebinding is also rejected',()=>{
  const {templateXml:t,waylinesXml:w}=documentPair();
  const inject=xml=>xml.replace('<Folder>',
    '<Folder xmlns="http://example.invalid/kml">');
  assert.throws(()=>parseXml(inject(t)),/nested namespace rebinding/);
  assert.equal(validateDocuments(inject(t),inject(w)).valid,false);
  assert.equal(auditReferenceKmz(kmz(inject(t),inject(w))).reviewStatus,'blocked');
});
test('duplicate namespace declarations and unsupported URI profiles fail closed',()=>{
  const {templateXml:t,waylinesXml:w}=documentPair();
  const duplicated=t.replace('xmlns:wpml="'+V102+'"',
    'xmlns:wpml="'+V102+'" xmlns:wpml="'+V106+'"');
  assert.throws(()=>parseXml(duplicated),/duplicate attribute/);
  assert.throws(()=>parseXml(t,'http://www.dji.com/wpmz/1.0.7'),/unsupported WPML namespace profile/);
  assert.equal(auditReferenceKmz(kmz(duplicated,w)).reviewStatus,'blocked');
});
test('unrecognized URI, including tiny spelling changes, never treated as documented version',()=>{
  const {templateXml:t,waylinesXml:w}=documentPair();
  for(const uri of ['http://www.dji.com/wpmz/1.0.7',
    'https://www.dji.com/wpmz/1.0.2','http://www.dji.com/wpml/1.0.2']){
    const rewrite=xml=>xml.replace(V102,uri);
    const result=auditReferenceKmz(kmz(rewrite(t),rewrite(w)));
    assert.equal(result.reviewStatus,'blocked');
    assert.equal(result.offlineValid,null);
    assert.equal(result.inspectionMode,'not-inspected');
    assert.deepEqual(result.findings,['WPML_NAMESPACE_NOT_VALIDATED_BY_SKYHUB']);
  }
});
test('read-only inspection preserves original KMZ bytes, never exports rewritten version',()=>{
  const {templateXml:t,waylinesXml:w}=documentPair();
  const original=kmz(alternate(t),alternate(w));
  const copy=Buffer.from(original);
  const report=auditReferenceKmz(original);
  assert.deepEqual(original,copy);
  assert.equal(report.inspectionMode,'explicit-alternate-namespace-read-only');
  const emitted=JSON.stringify(report);
  assert.doesNotMatch(emitted,/Private flight|49\.12345|8\.56789|<kml|ellipsoidHeight>50/);
  assert.equal(report.missionDispatchEnabled,false);
});
