'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const express=require('express');
const {createTileCache,createTileRedirect,tileCacheSettings,tileCoordinates,maxAgeMs,
  USER_AGENT,MIN_FRESH_MS}=require('../tile-cache');

// Synthetic PNG bytes only; no request ever leaves the test process.
const png=(tag='a',size=64)=>Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),
  Buffer.alloc(size,tag)]);
function upstream(handler){
  const calls=[];
  const fetchImpl=async(url,options)=>{
    calls.push({url,headers:options.headers});
    const r=await handler(url,options,calls.length);
    if(r instanceof Error)throw r;
    const headers=new Headers(r.headers||{'content-type':'image/png','cache-control':'max-age=3600'});
    return {status:r.status||200,headers,arrayBuffer:async()=>r.body||png()};
  };
  return {fetchImpl,calls};
}
function tmp(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'skyhub-tiles-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  return dir;
}
async function serve(t,router){
  const app=express();app.use(router);
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  t.after(()=>server.close());
  return 'http://127.0.0.1:'+server.address().port;
}

test('tile coordinates are bounded to the zoom pyramid',()=>{
  assert.deepEqual(tileCoordinates('0','0','0'),{z:0,x:0,y:0});
  assert.deepEqual(tileCoordinates('19','524287','1'),{z:19,x:524287,y:1});
  for(const bad of [['20','0','0'],['3','8','0'],['3','0','8'],['-1','0','0'],['1.5','0','0'],['01e1','0','0'],['3','','0']])
    assert.equal(tileCoordinates(...bad),null,bad.join('/'));
});

test('upstream cache headers are read, absent headers give zero',()=>{
  assert.equal(maxAgeMs(new Headers({'cache-control':'public, max-age=600'})),600000);
  assert.equal(maxAgeMs(new Headers({date:'Mon, 02 Nov 2026 10:00:00 GMT',expires:'Mon, 02 Nov 2026 11:00:00 GMT'})),3600000);
  assert.equal(maxAgeMs(new Headers({})),0);
});

test('settings are opt-in, bounded and require an absolute directory',()=>{
  assert.equal(tileCacheSettings({}).enabled,false);
  assert.equal(tileCacheSettings({SKYHUB_TILE_CACHE_ENABLED:'true',SKYHUB_TILE_CACHE_DIR:'/data/t'}).maxBytes,512*1024*1024);
  assert.throws(()=>tileCacheSettings({SKYHUB_TILE_CACHE_MAX_MB:'4'}),/16 to 20480/);
  assert.throws(()=>tileCacheSettings({SKYHUB_TILE_CACHE_MAX_MB:'abc'}),/16 to 20480/);
  assert.throws(()=>tileCacheSettings({SKYHUB_TILE_CACHE_ENABLED:'true',SKYHUB_TILE_CACHE_DIR:'rel'}),/absolute/);
});

test('first view fetches once with an identifying User-Agent, then serves from disk',async t=>{
  const dir=tmp(t);
  const up=upstream(()=>({body:png('x')}));
  const cache=createTileCache({dir,fetchImpl:up.fetchImpl});
  const base=await serve(t,cache.router);
  const first=await fetch(base+'/tiles/osm/12/2138/1420.png');
  assert.equal(first.status,200);
  assert.equal(first.headers.get('x-skyhub-tile'),'miss');
  assert.equal(first.headers.get('content-type'),'image/png');
  assert.deepEqual(Buffer.from(await first.arrayBuffer()),png('x'));
  const second=await fetch(base+'/tiles/osm/12/2138/1420.png');
  assert.equal(second.headers.get('x-skyhub-tile'),'hit');
  assert.equal(up.calls.length,1);
  assert.equal(up.calls[0].url,'https://tile.openstreetmap.org/12/2138/1420.png');
  assert.equal(up.calls[0].headers['User-Agent'],USER_AGENT);
  assert.ok(fs.existsSync(path.join(dir,'12','2138','1420.png')));
  assert.equal(cache.stats().tiles,1);
});

test('tiles stay fresh for at least seven days even with short upstream max-age',async t=>{
  let clock=1_800_000_000_000;
  const up=upstream(()=>({headers:{'content-type':'image/png','cache-control':'max-age=60'}}));
  const cache=createTileCache({dir:tmp(t),fetchImpl:up.fetchImpl,now:()=>clock});
  await cache.get({z:5,x:1,y:1});
  clock+=MIN_FRESH_MS-1000;
  assert.equal((await cache.get({z:5,x:1,y:1})).state,'hit');
  assert.equal(up.calls.length,1);
});

