'use strict';
// Mission release (risk register M1/M2/M4/M5/M6): only released, checked revisions reach the DJI Pilot 2 library.
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const http=require('node:http');
const express=require('express');
const planner=require('../../frontend/public/wpml-editor-core');
const {waylineId}=require('../wpml-mission-store');
const {releaseConfig,releasedLibrary,pilotLibrary,createMissionReleaseRouter,tokenMatches,CHECKLIST,createReleaseStore}=require('../mission-release');

const TOKEN='r'.repeat(40);
function plan(height=50){
  return {name:'Feld Nord',model:'mavic3m',speed:5,transitionSpeed:5,takeoffHeight:30,finishAction:'goHome',timestamp:1792573200000,
    waypoints:[{lat:49.12345,lon:8.56789,height,photo:false},{lat:49.12445,lon:8.56889,height,photo:false}]};
}
function entry(bytes,over={}){
  const sha256=crypto.createHash('sha256').update(bytes).digest('hex'),id=waylineId(sha256);
  return {id,sha256,name:'Feld Nord',rootId:id,generation:1,droneModelKey:'0-77-2',payloadModelKeys:['1-68-0'],bytes,...over};
}
function fakeStore(items){
  return {
    async all(){return items.map(({bytes,...meta})=>meta);},
    async get(id){const i=items.find(x=>x.id===id);if(!i){const e=new Error('Wayline not found');e.status=404;throw e;}return {bytes:i.bytes,name:i.name};},
    async downloadUrl(id){return 'https://minio.example/'+id;},
    async duplicateNames(){return [];}
  };
}
function fakeReleases(){
  const rows=[];let next=1;
  const t=()=>Date.now();
  return {rows,
    async active(){return rows.filter(r=>!r.revokedAt&&r.expiresAt>t());},
    async history(ids){return rows.filter(r=>ids.includes(r.waylineId)).reverse();},
    async release(e){
      for(const r of rows)if(r.rootId===e.rootId&&!r.revokedAt){r.revokedAt=t();r.revokeReason='ersetzt';}
      const r={id:next++,...e,releasedAt:e.releasedAt.getTime(),expiresAt:e.expiresAt.getTime(),revokedAt:null};
      rows.push(r);return r;
    },
    async revoke(id,{reason}){const hit=rows.filter(r=>r.waylineId===id&&!r.revokedAt);hit.forEach(r=>{r.revokedAt=t();r.revokeReason=reason;});return hit;}
  };
}
async function serve(router){
  const app=express();app.use(express.json());app.use('/api/wpml/release',router);
  const server=http.createServer(app);
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base='http://127.0.0.1:'+server.address().port+'/api/wpml/release';
  const call=async(method,path,body,token)=>{
    const res=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(token?{'X-SkyHub-Release-Token':token}:{})},
      body:body===undefined?undefined:JSON.stringify(body)});
    return {status:res.status,body:await res.json()};
  };
  return {call,close:()=>new Promise(r=>server.close(r))};
}
const allChecked=Object.fromEntries(Object.keys(CHECKLIST).map(k=>[k,true]));

test('configuration: off by default, token rules, limits only tighten',()=>{
  assert.equal(releaseConfig({}).enabled,false);
  assert.match(releaseConfig({SKYHUB_MISSION_RELEASE_ENABLED:'true',SKYHUB_MISSION_RELEASE_TOKEN:'short'}).issue,/32 characters/);
  assert.match(releaseConfig({SKYHUB_MISSION_RELEASE_ENABLED:'true',SKYHUB_MISSION_RELEASE_TOKEN:TOKEN,SKYHUB_VIEW_TOKEN:TOKEN}).issue,/differ/);
  assert.match(releaseConfig({SKYHUB_MISSION_RELEASE_ENABLED:'true',SKYHUB_MISSION_RELEASE_TOKEN:TOKEN,SKYHUB_MISSION_MAX_HEIGHT_M:'200'}).issue,/120/);
  const ok=releaseConfig({SKYHUB_MISSION_RELEASE_ENABLED:'true',SKYHUB_MISSION_RELEASE_TOKEN:TOKEN,SKYHUB_MISSION_RELEASE_HOURS:'24'});
  assert.equal(ok.enabled,true);assert.equal(ok.hours,24);
  assert.equal(tokenMatches(TOKEN,TOKEN),true);
  assert.equal(tokenMatches('x',TOKEN),false);
  assert.equal(tokenMatches(undefined,TOKEN),false);
});

