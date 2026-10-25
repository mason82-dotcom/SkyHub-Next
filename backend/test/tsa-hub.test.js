'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const {once}=require('node:events');
const WebSocket=require('ws');
const express=require('express');
const {createTsaHub,createTopologyListHandler,tokenFrom,secure,trustedPeer}=require('../tsa-hub');

const WS_ID='e3dea0f5-37f2-4d79-ae58-490af3228069';
const OTHER_WS='203cc94c-aef1-4e0e-a520-05a24be33a31';
const GOOD='good-token';
const device=(sn,over={})=>({
  sn,role:sn.startsWith('RC')?'gateway':'subdevice',gatewaySn:sn.startsWith('RC')?null:'RC01',
  children:sn==='RC01'?['AIR01']:[],
  model:sn.startsWith('RC')?{domain:'2',type:174,subType:0}:{domain:'0',type:99,subType:1},
  modelName:sn.startsWith('RC')?'DJI RC Plus 2 Enterprise':'Matrice 4T',
  topologyOnline:true,fresh:true,aircraftConnected:true,positionFresh:true,lastPositionAt:1000,
  telemetry:{latitude:49.1,longitude:8.4,heightEllipsoid:100,heading:10,altitude:5,horizontalSpeed:1,verticalSpeed:0},
  ...over
});

async function setup({devices=[device('RC01'),device('AIR01')],maxClients=20,pingMs=60000,
  authorize=async token=>token===GOOD?{role:'pilot',workspaceId:WS_ID}:null}={}){
  const registry={devices,snapshot:()=>registry.devices};
  const hub=createTsaHub({registry,authorize,workspaceId:WS_ID,intervalMs:600000,pingMs,maxClients,now:()=>1792528000000});
  const server=http.createServer((req,res)=>{res.statusCode=404;res.end();});
  server.on('upgrade',(req,socket,head)=>{if(hub.matches(req))hub.handleUpgrade(req,socket,head);else socket.destroy();});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const base='ws://127.0.0.1:'+server.address().port;
  async function connect({path='/ws/tsa?x-auth-token='+GOOD,headers={'X-Forwarded-Proto':'https'},options={}}={}){
    const ws=new WebSocket(base+path,{headers,...options});
    const messages=[];
    ws.on('message',data=>messages.push(JSON.parse(data.toString())));
    ws.on('error',()=>{});
    const outcome=await new Promise(resolve=>{
      ws.once('open',()=>resolve('open'));
      ws.once('unexpected-response',(_req,res)=>{resolve(res.statusCode);res.resume();});
      ws.once('error',()=>resolve('error'));
    });
    return {ws,messages,outcome};
  }
  return {registry,hub,server,connect,async stop(){hub.close();server.close();server.closeAllConnections?.();}};
}
const settle=(ms=60)=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitFor(check,ms=2000){
  const end=Date.now()+ms;
  while(Date.now()<end){if(check())return true;await settle(10);}
  return check();
}

test('the helpers recognise DJI-style tokens and only trust proxy headers from local peers',()=>{
  assert.equal(tokenFrom({url:'/ws/tsa?x-auth-token=abc',headers:{}}),'abc');
  assert.equal(tokenFrom({url:'/ws/tsa?X-Auth-Token=abc%2B1',headers:{}}),'abc+1');
  assert.equal(tokenFrom({url:'/ws/tsa',headers:{'x-auth-token':'hdr'}}),'hdr');
  assert.equal(tokenFrom({url:'/ws/tsa?x-auth-token=',headers:{}}),null);
  assert.equal(tokenFrom({url:'/ws/tsa?x-auth-token='+'a'.repeat(257),headers:{}}),null);
  assert.equal(tokenFrom({url:'/ws/tsa',headers:{}}),null);
  for(const ok of ['127.0.0.1','::1','::ffff:127.0.0.1'])
    assert.equal(trustedPeer(ok),true,ok);
  for(const bad of ['8.8.8.8','192.168.178.5','10.0.0.2','172.16.0.1','172.31.255.1',
                    '172.32.0.1','100.64.0.1',undefined,null,''])
    assert.equal(trustedPeer(bad),false,String(bad));
  assert.equal(trustedPeer('::ffff:172.18.0.1',['172.18.0.1']),true);
  assert.equal(trustedPeer('172.18.0.2',['172.18.0.1']),false);
  const req=(proto,addr)=>({socket:{remoteAddress:addr},headers:{'x-forwarded-proto':proto}});
  assert.equal(secure(req('https','127.0.0.1')),true);
  assert.equal(secure(req('https, http','127.0.0.1')),false);
  assert.equal(secure(req('https','192.168.178.5')),false);
  assert.equal(secure(req('https','172.18.0.1'),['172.18.0.1']),true);
  assert.equal(secure(req('http','127.0.0.1')),false);
  assert.equal(secure(req('https','8.8.8.8')),false,'forwarded header from a public peer must be ignored');
});