test('expired tile is revalidated with ETag and served stale when offline',async t=>{
  let clock=1_800_000_000_000,mode='online';
  const up=upstream((url,options,n)=>{
    if(mode==='offline')return new Error('ENETUNREACH');
    if(n===1)return {headers:{'content-type':'image/png',etag:'"v1"'},body:png('v')};
    return {status:304,headers:{}};
  });
  const cache=createTileCache({dir:tmp(t),fetchImpl:up.fetchImpl,now:()=>clock});
  const tile={z:10,x:530,y:340};
  await cache.get(tile);
  clock+=MIN_FRESH_MS+1;
  const revalidated=await cache.get(tile);
  assert.equal(revalidated.state,'revalidated');
  assert.equal(up.calls[1].headers['If-None-Match'],'"v1"');
  assert.deepEqual(revalidated.body,png('v'));
  clock+=MIN_FRESH_MS+1;mode='offline';
  const stale=await cache.get(tile);
  assert.equal(stale.state,'stale');
  assert.deepEqual(stale.body,png('v'));
  assert.equal(cache.stats().upstreamErrors,1);
});

test('missing tile without connectivity answers 504 JSON, never a broken image',async t=>{
  const cache=createTileCache({dir:tmp(t),fetchImpl:upstream(()=>new Error('offline')).fetchImpl});
  const base=await serve(t,cache.router);
  const res=await fetch(base+'/tiles/osm/3/1/1.png');
  assert.equal(res.status,504);
  assert.deepEqual(await res.json(),{error:'Tile unavailable'});
});

test('non-PNG, oversized or failing upstream answers are never stored',async t=>{
  const dir=tmp(t);
  const bodies=[
    {headers:{'content-type':'text/html'},body:Buffer.from('<html>')},
    {headers:{'content-type':'image/png'},body:Buffer.from('not a png')},
    {headers:{'content-type':'image/png'},body:png('b',600*1024)},
    {status:403,headers:{'content-type':'image/png'}}
  ];
  const up=upstream((url,o,n)=>bodies[n-1]);
  const cache=createTileCache({dir,fetchImpl:up.fetchImpl});
  for(let i=0;i<bodies.length;i++)await assert.rejects(cache.get({z:4,x:i,y:0}));
  assert.equal(cache.stats().tiles,0);
  assert.deepEqual(fs.readdirSync(dir).length===0||fs.readdirSync(path.join(dir,'4')).every(x=>
    fs.readdirSync(path.join(dir,'4',x)).length===0),true);
});

test('concurrent requests share one upstream call and the per-minute budget is enforced',async t=>{
  let release;
  const gate=new Promise(r=>{release=r;});
  const up=upstream(async()=>{await gate;return {};});
  const cache=createTileCache({dir:tmp(t),fetchImpl:up.fetchImpl,upstreamPerMinute:2});
  const same=[cache.get({z:6,x:1,y:1}),cache.get({z:6,x:1,y:1}),cache.get({z:6,x:1,y:1})];
  release();
  await Promise.all(same);
  assert.equal(up.calls.length,1);
  await cache.get({z:6,x:2,y:1});
  await assert.rejects(cache.get({z:6,x:3,y:1}),err=>err.busy===true);
  assert.equal(up.calls.length,2);
});

test('size limit evicts least recently used tiles and the index survives a restart',async t=>{
  const dir=tmp(t);
  let clock=1_800_000_000_000;
  const up=upstream(()=>({body:png('s',1000)}));
  const cache=createTileCache({dir,fetchImpl:up.fetchImpl,now:()=>clock++,maxBytes:3500});
  for(let x=0;x<3;x++)await cache.get({z:8,x,y:0});
  await cache.get({z:8,x:0,y:0});          // keep x=0 recently used
  await cache.get({z:8,x:3,y:0});          // exceeds 3500 bytes -> evict x=1
  assert.equal(fs.existsSync(path.join(dir,'8','1','0.png')),false);
  assert.equal(fs.existsSync(path.join(dir,'8','0','0.png')),true);
  assert.ok(cache.stats().bytes<=3500*0.9);
  const restarted=createTileCache({dir,fetchImpl:up.fetchImpl});
  await restarted.ready;
  assert.equal(restarted.stats().tiles,cache.stats().tiles);
  assert.equal(restarted.stats().bytes,cache.stats().bytes);
});

test('disabled cache redirects to the official OSM host and rejects invalid tiles',async t=>{
  const base=await serve(t,createTileRedirect().router);
  const ok=await fetch(base+'/tiles/osm/7/66/43.png',{redirect:'manual'});
  assert.equal(ok.status,302);
  assert.equal(ok.headers.get('location'),'https://tile.openstreetmap.org/7/66/43.png');
  assert.equal((await fetch(base+'/tiles/osm/7/128/43.png',{redirect:'manual'})).status,404);
});
