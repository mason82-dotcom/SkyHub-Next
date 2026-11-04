'use strict';
// Map element write path against a real PostgreSQL with migrations 001 + 002 (SKYHUB_TEST_DATABASE_URL, database skyhub_test).
const test=require('node:test');
const assert=require('node:assert/strict');
const {Pool}=require('pg');
const express=require('express');
const {createMapElementWriter,registerPilotMapWrites,createMapElementRouter,MapWriteError}=require('../map-element-write');
const {createMapElementStore}=require('../map-element-store');

const URL_=process.env.SKYHUB_TEST_DATABASE_URL;
const WS='123e4567-e89b-42d3-a456-426614174000';

test('map elements: SkyHub + Pilot 2 write, audit, WebSocket push, read-back as Pilot 2 sees it',{skip:!URL_},async()=>{
  assert.match(new URL(URL_).pathname,/^\/skyhub_test$/,'only a test database');
  const pool=new Pool({connectionString:URL_});
  await pool.query('DELETE FROM dji_map_elements WHERE workspace_id=$1',[WS]);
  await pool.query('DELETE FROM dji_map_element_groups WHERE workspace_id=$1',[WS]);
  const pushes=[];
  const writer=createMapElementWriter({pool,workspaceId:WS,publish:m=>pushes.push(m),clock:()=>1700000000000});
  await writer.ensureGroup();await writer.ensureGroup();
  const app=express();app.use(express.json());
  app.use((req,res,next)=>{Object.defineProperty(req,'secure',{value:true});next();});
  app.use('/api/map-elements',createMapElementRouter({express,writer}));
  registerPilotMapWrites(app,{writer,workspaceId:WS,authorize:async t=>t==='pilot-token'?{role:'pilot',workspaceId:WS}:null});
  const srv=app.listen(0);await new Promise(r=>srv.once('listening',r));
  const base='http://127.0.0.1:'+srv.address().port;
  const call=(m,p,b,h={})=>fetch(base+p,{method:m,headers:{'Content-Type':'application/json',...h},body:b?JSON.stringify(b):undefined})
    .then(async r=>({status:r.status,body:await r.json()}));
  try{
    // SkyHub page: polygon
    const poly={type:'Polygon',coordinates:[[[8.6,49.15],[8.61,49.15],[8.61,49.16],[8.6,49.15]]]};
    const c=await call('POST','/api/map-elements',{name:'Sperrfläche',color:'#E23C39',geometry:poly});
    assert.equal(c.status,200,JSON.stringify(c.body));
    assert.equal(pushes[0].biz_code,'map_element_create');
    assert.equal(pushes[0].data.group_id,'skyhub-shared');
    assert.equal(pushes[0].data.resource.content.properties.color,'#E23C39');
    // Pilot 2: point into the shared group (DJI create)
    const pid='0b9b7e5e-6f6a-4a51-9d1e-1c2a3b4c5d6e';
    const p=await call('POST','/map/api/v1/workspaces/'+WS+'/element-groups/skyhub-shared/elements',
      {id:pid,name:'PILOT 1',resource:{type:0,user_name:'Mason',content:{type:'Feature',properties:{color:'#2D8CF0',clampToGround:true},
        geometry:{type:'Point',coordinates:[8.605,49.152]}}}},{'x-auth-token':'pilot-token'});
    assert.deepEqual(p.body,{code:0,message:'success',data:{id:pid}});
    assert.equal(pushes[1].data.resource.user_name,'Mason');
    assert.equal((await call('POST','/map/api/v1/workspaces/'+WS+'/element-groups/skyhub-shared/elements',{id:'x'},{'x-auth-token':'bad'})).status,401);
    // Pilot 2: update name, keep geometry; then delete
    const u=await call('PUT','/map/api/v1/workspaces/'+WS+'/elements/'+pid,{name:'PILOT Treffpunkt'},{'x-auth-token':'pilot-token'});
    assert.equal(u.body.code,0);assert.equal(pushes[2].biz_code,'map_element_update');assert.equal(pushes[2].data.name,'PILOT Treffpunkt');
    // read-back exactly as Pilot 2 gets it (GET element-groups)
    const read=await createMapElementStore(pool).readResponse(WS,{isDistributed:true});
    const g=read.data.find(x=>x.id==='skyhub-shared');
    assert.equal(g.elements.length,2);
    // invalid geometry and unknown element
    assert.equal((await call('POST','/api/map-elements',{name:'x',color:'#E23C39',geometry:{type:'Point',coordinates:[999,0]}})).status,400);
    assert.equal((await call('DELETE','/api/map-elements/nope')).status,404);
    const d=await call('DELETE','/map/api/v1/workspaces/'+WS+'/elements/'+pid,null,{'x-auth-token':'pilot-token'});
    assert.equal(d.body.code,0);assert.deepEqual(pushes[3].data,{id:pid,group_id:'skyhub-shared'});
    // audit trail: create, create, update, delete with the actor kind
    const {rows}=await pool.query('SELECT actor_id,action FROM dji_map_element_audit WHERE workspace_id=$1 ORDER BY 1,2',[WS]);
    assert.deepEqual(rows.map(r=>r.actor_id.split(':')[0]+'/'+r.action).sort(),['pilot/create','pilot/delete','pilot/update','skyhub/create']);
    // a group not distributed to Pilot 2 is refused for the RC
    await pool.query("INSERT INTO dji_map_element_groups (workspace_id,group_id,name,group_type,is_locked,is_distributed) VALUES ($1,'private','Privat',0,false,false)",[WS]);
    const priv=await call('POST','/map/api/v1/workspaces/'+WS+'/element-groups/private/elements',
      {id:'p2',name:'x',resource:{type:0,content:{type:'Feature',properties:{},geometry:{type:'Point',coordinates:[8,49]}}}},{'x-auth-token':'pilot-token'});
    assert.equal(priv.status,403);
    assert.ok(MapWriteError);
  }finally{srv.close();await pool.end();}
});
