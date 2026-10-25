'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {
  HeadBucketCommand,
  ListObjectsV2Command
}=require('@aws-sdk/client-s3');
const {createS3Storage}=require('../s3-storage');

test('only allowlisted buckets are checked and returned',async()=>{
  const checked=[];
  const client={
    async send(command){
      assert.ok(command instanceof HeadBucketCommand);
      checked.push(command.input.Bucket);
      if(['dji-cloud','farming'].includes(command.input.Bucket)){
        return {};
      }
      throw Object.assign(new Error('Not found'),{
        name:'NotFound',
        $metadata:{httpStatusCode:404}
      });
    }
  };
  const storage=createS3Storage({},client);
  assert.deepEqual(await storage.buckets(),[
    'dji-cloud','farming'
  ]);
  assert.deepEqual(checked,[
    'basemaps',
    'dji-cloud',
    'farming',
    'mapping-results',
    'pv-inspections'
  ]);
});

test('invalid buckets are rejected before S3 access',async()=>{
  const client={
    async send(){
      throw new Error('S3 must not be called');
    }
  };
  const storage=createS3Storage({},client);
  await assert.rejects(
    storage.objects('private'),
    {status:400}
  );
});

test('object listing supports pagination',async()=>{
  const client={
    async send(command){
      assert.ok(command instanceof ListObjectsV2Command);
      assert.equal(command.input.Bucket,'dji-cloud');
      assert.equal(command.input.MaxKeys,25);
      assert.equal(command.input.ContinuationToken,'page-1');
      return {
        Contents:[{
          Key:'photo.jpg',
          Size:1024,
          LastModified:new Date('2026-10-21T12:00:00Z')
        }],
        IsTruncated:true,
        NextContinuationToken:'page-2'
      };
    }
  };
  const storage=createS3Storage({},client);
  const result=await storage.objects('dji-cloud',{
    limit:25,cursor:'page-1'
  });
  assert.equal(result.objects.length,1);
  assert.equal(result.objects[0].key,'photo.jpg');
  assert.equal(result.nextCursor,'page-2');
  assert.equal(result.truncated,true);
});

test('invalid pagination is rejected',async()=>{
  const storage=createS3Storage({},{
    async send(){
      throw new Error('Unexpected S3 call');
    }
  });
  for(const limit of [0,201,-1,1.5]){
    await assert.rejects(
      storage.objects('dji-cloud',{limit}),
      {status:400}
    );
  }
});

test('missing credentials are rejected',()=>{
  assert.throws(
    ()=>createS3Storage({}),
    /S3 configuration incomplete/
  );
});

test('malformed ListObjectsV2 payloads fail closed',async()=>{
  const invalid=[
    null,
    {},
    {Contents:[],IsTruncated:'false'},
    {Contents:[],IsTruncated:true},
    {Contents:[],IsTruncated:true,NextContinuationToken:''},
    {Contents:[],IsTruncated:false,NextContinuationToken:'unexpected'},
    {Contents:[{Key:'outside/file.jpg'}],IsTruncated:false},
    {Contents:[{Key:'safe/a.jpg'},{Key:'safe/a.jpg'}],IsTruncated:false},
    {Contents:[{Key:'safe/control\\n.jpg'.replace('\\n','\n')}],IsTruncated:false},
    {Contents:[{Key:'safe/'+ 'a'.repeat(1025)}],IsTruncated:false},
    {Contents:[{Key:'safe/a.jpg',Size:-1}],IsTruncated:false},
    {Contents:Array.from({length:201},(_,i)=>({Key:'safe/'+i})),
      IsTruncated:false}
  ];
  for(const response of invalid){
    const storage=createS3Storage({},{
      async send(command){
        assert.ok(command instanceof ListObjectsV2Command);
        return response;
      }
    });
    await assert.rejects(
      storage.objects('dji-cloud',{prefix:'safe/',limit:200}),
      /Invalid S3 listing/
    );
  }
});

test('valid final listing is not mistaken for a truncated listing',async()=>{
  const storage=createS3Storage({},{
    async send(){return {Contents:[{Key:'safe/photo.jpg',Size:0}],
      IsTruncated:false};}
  });
  const report=await storage.objects('dji-cloud',{prefix:'safe/'});
  assert.equal(report.truncated,false);
  assert.equal(report.nextCursor,null);
  assert.equal(report.objects[0].key,'safe/photo.jpg');
});
