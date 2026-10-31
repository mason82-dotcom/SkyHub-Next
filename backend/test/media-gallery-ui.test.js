'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ROOT=path.resolve(__dirname,'../../frontend/public');
const file=name=>fs.readFileSync(path.join(ROOT,name),'utf8');
const M=require('../../frontend/public/media-library-model');

const raw=[
  {key:'wayline/DJI_20261002165548_0001_V.JPG',size:7516160,lastModified:'2026-10-03T08:00:00.000Z'},
  {key:'wayline/DJI_20261001224903_0001_T.JPG',size:1290240,lastModified:'2026-10-03T08:00:00.000Z'},
  {key:'wayline/DJI_20261001223817_0001_MS_NIR.TIF',size:2000000,lastModified:'2026-10-03T08:00:00.000Z'},
  {key:'wayline/org_00e9af24aeb848f8_1729610684000.jpg',size:4050944,lastModified:'2026-10-03T08:00:00.000Z'},
  {key:'wayline/mission/clip.MP4',size:90000000,lastModified:'2026-10-05T10:00:00.000Z'},
  {key:'wayline/route.kmz',size:4000,lastModified:'2026-10-01T10:00:00.000Z'},
  {key:'ppk/a/b/DJI_202504271730_001.MRK',size:1000,lastModified:'2025-04-28T10:00:00.000Z'},
  {key:'readme.txt',size:10,lastModified:'2026-10-01T10:00:00.000Z'}
];

test('file kinds, DJI capture times and lens hints come from the object name',()=>{
  assert.equal(M.kind('a/IMG.JPG'),'image');
  assert.equal(M.kind('a/x.TIFF'),'tiff');
  assert.equal(M.kind('a/x.mov'),'video');
  assert.equal(M.kind('a/x.jpeg.exe'),'other');
  assert.equal(M.captureTime('DJI_20261002165548_0001_V.JPG'),new Date(2026,9,2,16,55,48).getTime());
  assert.equal(M.captureTime('org_00e9af24aeb848f8_1729610684000.jpg'),1729610684000);
  assert.equal(M.captureTime('photo.jpg'),null);
  assert.equal(M.lens('DJI_20261001224903_0001_T.JPG'),'Wärmebild');
  assert.equal(M.lens('DJI_20261001223817_0001_MS_NIR.TIF'),'Multispektral NIR');
  assert.equal(M.lens('holiday.jpg'),null);
});

test('folder view lists direct sub-folders with totals and the files of the folder',()=>{
  const items=M.normalizeAll(raw);
  const root=M.folder(items,'');
  assert.deepEqual(root.folders.map(f=>f.name),['ppk','wayline']);
  assert.deepEqual(root.files.map(f=>f.name),['readme.txt']);
  const wayline=root.folders.find(f=>f.name==='wayline');
  assert.equal(wayline.count,6);
  assert.equal(wayline.images,3);
  assert.equal(wayline.videos,1);
  assert.ok(wayline.cover.key.endsWith('_V.JPG'));
  const inner=M.folder(items,'wayline/');
  assert.deepEqual(inner.folders.map(f=>f.prefix),['wayline/mission/']);
  assert.equal(inner.files.length,5);
  assert.deepEqual(M.crumbs('ppk/a/b/').map(c=>c.prefix),['ppk/','ppk/a/','ppk/a/b/']);
});

test('search, type filter and sorting cover the complete bucket',()=>{
  const items=M.normalizeAll(raw);
  assert.equal(M.filter(items,{type:'image'}).length,3);
  assert.equal(M.filter(items,{query:'wayline 20261001'}).length,2);
  assert.equal(M.filter(M.within(items,'ppk/'),{}).length,1);
  assert.deepEqual(M.sort(items,'size-desc').map(i=>i.size)[0],90000000);
  assert.equal(M.sort(items,'newest')[0].name,'clip.MP4');
  assert.equal(M.sort(M.filter(items,{type:'image'}),'newest')[0].name,'DJI_20261002165548_0001_V.JPG');
  assert.throws(()=>M.filter(items,{type:'exe'}));
  assert.throws(()=>M.sort(items,'random'));
  const c=M.counts(items);
  assert.deepEqual([c.all,c.image,c.video,c.tiff,c.other],[8,3,1,1,3]);
  assert.equal(M.normalizeAll([{key:''},null,{key:'x.jpg',size:-5}]).length,1);
});

test('Pilot 2 uploads show the DJI file name and stay searchable by both names',()=>{
  const item=M.normalize({key:'ws/media/s/org_c4ad6bf6a2680e67_1792649118000.jpg',size:10,
    displayName:'DJI_20261022080518_0001_T.JPG',capturedAt:'2026-10-22T08:05:18+02:00'});
  assert.equal(item.name,'DJI_20261022080518_0001_T.JPG');
  assert.equal(item.storedName,'org_c4ad6bf6a2680e67_1792649118000.jpg');
  assert.equal(item.lens,'Wärmebild');
  assert.equal(item.captured,new Date(2026,9,22,8,5,18).getTime());
  assert.equal(M.filter([item],{query:'_T.JPG'}).length,1);
  assert.equal(M.filter([item],{query:'org_c4ad'}).length,1);
  assert.equal(M.normalize({key:'a/x.jpg',displayName:'../evil'}).name,'x.jpg');
});

test('preview URLs use the read-only media API with encoded parameters',()=>{
  assert.equal(M.fileUrl('dji-cloud','a b/ü.jpg'),'/api/media/file?bucket=dji-cloud&key=a+b%2F%C3%BC.jpg');
  assert.match(M.fileUrl('farming','x.png',{download:true}),/&download=1$/);
  assert.equal(M.thumbUrl('dji-cloud','a.jpg'),'/api/media/thumb?bucket=dji-cloud&key=a.jpg');
  assert.equal(M.canPreviewDirectly(M.normalize({key:'a.png',size:1000})),true);
  assert.equal(M.canPreviewDirectly(M.normalize({key:'a.jpg',size:9000000})),false);
  assert.equal(M.canPreviewDirectly(M.normalize({key:'a.tif',size:10})),false);
});

test('gallery page asks for no token or password and renders without innerHTML',()=>{
  const html=file('media-gallery.html'),app=file('media-gallery-app.js');
  new vm.Script(app);new vm.Script(file('media-library-model.js'));
  assert.doesNotMatch(html,/type="password"|token|Passwort/i);
  assert.doesNotMatch(app,/Authorization|X-Auth-Token|localStorage|sessionStorage|innerHTML|eval\s*\(/);
  assert.match(app,/\/api\/media\/summary/);
  assert.match(app,/\/api\/media\/index\?/);
  for(const id of ['stats','buckets','search','types','sort','view-folders','view-all',
    'crumbs','folders','files','viewer','viewer-stage','viewer-download','viewer-prev','viewer-next']){
    assert.ok(html.includes('id="'+id+'"'),id);
  }
  assert.match(html,/name="referrer" content="no-referrer"/);
  assert.doesNotMatch(html,/type="file"|<iframe\b/i);
});

test('no page of the web UI contains a token or password prompt',()=>{
  for(const name of ['index.html','media-gallery.html','smart-farming.html','pilot-login.html',
    'wpml-editor.html','wpml-route-library.html','wpml-survey-preview.html']){
    assert.doesNotMatch(file(name),/type="password"/,name);
  }
});

test('media navigation exists on all five existing workspace pages',()=>{
  for(const name of ['index.html','wpml-editor.html','wpml-route-library.html',
    'wpml-survey-preview.html','smart-farming.html']){
    assert.match(file(name),/href="\/media-gallery\.html">Medien<\/a>/);
  }
});
