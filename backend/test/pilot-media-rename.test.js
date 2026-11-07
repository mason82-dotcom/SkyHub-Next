'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {renameConfig,createPilotMediaRenamer,targetKey}=require('../pilot-media-rename');
const {createPilotMediaStore}=require('../pilot-media-store');

const WS='09016a46-e315-441d-bf4a-2c67e0903e11';
const PREFIX=WS+'/media/'+'a'.repeat(32);
const ORIG=PREFIX+'/org_c585ec03a4215b32_1791124076000.jpg';
const row=(extra={})=>({object_key:ORIG,grant_prefix:PREFIX,file_name:'DJI_20261004172757_0096_V.JPG',size_bytes:'8159232',...extra});

// S3 double: objects by key, records commands by type and key
function fakeS3(objects={},{copySize}={}){
  const calls=[];
  return {calls,objects,async send(cmd){
    const name=cmd.constructor.name,input=cmd.input;
    calls.push([name,input.Key]);
    if(name==='HeadObjectCommand'){
      const o=objects[input.Key];
      if(!o){const e=new Error('nf');e.name='NotFound';throw e;}
      return {ContentLength:o.size,ETag:o.etag,LastModified:new Date(1794050000000)};
    }
    if(name==='CopyObjectCommand'){
      const src=decodeURIComponent(input.CopySource.slice('dji-cloud/'.length));
      objects[input.Key]={size:copySize??objects[src].size,etag:'"copy"'};return {};
    }
    if(name==='DeleteObjectCommand'){delete objects[input.Key];return {};}
    throw new Error('unexpected '+name);
  }};
}
function fakeDb(rows=[row()],{rowCount=1}={}){
  const queries=[];
  return {queries,async query(sql,params){
    queries.push([sql,params]);
    if(/^UPDATE/.test(sql))return {rowCount};
    if(/^SELECT object_key/.test(sql))return {rows:params[1]&&typeof params[1]==='string'?rows.filter(r=>r.object_key===params[1]):rows};
    return {rows:[]};
  }};
}

test('only genuine DJI names in the same session folder become targets',()=>{
  assert.equal(targetKey(row()),PREFIX+'/DJI_20261004172757_0096_V.JPG');
  assert.equal(targetKey(row({file_name:'DJI_20261004172757_0096_MS_NIR.TIF'})),PREFIX+'/DJI_20261004172757_0096_MS_NIR.TIF');
  assert.equal(targetKey(row({file_name:'DJI_20261004172757_0010.DNG'})),PREFIX+'/DJI_20261004172757_0010.DNG');
  for(const bad of ['../DJI_20261004172757_0096_V.JPG','x/DJI_20261004172757_0096_V.JPG','org_1.jpg','DJI_2026_0096.JPG',
    'DJI_20261004172757_0096_V.exe','DJI_20261004172757_0096_V.JPG ',''])
    assert.equal(targetKey(row({file_name:bad})),null,bad);
  assert.equal(targetKey(row({object_key:PREFIX+'/DJI_20261004172757_0096_V.JPG'})),null);    // schon umbenannt
  assert.equal(targetKey(row({object_key:'other/'+ORIG})),null);                                // nicht unter dem Grant
  assert.equal(targetKey(row({grant_prefix:'x/media/y'})),null);
});

test('rename copies, checks the copy, updates the record, then deletes the original',async()=>{
  const s3=fakeS3({[ORIG]:{size:8159232,etag:'"orig-2"'}});
  const db=fakeDb();
  const r=await createPilotMediaRenamer({s3,db,workspace:WS,log:()=>{}}).renameKey(ORIG);
  assert.equal(r.status,'renamed');
  assert.deepEqual(s3.calls.map(c=>c[0]),['HeadObjectCommand','CopyObjectCommand','HeadObjectCommand','DeleteObjectCommand']);
  assert.equal(s3.calls[3][1],ORIG);
  assert.ok(s3.objects[PREFIX+'/DJI_20261004172757_0096_V.JPG']&&!s3.objects[ORIG]);
  const update=db.queries.find(q=>/^UPDATE/.test(q[0]));
  assert.deepEqual(update[1].slice(0,4),[WS,ORIG,PREFIX+'/DJI_20261004172757_0096_V.JPG','"copy"']);
  assert.match(update[0],/pilot_object_key IS NULL/);
});

