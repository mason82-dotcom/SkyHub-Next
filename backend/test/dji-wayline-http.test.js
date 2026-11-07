'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const express=require('express');
const {createDjiWaylineRouter,UPLOAD_DISABLED_CODE}=require('../dji-wayline-http');
const {pilotConfiguration}=require('../pilot-config');

const WS='0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const A='11111111-1111-8111-8111-111111111111';
const B='22222222-2222-8222-8222-222222222222';
function fakeStore(){
  const rows=[
    {id:A,name:'Alpha',objectKey:'missions/'+A+'.kmz',sign:'a'.repeat(32),droneModelKey:'0-77-2',
      payloadModelKeys:['1-68-0'],templateTypes:[0],username:'SkyHub',createTime:2000,startPoint:{lat:49.1525,lon:8.6044}},
    {id:B,name:'Bravo',objectKey:'missions/'+B+'.kmz',sign:'b'.repeat(32),droneModelKey:'0-99-0',
      payloadModelKeys:['1-88-0'],templateTypes:[0],username:null,createTime:1000}
  ];
  return {
    async all(){return rows;},
    async describe(id){const r=rows.find(x=>x.id===id);if(!r)throw Object.assign(new Error('nf'),{status:404});return r;},
    async duplicateNames(names){return rows.map(r=>r.name).filter(n=>names.includes(n));},
    async downloadUrl(id){await this.describe(id);return 'https://pi.lan:9446/skyhub-wpml/missions/'+id+'.kmz?X-Amz-Signature=x';}
  };
}
function memoryFavorites(){
  const set=new Set();
  return {set,async list(){return new Set(set);},async add(_w,ids){ids.forEach(i=>set.add(i));},
    async remove(_w,ids){ids.forEach(i=>set.delete(i));}};
}
async function serve({secure=true}={}){
  const favorites=memoryFavorites();
  const app=express();
  app.use((req,_res,next)=>{Object.defineProperty(req,'secure',{value:secure});next();});
  app.use(createDjiWaylineRouter({workspace:WS,store:fakeStore(),favorites,log:()=>{},
    authorize:async token=>token==='good-token'?{role:'pilot',workspaceId:WS}:
      token==='other'?{role:'pilot',workspaceId:'ffffffff-ffff-4fff-8fff-ffffffffffff'}:null}));
  const server=http.createServer(app);
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base='http://127.0.0.1:'+server.address().port+'/wayline/api/v1/workspaces/'+WS;
  const call=(p,opt={})=>fetch(base+p,{redirect:'manual',...opt,
    headers:{'x-auth-token':'good-token',...(opt.headers||{})}});
  return {server,base,call,favorites};
}

test('wayline list follows the DJI PaginationData contract with filters and order',async()=>{
  const {server,call}=await serve();
  try{
    let res=await call('/waylines?order_by=update_time%20desc&page=1&page_size=10');
    assert.equal(res.status,200);
    let body=await res.json();
    assert.equal(body.code,0);
    assert.equal(body.message,'success');
    assert.deepEqual(body.data.pagination,{page:1,page_size:10,total:2});
    assert.deepEqual(Object.keys(body.data.list[0]).sort(),['action_type','create_time','drone_model_key','favorited',
      'id','name','object_key','payload_model_keys','sign','start_wayline_point','template_types','update_time','user_name']);
    assert.equal(body.data.list[0].name,'Alpha');
    assert.equal(body.data.list[1].user_name,'SkyHub');
    res=await call('/waylines?order_by=name%20desc');
    assert.equal((await res.json()).data.list[0].name,'Bravo');
    res=await call('/waylines?drone_model_keys=0-99-0');
    body=await res.json();
    assert.deepEqual(body.data.list.map(w=>w.name),['Bravo']);
    res=await call('/waylines?template_type=1');
    assert.equal((await res.json()).data.pagination.total,0);
    res=await call('/waylines?page_size=1&page=2&order_by=create_time%20asc');
    assert.deepEqual((await res.json()).data.list.map(w=>w.name),['Alpha']);
    res=await call('/waylines?key=alp');
    assert.equal((await res.json()).data.pagination.total,1);
    for(const q of ['order_by=drop%20table','page=0','page_size=1000','template_type=9','favorited=maybe'])
      assert.equal((await call('/waylines?'+q)).status,400,q);
  }finally{server.close();}
});

