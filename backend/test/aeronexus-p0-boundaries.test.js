'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'../..');
test('AeroNexus integration P0 pins both repositories and prevents parallel stack migration',()=>{
  const doc=fs.readFileSync(path.join(root,'docs/aeronexus-integration-matrix-2026-11-02.md'),'utf8');
  for(const ref of ['535e26a1718d87d1629ee0b7ab42d16baae618d0',
    '7d9f52a5260bd9d5f0528eafa16e59fd142f33dd',
    'PR #265','P1','P2','P3','P4','P5','Keine zweite MinIO-Instanz']) assert.ok(doc.includes(ref),ref);
  const server=fs.readFileSync(path.join(root,'backend/server.js'),'utf8');
  assert.doesNotMatch(server,/aeronexusadvanced|aeronexus-p0/i);
});
