'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const c=require('../media-upload-contract');

const WS='e3dea0f5-37f2-4d79-ae58-490af3228069';
const TINY='5aec4c6e78052bf38fab901bcd1a2319_2021_12_8_22_13_10';

test('tiny fingerprint request is bounded, deduplicated and charset-checked',()=>{
  assert.deepEqual(c.parseTinyFingerprintRequest({tiny_fingerprints:[TINY,TINY,'abc']}),
    {tinyFingerprints:[TINY,'abc']});
  assert.deepEqual(c.parseTinyFingerprintRequest({tiny_fingerprints:[]}),{tinyFingerprints:[]});
  for(const bad of [null,[],{},{tiny_fingerprints:'x'},{tiny_fingerprints:[1]},
    {tiny_fingerprints:['a b']},{tiny_fingerprints:['../x']},{tiny_fingerprints:['x'.repeat(129)]},
    {tiny_fingerprints:Array.from({length:501},(_,i)=>'f'+i)}]){
    assert.equal(c.parseTinyFingerprintRequest(bad),null);
  }
});

test('fast upload requires a fingerprint and rejects traversal and control characters',()=>{
  const ok=c.parseFastUploadRequest({fingerprint:'abc123',name:'DJI_0001.JPG',path:'2026/10/22',
    ext:{drone_model_key:'0-99-1',is_original:true,tinny_fingerprint:TINY,sn:'1581F6Q8D24AB'}});
  assert.equal(ok.fingerprint,'abc123');
  assert.equal(ok.ext.is_original,true);
  assert.equal(ok.ext.sn,'1581F6Q8D24AB');
  assert.deepEqual(c.parseFastUploadRequest({fingerprint:'abc123'}),
    {fingerprint:'abc123',name:null,path:null,ext:{}});
  for(const bad of [null,{},{fingerprint:''},{fingerprint:'a b'},
    {fingerprint:'a',name:'x\u0000y'},{fingerprint:'a',path:'../etc'},{fingerprint:'a',path:'/abs'},
    {fingerprint:'a',path:'a//b'},{fingerprint:'a',ext:'x'},{fingerprint:'a',ext:{is_original:'yes'}},
    {fingerprint:'a',ext:{sn:'bad serial'}},{fingerprint:'a',ext:{drone_model_key:'a b'}}]){
    assert.equal(c.parseFastUploadRequest(bad),null,JSON.stringify(bad));
  }
});

test('upload callback validates result, object key, metadata and position',()=>{
  const body={result:0,name:'a.jpg',object_key:WS+'/a.jpg',fingerprint:'abc',sub_file_type:1,
    ext:{file_group_id:'g-1'},
    metadata:{absolute_altitude:123.4,relative_altitude:20,gimbal_yaw_degree:-90.5,
      created_time:'2026-10-22T08:00:00Z',shoot_position:{lat:49.1,lng:8.4}}};
  const ok=c.parseUploadCallback(body);
  assert.equal(ok.uploaded,true);
  assert.equal(ok.objectKey,WS+'/a.jpg');
  assert.equal(ok.subFileType,1);
  assert.deepEqual(ok.metadata.shoot_position,{lat:49.1,lng:8.4});
  assert.equal(c.parseUploadCallback({...body,result:3}).uploaded,false);
  // 0/0 means "no position" and is not stored.
  assert.equal(c.parseUploadCallback({...body,metadata:{shoot_position:{lat:0,lng:0}}})
    .metadata.shoot_position,undefined);
  for(const bad of [null,{},{...body,result:-1},{...body,result:1.5},{...body,result:'0'},
    {...body,name:undefined},{...body,object_key:undefined},{...body,object_key:'../x'},
    {...body,object_key:'/x'},{...body,sub_file_type:2},
    {...body,metadata:{shoot_position:{lat:91,lng:0}}},
    {...body,metadata:{shoot_position:{lat:0,lng:181}}},
    {...body,metadata:{absolute_altitude:'high'}},{...body,metadata:{created_time:'not a date'}},
    {...body,metadata:[]}]){
    assert.equal(c.parseUploadCallback(bad),null,JSON.stringify(bad).slice(0,80));
  }
});

