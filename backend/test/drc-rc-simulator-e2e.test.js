'use strict';
// Complete DRC chain with an IN-MEMORY MQTT transport and synthetic RC.
// HTTP binds only to localhost at an ephemeral port. No live DJI devices/broker.
const test=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const http=require('node:http');
const express=require('express');
const {createDrcRuntime,drcConfig}=require('../drc-runtime');
const {createRcSimulator}=require('../drc-rc-simulator');

const GW='SIMRCP2',SN='SIMM4T',OP='operator-lab-001';
const TOKEN='synthetic-drc-ci-token-not-for-hardware-1234567890';
function fakeClock(start=1810000000000){
  let t=start,n=0;const timers=new Map();
  return {
    now:()=>t,
    setTimeout(fn,ms){const id=++n;timers.set(id,{fn,at:t+ms,every:null});return id;},
    setInterval(fn,ms){const id=++n;timers.set(id,{fn,at:t+ms,every:ms});return id;},
    clearTimeout(id){timers.delete(id);},
    clearInterval(id){timers.delete(id);},
    async advance(ms){
      const end=t+ms;
      for(let i=0;i<10000;i++){
        const next=[...timers.entries()].filter(([,v])=>v.at<=end)
          .sort((a,b)=>a[1].at-b[1].at||a[0]-b[0])[0];
        if(!next){t=end;await new Promise(r=>setImmediate(r));return;}
        const [id,v]=next;t=v.at;
        if(v.every!==null)v.at+=v.every;else timers.delete(id);
        v.fn();await Promise.resolve();await Promise.resolve();
      }
      throw new Error('Virtual timer runaway');
    }
  };
}
function registry(){
  const list=[
    {sn:GW,model:{domain:'2',type:174,subType:0}},
    {sn:SN,gatewaySn:GW,model:{domain:'0',type:99,subType:1},modelName:'Matrice 4T',
      online:true,aircraftConnected:true,positionFresh:true,modeCode:0,
      telemetry:{latitude:49.1,longitude:8.5,heightEllipsoid:150,altitude:0},
      home:{latitude:49.1,longitude:8.5}}
  ];
  return {get:sn=>list.find(d=>d.sn===sn)||null,snapshot:()=>list};
}
async function fixture(){
  const clock=fakeClock(),published=[],mqtt=new EventEmitter();
  mqtt.online=false;mqtt.topics=new Set();
  mqtt.subscribe=(topics,opts,cb)=>{for(const topic of topics)mqtt.topics.add(topic);if(cb)cb(null);};
  mqtt.publish=(topic,payload,opts)=>{
    if(!mqtt.online)throw Error('synthetic broker offline');
    const msg=JSON.parse(String(payload));
    published.push({topic,method:msg.method,qos:opts&&opts.qos});
    if(topic==='thing/product/'+GW+'/services'||topic==='thing/product/'+GW+'/drc/down')
      sim.receive(topic,msg);
  };
  mqtt.end=()=>{mqtt.online=false;};
  mqtt.connect=()=>{mqtt.online=true;mqtt.emit('connect');};
  mqtt.drop=()=>{mqtt.online=false;mqtt.emit('close');};
  const sim=createRcSimulator({
    gateway:GW,aircraftSn:SN,clock,
    publish:(topic,msg)=>{
      // MQTT delivery is asynchronous: replies cannot race ahead of pending
      // service/payload reply registration in the SkyHub session.
      if(mqtt.online&&mqtt.topics.has(topic)){
        const bytes=Buffer.from(JSON.stringify(msg));
        queueMicrotask(()=>{
          if(mqtt.online)mqtt.emit('message',topic,bytes,{retain:false});
        });
      }
    }
  });
  const env={
    SKYHUB_DRC_ENABLED:'true',SKYHUB_DRC_TOKEN:TOKEN,SKYHUB_DRC_GATEWAY_SN:GW,
    SKYHUB_DRC_MQTT_URL:'mqtt://in-memory:1884',
    SKYHUB_DRC_MQTT_USERNAME:'synthetic',SKYHUB_DRC_MQTT_PASSWORD:'synthetic',
    SKYHUB_DRC_BROKER_ADDRESS:'in-memory:1884',
    SKYHUB_DRC_BROKER_USERNAME:'synthetic',SKYHUB_DRC_BROKER_PASSWORD:'synthetic'
  };
  const config=drcConfig(env);
  assert.equal(config.enabled,true,config.issue);
  const ns={use(){},on(){},emit(){}};
  const rt=createDrcRuntime({config,registry:registry(),pool:null,io:{of:()=>ns},express,
    mqttConnect:()=>mqtt,clock,log:{log(){},error(){}}});
  const app=express();app.use(express.json());app.use('/api/drc',rt.router);
  const server=http.createServer(app);
  await new Promise((resolve,reject)=>{
    server.once('error',reject);server.listen(0,'127.0.0.1',resolve);
  });
  const base='http://127.0.0.1:'+server.address().port+'/api/drc';
  async function call(method,path,body){
    const response=await fetch(base+path,{method,headers:{
      'X-SkyHub-DRC-Token':TOKEN,'X-SkyHub-Operator':OP,'Content-Type':'application/json'},
      body:method==='POST'?JSON.stringify(body||{}):undefined});
    return {code:response.status,data:await response.json()};
  }
  mqtt.connect();sim.start(5);
  return {
    clock,mqtt,sim,rt,published,call,
    async authorizeAndEnter(){
      const request=await call('POST','/auth/request');
      assert.equal(request.code,200,JSON.stringify(request.data));
      assert.equal(request.data.status.phase,'auth_pending');
      await clock.advance(400);
      assert.equal(rt.session.snapshot().phase,'authorized');
      const enter=await call('POST','/live/enter');
      assert.equal(enter.code,200,JSON.stringify(enter.data));
      assert.equal(rt.session.snapshot().phase,'drc_active');
    },
    async proveLink(){
      await clock.advance(1100);
      assert.equal(rt.session.snapshot().controlLink.ready,true,'RC state 2 and uplink heartbeat required');
    },
    async close(){
      sim.stop();await rt.shutdown();await new Promise(resolve=>server.close(resolve));
    }
  };
}