test('upgrades are refused without HTTPS, without a token, with a wrong token or for another workspace',async()=>{
  const t=await setup({authorize:async token=>token===GOOD?{role:'pilot',workspaceId:WS_ID}:
    token==='other'?{role:'pilot',workspaceId:OTHER_WS}:null});
  try{
    assert.equal((await t.connect({headers:{}})).outcome,403);
    assert.equal((await t.connect({headers:{'X-Forwarded-Proto':'http'}})).outcome,403);
    assert.equal((await t.connect({path:'/ws/tsa'})).outcome,401);
    assert.equal((await t.connect({path:'/ws/tsa?x-auth-token=nope'})).outcome,401);
    assert.equal((await t.connect({path:'/ws/tsa?x-auth-token=other'})).outcome,401);
    assert.equal(t.hub.stats().clients,0);
    assert.equal(t.hub.stats().rejected,5);
  }finally{await t.stop();}
});

test('authorization failures are a 503, not a crash or an open channel',async()=>{
  const t=await setup({authorize:async()=>{throw new Error('redis password private');}});
  try{
    const r=await t.connect();
    assert.equal(r.outcome,503);
    assert.equal(t.hub.stats().clients,0);
  }finally{await t.stop();}
});

test('a valid token connects through the query string or the header; the client cap holds',async()=>{
  const t=await setup({maxClients:2});
  try{
    const a=await t.connect();
    const b=await t.connect({path:'/ws/tsa',headers:{'X-Forwarded-Proto':'https','X-Auth-Token':GOOD}});
    assert.equal(a.outcome,'open');assert.equal(b.outcome,'open');
    assert.equal(t.hub.stats().clients,2);
    assert.equal((await t.connect()).outcome,503);
    a.ws.close();
    await waitFor(()=>t.hub.stats().clients===1);
    assert.equal((await t.connect()).outcome,'open');
  }finally{await t.stop();}
});

test('a new position is pushed once as device_osd; repeats and invalid positions are not',async()=>{
  const t=await setup();
  try{
    const c=await t.connect();
    t.hub.tick();
    await waitFor(()=>c.messages.length>=2);
    const osd=c.messages.filter(m=>m.biz_code==='device_osd');
    assert.deepEqual(osd.map(m=>m.data.sn).sort(),['AIR01','RC01']);
    assert.deepEqual(osd.find(m=>m.data.sn==='AIR01').data.host,
      {latitude:49.1,longitude:8.4,height:100,attitude_head:10,elevation:5,horizontal_speed:1,vertical_speed:0});
    c.messages.length=0;
    t.hub.tick();t.hub.tick();await settle();
    assert.deepEqual(c.messages,[],'same position must not be pushed again');
    t.registry.devices=[device('RC01'),device('AIR01',{lastPositionAt:2000,telemetry:{latitude:49.2,longitude:8.5}})];
    t.hub.tick();
    await waitFor(()=>c.messages.length>=1);
    assert.equal(c.messages.length,1);
    assert.equal(c.messages[0].data.host.latitude,49.2);
    c.messages.length=0;
    t.registry.devices=[device('RC01'),device('AIR01',{lastPositionAt:3000,telemetry:{latitude:0,longitude:0}})];
    t.hub.tick();await settle();
    assert.deepEqual(c.messages,[]);
  }finally{await t.stop();}
});

test('late TSA client receives fresh positions without duplicating other clients',async()=>{
  const t=await setup();
  try{
    t.hub.tick(); // a position was processed before there were any clients
    const first=await t.connect();
    assert.equal(first.outcome,'open');
    assert.equal(await waitFor(()=>first.messages.length===2),true);
    assert.deepEqual(first.messages.map(x=>x.biz_code),['device_osd','device_osd']);
    const second=await t.connect();
    assert.equal(second.outcome,'open');
    assert.equal(await waitFor(()=>second.messages.length===2),true);
    assert.equal(first.messages.length,2,'new connection must not rebroadcast to others');
    t.hub.tick();await settle();
    assert.equal(first.messages.length,2);
    assert.equal(second.messages.length,2);
  }finally{await t.stop();}
});

test('online, offline and topology changes are announced once per tick; the initial state is silent',async()=>{
  const t=await setup();
  try{
    const c=await t.connect();
    t.hub.tick();await settle();
    const presence=()=>c.messages.filter(m=>m.biz_code!=='device_osd').map(m=>m.biz_code);
    assert.deepEqual(presence(),[],'devices that were already online at startup need no push');
    t.registry.devices=[device('RC01'),device('AIR01',{fresh:false})];
    t.hub.tick();await waitFor(()=>presence().length>=1);
    assert.deepEqual(presence(),['device_offline']);
    t.registry.devices=[device('RC01'),device('AIR01')];
    t.hub.tick();await waitFor(()=>presence().length>=2);
    assert.deepEqual(presence(),['device_offline','device_online']);
    // two devices appear in the same tick: one device_online
    c.messages.length=0;
    t.registry.devices=[device('RC01'),device('AIR01'),device('AIR02'),device('AIR03')];
    t.hub.tick();await waitFor(()=>presence().length>=1);await settle();
    assert.deepEqual(presence(),['device_online']);
    // a device disappears
    c.messages.length=0;
    t.registry.devices=[device('RC01'),device('AIR01'),device('AIR02')];
    t.hub.tick();await waitFor(()=>presence().length>=1);
    assert.deepEqual(presence(),['device_offline']);
    // a topology change from MQTT
    c.messages.length=0;
    t.hub.topologyChanged();t.hub.topologyChanged();
    t.hub.tick();await waitFor(()=>presence().length>=1);await settle();
    assert.deepEqual(presence(),['device_update_topo']);
    t.hub.tick();await settle();
    assert.deepEqual(presence(),['device_update_topo']);
  }finally{await t.stop();}
});

