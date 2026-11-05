'use strict';
// DJI Pilot 2 livestream relay (opt-in). Expects H.264 (+AAC) from Pilot 2; browsers play it via hls.js/MSE. Pilot 2's liveshare module publishes RTMP to a local
// MediaMTX (Compose profile "live"); the pilot starts and stops the stream on the RC
// ("video-by-manual"); with SKYHUB_LIVE_CONTROL_ENABLED SkyHub may also request it (live-control.js, live_start_push).
// The dashboard reads HLS through this backend: MediaMTX stays on the internal Docker network,
// its read credentials never reach the browser, and only the single path "pilot" is exposed.
const express=require('express');

const PATH='pilot';
const PUBLISH_USER='skyhub-pilot';
const READ_USER='skyhub-backend';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FILE=/^[A-Za-z0-9_-]{1,96}\.(m3u8|mp4)$/;
const MAX_PLAYLIST=256*1024;
const MAX_SEGMENT=32*1024*1024;

function internalUrl(value,fallback){
  const url=new URL(value||fallback);
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash||
     url.pathname!=='/')throw new Error('MediaMTX URLs must be plain internal origins');
  return url.origin;
}

function liveStreamSettings(env){
  const enabled=env.SKYHUB_LIVE_ENABLED==='true';
  if(!enabled)return {enabled:false,issue:null};
  try{
    const publishPass=env.SKYHUB_LIVE_PUBLISH_PASS||'';
    const readPass=env.SKYHUB_LIVE_READ_PASS||'';
    for(const [name,value] of [['SKYHUB_LIVE_PUBLISH_PASS',publishPass],['SKYHUB_LIVE_READ_PASS',readPass]]){
      if(value.length<24||value.startsWith('REPLACE_')||!/^[A-Za-z0-9_-]+$/.test(value))
        throw new Error(name+' must be at least 24 URL-safe characters');
    }
    if(publishPass===readPass)throw new Error('Publish and read passwords must differ');
    // The RC needs an address it can reach in the LAN, never Docker-internal names.
    const rtmp=new URL(env.SKYHUB_LIVE_RTMP_URL||'');
    if(rtmp.protocol!=='rtmp:'||rtmp.username||rtmp.password||rtmp.search||rtmp.hash||
       !['','/'].includes(rtmp.pathname)||['localhost','127.0.0.1','0.0.0.0','mediamtx',
       'host.docker.internal'].includes(rtmp.hostname))
      throw new Error('SKYHUB_LIVE_RTMP_URL must look like rtmp://192.168.178.63:1935');
    return {enabled:true,issue:null,publishPass,readPass,
      rtmpOrigin:'rtmp://'+rtmp.host,
      hlsOrigin:internalUrl(env.SKYHUB_LIVE_MEDIAMTX_HLS_URL,'http://mediamtx:8888'),
      apiOrigin:internalUrl(env.SKYHUB_LIVE_MEDIAMTX_API_URL,'http://mediamtx:9997')};
  }catch(err){return {enabled:false,issue:err.message};}
}

// Handed to Pilot 2 only inside the authenticated HTTPS bootstrap (like the MQTT credentials).
// onDemand (live-control.js active): video-demand-aux-manual = SkyHub may request the stream (live_start_push), the pilot can
// still change or stop it on the RC (jsbridge liveshare videoPublishType).
function pilotLiveConfig(settings,{onDemand=false}={}){
  if(!settings.enabled)return null;
  return {rtmpUrl:settings.rtmpOrigin+'/'+PATH+'?user='+PUBLISH_USER+'&pass='+settings.publishPass,
    publishType:onDemand?'video-demand-aux-manual':'video-by-manual'};
}

