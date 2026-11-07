'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const express=require('express');
const {liveStreamSettings,pilotLiveConfig,createLiveStreamRouter}=require('../live-stream');
const panel=require(path.resolve(__dirname,'../../frontend/public/live-panel.js'));

const PUB='pub_abcdefghijklmnopqrstuvwx',READ='read_abcdefghijklmnopqrstuv';
const ENV={SKYHUB_LIVE_ENABLED:'true',SKYHUB_LIVE_RTMP_URL:'rtmp://192.168.178.63:1935',
  SKYHUB_LIVE_PUBLISH_PASS:PUB,SKYHUB_LIVE_READ_PASS:READ};
const SESSION='6a9ce2fb-40c7-4e73-9154-58a5ee534db8';

test('live settings are opt-in and fail closed on weak or shared secrets and unreachable RTMP hosts',()=>{
  assert.deepEqual(liveStreamSettings({}),{enabled:false,issue:null});
  const ok=liveStreamSettings(ENV);
  assert.equal(ok.enabled,true);
  assert.equal(ok.rtmpOrigin,'rtmp://192.168.178.63:1935');
  assert.equal(ok.hlsOrigin,'http://mediamtx:8888');
  assert.equal(ok.apiOrigin,'http://mediamtx:9997');
  for(const [override,pattern] of [
    [{SKYHUB_LIVE_PUBLISH_PASS:'short'},/SKYHUB_LIVE_PUBLISH_PASS/],
    [{SKYHUB_LIVE_READ_PASS:''},/SKYHUB_LIVE_READ_PASS/],
    [{SKYHUB_LIVE_READ_PASS:PUB},/must differ/],
    [{SKYHUB_LIVE_PUBLISH_PASS:'has&ampersand_abcdefghijklmnop'},/URL-safe/],
    [{SKYHUB_LIVE_RTMP_URL:'rtmp://localhost:1935'},/rtmp:\/\//],
    [{SKYHUB_LIVE_RTMP_URL:'rtmp://mediamtx:1935'},/rtmp:\/\//],
    [{SKYHUB_LIVE_RTMP_URL:'rtmp://192.168.178.63/live'},/rtmp:\/\//],
    [{SKYHUB_LIVE_RTMP_URL:'http://192.168.178.63:1935'},/rtmp:\/\//],
    [{SKYHUB_LIVE_MEDIAMTX_HLS_URL:'http://user:pw@mediamtx:8888'},/plain internal/]
  ]){
    const s=liveStreamSettings({...ENV,...override});
    assert.equal(s.enabled,false,JSON.stringify(override));
    assert.match(s.issue,pattern);
    assert.doesNotMatch(s.issue,new RegExp(PUB+'|'+READ),'issues never contain secrets');
  }
});

test('Pilot 2 receives the single publish path, manual publish type, and no read secret',()=>{
  assert.equal(pilotLiveConfig({enabled:false}),null);
  const live=pilotLiveConfig(liveStreamSettings(ENV));
  assert.deepEqual(live,{rtmpUrl:'rtmp://192.168.178.63:1935/pilot?user=skyhub-pilot&pass='+PUB,
    publishType:'video-by-manual'});
  assert.doesNotMatch(JSON.stringify(live),new RegExp(READ));
});

// Fake MediaMTX: records every upstream request.
function relay(routes){
  const calls=[];
  const fetchImpl=async(url,options)=>{
    calls.push({url,headers:options.headers,redirect:options.redirect});
    const r=routes(new URL(url),options.headers);
    if(r instanceof Error)throw r;
    const body=Buffer.from(r.body||'');
    return {status:r.status||200,headers:new Headers(r.headers||{}),arrayBuffer:async()=>body};
  };
  return {fetchImpl,calls};
}
async function serve(t,router){
  const app=express();app.use(router);
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  t.after(()=>server.close());
  return 'http://127.0.0.1:'+server.address().port;
}
const settings=liveStreamSettings(ENV);
const INDEX='#EXTM3U\n#EXT-X-VERSION:10\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",URI="audio2_stream.m3u8"\n'+
  '#EXT-X-STREAM-INF:BANDWIDTH=1,AUDIO="audio"\nvideo1_stream.m3u8\nhttp://evil.example/x.m3u8\n';
const MEDIA='#EXTM3U\n#EXT-X-MAP:URI="abc_video1_init.mp4?session='+SESSION+'"\n#EXTINF:1.0,\n'+
  'abc_video1_seg0.mp4?session='+SESSION+'\n#EXT-X-MAP:URI="https://evil.example/i.mp4"\n#EXTINF:1.0,\n../../secret.mp4\n';

test('disabled relay answers 503 enabled:false without contacting MediaMTX',async t=>{
  const up=relay(()=>({}));
  const base=await serve(t,createLiveStreamRouter({settings:{enabled:false},fetchImpl:up.fetchImpl}).router);
  const res=await fetch(base+'/api/live/status');
  assert.equal(res.status,503);
  assert.deepEqual(await res.json(),{enabled:false});
  assert.equal((await fetch(base+'/api/live/hls/pilot/index.m3u8')).status,503);
  assert.equal(up.calls.length,0);
});

test('status maps the MediaMTX path to a minimal, credential-free summary',async t=>{
  const up=relay(url=>url.pathname==='/v3/paths/get/pilot'?{headers:{'content-type':'application/json'},
    body:JSON.stringify({name:'pilot',ready:true,readyTime:'2026-11-02T15:40:57Z',tracks:['H264',7],
      readers:[{type:'hlsMuxer',id:'secret-id'}],inboundBytes:123,source:{type:'rtmpConn',id:'x'}})}:{status:404});
  const live=createLiveStreamRouter({settings,fetchImpl:up.fetchImpl});
  const base=await serve(t,live.router);
  assert.deepEqual(await (await fetch(base+'/api/live/status')).json(),
    {enabled:true,relay:'online',ready:true,since:'2026-11-02T15:40:57Z',tracks:['H264'],viewers:1,inboundBytes:123});
  assert.equal(up.calls[0].url,'http://mediamtx:9997/v3/paths/get/pilot');
  assert.equal(up.calls[0].headers.Authorization,'Basic '+Buffer.from('skyhub-backend:'+READ).toString('base64'));
  assert.equal(up.calls[0].redirect,'manual');
});

test('unreachable relay reports unavailable instead of an error page',async t=>{
  const base=await serve(t,createLiveStreamRouter({settings,fetchImpl:relay(()=>new Error('ECONNREFUSED')).fetchImpl}).router);
  const res=await fetch(base+'/api/live/status');
  assert.equal(res.status,503);
  assert.deepEqual(await res.json(),{enabled:true,relay:'unavailable',ready:false});
});

test('master playlist opens a reader session and hands it to the browser in the URLs only',async t=>{
  const up=relay(url=>url.pathname==='/pilot/index.m3u8'&&url.search==='?cookieCheck=1'?
    {headers:{'set-cookie':'hlsSession='+SESSION+'; HttpOnly; Secure'},body:INDEX}:{status:404});
  const base=await serve(t,createLiveStreamRouter({settings,fetchImpl:up.fetchImpl}).router);
  const res=await fetch(base+'/api/live/hls/pilot/index.m3u8');
  assert.equal(res.status,200);
  assert.match(res.headers.get('content-type'),/^application\/vnd\.apple\.mpegurl/);
  assert.equal(res.headers.get('set-cookie'),null,'no MediaMTX cookie reaches the browser');
  const text=await res.text();
  assert.match(text,new RegExp('URI="audio2_stream\\.m3u8\\?s='+SESSION+'"'));
  assert.match(text,new RegExp('^video1_stream\\.m3u8\\?s='+SESSION+'$','m'));
  assert.doesNotMatch(text,/evil\.example/);
  assert.equal(up.calls[0].headers.Cookie,'cookieCheck=1');
});

test('media playlist needs a valid session and keeps only same-directory segment references',async t=>{
  const up=relay((url,headers)=>headers.Cookie==='hlsSession='+SESSION?{body:MEDIA}:{status:401});
  const base=await serve(t,createLiveStreamRouter({settings,fetchImpl:up.fetchImpl}).router);
  assert.equal((await fetch(base+'/api/live/hls/pilot/video1_stream.m3u8')).status,400);
  assert.equal((await fetch(base+'/api/live/hls/pilot/video1_stream.m3u8?s=not-a-uuid')).status,400);
  const text=await (await fetch(base+'/api/live/hls/pilot/video1_stream.m3u8?s='+SESSION)).text();
  assert.match(text,/#EXT-X-MAP:URI="abc_video1_init\.mp4\?session=/);
  assert.match(text,/^abc_video1_seg0\.mp4\?session=/m);
  assert.doesNotMatch(text,/evil\.example|secret\.mp4/);
});

test('segments pass through with the session, only for safe names and bounded size',async t=>{
  const up=relay(url=>url.pathname==='/pilot/big.mp4'?{headers:{'content-length':String(64*1024*1024)},body:'x'}:
    url.pathname.endsWith('.mp4')?{body:'MP4DATA'}:{status:404});
  const base=await serve(t,createLiveStreamRouter({settings,fetchImpl:up.fetchImpl}).router);
  const seg=await fetch(base+'/api/live/hls/pilot/abc_video1_seg0.mp4?session='+SESSION);
  assert.equal(seg.status,200);
  assert.equal(seg.headers.get('content-type'),'video/mp4');
  assert.equal(await seg.text(),'MP4DATA');
  assert.equal(up.calls[0].url,'http://mediamtx:8888/pilot/abc_video1_seg0.mp4?session='+SESSION);
  await fetch(base+'/api/live/hls/pilot/abc_video1_seg0.mp4?session=../../x');
  assert.equal(up.calls[1].url,'http://mediamtx:8888/pilot/abc_video1_seg0.mp4','invalid session is dropped');
  assert.equal((await fetch(base+'/api/live/hls/pilot/big.mp4')).status,503);
  for(const bad of ['x.ts','..%2Fx.mp4','a.b.mp4','index.html'])
    assert.equal((await fetch(base+'/api/live/hls/pilot/'+bad)).status,404,bad);
  assert.equal((await fetch(base+'/api/live/hls/other/index.m3u8')).status,404);
});

test('dashboard status text, and the hls.js SRI pinned in the panel matches the vendored file',()=>{
  assert.deepEqual(panel.describeStatus({enabled:false}),{enabled:false});
  assert.deepEqual(panel.describeStatus(null),{enabled:false});
  assert.match(panel.describeStatus({enabled:true,relay:'online',ready:false}).text,/Kein Livestream aktiv/);
  assert.match(panel.describeStatus({enabled:true,relay:'unavailable'}).text,/nicht erreichbar/);
  const live=panel.describeStatus({enabled:true,relay:'online',ready:true,tracks:['H264','<b>'],viewers:2,
    since:'2026-11-02T15:40:57Z'});
  assert.equal(live.ready,true);
  assert.match(live.text,/^LIVE · H264, <b> · seit .* · 2 Zuschauer$/);
  const file=path.resolve(__dirname,'../../frontend/public',panel.HLS_SRC.slice(1));
  assert.equal(panel.HLS_SRI,'sha256-'+crypto.createHash('sha256').update(fs.readFileSync(file)).digest('base64'));
  assert.match(fs.readFileSync(path.join(path.dirname(file),'LICENSE'),'utf8'),/Apache License/);
});
