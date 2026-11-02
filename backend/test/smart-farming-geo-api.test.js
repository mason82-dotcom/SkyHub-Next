'use strict';
// Synthetic loopback HTTP tests; no raster files, S3, DJI, Pi or public listeners.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const {createSmartFarmingGeoRouter} = require('../smart-farming-geo-api');
const ID = 'm3m-exp-' + 'a1'.repeat(12);
const TOKEN = 'unit-test-private-gis-token-01234567890';
const layers = ['red', 'green', 'red_edge', 'nir', 'ndvi', 'ndre', 'gndvi', 'osavi'];

function sourceReport(kind = 'Point') {
  return {
    schema: 'skyhub-m3m-private-geospatial-query-v1',
    geometryType: kind, inputCrs: 'WGS84', queryPixels: 3,
    numericalValuesNotFromPng: true, fullBundleIntegrityRecheckedAfterRead: true,
    coordinatesPublished: false, rasterTilesPublished: false,
    radiometricCalibrationVerified: false, bandCoregistrationVerified: false,
    reflectanceReady: false, ndviReady: false, ndreReady: false,
    operationalUseAllowed: false, prescriptionExportAllowed: false,
    flightMissionAllowed: false,
    // Untrusted fields must never pass into client JSON.
    privatePath: '/sensitive/source/image.tif',
    coordinateLeak: [9.1353, 49.3420],
    statistics: Object.fromEntries(layers.map(name => [name, {
      validPixels: 2, maskedOrNoDataPixels: 1, min: .2, max: .6,
      mean: .4, median: .4, p10: .24, p90: .56, stddev: .2,
      secret: '/some/private/path',
    }]))
  };
}
const reqPoint = {schema: 'skyhub-m3m-geospatial-request-v1',
  geometry: {type: 'Point', coordinates: [9.1353, 49.3420]}};
const reqPolygon = {schema: 'skyhub-m3m-geospatial-request-v1',
  geometry: {type: 'Polygon', coordinates: [[
    [9.134,49.341],[9.136,49.341],[9.136,49.343],[9.134,49.343],[9.134,49.341],
  ]]}};
