'use strict';
const fs=require('fs/promises');
const path=require('path');
const express=require('express');

// On-demand OpenStreetMap tile cache for field use without internet.
// - Tiles are fetched only when a browser actually displays them: no prefetch, no bulk download
//   (OSMF tile policy, https://operations.osmfoundation.org/policies/tiles/).
// - Stored tiles are reused for at least 7 days, longer if upstream cache headers allow it.
// - Without upstream connectivity an expired tile is still served (marked "stale").
// - Disabled: the same URL redirects to tile.openstreetmap.org, i.e. the previous behaviour.
const UPSTREAM='https://tile.openstreetmap.org';
const USER_AGENT='SkyHub-Next/0.1 tile cache (+https://github.com/mason82-dotcom/SkyHub-Next)';
const MAX_ZOOM=19;
const MIN_FRESH_MS=7*24*3600*1000;
const MAX_TILE_BYTES=512*1024;
const PNG_MAGIC=Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);

function tileCoordinates(z,x,y){
  if(![z,x,y].every(v=>typeof v==='string'&&/^\d{1,7}$/.test(v)))return null;
  const [zn,xn,yn]=[Number(z),Number(x),Number(y)];
  if(zn>MAX_ZOOM)return null;
  const size=2**zn;
  return xn<size&&yn<size?{z:zn,x:xn,y:yn}:null;
}

function maxAgeMs(headers){
  const cc=headers.get('cache-control')||'';
  const match=/(?:^|,)\s*max-age=(\d{1,10})/i.exec(cc);
  if(match)return Number(match[1])*1000;
  const expires=Date.parse(headers.get('expires')||'');
  const date=Date.parse(headers.get('date')||'')||Date.now();
  return Number.isFinite(expires)?Math.max(0,expires-date):0;
}

function tileCacheSettings(env){
  const enabled=env.SKYHUB_TILE_CACHE_ENABLED==='true';
  const dir=env.SKYHUB_TILE_CACHE_DIR||path.resolve(__dirname,'../tile-cache');
  const mb=env.SKYHUB_TILE_CACHE_MAX_MB===undefined||env.SKYHUB_TILE_CACHE_MAX_MB===''?
    512:Number(env.SKYHUB_TILE_CACHE_MAX_MB);
  if(!Number.isInteger(mb)||mb<16||mb>20480)
    throw new Error('SKYHUB_TILE_CACHE_MAX_MB must be an integer from 16 to 20480');
  if(enabled&&!path.isAbsolute(dir))throw new Error('SKYHUB_TILE_CACHE_DIR must be absolute');
  return {enabled,dir,maxBytes:mb*1024*1024};
}