test('favorites, duplicate names and presigned download redirect',async()=>{
  const {server,call,favorites}=await serve();
  try{
    let res=await call('/favorites?id='+A,{method:'POST'});
    assert.equal((await res.json()).code,0);
    assert.ok(favorites.set.has(A));
    res=await call('/waylines?favorited=true');
    let body=await res.json();
    assert.deepEqual(body.data.list.map(w=>[w.name,w.favorited]),[['Alpha',true]]);
    res=await call('/favorites?id=00000000-0000-8000-8000-000000000000',{method:'POST'});
    assert.equal(res.status,404);
    res=await call('/favorites?id=bad',{method:'POST'});
    assert.equal(res.status,400);
    res=await call('/favorites?id='+A,{method:'DELETE'});
    assert.equal((await res.json()).code,0);
    assert.equal(favorites.set.size,0);
    res=await call('/waylines/duplicate-names?name=Alpha&name=Neu');
    body=await res.json();
    assert.deepEqual(body.data,['Alpha']);
    assert.equal((await call('/waylines/duplicate-names')).status,400);
    res=await call('/waylines/'+A+'/url');
    assert.equal(res.status,302);
    assert.match(res.headers.get('location'),/^https:\/\/pi\.lan:9446\/skyhub-wpml\/missions\//);
    assert.equal((await call('/waylines/not-a-uuid/url')).status,400);
  }finally{server.close();}
});

test('Pilot 2 uploads are refused explicitly, never acknowledged as success',async()=>{
  const {server,call}=await serve();
  try{
    const res=await call('/upload-callback',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({object_key:'x/y.kmz',name:'y',metadata:{}})});
    const body=await res.json();
    assert.equal(body.code,UPLOAD_DISABLED_CODE);
    assert.notEqual(body.code,0);
  }finally{server.close();}
});

test('HTTPS, workspace and Pilot token are enforced on every route',async()=>{
  let {server,call,base}=await serve();
  try{
    assert.equal((await call('/waylines',{headers:{'x-auth-token':'nope'}})).status,403);
    assert.equal((await call('/waylines',{headers:{'x-auth-token':'other'}})).status,403);
    assert.equal((await fetch(base+'/waylines')).status,401);
    assert.equal((await fetch(base.replace(WS,'ffffffff-ffff-4fff-8fff-ffffffffffff')+'/waylines',
      {headers:{'x-auth-token':'good-token'}})).status,404);
  }finally{server.close();}
  ({server,call}=await serve({secure:false}));
  try{assert.equal((await call('/waylines')).status,403);}
  finally{server.close();}
});

test('Pilot bootstrap offers the mission module only when explicitly enabled over HTTPS',()=>{
  const env={SKYHUB_PILOT_PUBLIC_URL:'https://pi.lan:8443/'};
  assert.equal(pilotConfiguration(env).wayline.enabled,false);
  const on=pilotConfiguration({...env,SKYHUB_PILOT_WAYLINE_ENABLED:'true'});
  assert.equal(on.wayline.enabled,true);
  assert.equal(on.wayline.apiHost,'https://pi.lan:8443');
  const bad=pilotConfiguration({SKYHUB_PILOT_PUBLIC_URL:'http://pi.lan/',SKYHUB_PILOT_WAYLINE_ENABLED:'true'});
  assert.equal(bad.wayline.enabled,false);
  assert.match(bad.wayline.issue,/HTTPS/);
});

test('wayline list: action_type 0, AI spot-check filter empty, start point from the release (start_lontitude sic)',async()=>{
  const {server,call}=await serve();
  try{
    let body=await (await call('/waylines?order_by=name%20asc')).json();
    const alpha=body.data.list.find(w=>w.name==='Alpha'),bravo=body.data.list.find(w=>w.name==='Bravo');
    assert.equal(alpha.action_type,0);
    assert.deepEqual(alpha.start_wayline_point,{start_latitude:49.1525,start_lontitude:8.6044});
    assert.equal('start_wayline_point' in bravo,false,'no start point known: field omitted (optional in DJI)');
    body=await (await call('/waylines?action_type=1')).json();
    assert.deepEqual(body.data,{list:[],pagination:{page:1,page_size:10,total:0}});
    assert.equal((await call('/waylines?action_type=7')).status,400);
  }finally{server.close();}
});