test('E2E: HTTP authentication -> synthetic RC -> link proof -> payload -> verified handback',async()=>{
  const f=await fixture();
  try{
    assert.equal((await f.call('GET','/status')).data.phase,'idle');
    await f.authorizeAndEnter();
    assert.equal(f.rt.session.snapshot().controlLink.ready,false);
    const blocked=await f.call('POST','/flyto',{latitude:49.1001,longitude:8.5001,heightAboveTakeoff:30});
    assert.equal(blocked.code,423);
    assert.equal(f.published.some(m=>m.method==='fly_to_point'),false);
    // Retained frames must never be accepted as current uplink evidence.
    f.mqtt.emit('message','thing/product/'+GW+'/drc/up',
      Buffer.from(JSON.stringify({method:'heart_beat',data:{timestamp:f.clock.now()}})),{retain:true});
    assert.equal(f.rt.session.snapshot().controlLink.ready,false);
    await f.proveLink();
    f.rt.session.acquire(OP);
    const photo=await f.call('POST','/payload/photo_take');
    assert.equal(photo.code,200,JSON.stringify(photo.data));
    assert.equal(f.sim.state().camera.photos,1);
    const release=await f.call('POST','/release');
    assert.equal(release.code,200,JSON.stringify(release.data));
    assert.equal(f.rt.session.snapshot().phase,'idle');
    assert.equal(f.rt.session.snapshot().recoveryRequired,false);
    assert.equal(f.sim.state().drcState,0);
    assert.equal(f.published.some(m=>m.method==='cloud_control_release'),true);
    await f.authorizeAndEnter();
  }finally{await f.close();}
});

test('E2E: broker disconnect, reconnect before timeout, RC handback confirmed',async()=>{
  const f=await fixture();
  try{
    await f.authorizeAndEnter();await f.proveLink();
    f.mqtt.drop();
    assert.equal(f.rt.session.snapshot().controlLink.ready,false);
    assert.equal(f.rt.session.snapshot().recoveryRequired,true);
    assert.equal(f.rt.session.snapshot().failsafe.pending,true);
    f.rt.session.acquire(OP);
    assert.equal(f.rt.session.snapshot().failsafe.pending,true,'renewed lease cannot clear transport-loss fail-safe');
    f.mqtt.connect();
    await f.clock.advance(3100);
    const state=f.rt.session.snapshot();
    assert.equal(state.phase,'idle');
    assert.equal(state.recoveryRequired,false);
    assert.equal(f.sim.state().drcState,0);
    assert.equal(state.failsafe.confirmed,true);
    assert.equal((await f.call('POST','/auth/request')).code,200);
  }finally{await f.close();}
});

test('E2E: unrecoverable broker disconnect latches unsafe handback after reconnect',async()=>{
  const f=await fixture();
  try{
    await f.authorizeAndEnter();await f.proveLink();
    f.mqtt.drop();
    await f.clock.advance(12000);
    const state=f.rt.session.snapshot();
    assert.equal(state.phase,'idle');
    assert.equal(state.recoveryRequired,true);
    assert.equal(state.failsafe.confirmed,false);
    assert.match(state.lastError,/nicht bestätigt/);
    f.mqtt.connect();
    f.mqtt.emit('message','thing/product/'+GW+'/osd',
      Buffer.from(JSON.stringify({data:{drc_state:2}})),{retain:false});
    f.mqtt.emit('message','thing/product/'+GW+'/drc/up',
      Buffer.from(JSON.stringify({method:'heart_beat',data:{timestamp:f.clock.now()}})),{retain:false});
    assert.equal(f.rt.session.snapshot().controlLink.ready,false);
    assert.equal((await f.call('POST','/auth/request')).code,423);
    assert.equal(f.published.filter(m=>m.method==='cloud_control_auth_request').length,1);
  }finally{await f.close();}
});
