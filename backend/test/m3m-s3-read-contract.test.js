'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createScopedListOnlyStorage,validatePrefix}=require('../m3m-s3-read-contract');
const {inventoryM3MFromS3}=require('../m3m-s3-inventory');

const ROOT='missions/flight-001/';
const CAPTURE='DJI_20261021190530_0001';
const FILES=[
  CAPTURE+'_D.JPG',
  ...['G','R','RE','NIR'].map(b=>CAPTURE+'_MS_'+b+'.TIF')
];
const page=(files,{truncated=false,next=null}={})=>({
  Contents:files.map(Key=>({Key:ROOT+Key,Size:999,ETag:'SECRET_ETAG',
    LastModified:new Date('2026-10-21T12:00:00Z')})),
  IsTruncated:truncated,
  ...(truncated?{NextContinuationToken:next}:{})
});
const reader=(fn,root=ROOT)=>createScopedListOnlyStorage({allowedPrefix:root,listOnly:fn});

test('paginates at ListObjectsV2 with delimiter, strict scope and no metadata leaks',async()=>{
  const inputs=[];
  const storage=reader(async input=>{
    inputs.push(input);
    return !input.ContinuationToken?
      page(FILES.slice(0,2),{truncated:true,next:'page-2'}):
      page(FILES.slice(2));
  });
  const report=await inventoryM3MFromS3(storage,ROOT);
  assert.equal(report.totalEntries,5);
  assert.equal(report.fiveChannelSets,1);
  assert.equal(report.ndviReady,false);
  assert.equal(report.reflectanceReady,false);
  assert.equal(inputs.length,2);
  assert.deepEqual(inputs[0],{Bucket:'dji-cloud',Prefix:ROOT,Delimiter:'/',MaxKeys:200});
  assert.equal(inputs[1].ContinuationToken,'page-2');
  assert.doesNotMatch(JSON.stringify(report),
    /missions|flight-001|20261021190530|SECRET_ETAG|2026-10-21/);
});

test('rejects any wider, foreign, ambiguous or malformed scope before calling S3',async()=>{
  let calls=0;
  const storage=reader(async()=>{calls++;return page([]);});
  for(const scope of ['missions/','missions/other/','missions/flight-002/',
    'missions/flight-001x/','/missions/flight-001/','missions/../flight-001/',
    'missions//flight-001/','missions/flight-001','missions/%66light-001/',
    'missions/flight-001/?secret/','missions/flight-001/\n']){
    await assert.rejects(storage.objects('dji-cloud',{prefix:scope}),TypeError);
  }
  await assert.rejects(storage.objects('farming',{prefix:ROOT}),TypeError);
  assert.equal(calls,0);
  assert.throws(()=>createScopedListOnlyStorage({listOnly:()=>{}}),TypeError);
  assert.throws(()=>validatePrefix('missions/'),TypeError);
});

test('allows only nested reads under independently pinned scope',async()=>{
  const inner='missions/flight-001/capture/';
  const seen=[];
  const storage=reader(async input=>{
    seen.push(input);
    return {Contents:[],IsTruncated:false};
  });
  const result=await inventoryM3MFromS3(storage,inner);
  assert.equal(result.totalEntries,0);
  assert.equal(seen[0].Prefix,inner);
});

test('rejects bad list query shape and cursors without S3 call',async()=>{
  let calls=0;
  const storage=reader(async()=>{calls++;return page([]);});
  for(const options of [{limit:0},{limit:201},{limit:1.5},{cursor:''},
    {cursor:'bad\ncursor'},{cursor:'x'.repeat(4097)}]){
    await assert.rejects(storage.objects('dji-cloud',{prefix:ROOT,...options}),TypeError);
  }
  assert.equal(calls,0);
});

test('rejects malformed, outside-scope and control-character S3 response keys',async()=>{
  for(const raw of [null,{}, {Contents:'bad',IsTruncated:false},
    {Contents:[],IsTruncated:'false'},
    {Contents:[],IsTruncated:true},
    {Contents:[{Key:'missions/private/secret.jpg'}],IsTruncated:false},
    {Contents:[{Key:ROOT+'x'.repeat(1025)}],IsTruncated:false},
    {Contents:[{Key:ROOT+'secrets\n.jpg'}],IsTruncated:false},
    {Contents:Array(201).fill({Key:ROOT+'x'}),IsTruncated:false}]){
    const storage=reader(async()=>raw);
    await assert.rejects(inventoryM3MFromS3(storage,ROOT));
  }
});

test('rejects repeated, missing and cyclic cursors without partial success',async()=>{
  for(const strategy of [
    ()=>page(FILES.slice(0,1),{truncated:true,next:''}),
    ()=>page(FILES.slice(0,1),{truncated:true,next:'x'.repeat(4097)}),
    ()=>page(FILES.slice(0,1),{truncated:true,next:'p'})
  ]){
    const storage=reader(async()=>strategy());
    await assert.rejects(inventoryM3MFromS3(storage,ROOT));
  }
});

test('rejects duplicate S3 keys crossing pages, rather than inflating counts',async()=>{
  const storage=reader(async input=>input.ContinuationToken?
    page([FILES[0]]):page([FILES[0]],{truncated:true,next:'2'}));
  await assert.rejects(inventoryM3MFromS3(storage,ROOT),/Duplicate S3 (?:inventory object )?key/);
});

test('nested keys and directory markers are excluded from direct capture inventory',async()=>{
  const storage=reader(async()=>page([FILES[0],
    'nested/'+FILES[1], '', FILES[2]]));
  const r=await inventoryM3MFromS3(storage,ROOT);
  assert.equal(r.totalEntries,2);
  assert.equal(r.fiveChannelSets,0);
});

test('empty bucket listing returns zero counts with all readiness flags false',async()=>{
  const storage=reader(async()=>({Contents:[],IsTruncated:false}));
  const r=await inventoryM3MFromS3(storage,ROOT);
  assert.equal(r.totalEntries,0);
  assert.equal(r.captureGroups,0);
  assert.equal(r.ndviReady,false);
  assert.equal(r.ndreReady,false);
});

test('upstream list failure cannot produce a partial report or leak errors',async()=>{
  let calls=0;
  const storage=reader(async()=>{
    calls++;
    if(calls===1)return page([FILES[0]],{truncated:true,next:'p2'});
    throw new Error('PRIVATE: upstream S3 call failed');
  });
  await assert.rejects(inventoryM3MFromS3(storage,ROOT));
  assert.equal(calls,2);
});

test('bounded 101 pages refuse a perpetually truncated listing',async()=>{
  let calls=0;
  const storage=reader(async()=>{
    calls++;
    return {Contents:[],IsTruncated:true,NextContinuationToken:'cursor-'+calls};
  });
  await assert.rejects(inventoryM3MFromS3(storage,ROOT),/page limit exceeded/);
  assert.equal(calls,101);
});

test('20001 direct objects fail closed, no complete-looking report',async()=>{
  let calls=0;
  const storage=reader(async()=>{
    calls++;
    return {
      Contents:Array.from({length:200},(_,i)=>({Key:ROOT+
        'unknown-'+String(calls).padStart(3,'0')+'-'+String(i).padStart(3,'0')+'.jpg'})),
      IsTruncated:true, NextContinuationToken:'p-'+calls
    };
  });
  await assert.rejects(inventoryM3MFromS3(storage,ROOT),/entry limit exceeded/);
  assert.equal(calls,101);
});
