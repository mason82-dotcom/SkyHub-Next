'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {listCandidates, readRegistry, createSmartFarmingCatalogRouter, CatalogError} = require('../smart-farming-catalog');
const digest = text => crypto.createHash('sha256').update(text).digest('hex');
function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'skyhub-m3m-catalog-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const pin='ab'.repeat(32);
  const candidateId='m3m-exp-'+digest(Buffer.from(pin,'hex')).slice(0,24);
  const candidate = {
    schema:'skyhub-m3m-smart-farming-candidate-v1', candidateId,
    state:'experimental_candidate', classification:'locally-verified-integrity-not-radiometric-validity',
    indexCount:4,
    indexLayers:['ndvi','ndre','gndvi','osavi'].map(index=>({index,title:index.toUpperCase(),
      validPixels:90,mean:0.25,min:0.1,max:0.4,unit:'dimensionless',mapTilesAvailable:false})),
    integrity:{receiptSha256:pin,rasterQaPassedAtRegistration:true,sealedArtifactsMatched:11},
    cameraProvenanceVerified:false,radiometricCalibrationVerified:false,
    bandCoregistrationVerified:false,reflectanceReady:false,ndviReady:false,ndreReady:false,
    operationalUseAllowed:false,prescriptionExportAllowed:false,flightMissionAllowed:false,
    geolocationPublished:false,tileUrlsPublished:false,
    privatePath:'/SENSITIVE/PATH',gps:{lat:51.23,lon:8.54},token:'DO_NOT_LEAK'
  };
  const entries=path.join(root,'entries'), slot=path.join(entries,'demo');
  fs.mkdirSync(slot,{recursive:true});
  const file=path.join(slot,'candidate.json');
  const registryFile=path.join(root,'catalog-manifest.json');
  function saveCandidate(){const bytes=JSON.stringify(candidate)+'\n'; fs.writeFileSync(file,bytes);return digest(bytes)}
  const registry={schema:'skyhub-m3m-smart-farming-catalog-manifest-v1',entries:[{candidateId,slot:'demo',candidateSha256:saveCandidate()}]};
  function saveRegistry(){const bytes=JSON.stringify(registry)+'\n';fs.writeFileSync(registryFile,bytes);return digest(bytes)}
  const options={root,manifestSha256:saveRegistry()};
  function repin(){registry.entries[0].candidateSha256=saveCandidate();options.manifestSha256=saveRegistry()}
  return {root,candidate,candidateId,registry,options,file,registryFile,saveRegistry,repin};
}

