'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createWpmlRouteService,createWpmlRouteStore,RouteError,
  validateActor,validatePlan,canonical}=require('../wpml-central-routes');
const A='e3dea0f5-37f2-4d79-ae58-490af3228069';
const B='203cc94c-aef1-4e0e-a520-05a24be33a31';
const HUMAN='69ecb38c-04f2-44d0-adc6-3441cb4f9449';
const actor=Object.freeze({kind:'human',source:'independent-operator-auth',
  role:'operator',id:HUMAN,workspaceId:A});
const plan=()=>({name:'Private survey route',model:'matrice4t',speed:5,
  takeoffHeight:30,finishAction:'goHome',waypoints:[
    {lat:49.12345,lon:8.56789,height:50,photo:false},
    {lat:49.12445,lon:8.56889,height:50,photo:false}]});
function pool(){
  const sql=[];
  return {sql,connect:async()=>({
    query:async(text,params=[])=>{
      sql.push({text,params});
      if(text.includes('SELECT route_id,route_name,latest_revision'))
        return {rowCount:0,rows:[]};
      if(text.includes('SELECT COUNT(*)'))return {rowCount:1,rows:[{count:0}]};
      return {rowCount:1,rows:[]};
    },
    release(){}
  })};
}
test('isolated service refuses creation without separately injected human resolver',()=>{
  assert.throws(()=>createWpmlRouteService({pool:pool()}),/Independent operator/);
  for(const impostor of [
    null,{...actor,kind:'pilot'}, {...actor,source:'pilot-2-pairing'},
    {...actor,source:'dashboard-view-token'},{...actor,role:'viewer'},
    {...actor,role:'pilot'}, {...actor,workspaceId:B},
    {...actor,id:'not uuid'}, {...actor,source:null}
  ])assert.equal(validateActor(impostor,A),false);
  assert.equal(validateActor(actor,A),true);
});
test('untrusted token, nonhuman DJI principal and cross-workspace identity cannot query DB',async()=>{
  const db=pool();
  const auth=async credential=>credential==='verified-session'?actor:null;
  const service=createWpmlRouteService({pool:db,authorize:auth});
  for(const credential of ['view-secret','pilot-token',''])await assert.rejects(
    service.listRoutes({credential,workspaceId:A}),{code:'unauthorized'});
  await assert.rejects(service.listRoutes({credential:'verified-session',workspaceId:B}),
    {code:'unauthorized'});
  await assert.rejects(service.listRoutes({credential:'verified-session',workspaceId:'BAD'}),
    {code:'invalid'});
  assert.equal(db.sql.length,0);
});
test('only a separately verified operator can execute parameterized, workspace-bound list',async()=>{
  const db=pool(),service=createWpmlRouteService({
    pool:db,authorize:async token=>token==='session'?actor:null});
  const result=await service.listRoutes({credential:'session',workspaceId:A,
    principal:{role:'admin',workspaceId:B}});
  assert.deepEqual(result,[]);
  assert.equal(db.sql.filter(q=>q.text.startsWith('SELECT route_id')).length,1);
  const q=db.sql.find(q=>q.text.startsWith('SELECT route_id'));
  assert.deepEqual(q.params,[A]);
  assert.match(q.text,/workspace_id=\$1/);
  assert.ok(!db.sql.some(q=>q.text.includes('INSERT')||q.text.includes('UPDATE')));
});
test('create validates canonical offline plans and produces no flight-ready artifacts',async()=>{
  const db=pool(),service=createWpmlRouteService({
    pool:db,authorize:async()=>actor});
  const result=await service.createRoute({credential:'session',workspaceId:A,
    name:'Private survey route',plan:plan()});
  assert.equal(result.revision,1);
  assert.equal(result.flightReady,false);
  assert.equal(result.dispatchAllowed,false);
  const statements=db.sql.map(x=>x.text);
  assert.deepEqual(statements.filter(x=>x==='BEGIN'||x==='COMMIT'),['BEGIN','COMMIT']);
  assert.ok(statements.some(x=>x.includes('pg_advisory_xact_lock')));
  const insert=db.sql.find(x=>x.text.includes('INSERT INTO skyhub_wpml_route_revisions'));
  assert.equal(insert.params[0],A);
  assert.equal(insert.params[2].includes('49.12345'),true);
  assert.equal(insert.params[4],HUMAN);
  assert.equal(Buffer.isBuffer(insert.params[3]),true);
  const audit=db.sql.find(x=>x.text.includes('INSERT INTO skyhub_wpml_route_audit'));
  assert.deepEqual(audit.params,[A,result.routeId,HUMAN]);
  assert.doesNotMatch(audit.text+JSON.stringify(audit.params),
    /49\.12345|8\.56789|Private survey route/);
  const db2=pool(),s2=createWpmlRouteService({pool:db2,authorize:async()=>actor});
  await assert.rejects(s2.createRoute({workspaceId:A,name:'Private survey route',
    plan:{...plan(),dispatchAllowed:true}}),{code:'invalid'});
  // Invalid payloads are rejected before acquiring a database client.
  assert.equal(db2.sql.length,0);
});
test('tampered plan attributes or unsupported fields reject without revealing GPS in errors',()=>{
  for(const input of [
    {...plan(),flightReady:true}, {...plan(),waypoints:[]},
    {...plan(),waypoints:[{lat:49.1,lon:8.5,height:50,photo:false,
      unrestrictedFlight:true},plan().waypoints[1]]},
    {...plan(),model:'unknown'}, {...plan(),speed:100000}
  ]){
    assert.throws(()=>validatePlan('Private survey route',input),{code:'invalid'});
    try{validatePlan('Private survey route',input);}catch(e){
      assert.doesNotMatch(e.message,/49\.1|8\.5|Private|unrestrictedFlight/);
    }
  }
  assert.equal(canonical({b:2,a:{z:true,c:1}}),
    canonical({a:{c:1,z:true},b:2}));
});
test('database connection, SQL and audit errors are redacted before reaching callers',async()=>{
  const secret='internal GPS 49.12345 and database password';
  const brokenPool={connect:async()=>{throw Error(secret);}};
  const svc=createWpmlRouteService({pool:brokenPool,authorize:async()=>actor});
  await assert.rejects(svc.listRoutes({credential:'session',workspaceId:A}),
    {code:'unavailable',message:'WPML route operation unavailable'});

  let rollback=0;
  const sqlFailure={connect:async()=>({
    query:async statement=>{
      if(statement==='ROLLBACK'){rollback++;return {rows:[],rowCount:0};}
      if(statement==='BEGIN')return {rows:[],rowCount:0};
      throw Object.assign(new Error(secret),{detail:secret,sql:secret});
    },
    release(){}
  })};
  const svc2=createWpmlRouteService({pool:sqlFailure,authorize:async()=>actor});
  let thrown;
  try{await svc2.listRoutes({credential:'session',workspaceId:A});}
  catch(e){thrown=e;}
  assert.equal(thrown.code,'unavailable');
  assert.equal(thrown.message,'WPML route operation unavailable');
  assert.equal(JSON.stringify({message:thrown.message,code:thrown.code})
    .includes(secret),false);
  assert.equal(rollback,1);
});

test('no route service is wired to production server or to DJI command interfaces',()=>{
  const root=path.resolve(__dirname,'..');
  const source=fs.readFileSync(path.join(root,'wpml-central-routes.js'),'utf8');
  const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
  assert.doesNotMatch(server,/wpml-central-routes|wpml-route-(?:api|service)/);
  assert.doesNotMatch(source,/mqtt\.publish|service\.send|mission\/create|axios|fetch\s*\(/);
  assert.match(source,/independent-operator-auth/);
  assert.match(source,/ROLLBACK/);
  assert.match(source,/latest_revision=\$4/);
  assert.ok(RouteError);
});
