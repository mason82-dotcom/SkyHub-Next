'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ROOT=path.resolve(__dirname,'../../frontend/public');
const file=name=>fs.readFileSync(path.join(ROOT,name),'utf8');
const V=require('../../frontend/public/media-gallery-verified-model');
const S=require('../../frontend/public/media-gallery-s3-model');
const WORKSPACE='e3dea0f5-37f2-4d79-ae58-490af3228069';
const ASSET='33670000-0000-4000-8000-000000000001';
function asset(status='head-at-ingestion'){
  return {id:ASSET,fileName:'DJI_20261022150000_0001_MS_R.TIF',
    fileSizeBytes:3072,fileGroupId:'group-1',mediaHint:'m3m-multispectral-filename',
    bandHint:'R',hintSource:'filename-only-unverified',
    verifiedAt:'2026-10-22T15:00:00.000Z',
    objectEvidence:{status,sizeBytes:3072,etag:'private-etag',
      lastModified:'2026-10-22T14:59:59.000Z'},
    storage:{bucket:'dji-cloud',objectKey:'private/workspace/SECRET_OBJECT'},
    pilotMetadata:{source:'pilot-upload-callback',
      fields:{shoot_position:{lat:49.12,lng:8.12},absolute_altitude:123}},
    imageInspection:{exif:'not-extracted',xmp:'not-extracted',rtk:'not-extracted',
      captureUuidConfirmed:false,m3mSourceVerified:false,
      bandCoregistrationVerified:false,radiometricCalibrationVerified:false,
      reflectanceReady:false,ndviReady:false,ndreReady:false}
  };
}
const wrap=data=>({code:0,message:'success',data});

test('verified Pilot 2 list is schema-bound and strips private keys, positions and ETag',()=>{
  const items=V.libraryList(wrap({schema:'skyhub-pilot-media-library-v1',
    verification:'s3-head-at-ingestion-not-rechecked',
    items:[asset()],nextCursor:null}),20).items;
  assert.equal(items.length,1);
  assert.equal(items[0].evidence,'head-at-ingestion');
  assert.equal(items[0].bandHint,'R');
  const printed=JSON.stringify(items);
  for(const forbidden of ['SECRET_OBJECT','private-etag','49.12','absolute_altitude','storage','pilotMetadata']){
    assert.ok(!printed.includes(forbidden),forbidden);
  }
  assert.ok(V.UUID.test(ASSET));
  assert.ok(V.UUID.test(WORKSPACE));
});

test('verified detail must result from a current HEAD recheck and reject readiness claims',()=>{
  const good=wrap({item:asset('head-rechecked')});
  assert.equal(V.detail(good,ASSET).evidence,'head-rechecked');
  assert.throws(()=>V.detail(wrap({item:asset()}),ASSET));
  assert.throws(()=>V.detail(good,'00000000-0000-4000-8000-000000000001'));
  const unsafe=asset();
  unsafe.imageInspection.ndviReady=true;
  assert.throws(()=>V.libraryList(wrap({
    schema:'skyhub-pilot-media-library-v1',
    verification:'s3-head-at-ingestion-not-rechecked',
    items:[unsafe],nextCursor:null
  }),20));
});

test('M3M group aggregates are bounded and cannot claim extracted/verified pixels',()=>{
  const response=wrap({
    schema:'skyhub-m3m-library-hints-v1',classification:'filename-hints-only',
    examined:5,sessionPartitions:1,classified:5,unrecognized:0,invalid:0,
    captureGroups:1,spectralSets:1,fiveChannelSets:1,partialSets:0,duplicateSets:0,
    bandCounts:{RGB:1,G:1,R:1,RE:1,NIR:1},
    captureUuidVerified:false,exifVerified:false,xmpVerified:false,
    bandCoregistrationVerified:false,radiometricCalibrationVerified:false,
    reflectanceReady:false,ndviReady:false,ndreReady:false
  });
  assert.equal(V.group(response).spectralSets,1);
  response.data.captureUuidVerified=true;
  assert.throws(()=>V.group(response));
});

test('S3 objects are validated independently and never represented as verified media',()=>{
  assert.deepEqual(S.buckets({buckets:['dji-cloud','farming']}),['dji-cloud','farming']);
  assert.throws(()=>S.buckets({buckets:['dji-cloud','PRIVATE_BUCKET']}));
  const data=S.page({bucket:'dji-cloud',prefix:'missions/',objects:[
    {key:'missions/image_01.TIF',size:2048,lastModified:'2026-10-25T00:00:00.000Z'}
  ],truncated:false,nextCursor:null},{bucket:'dji-cloud',prefix:'missions/',limit:50});
  assert.equal(data.items.length,1);
  assert.equal(data.items[0].bytes,2048);
  assert.deepEqual(Object.keys(data.items[0]),['name','bytes','modified']);
  assert.throws(()=>S.page({bucket:'private',prefix:'',objects:[],truncated:false,nextCursor:null},
    {bucket:'private',limit:50}));
});

test('standalone gallery requires both authorizations, uses GET only and no credential persistence',()=>{
  const html=file('media-gallery.html');
  for(const id of ['verified-view-token','verified-workspace','verified-token',
    'verified-list','verified-detail','verified-next','verified-group',
    'storage-token','storage-objects','storage-bucket','storage-prefix',
    'storage-next','verified-clear','storage-clear']){
    assert.ok(html.includes('id="'+id+'"'),id);
  }
  assert.match(html,/name="referrer" content="no-referrer"/);
  assert.match(html,/aria-live="polite"/);
  const verified=file('media-gallery-verified.js'),raw=file('media-gallery-s3.js');
  new vm.Script(verified);new vm.Script(raw);
  assert.match(verified,/Authorization:'Bearer '\+viewToken/);
  assert.match(verified,/'X-Auth-Token':token/);
  assert.match(raw,/Authorization:'Bearer '\+token/);
  for(const source of [verified,raw]){
    assert.match(source,/method:'GET'/);
    assert.match(source,/cache:'no-store'/);
    assert.doesNotMatch(source,/localStorage|sessionStorage|innerHTML|eval\s*\(|method:'POST'|method:'DELETE'/);
  }
  assert.doesNotMatch(html,/<img\b|type="file"|<iframe\b/i);
});

test('media navigation exists on all five existing workspace pages',()=>{
  for(const name of ['index.html','wpml-editor.html','wpml-route-library.html',
    'wpml-survey-preview.html','smart-farming.html']){
    assert.match(file(name),/href="\/media-gallery\.html">Medien<\/a>/);
  }
});