test('pinned catalog exposes four sanitized experimental layers only',t=>{
  const f=fixture(t);const records=listCandidates(f.options);
  assert.equal(records.length,1);
  const card=records[0];
  assert.equal(card.candidateId,f.candidateId);
  assert.deepEqual(card.indices.map(x=>x.index),['ndvi','ndre','gndvi','osavi']);
  assert.equal(card.rasterQaRecheckedAtRead,false);
  assert.equal(card.recordSha256VerifiedAtRead,true);
  assert.equal(card.operationalUseAllowed,false);
  for(const secret of ['SENSITIVE','DO_NOT_LEAK','gps','token','receiptSha256','privatePath'])
    assert.equal(JSON.stringify(card).includes(secret),false);
});
test('modification of pinned candidate fails closed',t=>{
  const f=fixture(t); f.candidate.indexLayers[0].mean=0.3;
  fs.writeFileSync(f.file,JSON.stringify(f.candidate)+'\n');
  assert.throws(()=>listCandidates(f.options),CatalogError);
});
test('tampered manifest fails against independent SHA pin',t=>{
  const f=fixture(t);f.registry.entries.push({...f.registry.entries[0],slot:'duplicate'});
  f.saveRegistry();assert.throws(()=>readRegistry(f.options),CatalogError);
});
test('malformed manifest ID is refused even if repinned',t=>{
  const f=fixture(t);f.registry.entries[0].candidateId='../escape';
  f.options.manifestSha256=f.saveRegistry();assert.throws(()=>listCandidates(f.options),CatalogError);
});
test('duplicated JSON keys in manifest are rejected even when repinned',t=>{
  const f=fixture(t);
  const text=JSON.stringify(f.registry).replace('"entries":','"schema":"hidden","entries":')+'\n';
  fs.writeFileSync(f.registryFile,text);f.options.manifestSha256=digest(text);
  assert.throws(()=>listCandidates(f.options),CatalogError);
});
test('repeated candidate IDs are rejected',t=>{
  const f=fixture(t);f.registry.entries.push({...f.registry.entries[0],slot:'demo2'});
  f.options.manifestSha256=f.saveRegistry();assert.throws(()=>listCandidates(f.options),CatalogError);
});
test('symlink candidate file is refused',t=>{
  const f=fixture(t);fs.renameSync(f.file,f.file+'.source');fs.symlinkSync(f.file+'.source',f.file);
  assert.throws(()=>listCandidates(f.options));
});
test('candidate file hardlink is refused',t=>{
  const f=fixture(t);fs.linkSync(f.file,path.join(f.root,'extra'));
  assert.throws(()=>listCandidates(f.options),CatalogError);
});
test('root symlink is refused',t=>{
  const f=fixture(t);fs.symlinkSync(f.root,f.root+'-link','dir');
  assert.throws(()=>listCandidates({...f.options,root:f.root+'-link'}),CatalogError);
  fs.unlinkSync(f.root+'-link');
});
test('forged readiness is rejected even when attacker re-pins files',t=>{
  const f=fixture(t);f.candidate.prescriptionExportAllowed=true;f.repin();
  assert.throws(()=>listCandidates(f.options),CatalogError);
});
test('false raster-integrity claim is rejected even if repinned',t=>{
  const f=fixture(t);f.candidate.integrity.rasterQaPassedAtRegistration=false;f.repin();
  assert.throws(()=>listCandidates(f.options),CatalogError);
});
test('candidate ID must be derived from pinned seal',t=>{
  const f=fixture(t);f.candidate.integrity.receiptSha256='cd'.repeat(32);f.repin();
  assert.throws(()=>listCandidates(f.options),CatalogError);
});
test('unexpected raster tile URL is never exposed',t=>{
  const f=fixture(t);f.candidate.indexLayers[0].tileUrl='https://example.invalid/private';f.repin();
  assert.equal(JSON.stringify(listCandidates(f.options)).includes('example.invalid'),false);
});
test('index count, stats and index type fail closed',t=>{
  const f=fixture(t);f.candidate.indexLayers[0].validPixels=-1;f.repin();
  assert.throws(()=>listCandidates(f.options),CatalogError);
});
test('float32 constant-index mean rounding is tolerated but large drift is refused',t=>{
  const f=fixture(t);
  f.candidate.indexLayers[0].min=0.25;
  f.candidate.indexLayers[0].max=0.25;
  f.candidate.indexLayers[0].mean=0.24999996;
  f.repin();
  assert.equal(listCandidates(f.options).length,1);
  f.candidate.indexLayers[0].mean=0.249;
  f.repin();
  assert.throws(()=>listCandidates(f.options),CatalogError);
});
test('empty pinned manifest returns an empty list',t=>{
  const f=fixture(t);f.registry.entries=[];f.options.manifestSha256=f.saveRegistry();
  assert.deepEqual(listCandidates(f.options),[]);
});
test('router refuses missing authentication even with valid manifest',t=>{
  const f=fixture(t);const express={Router:()=>({use(){},get(){}})};
  assert.throws(()=>createSmartFarmingCatalogRouter({express,root:f.root,
    manifestSha256:f.options.manifestSha256}),CatalogError);
});
test('router registers auth before routes and returns redacted only',t=>{
  const f=fixture(t);const events=[];
  const router={use:(fn)=>events.push(['use',fn]),get:(p,fn)=>events.push(['get',p,fn])};
  const express={Router:()=>router};
  const auth=(req,res,next)=>next();
  assert.equal(createSmartFarmingCatalogRouter({express,auth,...f.options}),router);
  assert.equal(events[0][0],'use');assert.equal(events[0][1],auth);
  assert.equal(events[1][0],'use'); // transport guard before response headers
  assert.equal(events[3][1],'/');assert.equal(events[4][1],'/:candidateId');
  const res={statusCode:200, body:null, json(body){this.body=body;return this}, status(n){this.statusCode=n;return this},sendStatus(n){this.statusCode=n;return this}};
  events[3][2]({},res);assert.equal(res.body.count,1);
  assert.equal(JSON.stringify(res.body).includes('SENSITIVE'),false);
});
test('router does not expose missing or arbitrary candidate names',t=>{
  const f=fixture(t);const events=[];const router={use(){},get:(p,fn)=>events.push([p,fn])};
  createSmartFarmingCatalogRouter({express:{Router:()=>router},auth:(_a,_b,next)=>next(),...f.options});
  const res={statusCode:200,sendStatus(n){this.statusCode=n;return this},json(body){this.body=body;return this},status(n){this.statusCode=n;return this}};
  events[1][1]({params:{candidateId:'../secret'}},res);assert.equal(res.statusCode,404);
  events[1][1]({params:{candidateId:'m3m-exp-'+('0'.repeat(24))}},res);assert.equal(res.statusCode,404);
});
test('router fails closed on corrupted registry and does not leak filename',t=>{
  const f=fixture(t);const events=[];const router={use(){},get:(p,fn)=>events.push([p,fn])};
  createSmartFarmingCatalogRouter({express:{Router:()=>router},auth:(_a,_b,next)=>next(),...f.options});
  fs.writeFileSync(f.registryFile,'{}');
  const res={statusCode:200,status(n){this.statusCode=n;return this},json(body){this.body=body;return this}};
  events[0][1]({},res);assert.equal(res.statusCode,503);
  assert.equal(JSON.stringify(res.body).includes(f.root),false);
});
