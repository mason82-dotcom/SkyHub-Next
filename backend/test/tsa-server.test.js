'use strict';
const {before,after,test}=require('node:test');
const assert=require('node:assert/strict');
const {once}=require('node:events');
const WebSocket=require('ws');
const {io}=require('socket.io-client');

// Real app with situation awareness enabled. Broker and Redis point to the closed local port 1.
const VIEW_TOKEN='test-view-token-abcdefghijklmnopqrstuvwxyz';
const PILOT_TOKEN='test-pilot-token-abcdefghijklmnopqrstuvwxyz';
const WORKSPACE='123e4567-e89b-42d3-a456-426614174000';
Object.assign(process.env,{
  NODE_ENV:'test',PORT:'0',SKYHUB_BIND_ADDRESS:'127.0.0.1',
  SKYHUB_VIEW_TOKEN:VIEW_TOKEN,
  MQTT_BROKER_URL:'mqtt://127.0.0.1:1',REDIS_URL:'redis://127.0.0.1:1',
  SKYHUB_TOPOLOGY_ACK_ENABLED:'false',
  SKYHUB_PILOT_ENABLED:'true',SKYHUB_PILOT_ACCESS_TOKEN:PILOT_TOKEN,
  SKYHUB_DJI_APP_ID:'test-app-id',SKYHUB_DJI_APP_KEY:'test-app-key',SKYHUB_DJI_APP_LICENSE:'test-license',
  SKYHUB_PILOT_MQTT_URL:'mqtt://192.168.178.63:1884',
  SKYHUB_PILOT_MQTT_USER:'test-pilot-user',SKYHUB_PILOT_MQTT_PASSWORD:'test-pilot-password',
  SKYHUB_PILOT_WORKSPACE_ID:WORKSPACE,
  SKYHUB_DJI_TSA_ENABLED:'true',SKYHUB_PILOT_PUBLIC_URL:'https://rpi5.fritz.box'
});
delete process.env.DATABASE_URL;
delete process.env.SKYHUB_LAN_VIEW_CIDR;
const {server,stop}=require('../server');
let base;
before(async()=>{
  if(!server.listening)await once(server,'listening');
  base='127.0.0.1:'+server.address().port;
});
after(()=>stop());

function wsOutcome(path,headers={}){
  return new Promise(resolve=>{
    const ws=new WebSocket('ws://'+base+path,{headers});
    ws.once('open',()=>{resolve({outcome:'open',ws});});
    ws.once('unexpected-response',(_req,res)=>{resolve({outcome:res.statusCode});res.resume();});
    ws.once('error',()=>resolve({outcome:'error'}));
  });
}
const topologies='/manage/api/v1/workspaces/'+WORKSPACE+'/devices/topologies';

test('bootstrap hands the RC the api and ws hosts',async()=>{
  const res=await fetch('http://'+base+'/api/pilot/bootstrap',{method:'POST',
    headers:{authorization:'Bearer '+PILOT_TOKEN,'x-forwarded-proto':'https'}});
  assert.equal(res.status,200);
  assert.deepEqual((await res.json()).tsa,{apiHost:'https://rpi5.fritz.box',wsHost:'wss://rpi5.fritz.box/ws/tsa'});
});

test('the DJI topology list is served behind HTTPS and the Pilot token',async()=>{
  const get=headers=>fetch('http://'+base+topologies,{headers});
  const ok=await get({'x-forwarded-proto':'https','x-auth-token':PILOT_TOKEN});
  assert.equal(ok.status,200);
  assert.deepEqual(await ok.json(),{code:0,message:'success',data:{list:[]}});
  assert.equal((await get({'x-auth-token':PILOT_TOKEN})).status,403);
  assert.equal((await get({'x-forwarded-proto':'https','x-auth-token':VIEW_TOKEN})).status,401);
  assert.equal((await get({'x-forwarded-proto':'https'})).status,401);
});

test('the situation-awareness WebSocket accepts the Pilot token and shows up in health',async()=>{
  assert.equal((await wsOutcome('/ws/tsa?x-auth-token='+PILOT_TOKEN)).outcome,403);
  assert.equal((await wsOutcome('/ws/tsa?x-auth-token='+VIEW_TOKEN,{'X-Forwarded-Proto':'https'})).outcome,401);
  const ok=await wsOutcome('/ws/tsa?x-auth-token='+PILOT_TOKEN,{'X-Forwarded-Proto':'https'});
  assert.equal(ok.outcome,'open');
  const health=await (await fetch('http://'+base+'/api/health')).json();
  assert.equal(health.tsa.clients,1);
  assert.equal(JSON.stringify(health).includes(PILOT_TOKEN),false);
  ok.ws.close();
});

test('other upgrade paths are refused while Socket.IO keeps working',async()=>{
  const stray=await wsOutcome('/ws/other?x-auth-token='+PILOT_TOKEN,{'X-Forwarded-Proto':'https'});
  assert.equal(stray.outcome,'error');
  const outcome=await new Promise((resolve,reject)=>{
    const client=io('http://'+base,{transports:['websocket'],reconnection:false,timeout:2000,auth:{token:VIEW_TOKEN}});
    const timer=setTimeout(()=>{client.disconnect();reject(new Error('Socket.IO timeout'));},4000);
    client.once('connect',()=>{clearTimeout(timer);client.disconnect();resolve('connected');});
    client.once('connect_error',err=>{clearTimeout(timer);client.disconnect();resolve(err.message);});
  });
  assert.equal(outcome,'connected');
});
