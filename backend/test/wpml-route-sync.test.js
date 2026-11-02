'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {webcrypto}=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const planner=require('../../frontend/public/wpml-editor-core');
const library=require('../../frontend/public/wpml-route-library-core');
const syncModule=require('../../frontend/public/wpml-route-sync');

function storage(){
  const data=new Map();
  return {
    data,
    getItem:k=>data.get(k)??null,
    setItem(k,v){data.set(k,String(v));}
  };
}
function plan(name='Routenentwurf',latitude=49.1){
  return {name,model:'matrice4t',speed:5,takeoffHeight:30,rthHeight:100,
    finishAction:'goHome',timestamp:1792573200000,
    waypoints:[{lat:latitude,lon:8.6,height:50,photo:false},
      {lat:latitude+.001,lon:8.601,height:50,photo:false}]};
}
function savedDb(){
  const first=library.save(library.blank(),{name:'Feld. Nord',plan:plan(),savedAt:1});
  return library.save(first.library,{routeId:first.routeId,name:'Feld. Nord',
    plan:plan('Routenentwurf',49.12),savedAt:2}).library;
}
function harness(opts={}){
  const memory=storage(),calls=[],status=[];
  let failureCount=opts.failures||0;
  const uploader={async upload(token,bytes,name){
    assert.equal(token,'','LAN mode must not transmit authorization');
    assert.ok(bytes instanceof Uint8Array);
    assert.match(name,/ R\d+ V\d+ H[0-9a-f]{16}$/);
    assert.doesNotMatch(name,/[._/\\]/);
    assert.equal(planner.normalize({...plan(),name}).name,name);
    calls.push({name,bytes});
    if(failureCount-->0)throw new Error('MinIO offline');
    return {id:'aaaaaaaa-aaaa-8aaa-8aaa-aaaaaaaaaaaa',created:true};
  }};
  const engine=syncModule.create({storage:memory,library,planner,store:uploader,
    cryptoApi:webcrypto,onStatus:e=>status.push(e)});
  return {memory,calls,status,engine};
}
test('all existing local revisions require explicit opt-in and are idempotent',async()=>{
  const app=harness(),db=savedDb();
  assert.deepEqual(await app.engine.sync(db),{disabled:true});
  assert.equal(app.calls.length,0);
  app.engine.setEnabled(true);
  const first=await app.engine.sync(db);
  assert.equal(first.uploaded,2);
  assert.equal(first.failed,0);
  assert.equal(app.calls.length,2);
  assert.notEqual(app.calls[0].name,app.calls[1].name);
  const second=await app.engine.sync(db);
  assert.equal(second.uploaded,0);
  assert.equal(second.skipped,2);
  assert.equal(app.calls.length,2);
  assert.equal(JSON.parse(app.memory.getItem(syncModule.RECEIPTS_KEY)).length,2);
});
test('cloned local route with identical original plan is a separate KMZ',async()=>{
  const app=harness();let db=savedDb();
  db=library.copy(db,1,{name:'Feld Nord Kopie',savedAt:3}).library;
  app.engine.setEnabled(true);
  const result=await app.engine.sync(db);
  assert.equal(result.uploaded,3);
  assert.equal(new Set(app.calls.map(c=>c.name)).size,3);
  assert.notDeepEqual(app.calls[0].bytes,app.calls[2].bytes);
});
test('failed uploads are never acknowledged; later sync resumes without erasing local data',async()=>{
  const app=harness({failures:1}),db=savedDb();
  app.engine.setEnabled(true);
  const first=await app.engine.sync(db);
  assert.equal(first.failed,1);
  assert.equal(first.uploaded,1);
  const receipts=JSON.parse(app.memory.getItem(syncModule.RECEIPTS_KEY));
  assert.equal(receipts.length,1);
  const second=await app.engine.sync(db);
  assert.equal(second.uploaded,1);
  assert.equal(second.skipped,1);
  assert.equal(JSON.parse(app.memory.getItem(syncModule.RECEIPTS_KEY)).length,2);
});
test('new revisions require another explicit sync call; disabling stops writes',async()=>{
  const app=harness();let db=savedDb();
  app.engine.setEnabled(true);
  await app.engine.sync(db);
  db=library.save(db,{routeId:1,name:'Feld. Nord',
    plan:plan('Routenentwurf',49.15),savedAt:3}).library;
  const next=await app.engine.sync(db);
  assert.equal(next.uploaded,1);
  assert.equal(app.calls.length,3);
  app.engine.setEnabled(false);
  assert.deepEqual(await app.engine.sync(db),{disabled:true});
  assert.equal(app.calls.length,3);
});
test('HTTP authorization denial stops batch immediately',async()=>{
  const memory=storage();let calls=0;
  const engine=syncModule.create({storage:memory,library,planner,cryptoApi:webcrypto,
    store:{async upload(){calls++;throw new Error('Zugriff verweigert (401)');}}});
  engine.setEnabled(true);
  const result=await engine.sync(savedDb());
  assert.equal(result.blocked,true);
  assert.equal(calls,1);
  assert.equal(memory.getItem(syncModule.RECEIPTS_KEY),null);
});
test('migration controls are present, and existing local JSON export remains untouched',()=>{
  const root=path.join(__dirname,'../../frontend/public');
  const html=fs.readFileSync(path.join(root,'wpml-route-library.html'),'utf8');
  const js=fs.readFileSync(path.join(root,'wpml-route-library.js'),'utf8');
  const source=fs.readFileSync(path.join(root,'wpml-route-sync.js'),'utf8');
  for(const id of ['route-sync-enable','route-sync-now','route-sync-disable','route-sync-status'])
    assert.ok(html.includes('id="'+id+'"'),id);
  assert.ok(html.indexOf('/wpml-route-sync.js')<html.indexOf('/wpml-route-library.js'));
  assert.match(js,/window\.confirm\('Alle bisher lokal gespeicherten/);
  assert.match(js,/addEventListener\('click',saveToMinioManually\)/);
  assert.doesNotMatch(js,/triggerSync\(\)/);
  assert.doesNotMatch(js,/sync\.sync\(library\).*?persist\(/s);
  assert.match(source,/ENABLED_KEY/);
  assert.doesNotMatch(source,/\/api\/mission\/create|flighttask_execute|mqtt\.connect/);
  assert.match(js,/backup\.exportBackup\(library\)/);
});
