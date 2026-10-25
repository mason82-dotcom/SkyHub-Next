'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {mapPageReferrerPolicy,MAP_REFERRER_POLICY}=
  require('../map-page-referrer');

const publicDir=path.resolve(__dirname,'../../frontend/public');
const backendDir=path.resolve(__dirname,'..');
const pages=['/wpml-editor.html','/wpml-survey-preview.html'];
function run(url,method='GET'){
  const headers={'referrer-policy':'no-referrer'};
  let called=0;
  const req={method,path:url};
  const res={set:(name,value)=>{headers[name.toLowerCase()]=value;return res;}};
  mapPageReferrerPolicy(req,res,()=>{called++;});
  assert.equal(called,1);
  return headers['referrer-policy'];
}

test('OSM map documents may transmit only their origin as Referer',()=>{
  for(const page of pages){
    assert.equal(run(page),MAP_REFERRER_POLICY);
    assert.equal(run(page,'HEAD'),MAP_REFERRER_POLICY);
    const html=fs.readFileSync(path.join(publicDir,page.slice(1)),'utf8');
    assert.match(html,/<meta name="referrer" content="strict-origin-when-cross-origin">/);
  }
});

test('all non-map and sensitive routes retain no-referrer',()=>{
  for(const url of ['/', '/index.html','/smart-farming.html',
    '/wpml-route-library.html','/pilot-login','/pilot-login.js',
    '/api/devices','/api/pilot/bootstrap','/map/api/v1/workspaces/x/element-groups',
    '/media-gallery.html','/wpml-editor.js','/wpml-survey-preview.js']){
    assert.equal(run(url),'no-referrer',url);
  }
  for(const page of pages){
    for(const method of ['POST','PUT','DELETE'])
      assert.equal(run(page,method),'no-referrer',method+' '+page);
  }
});

test('Leaflet uses HTTPS official tiles, visible attribution and per-tile policy',()=>{
  for(const page of pages){
    const js=fs.readFileSync(path.join(publicDir,page.replace('.html','.js').slice(1)),'utf8');
    assert.match(js,/https:\/\/tile\.openstreetmap\.org\/\{z\}\/\{x\}\/\{y\}\.png/);
    assert.match(js,/referrerPolicy:'strict-origin-when-cross-origin'/);
    assert.match(js,/attribution:'© OpenStreetMap contributors'/);
  }
});

test('main API still initializes no-referrer before scoped exception',()=>{
  const source=fs.readFileSync(path.join(backendDir,'server.js'),'utf8');
  const global=source.indexOf("res.set('Referrer-Policy','no-referrer')");
  const scoped=source.indexOf('app.use(mapPageReferrerPolicy)');
  const auth=source.indexOf("app.use('/api',auth)");
  const staticServe=source.indexOf('app.use(express.static(');
  assert.ok(global>=0 && scoped>global && auth>scoped && staticServe>auth);
});
