'use strict';
// TRUE subprocess/GeoTIFF integration using synthetic, independently sealed rasters.
// Run only in isolated runner with Python 3.12 + numpy/rasterio installed.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const express = require('express');
const {createSmartFarmingGeoRouter} = require('../smart-farming-geo-api');
const {createPrivateRasterProvider} = require('../smart-farming-raster-provider');
const TOKEN = 'private-test-workspace-token-1234567890';
// Default main/backend CI deliberately has no optional Python raster wheels.
// Run this *real subprocess* suite only from the dedicated raster workflow.
const integrationTest = process.env.SKYHUB_M3M_REAL_RASTER_PROVIDER_TEST === '1' ? test : test.skip;

function makeFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skyhub-m3m-p3-http-'));
  t.after(() => fs.rmSync(root, {recursive:true, force:true}));
  fs.chmodSync(root, 0o700);
  const pythonExecutable = execFileSync('python', ['-c',
    'import sys;print(sys.executable)'], {encoding:'utf8'}).trim();
  const json = execFileSync(pythonExecutable, [
    path.resolve(__dirname, '../../tests/m3m_geo_http_fixture.py'),root
  ], {encoding:'utf8', timeout:20000, maxBuffer:65536});
  const fixture = JSON.parse(json);
  const scratchRoot = path.join(root,'scratch');
  fs.mkdirSync(scratchRoot,{mode:0o700});
  const candidateId = 'm3m-exp-' + crypto.createHash('sha256')
    .update(Buffer.from(fixture.sealSha256,'hex')).digest('hex').slice(0,24);
  return {...fixture, root, scratchRoot, pythonExecutable, candidateId};
}
function makeServer(t, cfg, {workspace='farm-one', tamperedRegistry=false} = {}) {
  const calls = [];
  const registry = Object.freeze({
    candidateId: cfg.candidateId,
    workspaceId: tamperedRegistry ? 'farm-other' : 'farm-one',
    bundleDir: cfg.bundleDir,
    sealFile: cfg.sealFile,
    sealSha256: cfg.sealSha256
  });
  const provider = createPrivateRasterProvider({
    pythonExecutable: cfg.pythonExecutable,
    sourceRoot: path.join(cfg.root, 'sources'),
    sealRoot: path.join(cfg.root, 'seals'),
    scratchRoot: cfg.scratchRoot,
    timeoutMs: 20000,
    resolveRegisteredAsset: async ({principal,candidateId}) => {
      calls.push('registry');
      assert.equal(candidateId, cfg.candidateId);
      assert.equal(principal.workspaceId, workspace);
      return registry;
    }
  });
  const app = express();
  app.use(express.json({limit:'16kb'}));
  app.use('/api/smart-farming/geo', createSmartFarmingGeoRouter({
    express,
    authenticate: (req,res,next) => {
      if (req.headers.authorization !== 'Bearer ' + TOKEN)
        return res.sendStatus(401);
      req.testPrincipal = {actorId:'analyst-a',workspaceId:workspace};
      next();
    },
    scopedPrincipal: req => req.testPrincipal,
    authorizeWorkspaceCandidate: async ({principal,candidateId}) => {
      calls.push('authorize');
      return principal.workspaceId === 'farm-one' && candidateId === cfg.candidateId;
    },
    sampleVerifiedBundle: provider,
    maxConcurrent: 1
  }));
  const server = app.listen(0,'127.0.0.1');
  t.after(() => new Promise(resolve => server.close(resolve)));
  return {server,calls,ready:async()=>{
    if (!server.listening) await new Promise(resolve=>server.once('listening',resolve));
    return 'http://127.0.0.1:'+server.address().port+
      '/api/smart-farming/geo/'+cfg.candidateId+'/sample';
  }};
}
async function post(url,geometry,token=TOKEN) {
  return fetch(url,{
    method:'POST',
    headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},
    body:JSON.stringify({schema:'skyhub-m3m-geospatial-request-v1',geometry})
  });
}
integrationTest('authorized HTTP -> real Python/Rasterio -> sealed numeric pixel response', async t => {
  const cfg=makeFixture(t), api=makeServer(t,cfg);
  const res=await post(await api.ready(),{type:'Point',coordinates:cfg.point});
  assert.equal(res.status,200);
  assert.equal(res.headers.get('cache-control'),'no-store');
  const data=await res.json();
  assert.equal(data.schema,'skyhub-m3m-geo-sample-http-v1');
  assert.equal(data.queryPixels,1);
  assert.equal(data.statistics.ndvi.validPixels,1);
  assert.ok(Math.abs(data.statistics.ndvi.mean - .5) < .00001);
  assert.ok(Math.abs(data.statistics.ndre.mean - .2) < .00001);
  assert.equal(data.statistics.red.mean, .20000000298023224);
  assert.equal(data.operationalUseAllowed,false);
  assert.equal(data.reflectanceReady,false);
  assert.equal(data.fullBundleIntegrityRecheckedAfterRead,true);
  assert.deepEqual(api.calls,['authorize','registry']);
  const raw=JSON.stringify(data);
  assert.ok(!raw.includes(cfg.root) && !raw.includes('coordinates') &&
    !raw.includes('sealSha256') && !raw.includes('actorId') &&
    !raw.includes(cfg.sealSha256));
  assert.deepEqual(fs.readdirSync(cfg.scratchRoot),[]);
});
integrationTest('authorized WGS84 polygon -> actual six-pixel raster statistics', async t => {
  const cfg=makeFixture(t), api=makeServer(t,cfg);
  const res=await post(await api.ready(),cfg.polygon);
  assert.equal(res.status,200);
  const data=await res.json();
  assert.equal(data.geometryType,'Polygon');
  assert.equal(data.queryPixels,6);
  assert.equal(data.statistics.ndvi.validPixels,5);
  assert.equal(data.statistics.ndvi.maskedOrNoDataPixels,1);
  assert.ok(Math.abs(data.statistics.ndvi.median - .5) < .00001);
  assert.deepEqual(api.calls,['authorize','registry']);
  assert.deepEqual(fs.readdirSync(cfg.scratchRoot),[]);
});
integrationTest('no authorization means no registry access and no worker',async t=>{
  const cfg=makeFixture(t), api=makeServer(t,cfg,{workspace:'farm-other'});
  const resp=await post(await api.ready(),{type:'Point',coordinates:cfg.point});
  assert.equal(resp.status,404);
  assert.deepEqual(api.calls,['authorize']);
  assert.deepEqual(fs.readdirSync(cfg.scratchRoot),[]);
});
integrationTest('view-token auth still mandatory before any asset lookup',async t=>{
  const cfg=makeFixture(t), api=makeServer(t,cfg);
  const resp=await post(await api.ready(),{type:'Point',coordinates:cfg.point},'wrong-token');
  assert.equal(resp.status,401);
  assert.deepEqual(api.calls,[]);
});
integrationTest('workspace mismatch in resolved entry is refused and temporary files removed',async t=>{
  const cfg=makeFixture(t), api=makeServer(t,cfg,{tamperedRegistry:true});
  const resp=await post(await api.ready(),{type:'Point',coordinates:cfg.point});
  assert.equal(resp.status,503);
  assert.deepEqual(api.calls,['authorize','registry']);
  assert.deepEqual(fs.readdirSync(cfg.scratchRoot),[]);
});
integrationTest('point outside raster is rejected and response hides geographic locations',async t=>{
  const cfg=makeFixture(t), api=makeServer(t,cfg);
  const resp=await post(await api.ready(),{type:'Point',coordinates:[0,0]});
  assert.equal(resp.status,503);
  const raw=await resp.text();
  assert.ok(!raw.includes(cfg.root) && !raw.includes('0,0') &&
    !raw.includes(cfg.sealSha256));
  assert.deepEqual(fs.readdirSync(cfg.scratchRoot),[]);
});
integrationTest('modified GeoTIFF is rejected by full seal/pixel QA (no raster result)',async t=>{
  const cfg=makeFixture(t), api=makeServer(t,cfg);
  fs.appendFileSync(path.join(cfg.bundleDir,'indices','ndvi.tif'),'tampered');
  const resp=await post(await api.ready(),{type:'Point',coordinates:cfg.point});
  assert.equal(resp.status,503);
  assert.deepEqual(fs.readdirSync(cfg.scratchRoot),[]);
});
integrationTest('independently pinned seal is required; forged seal never passes',async t=>{
  const cfg=makeFixture(t), api=makeServer(t,cfg);
  fs.appendFileSync(cfg.sealFile,'tampered');
  const resp=await post(await api.ready(),{type:'Point',coordinates:cfg.point});
  assert.equal(resp.status,503);
  assert.deepEqual(fs.readdirSync(cfg.scratchRoot),[]);
});
integrationTest('no spatial access via symlink outside source root',async t=>{
  const cfg=makeFixture(t), api=makeServer(t,cfg);
  const outside = path.join(cfg.root,'outside');
  fs.renameSync(cfg.bundleDir,outside);
  fs.symlinkSync(outside,cfg.bundleDir);
  const resp=await post(await api.ready(),{type:'Point',coordinates:cfg.point});
  assert.equal(resp.status,503);
  assert.deepEqual(fs.readdirSync(cfg.scratchRoot),[]);
});

test('the real Rasterio provider remains absent from production server bootstrap', () => {
  const server=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
  assert.doesNotMatch(server,/smart-farming-raster-provider/);
  assert.doesNotMatch(server,/smart-farming-geo-api/);
});
