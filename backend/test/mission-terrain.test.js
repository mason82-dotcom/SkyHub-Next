'use strict';
// Terrain check (height above ground) for the mission release, with a fake Open Topo Data server.
const test=require('node:test');
const assert=require('node:assert/strict');
const {terrainConfig,createTerrainClient,terrainFindings,routeSamples}=require('../mission-terrain');

// Ground rises 1 m per 10 m going north from 49.1000 (a hill); flat (300 m) south of it.
const ground=(lat)=>300+Math.max(0,(lat-49.1)*111195/10);
function fakeFetch(calls,{fail=false,status='OK'}={}){
  return async url=>{
    calls.push(url);
    if(fail)throw Object.assign(new Error('down'),{name:'TypeError'});
    const u=new URL(url),locs=decodeURIComponent(u.searchParams.get('locations')).split('|');
    assert.ok(locs.length<=100,'at most 100 locations per request');
    return {ok:true,json:async()=>({status,results:locs.map(l=>{const [lat,lon]=l.split(',').map(Number);return {elevation:ground(lat),location:{lat,lng:lon}};})})};
  };
}
const route=(heights,{mode='relativeToStartPoint'}={})=>heights.map((h,i)=>({lat:49.1+i*0.001,lon:8.5,heightAboveTakeoffM:h,heightMode:mode}));

test('config: off by default, URL validated, public service flagged',()=>{
  assert.equal(terrainConfig({}).enabled,false);
  assert.match(terrainConfig({SKYHUB_TERRAIN_URL:'ftp://x'}).issue,/http/);
  assert.match(terrainConfig({SKYHUB_TERRAIN_URL:'https://u:p@x'}).issue,/Zugangsdaten/);
  const c=terrainConfig({SKYHUB_TERRAIN_URL:'https://api.opentopodata.org/'});
  assert.deepEqual([c.enabled,c.base,c.dataset,c.public,c.minAglM],[true,'https://api.opentopodata.org','eudem25m',true,15]);
  assert.equal(terrainConfig({SKYHUB_TERRAIN_URL:'http://opentopodata:5000',SKYHUB_TERRAIN_DATASET:'srtm30m'}).public,false);
});

test('samples: densified about every 25 m, waypoints kept, capped',()=>{
  const s=routeSamples(route([50,50]));            // ~111 m apart
  assert.ok(s.length>=4&&s.length<=6,String(s.length));
  assert.equal(s[0].wp,0);assert.equal(s.at(-1).wp,1);
  const many=routeSamples(route(new Array(300).fill(60)),{max:200});
  assert.ok(many.length<=300+200,String(many.length));   // all waypoints + at most max intermediatesassert.ok(many.filter(p=>Number.isInteger(p.wp)).length===300,'all waypoints kept');
});

test('height above ground: rising ground lowers the clearance; >120 m above ground is an error',async()=>{
  const calls=[];
  const t=createTerrainClient(terrainConfig({SKYHUB_TERRAIN_URL:'http://dem:5000'}),{fetchImpl:fakeFetch(calls)});
  // 100 m above take-off along a hill rising 11 m per 0.001°: ~89 m above ground at the 2nd point, ~78 at the 3rd.
  let r=await t.check('a',route([100,100,100]),null);
  assert.equal(r.status,'ok');assert.equal(r.assumedTakeoff,true);
  assert.ok(Math.abs(r.minAgl.aglM-77.8)<0.5,JSON.stringify(r.minAgl));assert.equal(r.maxAgl.aglM,100);
  let f=terrainFindings(r);
  assert.deepEqual(f.errors,[]);
  assert.ok(f.warnings.some(w=>/take-off point assumed/.test(w)));
  assert.ok(f.warnings.some(w=>/no buildings or trees/.test(w)));
  // Take-off on the hill (reference 0.002° north) and route going down south: ground falls away → too high above ground.
  const down=[0,1,2].map(i=>({lat:49.1-i*0.001,lon:8.5,heightAboveTakeoffM:110,heightMode:'relativeToStartPoint'}));
  r=await t.check('b',down,{lat:49.102,lon:8.5});
  f=terrainFindings(r);
  assert.ok(f.errors.some(e=>/above ground near waypoint 1 exceeds 120 m/.test(e)),JSON.stringify(r.maxAgl));
  // Low clearance warning.
  r=await t.check('c',route([10,10]),null);
  assert.ok(terrainFindings(r).warnings.some(w=>/only -?\d+(\.\d)? m above ground/.test(w)));
});

test('cache per route key; unavailable service and terrain-follow routes are handled',async()=>{
  const calls=[];
  const t=createTerrainClient(terrainConfig({SKYHUB_TERRAIN_URL:'http://dem:5000'}),{fetchImpl:fakeFetch(calls)});
  await t.check('same',route([60,60]),null);const n=calls.length;
  await t.check('same',route([60,60]),null);
  assert.equal(calls.length,n,'second check from cache');
  const down=createTerrainClient(terrainConfig({SKYHUB_TERRAIN_URL:'http://dem:5000'}),{fetchImpl:fakeFetch([],{fail:true})});
  const r=await down.check('x',route([60,60]),null);
  assert.equal(r.status,'unavailable');
  assert.ok(terrainFindings(r).warnings.some(w=>/terrain not checked/.test(w)));
  assert.deepEqual(terrainFindings(r).errors,[]);
  const follow=await t.check('f',route([70,70],{mode:'realTimeFollowSurface'}),null);
  assert.deepEqual(follow,{status:'skipped',reason:'terrain-follow'});
  assert.deepEqual(terrainFindings(follow),{errors:[],warnings:[]});
});
