'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createPilotMediaLibrary,createLibraryAudit,MAX_GROUP}=require('../pilot-media-library');
const WS='e3dea0f5-37f2-4d79-ae58-490af3228069',OTHER='203cc94c-aef1-4e0e-a520-05a24be33a31';
const ID1='33670000-0000-4000-8000-000000000001',ID2='33670000-0000-4000-8000-000000000002';
const SESSION='a'.repeat(32),PREFIX=WS+'/media/'+SESSION;
const TIME='2026-10-22T15:00:00.000000Z';
const SECRET=Buffer.alloc(32,17);
const BASE={
  workspace_id:WS,
  object_key:PREFIX+'/DJI_20261022150000_0001_MS_NIR.TIF',
  grant_prefix:PREFIX,file_name:'DJI_20261022150000_0001_MS_NIR.TIF',
  file_group_id:'mission-one',size_bytes:'1678900',etag:'"mock-etag"',
  object_last_modified:new Date('2026-10-22T15:00:00Z'),
  verified_at:new Date('2026-10-22T15:01:00Z'),
  cursor_time:'2026-10-22T15:01:00.000000Z',
  pilot_metadata:{absolute_altitude:50,relative_altitude:14,
    gimbal_yaw_degree:12,shoot_position:{lat:49.1,lng:8.4},
    privateSecret:'DO_NOT_LEAK',RtkFlag:50}
};
function row(id,over={}){return {...BASE,asset_id:id,...over};}
function makeDb(rows=[row(ID1),row(ID2,{verified_at:new Date('2026-10-22T15:00:59Z'),
  cursor_time:'2026-10-22T15:00:59.000000Z'})]){
  const calls=[],audits=[];
  return {calls,audits,async query(sql,args){
    calls.push({sql,args});
    if(sql.startsWith('INSERT INTO dji_pilot_media_library_audit')){
      audits.push(args);return {rows:[]};
    }
    if(sql.startsWith('SELECT grant_prefix,file_name'))
      return {rows:rows.filter(x=>x.file_group_id===args[1]&&x.workspace_id===args[0])
        .map(x=>({grant_prefix:x.grant_prefix,file_name:x.file_name}))};
    if(sql.includes('asset_id=$2::uuid'))return {rows:rows.filter(x=>x.asset_id===args[1]&&x.workspace_id===args[0])};
    if(sql.includes('ORDER BY verified_at DESC')){
      const list=rows.filter(r=>r.workspace_id===args[0]).sort((a,b)=>
        b.cursor_time.localeCompare(a.cursor_time)||b.asset_id.localeCompare(a.asset_id));
      const filtered=args[2]===null?list:list.filter(r=>
        r.cursor_time<args[2]||r.cursor_time===args[2]&&r.asset_id<args[3]);
      return {rows:filtered.slice(0,args[1])};
    }
    throw Error('Unexpected SQL');
  }};
}

test('library list exposes only callback allowlist, explicit provenance and bounded signed paging',async()=>{
  const db=makeDb(),lib=createPilotMediaLibrary(db,{cursorSecret:SECRET});
  const page=await lib.list({workspace:WS,limit:1});
  assert.equal(page.items.length,1);
  assert.equal(page.items[0].id,ID1);
  assert.equal(page.items[0].bandHint,'NIR');
  assert.equal(page.items[0].hintSource,'filename-only-unverified');
  assert.equal(page.items[0].imageInspection.rtk,'not-extracted');
  assert.equal(page.items[0].imageInspection.ndviReady,false);
  assert.equal(page.items[0].imageInspection.reflectanceReady,false);
  assert.equal(page.items[0].pilotMetadata.fields.absolute_altitude,50);
  assert.deepEqual(page.items[0].pilotMetadata.fields.shoot_position,{lat:49.1,lng:8.4});
  assert.ok(!('storage' in page.items[0]));
  assert.doesNotMatch(JSON.stringify(page.items),/DO_NOT_LEAK|RtkFlag|DO_NOT_LEAK/);
  assert.equal(typeof page.nextCursor,'string');
  assert.doesNotMatch(page.nextCursor,/DJI_|media|a{32}/);
  const second=await lib.list({workspace:WS,limit:1,cursor:page.nextCursor});
  assert.deepEqual(second.items.map(x=>x.id),[ID2]);
  assert.equal(second.nextCursor,null);
  assert.equal(db.calls[0].args[0],WS);
  assert.equal(db.calls[0].args[1],2);
});

test('workspace mixing and forged cursor cannot change listing scope',async()=>{
  const lib=createPilotMediaLibrary(makeDb(),{cursorSecret:SECRET});
  const cursor=(await lib.list({workspace:WS,limit:1})).nextCursor;
  const wrong=cursor.slice(0,-1)+(cursor.endsWith('a')?'b':'a');
  await assert.rejects(()=>lib.list({workspace:WS,limit:1,cursor:wrong}),/cursor/);
  await assert.rejects(()=>lib.list({workspace:OTHER,limit:1,cursor}),/cursor/);
  for(const limit of [0,101,'1',NaN])await assert.rejects(()=>lib.list({workspace:WS,limit}));
  assert.throws(()=>createPilotMediaLibrary(makeDb(),{cursorSecret:Buffer.alloc(8)}));
});