const headers = {'Authorization':'Bearer '+TOKEN,'Content-Type':'application/json'};
function build(t, opts = {}) {
  const events = [];
  const authenticate = opts.authenticate || ((req, res, next) => {
    if (req.headers.authorization !== 'Bearer ' + TOKEN) return res.sendStatus(401);
    req.labPrincipal = {actorId: 'analyst-a', workspaceId: 'farm-one'};
    next();
  });
  const scopedPrincipal = opts.scopedPrincipal || (req => req.labPrincipal);
  const authorizeWorkspaceCandidate = opts.authorizeWorkspaceCandidate ||
    (async ({principal, candidateId}) => {
      events.push('authorize');
      return principal.workspaceId === 'farm-one' && candidateId === ID;
    });
  const sampleVerifiedBundle = opts.sampleVerifiedBundle ||
    (async ({geometry}) => { events.push('sample'); return sourceReport(geometry.type); });
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({limit: '64kb'}));
  app.use('/api/smart-farming/geo', createSmartFarmingGeoRouter({
    express, authenticate, scopedPrincipal, authorizeWorkspaceCandidate,
    sampleVerifiedBundle, maxConcurrent: opts.maxConcurrent || 2,
  }));
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise(resolve => server.close(resolve)));
  return {server, events, ready: async () => {
    if (!server.listening) await new Promise(resolve => server.once('listening', resolve));
    return 'http://127.0.0.1:' + server.address().port +
      '/api/smart-farming/geo/' + ID + '/sample';
  }};
}
async function post(url, data = reqPoint, extra = {}) {
  return fetch(url, {method:'POST',headers:{...headers,...extra},
    body: JSON.stringify(data)});
}
test('explicit auth + principal + per-candidate workspace allow required', async t => {
  const f = build(t);
  const url = await f.ready();
  const missing = await fetch(url, {method:'POST',
    headers:{'Content-Type':'application/json'}, body:JSON.stringify(reqPoint)});
  assert.equal(missing.status,401);
  assert.deepEqual(f.events, []);
  const accepted = await post(url);
  assert.equal(accepted.status,200);
  assert.equal(accepted.headers.get('cache-control'),'no-store');
  assert.equal(accepted.headers.get('x-content-type-options'),'nosniff');
  const data = await accepted.json();
  assert.equal(data.schema,'skyhub-m3m-geo-sample-http-v1');
  assert.equal(data.readOnly,true);
  assert.equal(data.reflectanceReady,false);
  assert.equal(data.statistics.ndvi.mean,.4);
  assert.equal(Object.keys(data.statistics).length,8);
  const raw = JSON.stringify(data);
  assert.ok(!raw.includes('/sensitive/') && !raw.includes('49.342') &&
    !raw.includes('privatePath') && !raw.includes('"coordinates"') &&
    !raw.includes('"secret"') && !raw.includes('workspaceId'));
  assert.deepEqual(f.events,['authorize','sample']);
});
test('unauthorized workspace never invokes scientific raster provider', async t => {
  const f = build(t,{scopedPrincipal:() => ({actorId:'analyst-b', workspaceId:'farm-other'})});
  const response = await post(await f.ready());
  assert.equal(response.status,404);
  assert.deepEqual(f.events,['authorize']);
});
test('missing principal denied even with matching bearer view token',async t => {
  const f = build(t,{scopedPrincipal:() => null});
  assert.equal((await post(await f.ready())).status,403);
  assert.deepEqual(f.events,[]);
});
test('strict body/content type/candidate/method bounds', async t => {
  const f = build(t);
  const url = await f.ready();
  for (const invalid of [
    {...reqPoint, path:'/etc/passwd'},
    {schema:'skyhub-m3m-geospatial-request-v1',geometry:{type:'Point',coordinates:[500,49]}},
    {schema:'skyhub-m3m-geospatial-request-v1',geometry:{type:'Point',coordinates:['9',49]}},
    {schema:'skyhub-m3m-geospatial-request-v1',geometry:{type:'MultiPolygon',coordinates:[]}},
    {schema:'skyhub-m3m-geospatial-request-v1',geometry:
      {type:'Polygon',coordinates:[[[9,49],[9.1,49],[9.1,49.1],[9,49]] ,[[9,49],[9,49.1],[9.1,49]]]}},
  ]) {
    const response = await post(url,invalid);
    assert.equal(response.status,400);
  }
  assert.deepEqual(f.events,[]);
  assert.equal((await fetch(url,{method:'GET',headers})).status,404);
  assert.equal((await post(url.replace(ID,'m3m-exp-'+'a'.repeat(24)),reqPoint)).status,404);
  assert.equal((await fetch(url,{method:'POST',headers:{...headers,'Content-Type':'text/plain'},
    body:JSON.stringify(reqPoint)})).status,415);
  const oversized = {...reqPoint, filler:'x'.repeat(18000)};
  assert.equal((await post(url,oversized)).status,413);
});
test('polygon response and double gate are shaped for experiment only',async t=>{
  const f=build(t);
  const res=await post(await f.ready(),reqPolygon);
  const value=await res.json();
  assert.equal(res.status,200);
  assert.equal(value.geometryType,'Polygon');
  assert.equal(value.operationalUseAllowed,false);
  assert.equal(value.prescriptionExportAllowed,false);
  assert.deepEqual(f.events,['authorize','sample']);
});
test('forged readyness and malformed numerical reports fail closed', async t=>{
  for(const mutate of [
    v=>{v.radiometricCalibrationVerified=true;},
    v=>{v.fullBundleIntegrityRecheckedAfterRead=false;},
    v=>{v.statistics.ndvi.mean=NaN;},
    v=>{v.statistics.ndvi.validPixels=17;},
    v=>{delete v.statistics.ndvi;},
    v=>{v.statistics.ndvi.p10=.8;},
    v=>{v.statistics.ndvi.secret='something'; v.statistics.ndvi.mean=10;},
  ]) {
    const f=build(t,{sampleVerifiedBundle:async()=>{const x=sourceReport();mutate(x);return x;}});
    const res=await post(await f.ready());
    assert.equal(res.status,503);
    const raw=await res.text();
    assert.ok(!raw.includes('source.tif'));
    assert.ok(!raw.includes('secret'));
  }
});
test('bounded concurrency returns 429 and releases capacity',async t=>{
  let unblock;
  const held=new Promise(resolve=>{unblock=resolve;});
  let started;
  const began=new Promise(resolve=>{started=resolve;});
  const f=build(t,{maxConcurrent:1,sampleVerifiedBundle:async()=>{
    started();
    await held;
    return sourceReport();
  }});
  const url=await f.ready();
  const one=post(url);
  await began;
  const two=await post(url);
  assert.equal(two.status,429);
  unblock();
  assert.equal((await one).status,200);
  assert.equal((await post(url)).status,200);
});

test('all independent trust callbacks are required before the router can exist', () => {
  const defaults = {
    express,
    authenticate: (_req, _res, next) => next(),
    scopedPrincipal: () => ({actorId:'analyst-a', workspaceId:'farm-one'}),
    authorizeWorkspaceCandidate: async () => true,
    sampleVerifiedBundle: async () => sourceReport(),
  };
  for (const field of ['authenticate','scopedPrincipal',
    'authorizeWorkspaceCandidate','sampleVerifiedBundle']) {
    const invalid = {...defaults};
    delete invalid[field];
    assert.throws(() => createSmartFarmingGeoRouter(invalid), /must be injected explicitly/);
  }
  assert.throws(() => createSmartFarmingGeoRouter({...defaults,maxConcurrent:0}),
    /Bounded concurrent GIS requests required/);
});
test('the experiment is never mounted or imported in the production HTTP server', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const server = fs.readFileSync(path.resolve(__dirname,'../server.js'),'utf8');
  assert.doesNotMatch(server, /smart-farming-geo-api/);
  assert.doesNotMatch(server, /\/api\/smart-farming\/geo/);
});
