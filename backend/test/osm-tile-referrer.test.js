'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const ROOT=path.resolve(__dirname,'../../frontend/public');
const load=name=>fs.readFileSync(path.join(ROOT,name),'utf8');

test('OSM browser tile layer uses only official host and an origin-only Referer',()=>{
  for(const page of ['wpml-editor.js','wpml-survey-preview.js']){
    const src=load(page);
    assert.match(src,/L\.tileLayer\('https:\/\/tile\.openstreetmap\.org\/\{z\}\/\{x\}\/\{y\}\.png'/);
    assert.match(src,/referrerPolicy:'strict-origin-when-cross-origin'/);
    assert.match(src,/attribution:'© OpenStreetMap contributors'/);
    assert.doesNotMatch(src,/\{s\}\.tile\.openstreetmap\.org/);
  }
});

test('OSM map documents use origin-only policy while sensitive APIs remain private',()=>{
  for(const html of ['wpml-editor.html','wpml-survey-preview.html']){
    assert.match(load(html),/<meta name="referrer" content="strict-origin-when-cross-origin">/);
  }
  const server=fs.readFileSync(path.resolve(__dirname,'../server.js'),'utf8');
  assert.match(server,/res\.set\('Referrer-Policy','no-referrer'\)/);
  assert.match(server,/app\.use\(mapPageReferrerPolicy\)/);
});

test('main dashboard remains on the same OSM tile host and opt-in tile policy',()=>{
  const src=load('index.html');
  assert.match(src,/https:\/\/tile\.openstreetmap\.org\/\{z\}\/\{x\}\/\{y\}\.png/);
  assert.match(src,/referrerPolicy:'strict-origin-when-cross-origin'/);
});