test('Pilot 2 library shows only active releases bound to the stored bytes',async()=>{
  const a=entry(Buffer.from(planner.build(plan(50)).kmz)),b=entry(Buffer.from(planner.build(plan(60)).kmz));
  const releases=fakeReleases(),lib=releasedLibrary(fakeStore([a,b]),releases,{log:()=>{}});
  assert.deepEqual(await lib.all(),[],'nothing released: nothing visible (M1)');
  await assert.rejects(lib.downloadUrl(a.id),/not released/);
  const now=new Date();
  await releases.release({waylineId:a.id,rootId:a.rootId,sha256:a.sha256,droneModelKey:'0-77-2',releasedAt:now,expiresAt:new Date(now.getTime()+3600e3)});
  assert.deepEqual((await lib.all()).map(w=>w.id),[a.id]);
  assert.equal(await lib.downloadUrl(a.id),'https://minio.example/'+a.id);
  await assert.rejects(lib.downloadUrl(b.id),/not released/);
  // A release whose hash does not belong to the id (tampered row) is ignored.
  releases.rows[0].sha256=b.sha256;
  assert.deepEqual(await lib.all(),[]);
  // Expired releases disappear.
  releases.rows[0].sha256=a.sha256;releases.rows[0].expiresAt=Date.now()-1;
  assert.deepEqual(await lib.all(),[]);
});

test('database failure hides the whole library (fail-closed)',async()=>{
  const a=entry(Buffer.from(planner.build(plan()).kmz)),logs=[];
  const lib=releasedLibrary(fakeStore([a]),{async active(){throw new Error('connection refused');}},{log:m=>logs.push(m)});
  assert.deepEqual(await lib.all(),[]);
  await assert.rejects(lib.downloadUrl(a.id),/not released/);
  assert.match(logs[0],/database unavailable/);
});

test('release flow: token, check, warnings, checklist, hash; one active release per route family; revoke',async()=>{
  const a=entry(Buffer.from(planner.build(plan(50)).kmz)),b=entry(Buffer.from(planner.build(plan(70)).kmz));
  b.rootId=a.id;b.generation=2;                              // b is a later revision of a
  const releases=fakeReleases(),audit=[];
  const config=releaseConfig({SKYHUB_MISSION_RELEASE_ENABLED:'true',SKYHUB_MISSION_RELEASE_TOKEN:TOKEN});
  const srv=await serve(createMissionReleaseRouter({express,store:fakeStore([a,b]),releases,config,audit:e=>audit.push(e)}));
  try{
    const info=await srv.call('GET','/'+a.id);
    assert.equal(info.status,200);
    assert.equal(info.body.check.ok,true);
    assert.equal(info.body.active,null);
    const body={sha256:info.body.sha256,acknowledgedWarnings:info.body.check.warnings,checklist:allChecked};
    let r=await srv.call('POST','/'+a.id+'/release',body);
    assert.equal(r.status,403,'no release token');
    r=await srv.call('POST','/'+a.id+'/release',body,'falsch'.repeat(8));
    assert.equal(r.status,403);
    assert.equal(audit.filter(e=>e.action==='denied').length,2);
    r=await srv.call('POST','/'+a.id+'/release',{...body,acknowledgedWarnings:[]},TOKEN);
    assert.equal(r.status,409);assert.ok(r.body.missing.length>0);
    r=await srv.call('POST','/'+a.id+'/release',{...body,checklist:{airspace:true}},TOKEN);
    assert.equal(r.status,409);assert.match(r.body.error,/Checkliste/);
    r=await srv.call('POST','/'+a.id+'/release',{...body,sha256:'0'.repeat(64)},TOKEN);
    assert.equal(r.status,409);assert.match(r.body.error,/geändert/);
    r=await srv.call('POST','/'+a.id+'/release',{...body,hours:500},TOKEN);
    assert.equal(r.status,400);
    r=await srv.call('POST','/'+a.id+'/release',body,TOKEN);
    assert.equal(r.status,201);
    assert.equal(r.body.release.droneModelKey,'0-77-2');
    assert.ok(r.body.release.expiresAt-r.body.release.releasedAt<=72*3600e3+1000);
    // Releasing the later revision supersedes the earlier one (same family).
    const infoB=await srv.call('GET','/'+b.id);
    r=await srv.call('POST','/'+b.id+'/release',{sha256:infoB.body.sha256,acknowledgedWarnings:infoB.body.check.warnings,checklist:allChecked},TOKEN);
    assert.equal(r.status,201);
    const active=await releases.active();
    assert.deepEqual(active.map(x=>x.waylineId),[b.id]);
    const overview=await srv.call('GET','/');
    assert.equal(overview.status,200);
    assert.deepEqual(overview.body.active.map(x=>x.waylineId),[b.id]);
    assert.equal('envelope' in overview.body.active[0],false);
    assert.equal(overview.body.active[0].visible,true);
    // A release whose route no longer matches (e.g. other aircraft in the stored metadata) is active but not visible.
    b.droneModelKey='0-99-1';
    const stale=await srv.call('GET','/');
    assert.equal(stale.body.active[0].visible,false);
    b.droneModelKey='0-77-2';
    r=await srv.call('DELETE','/'+b.id+'/release',{reason:'Wetter'},TOKEN);
    assert.equal(r.status,200);
    assert.deepEqual(await releases.active(),[]);
    r=await srv.call('DELETE','/'+b.id+'/release',{},TOKEN);
    assert.equal(r.status,404);
    assert.deepEqual(audit.filter(e=>e.action!=='denied').map(e=>e.action),['release','release','revoke','revoke']);
    assert.ok(!JSON.stringify(audit).includes(TOKEN),'audit never contains the token');
  }finally{await srv.close();}
});

