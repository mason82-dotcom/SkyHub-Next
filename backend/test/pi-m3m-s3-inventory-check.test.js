'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const path=require('node:path');
const {createApiStorage,discoverFirstPagePrefix}=require('../../scripts/pi-m3m-s3-inventory-check');
const {inventoryM3MFromS3}=require('../m3m-s3-inventory');

const PREFIX='missions/SECRET_CAPTURE_ID/';
const CAPTURE='DJI_20261021190530_0001';
const NAMES=[CAPTURE+'_D.JPG',...['G','R','RE','NIR'].map(b=>CAPTURE+'_MS_'+b+'.TIF')];

test('Pi S3 probe help runs without Docker, MinIO or credentials',()=>{
  const file=path.resolve(__dirname,'../../scripts/pi-m3m-s3-inventory-check.js');
  const res=spawnSync(process.execPath,[file,'--help'],{encoding:'utf8',timeout:5000});
  assert.equal(res.status,0,res.stderr);
  assert.match(res.stdout,/--prefix/);
  assert.doesNotMatch(res.stdout,/SECRET|accessKey|s3_url/);
});

test('Pi S3 probe adapter paginates only dji-cloud and returns aggregate inventory',async()=>{
  let calls=0;
  const storage=createApiStorage(async request=>{
    assert.equal(request.bucket,'dji-cloud');
    assert.equal(request.prefix,PREFIX);
    assert.equal(request.limit,200);
    calls++;
    if(calls===1){
      assert.equal(request.cursor,undefined);
      return {objects:NAMES.slice(0,2).map(n=>({key:PREFIX+n})),
        truncated:true,nextCursor:'next'};
    }
    assert.equal(request.cursor,'next');
    return {objects:NAMES.slice(2).map(n=>({key:PREFIX+n})),
      truncated:false,nextCursor:null};
  });
  const report=await inventoryM3MFromS3(storage,PREFIX);
  assert.equal(calls,2);
  assert.equal(report.totalEntries,5);
  assert.equal(report.fiveChannelSets,1);
  assert.equal(report.ndviReady,false);
  assert.doesNotMatch(JSON.stringify(report),/SECRET|20261021|missions|NIR\.TIF/);
});

test('Pi S3 probe adapter never supports bucket writes or arbitrary buckets',async()=>{
  const storage=createApiStorage(async()=>{throw new Error('Must not call');});
  await assert.rejects(storage.objects('private',{prefix:PREFIX,limit:200}));
  await assert.rejects(storage.objects('dji-cloud',null));
  assert.equal(typeof storage.putObject,'undefined');
  assert.equal(typeof storage.deleteObject,'undefined');
});

test('Pi S3 probe refuses incomplete remote responses without sharing backend values',async()=>{
  const storage=createApiStorage(async()=>({secret:'API_KEY_1234'}));
  await assert.rejects(inventoryM3MFromS3(storage,PREFIX),
    /Invalid media API response/);
});


test('auto first-page discovery selects only a unique two-file M3M directory without printing it',async()=>{
  const firstPage={
    objects:[
      {key:'private/alpha/SECRET_METADATA.TXT'},
      {key:'private/alpha/DJI_20261021190530_0001_MS_G.TIF'},
      {key:'private/alpha/DJI_20261021190530_0001_MS_NIR.TIF'},
      {key:'private/other/unknown.jpg'}
    ],
    truncated:true,
    nextCursor:'next'
  };
  const calls=[];
  const storage=createApiStorage(async options=>{
    calls.push(options);
    return firstPage;
  });
  const prefix=await discoverFirstPagePrefix(storage);
  assert.equal(prefix,'private/alpha/');
  assert.deepEqual(calls,[{bucket:'dji-cloud',prefix:'',limit:100}]);
});

test('auto first-page discovery fails closed on ambiguous folders and partial single matches',async()=>{
  const candidate=name=>({key:name});
  const sample=(objects,truncated=false)=>({objects, truncated,nextCursor:null});
  const prefixA='private/alpha/DJI_20261021190530_0001_MS_';
  const prefixB='private/beta/DJI_20261021190530_0001_MS_';
  const ambiguous=sample([
    candidate(prefixA+'G.TIF'),candidate(prefixA+'R.TIF'),
    candidate(prefixB+'G.TIF'),candidate(prefixB+'R.TIF')
  ]);
  const onlyOne=sample([candidate(prefixA+'G.TIF')]);
  const noMatches=sample([candidate('private/alpha/other.jpg')]);
  for(const data of [ambiguous,onlyOne,noMatches]){
    const storage=createApiStorage(async()=>data);
    await assert.rejects(discoverFirstPagePrefix(storage),
      /No unambiguous M3M directory in first page/);
  }
});

test('auto discovery rejects invalid oversized API pages and unsafe prefix keys',async()=>{
  const sample=(keys)=>({objects:keys.map(key=>({key})),truncated:true,nextCursor:'next'});
  const name='DJI_20261021190530_0001_MS_G.TIF';
  const invalids=[
    {objects:[],truncated:'false'},
    sample(Array(101).fill('prefix/'+name))
  ];
  for(const data of invalids)
    await assert.rejects(discoverFirstPagePrefix(createApiStorage(async()=>data)));
  const unsafe=sample([
    '/absolute/'+name,'/absolute/DJI_20261021190530_0001_MS_R.TIF',
    'missions/../SECRET/'+name,'missions/../SECRET/DJI_20261021190530_0001_MS_R.TIF',
    'safe/'+name
  ]);
  await assert.rejects(discoverFirstPagePrefix(
    createApiStorage(async()=>unsafe)),
  /No unambiguous M3M directory in first page/);
});

test('Pi CLI auto-first-page usage does not disclose any prefix',()=>{
  const script=path.resolve(__dirname,'../../scripts/pi-m3m-s3-inventory-check.js');
  const res=spawnSync(process.execPath,[script,'--help'],{encoding:'utf8'});
  assert.equal(res.status,0);
  assert.match(res.stdout,/--auto-first-page/);
  assert.doesNotMatch(res.stdout,/private\/alpha|SECRET_METADATA|20261021190530/);
});