function createTileCache({dir,maxBytes=512*1024*1024,fetchImpl=fetch,now=()=>Date.now(),
  upstream=UPSTREAM,timeoutMs=10000,maxConcurrent=4,maxWaiting=128,upstreamPerMinute=300}){
  const index=new Map();            // "z/x/y" -> {bytes, usedAt}
  const inflight=new Map();         // "z/x/y" -> Promise
  const waiting=[];
  let active=0,totalBytes=0,budget={minute:-1,used:0};
  const stats={hits:0,misses:0,revalidated:0,stale:0,upstreamErrors:0,rejected:0,evicted:0};

  const file=(t,ext)=>path.join(dir,String(t.z),String(t.x),t.y+ext);
  const key=t=>t.z+'/'+t.x+'/'+t.y;

  // Rebuild the size index from disk once at startup (bounded to the cache layout z/x/y.png).
  const ready=(async()=>{
    let zs=[];
    try{zs=await fs.readdir(dir);}catch(_err){return;}
    for(const z of zs){
      if(!/^\d{1,2}$/.test(z))continue;
      let xs=[];try{xs=await fs.readdir(path.join(dir,z));}catch(_err){continue;}
      for(const x of xs){
        let ys=[];try{ys=await fs.readdir(path.join(dir,z,x));}catch(_err){continue;}
        for(const name of ys){
          const m=/^(\d+)\.png$/.exec(name);
          if(!m)continue;
          try{
            const st=await fs.stat(path.join(dir,z,x,name));
            index.set(z+'/'+x+'/'+m[1],{bytes:st.size,usedAt:st.mtimeMs});
            totalBytes+=st.size;
          }catch(_err){/* concurrently removed */}
        }
      }
    }
  })();

  async function acquire(){
    if(active<maxConcurrent){active++;return;}
    if(waiting.length>=maxWaiting)throw Object.assign(new Error('busy'),{busy:true});
    await new Promise(resolve=>waiting.push(resolve));
    active++;
  }
  function release(){active--;const next=waiting.shift();if(next)next();}
  function takeBudget(){
    const minute=Math.floor(now()/60000);
    if(budget.minute!==minute)budget={minute,used:0};
    if(budget.used>=upstreamPerMinute)return false;
    budget.used++;return true;
  }

  async function readCached(t){
    try{
      const [body,metaText]=await Promise.all([fs.readFile(file(t,'.png')),fs.readFile(file(t,'.json'),'utf8')]);
      const meta=JSON.parse(metaText);
      if(!Number.isFinite(meta.expiresAt))return null;
      return {body,meta};
    }catch(_err){return null;}
  }
  async function writeAtomic(target,data){
    const tmp=target+'.'+process.pid+'.'+Math.random().toString(36).slice(2)+'.tmp';
    await fs.writeFile(tmp,data);
    await fs.rename(tmp,target);
  }
  async function store(t,body,meta){
    await fs.mkdir(path.dirname(file(t,'.png')),{recursive:true});
    await writeAtomic(file(t,'.png'),body);
    await writeAtomic(file(t,'.json'),JSON.stringify(meta));
    const k=key(t),prior=index.get(k);
    totalBytes+=body.length-(prior?prior.bytes:0);
    index.set(k,{bytes:body.length,usedAt:now()});
    if(totalBytes>maxBytes)await evict();
  }
  // Least recently used tiles go first, down to 90 % of the limit.
  async function evict(){
    const target=maxBytes*0.9;
    const oldest=[...index.entries()].sort((a,b)=>a[1].usedAt-b[1].usedAt);
    for(const [k,entry] of oldest){
      if(totalBytes<=target)break;
      const [z,x,y]=k.split('/').map(Number);
      await Promise.all(['.png','.json'].map(ext=>fs.rm(file({z,x,y},ext),{force:true})));
      index.delete(k);totalBytes-=entry.bytes;stats.evicted++;
    }
  }

  async function fetchUpstream(t,cached){
    if(!takeBudget())throw Object.assign(new Error('budget'),{busy:true});
    await acquire();
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),timeoutMs);
    timer.unref?.();
    try{
      const headers={'User-Agent':USER_AGENT,Accept:'image/png'};
      if(cached?.meta.etag)headers['If-None-Match']=cached.meta.etag;
      if(cached?.meta.lastModified)headers['If-Modified-Since']=cached.meta.lastModified;
      const res=await fetchImpl(upstream+'/'+t.z+'/'+t.x+'/'+t.y+'.png',
        {headers,signal:controller.signal,redirect:'error'});
      const fetchedAt=now();
      const expiresAt=fetchedAt+Math.max(MIN_FRESH_MS,maxAgeMs(res.headers));
      if(res.status===304&&cached){
        const meta={...cached.meta,fetchedAt,expiresAt};
        await writeAtomic(file(t,'.json'),JSON.stringify(meta));
        return {body:cached.body,meta,state:'revalidated'};
      }
      if(res.status!==200)throw new Error('upstream status');
      if(!/^image\/png\b/i.test(res.headers.get('content-type')||''))throw new Error('upstream type');
      const body=Buffer.from(await res.arrayBuffer());
      if(body.length>MAX_TILE_BYTES||!body.subarray(0,8).equals(PNG_MAGIC))throw new Error('upstream body');
      const meta={fetchedAt,expiresAt,etag:res.headers.get('etag')||null,
        lastModified:res.headers.get('last-modified')||null};
      await store(t,body,meta);
      return {body,meta,state:'miss'};
    }finally{clearTimeout(timer);release();}
  }

  async function get(t){
    await ready;
    const cached=await readCached(t);
    const k=key(t);
    if(cached&&cached.meta.expiresAt>now()){
      const entry=index.get(k);if(entry)entry.usedAt=now();
      return {...cached,state:'hit'};
    }
    // Concurrent requests for the same tile share one upstream call.
    if(!inflight.has(k)){
      inflight.set(k,fetchUpstream(t,cached).finally(()=>inflight.delete(k)));
    }
    try{return await inflight.get(k);}
    catch(err){
      if(!err.busy)stats.upstreamErrors++;
      if(cached)return {...cached,state:'stale'};
      throw err;
    }
  }

  const router=express.Router();
  router.get('/tiles/osm/:z/:x/:y.png',async(req,res)=>{
    const t=tileCoordinates(req.params.z,req.params.x,req.params.y);
    if(!t)return res.status(404).json({error:'Not found'});
    try{
      const tile=await get(t);
      stats[{hit:'hits',miss:'misses',revalidated:'revalidated',stale:'stale'}[tile.state]]++;
      const seconds=tile.state==='stale'?300:Math.min(86400,Math.max(60,
        Math.floor((tile.meta.expiresAt-now())/1000)));
      res.set({'Content-Type':'image/png','Cache-Control':'public, max-age='+seconds,'X-SkyHub-Tile':tile.state});
      res.send(tile.body);
    }catch(err){
      stats.rejected++;
      res.set('Retry-After','30').status(err.busy?503:504).json({error:'Tile unavailable'});
    }
  });
  return {router,get,ready,
    stats:()=>({enabled:true,tiles:index.size,bytes:totalBytes,maxBytes,...stats})};
}

// Disabled cache: identical tile URLs, answered by OpenStreetMap as before.
function createTileRedirect(){
  const router=express.Router();
  router.get('/tiles/osm/:z/:x/:y.png',(req,res)=>{
    const t=tileCoordinates(req.params.z,req.params.x,req.params.y);
    if(!t)return res.status(404).json({error:'Not found'});
    res.redirect(302,UPSTREAM+'/'+t.z+'/'+t.x+'/'+t.y+'.png');
  });
  return {router,stats:()=>({enabled:false})};
}

module.exports={createTileCache,createTileRedirect,tileCacheSettings,tileCoordinates,maxAgeMs,
  USER_AGENT,MIN_FRESH_MS};