test('a route that fails the check cannot be released',async()=>{
  // The editor refuses > 120 m itself; imported KMZs (other tools, Pilot 2 exports) are not limited that way.
  const {readKmz,packageKmz}=require('../wpml-kmz');
  const d=readKmz(Buffer.from(planner.build(plan(50)).kmz));
  const high=entry(packageKmz(d.template,d.waylines.replace(/<wpml:executeHeight>50</g,'<wpml:executeHeight>130<')));
  const config=releaseConfig({SKYHUB_MISSION_RELEASE_ENABLED:'true',SKYHUB_MISSION_RELEASE_TOKEN:TOKEN});
  const srv=await serve(createMissionReleaseRouter({express,store:fakeStore([high]),releases:fakeReleases(),config,audit:()=>{}}));
  try{
    const info=await srv.call('GET','/'+high.id);
    assert.equal(info.body.check.ok,false);
    const r=await srv.call('POST','/'+high.id+'/release',{sha256:info.body.sha256,acknowledgedWarnings:info.body.check.warnings,checklist:allChecked},TOKEN);
    assert.equal(r.status,422);
    assert.ok(r.body.check.errors.some(e=>/exceeds 120/.test(e)));
    assert.equal((await srv.call('GET','/nicht-uuid')).status,400);
    assert.equal((await srv.call('GET','/'+'0'.repeat(8)+'-0000-8000-8000-'+'0'.repeat(12))).status,404);
  }finally{await srv.close();}
});

test('release store: schema once, superseding in one transaction, rollback on failure',async()=>{
  const log=[];let failInsert=false;
  const client={async query(sql,params){log.push(sql.trim().split(/\s+/).slice(0,2).join(' '));
      if(failInsert&&/^INSERT/.test(sql.trim()))throw new Error('boom');
      if(/^INSERT/.test(sql.trim()))return {rows:[{id:1,wayline_id:params[0],root_id:params[1],sha256:params[2],name:params[3],drone_model_key:params[4],
        payload_model_keys:params[5],envelope:{},acknowledged:{},released_at:params[8],expires_at:params[9],released_from:params[10]}]};
      return {rows:[]};},
    release(){log.push('client.release');}};
  const pool={async query(sql){log.push(sql.includes('CREATE TABLE')?'schema':sql.trim().split(/\s+/)[0]);return {rows:[]};},async connect(){return client;}};
  const store=createReleaseStore(pool);
  const e={waylineId:'a',rootId:'a',sha256:'f'.repeat(64),name:'n',droneModelKey:'0-77-2',payloadModelKeys:[],envelope:{},acknowledged:{},
    releasedAt:new Date(),expiresAt:new Date(Date.now()+1000),from:'1.2.3.4'};
  const r=await store.release(e);
  assert.equal(r.droneModelKey,'0-77-2');
  await store.active();
  assert.deepEqual(log.filter(x=>x==='schema').length,1);
  assert.deepEqual(log.slice(1,5),['BEGIN','UPDATE wpml_mission_release','INSERT INTO','COMMIT']);
  failInsert=true;log.length=0;
  await assert.rejects(store.release(e),/boom/);
  assert.ok(log.includes('ROLLBACK')&&log.includes('client.release'));
  assert.throws(()=>createReleaseStore(null),/PostgreSQL/);
});

test('without mission release Pilot 2 sees no route at all (fail-closed, risk M1)',async()=>{
  const a=entry(Buffer.from(planner.build(plan()).kmz));
  const lib=pilotLibrary(fakeStore([a]),null);
  assert.deepEqual(await lib.all(),[]);
  await assert.rejects(lib.downloadUrl(a.id),e=>e.status===404);
  assert.equal(typeof lib.duplicateNames,'function','other store functions stay available');
  const withRelease=pilotLibrary(fakeStore([a]),fakeReleases());
  assert.deepEqual(await withRelease.all(),[]);
});

test('server wires the Pilot 2 library only through pilotLibrary',()=>{
  const src=require('node:fs').readFileSync(require('node:path').join(__dirname,'../server.js'),'utf8');
  assert.match(src,/const pilotRoutes=pilotLibrary\(wpmlStore,releaseStore\)/);
  assert.match(src,/store:pilotRoutes,favorites/);
  assert.doesNotMatch(src,/createDjiWaylineRouter\(\{[^}]*store:wpmlStore/);
});

test('compose passes the release settings to the backend (default off)',()=>{
  const compose=require('node:fs').readFileSync(require('node:path').join(__dirname,'../../docker-compose.yml'),'utf8');
  assert.match(compose,/SKYHUB_MISSION_RELEASE_ENABLED: \$\{SKYHUB_MISSION_RELEASE_ENABLED:-false\}/);
  assert.match(compose,/SKYHUB_MISSION_RELEASE_TOKEN: \$\{SKYHUB_MISSION_RELEASE_TOKEN:-\}/);
  for(const k of ['HEIGHT_M','RTH_HEIGHT_M','SPEED_MS','DURATION_MIN','DISTANCE_M'])assert.ok(compose.includes('SKYHUB_MISSION_MAX_'+k+':'),k);
});
