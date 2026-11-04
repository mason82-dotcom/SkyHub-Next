'use strict';
// DRC runtime: configuration rules, token gate, topics/QoS, registry gating, reply flow, events_reply, audit.
const test=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const {EventEmitter}=require('node:events');
const express=require('express');
const {drcConfig,createDrcRuntime,aircraftFromRegistry}=require('../drc-runtime');

const TOKEN='d'.repeat(40);
const ENV={SKYHUB_DRC_ENABLED:'true',SKYHUB_DRC_TOKEN:TOKEN,SKYHUB_DRC_GATEWAY_SN:'RCP2SN01',SKYHUB_DRC_MQTT_URL:'mqtt://mosquitto:1884',
  SKYHUB_DRC_MQTT_USERNAME:'skyhub_commander',SKYHUB_DRC_MQTT_PASSWORD:'x',SKYHUB_DRC_BROKER_ADDRESS:'192.168.178.63:1884',
  SKYHUB_DRC_BROKER_USERNAME:'drc',SKYHUB_DRC_BROKER_PASSWORD:'y'};

function registry(rcModel={domain:'2',type:174,subType:0},aircraft={domain:'0',type:99,subType:1}){
  const devices=[{sn:'RCP2SN01',model:rcModel,role:'gateway'},
    {sn:'M4TSN01',gatewaySn:'RCP2SN01',model:aircraft,modelName:'Matrice 4T',online:true,aircraftConnected:true,positionFresh:true,modeCode:3,
      telemetry:{latitude:49.1,longitude:8.5,altitude:30,heightEllipsoid:180},home:{latitude:49.1,longitude:8.5}}];
  return {get:sn=>devices.find(d=>d.sn===sn)||null,snapshot:()=>devices};
}
function fakeMqtt(){
  const c=new EventEmitter();c.published=[];c.subscribed=[];
  c.publish=(topic,payload,opts)=>c.published.push({topic,msg:JSON.parse(payload),qos:opts.qos});
  c.subscribe=(topics,opts,cb)=>{c.subscribed.push(...topics);cb&&cb(null);};
  c.end=()=>{};
  return c;
}
function fakeIo(){const ns={use(){},on(){},emit(){}};return {of:()=>ns};}

test('configuration: off by default, all fields required, tokens must differ, limits bounded',()=>{
  assert.equal(drcConfig({}).enabled,false);
  const ok=drcConfig(ENV);
  assert.equal(ok.enabled,true,ok.issue);
  assert.deepEqual(ok.limits,{maxSpeedMs:10,maxHeightAboveTakeoffM:120,maxDistanceM:2000,stickScale:0.5});
  assert.match(drcConfig({...ENV,SKYHUB_DRC_TOKEN:'kurz'}).issue,/32/);
  assert.match(drcConfig({...ENV,SKYHUB_VIEW_TOKEN:TOKEN}).issue,/unterscheiden/);
  assert.match(drcConfig({...ENV,SKYHUB_DRC_MAX_HEIGHT_M:'150'}).issue,/20 und 120/);
  assert.match(drcConfig({...ENV,SKYHUB_DRC_BROKER_ADDRESS:'nur-host'}).issue,/host:port/);
  const g={...ENV};delete g.SKYHUB_DRC_GATEWAY_SN;
  assert.match(drcConfig(g).issue,/GATEWAY_SN/);
});

test('registry gate: only an RC Plus 2 with Matrice 4 behind it',()=>{
  assert.equal(aircraftFromRegistry(registry(),'RCP2SN01')().modelKey,'0-99-1');
  assert.equal(aircraftFromRegistry(registry({domain:'2',type:144,subType:0}),'RCP2SN01')(),null,'RC Pro is not controllable here');
  assert.equal(aircraftFromRegistry(registry(),'ANDERE')(),null);
  const a=aircraftFromRegistry(registry(undefined,{domain:'0',type:77,subType:0}),'RCP2SN01')();
  assert.equal(a.modelKey,'0-77-0','reported; the session refuses M3E for flight control');
});

