'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const http=require('node:http');
const express=require('express');
const {flighthubConfig,createFlightHubRouteSource,createFlightHubImportRouter,missionName}=require('../flighthub-route-source');

const KMZ=Buffer.from('PK\u0003\u0004 synthetic kmz bytes');
const ID=crypto.createHash('sha256').update(KMZ).digest('hex').slice(0,16);

// fetch double: answers by path, records requested URLs.
function fakeFetch(routes){
  const calls=[];
  const fn=async(url,opts)=>{
    calls.push({url,redirect:opts.redirect});
    const path=new URL(url).pathname;
    const r=routes[path];
    if(r instanceof Error)throw r;
    if(!r)return new Response('{}',{status:404});
    return new Response(r.body,{status:r.status||200,headers:r.headers||{}});
  };
  fn.calls=calls;
  return fn;
}
const listBody=items=>({body:JSON.stringify(items)});

test('config accepts only plain home-LAN origins',()=>{
  assert.deepEqual(flighthubConfig({}),{enabled:false,issue:null,base:null});
  assert.equal(flighthubConfig({SKYHUB_FLIGHTHUB_URL:'http://192.168.178.50:3003'}).base,'http://192.168.178.50:3003');
  assert.equal(flighthubConfig({SKYHUB_FLIGHTHUB_URL:'http://brix-node:3003/'}).enabled,true);
  for(const bad of ['https://example.com','http://8.8.8.8:3003','http://192.168.178.50:3003/api','http://u:p@10.0.0.1',
    'ftp://10.0.0.1','http://10.0.0.1/?x=1','not a url']){
    const c=flighthubConfig({SKYHUB_FLIGHTHUB_URL:bad});
    assert.equal(c.enabled,false,bad);assert.match(c.issue,/home-LAN origin/,bad);
  }
});

test('list maps only safe fields, kmz checks the SHA-256 against the id, fixed paths only',async()=>{
  const f=fakeFetch({
    '/api/waylines':listBody([{id:ID,name:'Kapelle.kmz',modelName:'Mavic 3E',waypoints:12,distanceM:800,points:[[49,8]],
      plan:[{lat:49}],issues:['x'],origin:'droneroute',addedAt:5},{id:'../etc',name:'bad'},null]),
    ['/api/waylines/'+ID+'/kmz']:{body:KMZ}
  });
  const s=createFlightHubRouteSource({base:'http://192.168.178.50:3003',fetchImpl:f});
  const list=await s.list();
  assert.equal(list.length,1);
  assert.equal(list[0].name,'Kapelle.kmz');
  assert.equal(list[0].model,'Mavic 3E');
  assert.ok(!('points' in list[0])&&!('plan' in list[0]));     // no coordinates passed on
  const {bytes,sha256}=await s.kmz(ID);
  assert.deepEqual(bytes,KMZ);assert.ok(sha256.startsWith(ID));
  await assert.rejects(s.kmz('../../x'),/Invalid FlightHub route id/);
  assert.ok(f.calls.every(c=>c.url.startsWith('http://192.168.178.50:3003/api/waylines')&&c.redirect==='error'));
});

test('wrong bytes, oversize, unreachable and HTTP errors fail closed',async()=>{
  const other='0123456789abcdef';
  const big=Buffer.alloc(13*1024*1024);
  const f=fakeFetch({
    ['/api/waylines/'+other+'/kmz']:{body:KMZ},
    ['/api/waylines/'+ID+'/kmz']:{body:big},
    '/api/waylines':new TypeError('fetch failed')
  });
  const s=createFlightHubRouteSource({base:'http://10.0.0.2:3003',fetchImpl:f});
  await assert.rejects(s.kmz(other),e=>e.status===502&&/does not match/.test(e.message));
  await assert.rejects(s.kmz(ID),e=>e.status===502&&/too large/.test(e.message));
  await assert.rejects(s.list(),e=>e.status===502&&/not reachable/.test(e.message));
  const g=createFlightHubRouteSource({base:'http://10.0.0.2:3003',fetchImpl:fakeFetch({'/api/waylines':{body:'nope',status:500}})});
  await assert.rejects(g.list(),e=>e.status===502&&/HTTP 500/.test(e.message));
  const e=createFlightHubRouteSource({base:'http://10.0.0.2:3003',fetchImpl:fakeFetch({'/api/waylines':{body:null,status:204}})});
  await assert.rejects(e.list(),e2=>e2.status===502);
  const h=createFlightHubRouteSource({base:'http://10.0.0.2:3003',fetchImpl:fakeFetch({'/api/waylines':{body:'{"a":1}'}})});
  await assert.rejects(h.list(),/unreadable/);
});