test('existing target, short copy and a changed record never lose the original',async()=>{
  const target=PREFIX+'/DJI_20261004172757_0096_V.JPG';
  let s3=fakeS3({[ORIG]:{size:8159232,etag:'"o"'},[target]:{size:1,etag:'"t"'}});
  let r=await createPilotMediaRenamer({s3,db:fakeDb(),workspace:WS,log:()=>{}}).renameKey(ORIG);
  assert.equal(r.reason,'Zielname existiert schon');
  assert.ok(s3.objects[ORIG]&&s3.objects[target].size===1);

  s3=fakeS3({[ORIG]:{size:8159232,etag:'"o"'}},{copySize:100});
  r=await createPilotMediaRenamer({s3,db:fakeDb(),workspace:WS,log:()=>{}}).renameKey(ORIG);
  assert.equal(r.status,'error');
  assert.ok(s3.objects[ORIG]&&!s3.objects[target]);

  s3=fakeS3({[ORIG]:{size:8159232,etag:'"o"'}});
  r=await createPilotMediaRenamer({s3,db:fakeDb([row()],{rowCount:0}),workspace:WS,log:()=>{}}).renameKey(ORIG);
  assert.equal(r.reason,'Eintrag geändert');
  assert.ok(s3.objects[ORIG]&&!s3.objects[target]);
});

test('backfill dry run plans without writing; apply renames and reports skips',async()=>{
  const rows=[row(),row({object_key:PREFIX+'/org_2.jpg',file_name:'IMG_1.JPG'}),
    row({object_key:PREFIX+'/org_3.dng',file_name:'DJI_20261004172800_0001.DNG',size_bytes:'5'})];
  const s3=fakeS3({[ORIG]:{size:8159232,etag:'"a"'},[PREFIX+'/org_3.dng']:{size:5,etag:'"b"'}});
  const renamer=createPilotMediaRenamer({s3,db:fakeDb(rows),workspace:WS,log:()=>{}});
  let sum=await renamer.backfill({apply:false});
  assert.deepEqual({planned:sum.planned,renamed:sum.renamed,skipped:sum.skipped},{planned:2,renamed:0,skipped:{'kein DJI-Name':1}});
  assert.ok(!s3.calls.some(c=>c[0]!=='HeadObjectCommand'));
  sum=await renamer.backfill({apply:true});
  assert.equal(sum.renamed,2);
  assert.ok(s3.objects[PREFIX+'/DJI_20261004172800_0001.DNG']);
});

test('repeated callback for a renamed object is answered from the record (store with djiNames)',async()=>{
  const queries=[];
  const db={async query(sql,params){queries.push(sql);
    if(/pilot_object_key=\$2/.test(sql))return {rows:params[1]===ORIG?[{file_name:'DJI_20261004172757_0096_V.JPG',fingerprint:'fp1'}]:[]};
    return {rows:[]};}};
  const store=createPilotMediaStore(db,{djiNames:true,clock:()=>1794050000000});
  const cb=(extra={})=>({object_key:ORIG,name:'DJI_20261004172757_0096_V.JPG',result:0,fingerprint:'fp1',path:'',
    ext:{drone_model_key:'0-77-0',payload_model_key:'1-66-0',is_original:true,sn:'1ZNBJ7R0010009',tinny_fingerprint:'t1'},
    metadata:{gimbal_yaw_degree:0,absolute_altitude:0,relative_altitude:0,create_time:'2026-10-04T17:27:57Z',shoot_position:{lat:49,lng:8}},...extra});
  const head=async()=>{throw new Error('HEAD must not be needed');};
  assert.equal((await store.verifyCallback({workspace:WS,callback:cb(),headObject:head})).status,'duplicate');
  assert.equal((await store.verifyCallback({workspace:WS,callback:cb({fingerprint:'other'}),headObject:head})).status,'conflict');
  const plain=createPilotMediaStore(db,{clock:()=>1794050000000});
  await plain.verifyCallback({workspace:WS,callback:cb(),headObject:async()=>null}).catch(()=>{});
  assert.ok(!queries.slice(2).some(q=>/pilot_object_key/.test(q)),'without djiNames the column is never queried');
});

test('config needs the flag, endpoint and a separate rename account',()=>{
  assert.deepEqual(renameConfig({}),{enabled:false,issue:null});
  const base={SKYHUB_PILOT_MEDIA_DJI_NAMES:'true',SKYHUB_S3_ENDPOINT:'http://skyhub-minio:9000',
    SKYHUB_PILOT_MEDIA_RENAME_S3_ACCESS_KEY:'skyhub-pilot-media-renamer',SKYHUB_PILOT_MEDIA_RENAME_S3_SECRET_KEY:'x'};
  assert.equal(renameConfig(base).enabled,true);
  assert.match(renameConfig({...base,SKYHUB_PILOT_MEDIA_RENAME_S3_SECRET_KEY:''}).issue,/rename account/);
  assert.match(renameConfig({...base,SKYHUB_S3_ACCESS_KEY:'skyhub-pilot-media-renamer'}).issue,/separate/);
});
