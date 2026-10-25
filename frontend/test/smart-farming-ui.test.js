'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {normalizeCatalog,format,mount,allowsBearerOrigin}=require('../public/smart-farming-ui');
const id='m3m-exp-'+('a'.repeat(24));
const base=()=>({
  schema:'skyhub-m3m-smart-farming-catalog-api-v1',
  readOnly:true,experimental:true,count:1,
  candidates:[{candidateId:id,state:'experimental_candidate',
    experimental:true,readOnly:true,mapTilesAvailable:false,
    recordSha256VerifiedAtRead:true,rasterQaRecheckedAtRead:false,
    radiometricCalibrationVerified:false,operationalUseAllowed:false,
    prescriptionExportAllowed:false,flightMissionAllowed:false,
    indices:['ndvi','ndre','gndvi','osavi'].map(index=>({
      index,title:index.toUpperCase(),validPixels:42,mean:.25,min:.1,max:.4,
      experimental:true,mapTilesAvailable:false}))
  }]
});
const refuses=change=>assert.throws(()=>normalizeCatalog(change(base())),/INVALID_CATALOG/);
test('conservative four-index view model accepts only experimental metadata',()=>{
  const raw=base();raw.candidates[0].secret='/private/data.tif';
  raw.candidates[0].indices[0].tileUrl='https://example.invalid/secret';
  const data=normalizeCatalog(raw);
  assert.equal(data.length,1);
  assert.deepEqual(data[0].indices.map(x=>x.index),['ndvi','ndre','gndvi','osavi']);
  assert.equal(data[0].indices[0].count,42);
  assert.equal(JSON.stringify(data).includes('private'),false);
  assert.equal(JSON.stringify(data).includes('example.invalid'),false);
});
test('float32 nearly constant means tolerate bounded numerical rounding only',()=>{
  const r=base();
  r.candidates[0].indices[0].min=0.25;
  r.candidates[0].indices[0].max=0.25;
  r.candidates[0].indices[0].mean=0.24999996;
  assert.equal(normalizeCatalog(r).length,1);
  r.candidates[0].indices[0].mean=0.249;
  assert.throws(()=>normalizeCatalog(r),/INVALID_CATALOG/);
});
test('empty experimental catalog is permitted',()=>{
  const doc=base();doc.candidates=[];doc.count=0;
  assert.deepEqual(normalizeCatalog(doc),[]);
});
test('wrong schema refused',()=>refuses(x=>(x.schema='unsupported',x)));
test('count mismatch refused',()=>refuses(x=>(x.count=2,x)));
test('wrong permission refused',()=>refuses(x=>(x.candidates[0].operationalUseAllowed=true,x)));
test('false radiometric claim refused',()=>refuses(x=>(x.candidates[0].radiometricCalibrationVerified=true,x)));
test('unverified record hash refused',()=>refuses(x=>(x.candidates[0].recordSha256VerifiedAtRead=false,x)));
test('falsely claimed full raster check refused',()=>refuses(x=>(x.candidates[0].rasterQaRecheckedAtRead=true,x)));
test('untrusted tile availability refused',()=>refuses(x=>(x.candidates[0].indices[0].mapTilesAvailable=true,x)));
test('unexpected index order refused',()=>refuses(x=>(x.candidates[0].indices.reverse(),x)));
test('invalid candidate identifier refused',()=>refuses(x=>(x.candidates[0].candidateId='../private',x)));
test('NaN in index mean refused',()=>refuses(x=>(x.candidates[0].indices[0].mean=NaN,x)));
test('invalid pixel count refused',()=>refuses(x=>(x.candidates[0].indices[0].validPixels=-1,x)));
test('contradictory statistics refused',()=>refuses(x=>(x.candidates[0].indices[0].max=.01,x)));
test('duplicate IDs refused',()=>{
  const r=base();r.candidates.push(JSON.parse(JSON.stringify(r.candidates[0])));r.count=2;
  assert.throws(()=>normalizeCatalog(r),/INVALID_CATALOG/);
});
test('German number formatter never treats invalid values as measurements',()=>{
  assert.equal(format(NaN),'—');
  assert.equal(format(Infinity),'—');
  assert.match(format(0.5),/0,500/);
});
test('UI source never persists token or injects catalog HTML',()=>{
  const src=fs.readFileSync(path.resolve(__dirname,'../public/smart-farming-ui.js'),'utf8');
  assert.doesNotMatch(src,/innerHTML|outerHTML|localStorage|sessionStorage|document\.cookie|eval\(/);
  assert.match(src,/token\.value=''/);
  assert.match(src,/credentials:'same-origin'/);
  assert.match(src,/cache:'no-store'/);
});
test('Smart Farming page is separate and includes no geospatial tile/map renderer',()=>{
  const src=fs.readFileSync(path.resolve(__dirname,'../public/smart-farming.html'),'utf8');
  assert.match(src,/href="\/"/);
  assert.match(src,/smart-farming-ui\.js/);
  assert.match(src,/type="password"/);
  assert.match(src,/Nicht kalibriert/);
  assert.doesNotMatch(src,/leaflet|mapbox|<iframe|<img|<form[^>]*action/i);
});
test('main dashboard has a discoverable navigation link',()=>{
  const src=fs.readFileSync(path.resolve(__dirname,'../public/index.html'),'utf8');
  assert.match(src,/href="\/smart-farming.html"/);
  assert.match(src,/aria-label="SkyHub-Module"/);
});

test('M3M access-token transport rejects unencrypted LAN and credential-bearing origins',()=>{
  for(const url of [
    'https://rpi5.fritz.box',
    'https://rpi5.fritz.box:8443',
    'http://localhost:4001',
    'http://127.0.0.1:4001',
    'http://[::1]:4001'
  ])assert.equal(allowsBearerOrigin(url),true,url);
  for(const url of [
    'http://192.168.178.63:4001',
    'http://rpi5.fritz.box',
    'http://host.docker.internal',
    'ftp://localhost',
    'https://user:password@rpi5.fritz.box',
    'https://rpi5.fritz.box/private',
    '',
    null
  ])assert.equal(allowsBearerOrigin(url),false,String(url));
  const src=fs.readFileSync(path.resolve(__dirname,'../public/smart-farming-ui.js'),'utf8');
  assert.match(src,/if\(!allowsBearerOrigin\(global\?\.location\?\.origin\)\)/);
  assert.match(src,/token\.value='';\s*setStatus\(doc,'Katalog-Token nur über HTTPS/);
});


// Exercise the actual browser click handler with a minimal DOM rather than
// relying on a regex against the origin helper; no outbound network.
function browserHarness(origin, transport){
  const source=fs.readFileSync(path.resolve(__dirname,'../public/smart-farming-ui.js'),'utf8');
  const browser={location:{origin},fetch:transport};
  vm.runInNewContext(source,{window:browser,URL,AbortController});
  const nodes=new Map();
  function node(id){
    const el={value:'',disabled:false,hidden:false,textContent:'',
      dataset:{},handlers:{},children:[],
      addEventListener(type,fn){this.handlers[type]=fn},
      replaceChildren(...children){this.children=children},
      click(){return this.handlers.click?.()}};
    nodes.set(id,el);return el;
  }
  for(const id of ['catalogToken','loadCatalog','clearCatalog','catalogStatus',
    'candidateList','layerGrid','candidateDetails','catalogCount'])node(id);
  const doc={getElementById:id=>nodes.get(id)};
  browser.SkyHubSmartFarming.mount(doc,transport);
  return {nodes,token:nodes.get('catalogToken'),load:nodes.get('loadCatalog'),
    status:nodes.get('catalogStatus'),forget:nodes.get('clearCatalog')};
}
test('browser click NEVER transmits Bearer token from insecure LAN origin',async()=>{
  let calls=0;
  const h=browserHarness('http://192.168.178.63:4001',async()=>{
    calls++;throw new Error('Network must never be reached');
  });
  h.token.value='private-catalog-token';
  await h.load.click();
  assert.equal(calls,0);
  assert.equal(h.token.value,'');
  assert.match(h.status.textContent,/HTTPS.*Loopback/);
  assert.equal(h.status.dataset.kind,'error');
  assert.equal(h.load.disabled,false);
});
test('HTTPS catalog request refuses redirects, never exposes Referrer and clears token',async()=>{
  let requests=0;
  const h=browserHarness('https://rpi5-pironman.example:9445',async(url,opts)=>{
    requests++;
    assert.equal(url,'/api/smart-farming/candidates/');
    assert.equal(opts.method,'GET');
    assert.equal(opts.cache,'no-store');
    assert.equal(opts.credentials,'same-origin');
    assert.equal(opts.redirect,'error');
    assert.equal(opts.referrerPolicy,'no-referrer');
    assert.equal(opts.headers.Authorization,'Bearer ephemeral-test-secret');
    // Real fetch rejects a 3xx when redirect:error; simulate that rejection.
    throw new TypeError('Redirect refused');
  });
  h.token.value='ephemeral-test-secret';
  await h.load.click();
  assert.equal(requests,1);
  assert.equal(h.token.value,'');
  assert.equal(h.status.dataset.kind,'error');
  assert.match(h.status.textContent,/nicht geladen/);
  assert.equal(h.load.disabled,false);
});
test('SSH loopback HTTP remains usable, token is erased after auth failure',async()=>{
  let count=0;
  const h=browserHarness('http://127.0.0.1:4001',async(_url,opts)=>{
    count++;
    assert.equal(opts.redirect,'error');
    assert.equal(opts.headers.Authorization,'Bearer local-secret');
    return {ok:false,status:401};
  });
  h.token.value='local-secret';
  await h.load.click();
  assert.equal(count,1);
  assert.equal(h.token.value,'');
  assert.match(h.status.textContent,/Token ungültig/);
  h.forget.click();
  assert.equal(h.status.dataset.kind,'normal');
});
