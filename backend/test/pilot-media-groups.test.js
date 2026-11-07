'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createPilotMediaGroupStore}=require('../pilot-media-groups');
const {createPilotMediaHttpAudit}=require('../pilot-media-http-audit');

const WS='e3dea0f5-37f2-4d79-ae58-490af3228069';
const OTHER='203cc94c-aef1-4e0e-a520-05a24be33a31';
const body={file_group_id:'mission-01',file_count:12,file_uploaded_count:10};

function database(verifiedCount=10){
  const reports=new Map();
  const audit=[];
  const seen=[];
  return {
    reports,audit,seen,
    async query(sql,args){
      seen.push({sql,args});
      if(sql.startsWith('INSERT INTO dji_pilot_media_group_reports')){
        const key=args[0]+'|'+args[1];
        if(verifiedCount!==args[3]||reports.has(key))return {rows:[]};
        reports.set(key,{file_count:args[2],file_uploaded_count:args[3]});
        return {rows:[{file_group_id:args[1]}]};
      }
      if(sql.startsWith('SELECT file_count,file_uploaded_count')){
        const report=reports.get(args[0]+'|'+args[1]);
        return {rows:report?[report]:[]};
      }
      if(sql.startsWith('INSERT INTO dji_pilot_media_http_audit')){
        audit.push(args);return {rows:[],rowCount:1};
      }
      throw Error('Unexpected SQL');
    }
  };
}

test('a group can be reported only when verified single-file count matches',async()=>{
  const db=database(10);
  const store=createPilotMediaGroupStore(db);
  assert.deepEqual(await store.report({workspace:WS,body}),{status:'recorded'});
  assert.equal(db.reports.size,1);
  assert.deepEqual(await store.report({workspace:WS,body}),{status:'duplicate'});
  assert.deepEqual(await store.report({workspace:WS,body:{...body,file_count:13}}),
    {status:'conflict'});
  assert.deepEqual(db.seen[0].args,[WS,'mission-01',12,10]);
  assert.doesNotMatch(JSON.stringify(db.seen),/DJI_0001|SECRET|PRIVATE/);
});

test('missing uploads, missing group identity and invalid claims are not acknowledged',async()=>{
  const db=database(9),groups=createPilotMediaGroupStore(db);
  assert.deepEqual(await groups.report({workspace:WS,body}),{status:'pending'});
  assert.equal(db.reports.size,0);
  for(const item of [
    {file_count:2,file_uploaded_count:2},
    {file_group_id:'mission-01',file_count:0,file_uploaded_count:0},
    {file_group_id:'mission-01',file_count:1,file_uploaded_count:0}
  ])assert.deepEqual(await groups.report({workspace:WS,body:item}),
    {status:'unverifiable'});
  assert.equal(db.reports.size,0);
  await assert.rejects(()=>groups.report({workspace:WS,body:{
    file_group_id:'../../other',file_count:12,file_uploaded_count:10
  }}),/Invalid DJI/);
  await assert.rejects(()=>groups.report({workspace:'bad',body}),/workspace/);
});

test('workspace bound report query cannot retrieve a cross-workspace group',async()=>{
  const db=database(10),groups=createPilotMediaGroupStore(db);
  assert.deepEqual(await groups.report({workspace:WS,body}),{status:'recorded'});
  assert.deepEqual(await groups.report({workspace:OTHER,body}),{status:'recorded'});
  assert.equal(db.reports.size,2);
  assert.equal(db.seen[0].args[0],WS);
  assert.equal(db.seen[1].args[0],OTHER);
});

test('append-only HTTP audit records only workspace, fixed action and fixed outcome',async()=>{
  const db=database(),audit=createPilotMediaHttpAudit(db);
  await audit({workspace:WS,operation:'upload_callback',outcome:'ok',
    token:'NOT_A_FIELD',objectKey:'NOT_A_FIELD',fingerprint:'NOT_A_FIELD'});
  assert.deepEqual(db.audit,[[WS,'upload_callback','ok']]);
  for(const input of [
    {workspace:'bad',operation:'upload_callback',outcome:'ok'},
    {workspace:WS,operation:'DROP TABLE users',outcome:'ok'},
    {workspace:WS,operation:'tiny_fingerprints',outcome:'private-err'},
    {workspace:WS,operation:'tiny_fingerprints'}
  ])await assert.rejects(()=>audit(input));
  assert.equal(db.audit.length,1);
});

test('no route, storage writes or production environment access is introduced',()=>{
  const server=fs.readFileSync(path.resolve(__dirname,'../server.js'),'utf8');
  assert.doesNotMatch(server,/pilot-media-(groups|http-audit)/);
  const source=fs.readFileSync(path.resolve(__dirname,'../pilot-media-groups.js'),'utf8');
  assert.doesNotMatch(source,/PutObjectCommand|GetObjectCommand|DeleteObjectCommand|process\.env/);
});