test('detail requires a fresh matching S3 HEAD of the exact verified object',async()=>{
  const db=makeDb(),lib=createPilotMediaLibrary(db,{cursorSecret:SECRET});
  let got;
  const headObject=async query=>{
    got=query;
    return {size:1678900,etag:'"mock-etag"',
      lastModified:new Date('2026-10-22T15:00:00Z')};
  };
  const good=await lib.detail({workspace:WS,id:ID1,headObject});
  assert.equal(good.status,'ok');
  assert.equal(good.item.objectEvidence.status,'head-rechecked');
  assert.equal(good.item.storage.bucket,'dji-cloud');
  assert.equal(good.item.storage.objectKey,BASE.object_key);
  assert.deepEqual(got,{bucket:'dji-cloud',key:BASE.object_key});
  const changed=await lib.detail({workspace:WS,id:ID1,
    headObject:async()=>({size:1678900,etag:'"replaced"',lastModified:BASE.object_last_modified})});
  assert.deepEqual(changed,{status:'changed'});
  const missing=await lib.detail({workspace:WS,id:ID1,headObject:async()=>null});
  assert.deepEqual(missing,{status:'missing'});
  assert.deepEqual(await lib.detail({workspace:WS,
    id:'33670000-0000-4000-8000-000000009999',headObject}),
    {status:'not-found'});
  const other=await lib.detail({workspace:OTHER,id:ID1,
    headObject:async()=>{throw Error('should not reach S3');}});
  assert.deepEqual(other,{status:'not-found'});
});

test('M3M capture filename inventory partitions by grant and never exposes names',async()=>{
  const capture='DJI_20261022150000_0001';
  const rows=[];
  for(const session of ['a'.repeat(32),'b'.repeat(32)]){
    for(const band of ['G','R','RE','NIR']){
      rows.push(row(ID1,{grant_prefix:WS+'/media/'+session,
        file_name:capture+'_MS_'+band+'.TIF'}));
    }
  }
  const db=makeDb(rows),lib=createPilotMediaLibrary(db,{cursorSecret:SECRET});
  const result=await lib.m3mGroup({workspace:WS,groupId:'mission-one'});
  assert.equal(result.status,'ok');
  assert.equal(result.report.examined,8);
  assert.equal(result.report.sessionPartitions,2);
  assert.equal(result.report.spectralSets,2);
  assert.equal(result.report.captureGroups,2);
  assert.equal(result.report.fiveChannelSets,0);
  assert.equal(result.report.xmpVerified,false);
  assert.equal(result.report.ndreReady,false);
  assert.doesNotMatch(JSON.stringify(result),/DJI_2026|\/media\/|a{32}|b{32}|DO_NOT_LEAK/);
});
test('M3M overview never turns unknown files into confirmed spectral captures',async()=>{
  const db=makeDb([row(ID1,{file_name:'FIELD_SECRET_1_MS_NIR.TIF'}),
    row(ID2,{file_name:'DJI_bad_MS_R.TIF'})]);
  const out=await createPilotMediaLibrary(db,{cursorSecret:SECRET})
    .m3mGroup({workspace:WS,groupId:'mission-one'});
  assert.equal(out.report.spectralSets,0);
  assert.equal(out.report.classified,0);
  assert.equal(out.report.unrecognized,2);
});
test('large groups fail closed before allocating unbounded inventory objects',async()=>{
  const db=makeDb();
  db.query=async()=>({rows:Array(MAX_GROUP+1).fill({
    grant_prefix:PREFIX,file_name:'DJI_20261022150000_0001_MS_NIR.TIF'
  })});
  assert.deepEqual(await createPilotMediaLibrary(db,{cursorSecret:SECRET})
    .m3mGroup({workspace:WS,groupId:'mission-one'}),
    {status:'limit-exceeded'});
});

test('append-only audit stores action and outcome, never object IDs or private metadata',async()=>{
  const db=makeDb(),audit=createLibraryAudit(db);
  await audit({workspace:WS,action:'detail',outcome:'ok',
    key:BASE.object_key,token:'SECRET_TOKEN'});
  assert.deepEqual(db.audits,[[WS,'detail','ok']]);
  await assert.rejects(()=>audit({workspace:WS,action:'delete',outcome:'ok'}));
  await assert.rejects(()=>audit({workspace:WS,action:'detail',outcome:'SECRET'}));
  assert.equal(db.audits.length,1);
});

test('live server stays disconnected from the metadata library',()=>{
  const server=fs.readFileSync(path.resolve(__dirname,'../server.js'),'utf8');
  assert.doesNotMatch(server,/pilot-media-library/);
  const source=fs.readFileSync(path.resolve(__dirname,'../pilot-media-library.js'),'utf8');
  assert.doesNotMatch(source,/process\.env|console\.(log|error)|GetObjectCommand|PutObjectCommand/);
});