function createLiveStreamRouter({settings,fetchImpl=globalThis.fetch,timeoutMs=8000}){
  const router=express.Router();
  const stats={playlists:0,segments:0,upstreamErrors:0};
  const auth='Basic '+Buffer.from(READ_USER+':'+(settings.readPass||'')).toString('base64');

  async function upstream(url,cookie){
    const headers={Authorization:auth};
    if(cookie)headers.Cookie=cookie;
    return fetchImpl(url,{headers,redirect:'manual',signal:AbortSignal.timeout(timeoutMs)});
  }
  async function readLimited(response,limit){
    const length=Number(response.headers.get('content-length'));
    if(Number.isFinite(length)&&length>limit)throw new Error('too large');
    const body=Buffer.from(await response.arrayBuffer());
    if(body.length>limit)throw new Error('too large');
    return body;
  }
  function send(res,status,type,body){
    res.set({'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
    return res.status(status).send(body);
  }
  const unavailable=res=>res.status(503).json({error:'Livestream unavailable'});

  router.get('/api/live/status',async(req,res)=>{
    if(!settings.enabled)return res.status(503).json({enabled:false});
    try{
      const response=await upstream(settings.apiOrigin+'/v3/paths/get/'+PATH);
      if(response.status===404)return res.json({enabled:true,relay:'online',ready:false});
      if(response.status!==200)throw new Error('status');
      const p=JSON.parse((await readLimited(response,MAX_PLAYLIST)).toString('utf8'));
      const tracks=Array.isArray(p.tracks)?p.tracks.filter(t=>typeof t==='string').slice(0,8):[];
      return res.json({enabled:true,relay:'online',ready:p.ready===true,
        since:typeof p.readyTime==='string'?p.readyTime:null,tracks,
        viewers:Array.isArray(p.readers)?p.readers.length:0,
        inboundBytes:Number.isSafeInteger(p.inboundBytes)?p.inboundBytes:null});
    }catch(_err){
      stats.upstreamErrors++;
      return res.status(503).json({enabled:true,relay:'unavailable',ready:false});
    }
  });

  router.get('/api/live/hls/'+PATH+'/:file',async(req,res)=>{
    if(!settings.enabled)return res.status(503).json({enabled:false});
    const file=req.params.file;
    if(!FILE.test(file))return res.status(404).json({error:'Not found'});
    const base=settings.hlsOrigin+'/'+PATH+'/';
    try{
      if(file==='index.m3u8'){
        // MediaMTX opens a reader session behind a cookie check; the session id is then passed
        // to the browser inside the rewritten playlist URLs instead of a cookie.
        const response=await upstream(base+'index.m3u8?cookieCheck=1','cookieCheck=1');
        if(response.status===404)return res.status(404).json({error:'No livestream'});
        if(response.status!==200)throw new Error('playlist');
        const session=/hlsSession=([0-9a-f-]{36})/.exec(response.headers.get('set-cookie')||'')?.[1];
        if(!session||!UUID.test(session))throw new Error('session');
        const text=(await readLimited(response,MAX_PLAYLIST)).toString('utf8');
        const withSession=name=>FILE.test(name)&&name.endsWith('.m3u8')?name+'?s='+session:null;
        const rewritten=text.split('\n').map(line=>{
          if(line.startsWith('#'))return line.replace(/URI="([^"]+)"/g,(m,uri)=>{
            const next=withSession(uri);return next?'URI="'+next+'"':m;
          });
          const trimmed=line.trim();
          return trimmed?withSession(trimmed)??'#skipped':line;
        }).join('\n');
        stats.playlists++;
        return send(res,200,'application/vnd.apple.mpegurl',rewritten);
      }
      if(file.endsWith('.m3u8')){
        const session=req.query.s;
        if(typeof session!=='string'||!UUID.test(session))return res.status(400).json({error:'Invalid session'});
        const response=await upstream(base+file,'hlsSession='+session);
        if(response.status===404||response.status===401)return res.status(404).json({error:'No livestream'});
        if(response.status!==200)throw new Error('playlist');
        const text=(await readLimited(response,MAX_PLAYLIST)).toString('utf8');
        // Media playlists only reference same-directory files; anything else is dropped.
        const safe=text.split('\n').map(line=>{
          const trimmed=line.trim();
          if(!trimmed||trimmed.startsWith('#')){
            return /URI="/.test(trimmed)&&!/URI="[A-Za-z0-9_-]{1,96}\.mp4(\?session=[0-9a-f-]{36})?"/.test(trimmed)?
              '#skipped':line;
          }
          return /^[A-Za-z0-9_-]{1,96}\.mp4(\?session=[0-9a-f-]{36})?$/.test(trimmed)?trimmed:'#skipped';
        }).join('\n');
        stats.playlists++;
        return send(res,200,'application/vnd.apple.mpegurl',safe);
      }
      const session=req.query.session;
      const query=typeof session==='string'&&UUID.test(session)?'?session='+session:'';
      const response=await upstream(base+file+query);
      if(response.status===404)return res.status(404).json({error:'Segment expired'});
      if(response.status!==200)throw new Error('segment');
      const body=await readLimited(response,MAX_SEGMENT);
      stats.segments++;
      return send(res,200,'video/mp4',body);
    }catch(_err){
      stats.upstreamErrors++;
      return unavailable(res);
    }
  });
  return {router,stats:()=>({enabled:settings.enabled,...stats})};
}

module.exports={liveStreamSettings,pilotLiveConfig,createLiveStreamRouter,PATH,PUBLISH_USER,READ_USER};