test('group upload callback keeps counts consistent',()=>{
  assert.deepEqual(c.parseGroupUploadCallback({file_group_id:'g1',file_count:5,file_uploaded_count:5}),
    {fileGroupId:'g1',fileCount:5,fileUploadedCount:5});
  assert.equal(c.parseGroupUploadCallback({file_count:0,file_uploaded_count:0}).fileGroupId,null);
  for(const bad of [null,{},{file_count:1},{file_count:1,file_uploaded_count:2},
    {file_count:-1,file_uploaded_count:0},{file_count:1.5,file_uploaded_count:1},
    {file_group_id:'a b',file_count:1,file_uploaded_count:1}]){
    assert.equal(c.parseGroupUploadCallback(bad),null);
  }
});

test('object keys must stay under the issued prefix',()=>{
  assert.equal(c.objectKeyUnderPrefix(WS+'/2026/a.jpg',WS),true);
  for(const [key,prefix] of [[WS,WS],[WS+'/',WS],['other/a.jpg',WS],[WS+'x/a.jpg',WS],
    [WS+'/../a.jpg',WS],['/'+WS+'/a.jpg',WS],[WS+'/a.jpg','']]){
    assert.equal(c.objectKeyUnderPrefix(key,prefix),false,key);
  }
});

test('response envelopes follow the DJI shape',()=>{
  assert.deepEqual(c.okEnvelope(),{code:0,message:'success',data:{}});
  assert.deepEqual(c.tinyFingerprintResponse([TINY,TINY]),
    {code:0,message:'success',data:{tiny_fingerprints:[TINY]}});
  assert.deepEqual(c.uploadCallbackResponse(WS+'/a.jpg').data,{object_key:WS+'/a.jpg'});
  assert.equal(c.errorEnvelope(1001,'x'.repeat(500)).message.length,200);
  assert.throws(()=>c.errorEnvelope(0,'ok'));
  assert.throws(()=>c.tinyFingerprintResponse(['a b']));
  assert.throws(()=>c.uploadCallbackResponse('../x'));
});

const grant=(over={})=>({
  bucket:'dji-cloud',region:'us-east-1',provider:'minio',
  endpoint:'https://minio.example.test:9000/ignored/path',
  objectKeyPrefix:WS+'/media',
  credentials:{accessKeyId:'TEMPKEY',accessKeySecret:'tempsecret',securityToken:'tok',expire:900},
  ...over
});

test('STS output is accepted only for short-lived, workspace-scoped HTTPS grants',()=>{
  const out=c.stsResponse(grant(),{workspace:WS});
  assert.equal(out.code,0);
  assert.equal(out.data.credentials.expire,900);
  assert.equal(out.data.endpoint,'https://minio.example.test:9000');
  assert.equal(out.data.object_key_prefix,WS+'/media');
  assert.deepEqual(Object.keys(out.data.credentials).sort(),
    ['access_key_id','access_key_secret','expire','security_token']);
  const bad=[
    grant({endpoint:'http://minio.example.test'}),
    grant({endpoint:'https://user:pw@minio.example.test'}),
    grant({endpoint:'not a url'}),
    grant({provider:'gcs'}),
    grant({objectKeyPrefix:'other-workspace/media'}),
    grant({objectKeyPrefix:'../'+WS}),
    grant({bucket:''}),
    grant({credentials:{accessKeyId:'K',accessKeySecret:'S',expire:900}}),
    grant({credentials:{accessKeyId:'K',accessKeySecret:'S',securityToken:'t',expire:3601}}),
    grant({credentials:{accessKeyId:'K',accessKeySecret:'S',securityToken:'t',expire:0}}),
    grant({credentials:{accessKeyId:'',accessKeySecret:'S',securityToken:'t',expire:60}}),
    null
  ];
  for(const item of bad)assert.throws(()=>c.stsResponse(item,{workspace:WS}),/Invalid STS/);
  assert.throws(()=>c.stsResponse(grant(),{workspace:'not-a-uuid'}),/Invalid STS/);
});

test('the contract is not wired into the server and has no I/O',()=>{
  const server=fs.readFileSync(path.resolve(__dirname,'../server.js'),'utf8');
  assert.doesNotMatch(server,/media-upload-contract/);
  assert.doesNotMatch(server,/\/media\/api|\/storage\/api|upload-callback|fast-upload|\/sts/);
  const source=fs.readFileSync(path.resolve(__dirname,'../media-upload-contract.js'),'utf8');
  assert.doesNotMatch(source,/require\(['"](?:node:)?(?:fs|net|http|https|child_process)['"]\)/);
  assert.doesNotMatch(source,/@aws-sdk|process\.env/);
});