test('mission names follow the DJI rules',()=>{
  assert.equal(missionName('Gebietsroute_erstellen3.kmz',ID),'Gebietsroute erstellen3');
  assert.equal(missionName('a.b:c*?d',ID),'a b c d');
  assert.equal(missionName('...',ID),'FlightHub '+ID.slice(0,8));
  assert.equal(missionName('x'.repeat(100),ID).length,64);
});

async function serve(router){
  const app=express();app.use(express.json());app.use('/api/wpml/missions',router);
  const server=http.createServer(app);await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base='http://127.0.0.1:'+server.address().port+'/api/wpml/missions';
  return {base,close:()=>new Promise(r=>server.close(r))};
}

test('import stores via store.put as origin flighthub, never released, audit without coordinates',async()=>{
  const puts=[],audits=[];
  const store={async put(bytes,opts){puts.push({bytes,opts});
    return {id:'11111111-2222-4333-8444-555555555555',name:opts.name,created:puts.length===1,droneModelKey:'0-77-0',waypointCount:12};}};
  const source=createFlightHubRouteSource({base:'http://10.0.0.2:3003',fetchImpl:fakeFetch({
    '/api/waylines':listBody([{id:ID,name:'See_Rutsche.kmz',modelName:'Mavic 3E',waypoints:12,points:[[49.1,8.6]]}]),
    ['/api/waylines/'+ID+'/kmz']:{body:KMZ}})});
  const srv=await serve(createFlightHubImportRouter({express,source,store,audit:e=>audits.push(e)}));
  try{
    let r=await fetch(srv.base+'/flighthub');
    assert.equal(r.status,200);
    assert.equal((await r.json()).items[0].id,ID);
    const post=body=>fetch(srv.base+'/import/flighthub',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    r=await post({id:ID});
    assert.equal(r.status,201);
    const out=await r.json();
    assert.equal(out.released,false);assert.equal(out.created,true);
    assert.deepEqual(puts[0].bytes,KMZ);
    assert.deepEqual(puts[0].opts,{name:'See Rutsche',username:'FlightHub',origin:'flighthub'});
    r=await post({id:ID});
    assert.equal(r.status,200);                                  // same bytes again: already stored
    assert.equal(audits.length,2);
    assert.equal(audits[0].flighthubId,ID);
    assert.doesNotMatch(JSON.stringify(audits),/49\.1|8\.6/);
    r=await post({id:'zz'});assert.equal(r.status,400);
    r=await post({id:'0123456789abcdef'});assert.equal(r.status,404);
  }finally{await srv.close();}
});

test('store validation errors reach the operator, storage errors stay generic',async()=>{
  const source=createFlightHubRouteSource({base:'http://10.0.0.2:3003',fetchImpl:fakeFetch({
    '/api/waylines':listBody([{id:ID,name:'Route'}]),['/api/waylines/'+ID+'/kmz']:{body:KMZ}})});
  const invalid=Object.assign(new Error('WPML validation failed'),{status:422,details:{errors:[{path:'waylines',message:'executeHeightMode missing'}]}});
  let srv=await serve(createFlightHubImportRouter({express,source,store:{put:async()=>{throw invalid;}},audit:()=>{}}));
  try{
    const r=await fetch(srv.base+'/import/flighthub',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:ID})});
    assert.equal(r.status,422);
    assert.equal((await r.json()).errors[0].message,'executeHeightMode missing');
  }finally{await srv.close();}
  srv=await serve(createFlightHubImportRouter({express,source,store:{put:async()=>{throw new Error('s3://secret-endpoint failed');}},audit:()=>{}}));
  try{
    const r=await fetch(srv.base+'/import/flighthub',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:ID})});
    assert.equal(r.status,503);
    assert.doesNotMatch(await r.text(),/secret/);
  }finally{await srv.close();}
});

test('without SKYHUB_FLIGHTHUB_URL both paths say "not configured"',async()=>{
  const srv=await serve(createFlightHubImportRouter({express,source:null,store:{put:async()=>{throw new Error('unused');}}}));
  try{
    for(const [m,p] of [['GET','/flighthub'],['POST','/import/flighthub']]){
      const r=await fetch(srv.base+p,{method:m});
      assert.equal(r.status,404);assert.equal((await r.json()).configured,false);
    }
  }finally{await srv.close();}
});