test('HTTP: token gate, auth request on the services topic with QoS 1, reply via MQTT, audit',async()=>{
  const mqtt=fakeMqtt(),audits=[];
  const pool={query:async(sql,params)=>{if(/INSERT INTO drc_audit/.test(sql))audits.push(params);return {rows:[]};}};
  const rt=createDrcRuntime({config:drcConfig(ENV),registry:registry(),pool,io:fakeIo(),express,mqttConnect:()=>mqtt,log:{log(){},error(){}}});
  mqtt.emit('connect');
  assert.deepEqual(mqtt.subscribed.sort(),['thing/product/RCP2SN01/drc/up','thing/product/RCP2SN01/events','thing/product/RCP2SN01/services_reply',
    'thing/product/RCP2SN01/state']);
  const app=express();app.use(express.json());app.use('/api/drc',rt.router);
  const server=http.createServer(app);await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base='http://127.0.0.1:'+server.address().port+'/api/drc';
  const call=(method,path,body,headers={})=>fetch(base+path,{method,headers:{'Content-Type':'application/json',...headers},body:body?JSON.stringify(body):undefined})
    .then(async r=>({status:r.status,body:await r.json()}));
  const H={'X-SkyHub-DRC-Token':TOKEN,'X-SkyHub-Operator':'operator-tab-1'};
  try{
    assert.equal((await call('GET','/status')).status,403);
    assert.equal((await call('POST','/auth/request',{}, {'X-SkyHub-DRC-Token':TOKEN})).status,400,'operator id required');
    const st=await call('GET','/status',null,H);
    assert.equal(st.status,200);assert.equal(st.body.phase,'idle');assert.equal(st.body.aircraft.model,'Matrice 4T');
    const pending=call('POST','/auth/request',{},H);
    await new Promise(r=>setTimeout(r,50));
    const req=mqtt.published.find(p=>p.msg.method==='cloud_control_auth_request');
    assert.equal(req.topic,'thing/product/RCP2SN01/services');assert.equal(req.qos,1);
    mqtt.emit('message','thing/product/RCP2SN01/services_reply',Buffer.from(JSON.stringify({tid:req.msg.tid,method:req.msg.method,data:{result:0}})));
    const r=await pending;
    assert.equal(r.status,200);assert.equal(r.body.status.phase,'auth_pending');
    mqtt.emit('message','thing/product/RCP2SN01/events',Buffer.from(JSON.stringify({tid:'e1',bid:'b1',method:'cloud_control_auth_notify',need_reply:0,data:{result:0,output:{status:'ok'}}})));
    assert.equal((await call('GET','/status',null,H)).body.phase,'authorized');
    // An event that needs a reply is acknowledged on events_reply.
    mqtt.emit('message','thing/product/RCP2SN01/events',Buffer.from(JSON.stringify({tid:'e2',bid:'b2',method:'joystick_invalid_notify',need_reply:1,data:{reason:0}})));
    const ack=mqtt.published.find(p=>p.topic==='thing/product/RCP2SN01/events_reply');
    assert.deepEqual([ack.msg.tid,ack.msg.method,ack.msg.data.result,ack.qos],['e2','joystick_invalid_notify',0,1]);
    assert.equal((await call('POST','/takeoff',{latitude:49.1,longitude:8.5,heightAboveTakeoff:40},H)).status,400,'takeoff needs explicit confirmation');
    assert.equal((await call('POST','/landing',{kind:'force',confirm:'x'},H)).status,400);
    assert.ok(audits.some(a=>a[1]==='denied'),'denied request audited');
    assert.ok(audits.some(a=>a[1]==='command'&&JSON.parse(a[2]).method==='cloud_control_auth_request'));
    assert.ok(!JSON.stringify(audits).includes(TOKEN),'audit never contains the token');
  }finally{server.close();await rt.shutdown();}
});

test('compose passes the DRC settings to the backend (default off)',()=>{
  const compose=require('node:fs').readFileSync(require('node:path').join(__dirname,'../../docker-compose.yml'),'utf8');
  assert.match(compose,/SKYHUB_DRC_ENABLED: \$\{SKYHUB_DRC_ENABLED:-false\}/);
  for(const k of ['TOKEN','GATEWAY_SN','MQTT_URL','MQTT_USERNAME','MQTT_PASSWORD','BROKER_ADDRESS','BROKER_USERNAME','BROKER_PASSWORD','BROKER_TLS',
    'MAX_SPEED_MS','MAX_HEIGHT_M','MAX_DISTANCE_M','STICK_SCALE'])assert.ok(compose.includes('SKYHUB_DRC_'+k+':'),k);
});