test('anything a client sends is ignored and cannot change the stream or crash the hub',async()=>{
  const t=await setup();
  try{
    const c=await t.connect();
    c.ws.send(JSON.stringify({biz_code:'device_osd',data:{sn:'EVIL',host:{latitude:1,longitude:1}}}));
    c.ws.send('not json');
    await settle(100);
    assert.equal(c.ws.readyState,WebSocket.OPEN);
    assert.deepEqual(c.messages,[]);
    // an oversized frame closes only that connection
    const big=await t.connect();
    big.ws.send('x'.repeat(5000));
    await waitFor(()=>big.ws.readyState===WebSocket.CLOSED);
    assert.equal(big.ws.readyState,WebSocket.CLOSED);
    assert.equal(c.ws.readyState,WebSocket.OPEN);
  }finally{await t.stop();}
});

test('clients that stop answering pings are dropped',async()=>{
  const t=await setup({pingMs:40});
  try{
    const silent=await t.connect({options:{autoPong:false}});
    const alive=await t.connect();
    assert.equal(silent.outcome,'open');
    assert.equal(await waitFor(()=>silent.ws.readyState===WebSocket.CLOSED,2000),true);
    assert.equal(alive.ws.readyState,WebSocket.OPEN);
  }finally{await t.stop();}
});

test('closing the hub disconnects every client',async()=>{
  const t=await setup();
  const c=await t.connect();
  assert.equal(c.outcome,'open');
  t.hub.close();
  assert.equal(await waitFor(()=>c.ws.readyState===WebSocket.CLOSED),true);
  assert.equal(t.hub.stats().clients,0);
  t.server.close();t.server.closeAllConnections?.();
});

test('the hub requires a registry, an authorizer and a workspace UUID',()=>{
  const registry={snapshot:()=>[]};
  assert.throws(()=>createTsaHub({authorize:()=>null,workspaceId:WS_ID}));
  assert.throws(()=>createTsaHub({registry,workspaceId:WS_ID}));
  assert.throws(()=>createTsaHub({registry,authorize:()=>null,workspaceId:'nope'}));
});

// ---- GET /manage/api/v1/workspaces/{id}/devices/topologies
function res(){return {statusCode:200,body:null,status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;}};}
const req=(over={})=>({socket:{remoteAddress:'127.0.0.1'},secure:true,
  headers:{'x-auth-token':GOOD,'x-forwarded-proto':'https'},params:{workspaceId:WS_ID},...over});

test('the topology list needs HTTPS, a valid token and the right workspace',async()=>{
  const registry={snapshot:()=>[device('RC01'),device('AIR01')]};
  const handler=createTopologyListHandler({registry,workspaceId:WS_ID,
    authorize:async token=>token===GOOD?{role:'pilot',workspaceId:WS_ID}:token==='other'?{role:'pilot',workspaceId:OTHER_WS}:null});
  const ok=res();await handler(req(),ok);
  assert.equal(ok.statusCode,200);
  assert.equal(ok.body.code,0);
  assert.equal(ok.body.data.list[0].hosts[0].sn,'AIR01');
  for(const [r,status] of [
    [req({headers:{'x-auth-token':GOOD,'x-forwarded-proto':'http'}}),403],
    [req({socket:{remoteAddress:'192.168.178.5'}}),403],
    [req({headers:{'x-forwarded-proto':'https'}}),401],[req({headers:{'x-auth-token':'nope','x-forwarded-proto':'https'}}),401],
    [req({headers:{'x-auth-token':'other','x-forwarded-proto':'https'}}),404],[req({params:{workspaceId:OTHER_WS}}),404]]){
    const out=res();await handler(r,out);
    assert.equal(out.statusCode,status);
    assert.equal(out.body.code,status);
    assert.deepEqual(out.body.data,{});
  }
});

test('topology list failures are redacted service errors',async()=>{
  const handler=createTopologyListHandler({registry:{snapshot:()=>{throw new Error('private details');}},
    workspaceId:WS_ID,authorize:async()=>({role:'pilot',workspaceId:WS_ID})});
  const out=res();await handler(req(),out);
  assert.equal(out.statusCode,503);
  assert.doesNotMatch(JSON.stringify(out.body),/private/);
  const broken=createTopologyListHandler({registry:{snapshot:()=>[]},workspaceId:WS_ID,
    authorize:async()=>{throw new Error('redis private');}});
  const out2=res();await broken(req(),out2);
  assert.equal(out2.statusCode,503);
  assert.doesNotMatch(JSON.stringify(out2.body),/private/);
});
void express;
