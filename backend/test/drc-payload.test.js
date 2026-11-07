'use strict';
// Camera / gimbal control of the Matrice 4E/4T over the RC Plus 2 DRC link (DJI Cloud API 1.18, dji-rc-plus-2/remote-control).
const test=require('node:test');
const assert=require('node:assert/strict');
const PL=require('../drc-payload');
const P=require('../drc-protocol');
const {createDrcSession}=require('../drc-session');
const {createRcSimulator}=require('../drc-rc-simulator');
const {modelKey}=require('../drc-runtime');

function fakeClock(start=1793800000000){
  let t=start,id=0;const timers=new Map();
  return {now:()=>t,
    setTimeout(fn,ms){const k=++id;timers.set(k,{fn,at:t+ms,every:null});return k;},
    setInterval(fn,ms){const k=++id;timers.set(k,{fn,at:t+ms,every:ms});return k;},
    clearTimeout(k){timers.delete(k);},clearInterval(k){timers.delete(k);},
    async advance(ms){
      const end=t+ms;
      for(;;){
        const due=[...timers.entries()].filter(([,x])=>x.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];
        if(!due)break;
        const [k,x]=due;t=x.at;
        if(x.every)x.at+=x.every;else timers.delete(k);
        x.fn();
        await Promise.resolve();
      }
      t=end;await new Promise(r=>setImmediate(r));
    }};
}
const M4T={modelKey:'0-99-1',modelName:'Matrice 4T',heightEllipsoid:180,heightAboveTakeoff:30,position:{latitude:49.1,longitude:8.5},
  home:{latitude:49.1,longitude:8.5},payloadIndex:null};
const M4E={...M4T,modelKey:'0-99-0',modelName:'Matrice 4E'};
const T4={payloadIndex:'89-0-0',cameraTypes:['wide','zoom','ir']},E4={payloadIndex:'88-0-0',cameraTypes:['wide','zoom']};

test('builders follow the 1.18 field tables',()=>{
  assert.deepEqual(PL.command('camera_mode',{mode:1},T4),{method:'drc_camera_mode_switch',label:'Kameramodus',data:{payload_index:'89-0-0',camera_mode:1}});
  assert.deepEqual(PL.command('zoom',{cameraType:'zoom',factor:56.04},T4).data,{payload_index:'89-0-0',camera_type:'zoom',zoom_factor:56});
  assert.deepEqual(PL.command('gimbal_reset',{mode:1},T4).data,{payload_index:'89-0-0',reset_mode:1});
  assert.deepEqual(PL.command('aim',{cameraType:'wide',x:0.5,y:0.25},T4).data,{payload_index:'89-0-0',camera_type:'wide',locked:false,x:0.5,y:0.25});
  assert.equal(PL.command('exposure_value',{cameraType:'wide',value:16},T4).data.exposure_value,'16');   // enum_string
  assert.equal(PL.EV['16'],'0.0 EV');assert.equal(PL.EV['1'],'-5.0 EV');assert.equal(PL.EV['31'],'+5.0 EV');
  assert.deepEqual(PL.lookAt({latitude:49.1234567,longitude:8.5,height:150.04},T4),
    {payload_index:'89-0-0',locked:false,latitude:49.123457,longitude:8.5,height:150});
  assert.deepEqual(PL.drag({pitch:-1,yaw:0.5},T4),{payload_index:'89-0-0',locked:false,pitch_speed:-0.6,yaw_speed:0.3});
});

test('ranges and lenses are enforced, nothing is clamped silently',()=>{
  assert.throws(()=>PL.command('zoom',{cameraType:'ir',factor:21},T4),/zwischen 2 und 20/);       // IR 2–20
  assert.throws(()=>PL.command('zoom',{cameraType:'zoom',factor:201},T4),/zwischen 2 und 200/);
  assert.throws(()=>PL.command('zoom',{cameraType:'ir',factor:4},E4),/gibt es an dieser Kamera nicht/);  // 4E has no thermal
  assert.throws(()=>PL.command('ir_metering_mode',{mode:1},E4),/Matrice 4T/);
  assert.throws(()=>PL.command('camera_mode',{mode:5},T4),/zwischen 0 und 4/);
  assert.throws(()=>PL.command('gimbal_reset',{mode:4},T4),/zwischen 0 und 3/);
  assert.throws(()=>PL.command('aim',{cameraType:'wide',x:1.2,y:0},T4),/zwischen 0 und 1/);
  assert.throws(()=>PL.command('focus_mode',{cameraType:'ir',mode:0},T4),/camera_type/);           // focus only wide/zoom
  assert.throws(()=>PL.command('exposure_mode',{cameraType:'wide',mode:0},T4),/zwischen 1 und 4/);
  assert.throws(()=>PL.command('split_screen',{enable:'yes'},T4),/true oder false/);
  assert.throws(()=>PL.command('night_lights',{},T4),/unbekannter Kamerabefehl/);               // beacons stay with the pilot
  assert.throws(()=>PL.command('__proto__',{},T4),/unbekannter Kamerabefehl/);
  assert.throws(()=>PL.drag({pitch:2},T4),/zwischen -1 und 1/);
  assert.throws(()=>PL.lookAt({latitude:49,longitude:8,height:1},T4),/zwischen 2 und 10000/);
});

test('payload context: documented default, observed payload_index only if it is the same camera',()=>{
  assert.equal(PL.payloadContext('0-99-1',null).payloadIndex,'89-0-0');
  assert.equal(PL.payloadContext('0-99-0',undefined).payloadIndex,'88-0-0');
  assert.equal(PL.payloadContext('0-99-1','89-0-0').payloadIndex,'89-0-0');
  assert.equal(PL.payloadContext('0-99-1','42-0-0').payloadIndex,'89-0-0');
  assert.equal(PL.payloadContext('0-77-0','68-0-0'),null);                                            // Mavic 3: RC Pro, not here
});

test('drc_state from the RC OSD (pushMode 0) and payload replies/pushes on drc/up are parsed',()=>{
  assert.deepEqual(P.parseUp('thing/product/RC1/osd',{data:{drc_state:0,capacity_percent:50}}),{gateway:'RC1',channel:'osd',method:null,drcState:0});
  assert.equal(P.parseUp('thing/product/RC1/osd',{data:{capacity_percent:50}}),null);
  const r=P.parseUp('thing/product/RC1/drc/up',{method:'drc_camera_aim',seq:7,data:{result:0}});
  assert.equal(r.seq,7);assert.equal(r.result,0);
  const st=P.parseUp('thing/product/RC1/drc/up',{method:'drc_camera_state_push',data:{payload_index:'89-0-0',
    camera_state:{camera_mode:1,recording_state:1,record_time:12,evil:{x:1}},media_storage:{photo_storage_settings:['current','<script>']}}});
  assert.equal(st.push.cameraMode,1);assert.equal(st.push.recording,true);assert.equal(st.push.recordTimeS,12);
  assert.deepEqual(st.push.photoStorage,['current']);assert.equal('evil' in st.push,false);
  const lens=P.parseUp('thing/product/RC1/drc/up',{method:'drc_camera_osd_info_push',data:{zoom_lense:{zoom_factor:7},ir_lense:{ir_zoom_factor:'x'}}});
  assert.equal(lens.push.zoom.factor,7);assert.equal(lens.push.ir.zoomFactor,null);
  assert.equal(P.parseUp('thing/product/RC1/drc/up',{method:'drc_unknown_push',data:{}}),null);
});

test('model key fills a missing domain only for RC Plus 2 and Matrice 4 (dji-rc-plus-2/device lists no domain)',()=>{
  assert.equal(modelKey({domain:null,type:174,subType:0},'gateway'),'2-174-0');
  assert.equal(modelKey({domain:null,type:99,subType:1},'aircraft'),'0-99-1');
  assert.equal(modelKey({domain:null,type:144,subType:0},'gateway'),'-144-0');
  assert.equal(modelKey({domain:'0',type:77,subType:2},'aircraft'),'0-77-2');
});

function setup(aircraft=M4T,{payloadResult=0,replyPayload=true}={}){
  const clock=fakeClock(),drc=[],log=[];
  let session;
  const publishService=(gw,msg)=>queueMicrotask(()=>session.onUp({gateway:gw,channel:'services_reply',method:msg.method,tid:msg.tid,result:0}));
  const publishDrc=(gw,m)=>{
    drc.push(m);
    if(replyPayload&&m.method.startsWith('drc_camera')||replyPayload&&m.method.startsWith('drc_gimbal')||replyPayload&&m.method.startsWith('drc_ir'))
      if(m.method!=='drc_camera_screen_drag')queueMicrotask(()=>session.onUp({gateway:gw,channel:'drc/up',method:m.method,seq:m.seq,result:payloadResult}));
  };
  session=createDrcSession({gateway:'RCP2SN',publishService,publishDrc,aircraft:()=>aircraft,clock,audit:e=>log.push(e),
    broker:()=>({address:'192.168.178.63:1884',clientId:'drc-RCP2SN',username:'drc',password:'pw',expireTime:1793900000,enableTls:false})});
  return {session,clock,drc,log};
}
async function live(x){
  await x.session.requestAuthorization('op1');
  x.session.onUp({gateway:'RCP2SN',channel:'events',method:'cloud_control_auth_notify',status:'ok'});
  await x.session.enterLiveControl('op1');
  x.session.onUp({gateway:'RCP2SN',channel:'osd',drcState:2});
  x.session.onUp({gateway:'RCP2SN',channel:'drc/up',method:'heart_beat',timestamp:x.clock.now()});
}

test('payload commands need live control and the lease; reply is matched by seq and method',async()=>{
  const x=setup();
  await assert.rejects(x.session.payload('op1','photo_take',{}),/erst im Live-Steuermodus|Lease/);
  await live(x);
  await assert.rejects(x.session.payload('op2','photo_take',{}),/Lease/);
  await x.session.payload('op1','camera_mode',{mode:1});
  await x.session.payload('op1','recording_start',{});
  const sent=x.drc.filter(m=>m.method.startsWith('drc_camera'));
  assert.deepEqual(sent.map(m=>m.method),['drc_camera_mode_switch','drc_camera_recording_start']);
  assert.deepEqual(sent[1].data,{payload_index:'89-0-0'});
  assert.equal(x.session.snapshot().camera.lastCommand.status,'OK');
  assert.ok(x.log.some(e=>e.action==='command'&&e.method==='drc_camera_recording_start'&&e.operator==='op1'));
  // A reply with the wrong method for the same seq does not resolve the request.
  const y=setup(M4T,{replyPayload:false});await live(y);
  const p=y.session.payload('op1','photo_take',{});
  const seq=y.drc.at(-1).seq;
  y.session.onUp({gateway:'RCP2SN',channel:'drc/up',method:'drc_camera_aim',seq,result:0});
  y.session.acquire('op1');
  let done=false;p.then(()=>{done=true;},()=>{done=true;});
  await y.clock.advance(1000);assert.equal(done,false);
  y.session.onUp({gateway:'RCP2SN',channel:'drc/up',method:'drc_camera_photo_take',seq,result:0});
  await p;
});

test('payload rejection and timeout are reported, not swallowed',async()=>{
  const x=setup(M4T,{payloadResult:5});await live(x);
  await assert.rejects(x.session.payload('op1','gimbal_reset',{mode:0}),/abgelehnt \(result 5\)/);
  const y=setup(M4T,{replyPayload:false});await live(y);
  const rejected=assert.rejects(y.session.payload('op1','gimbal_reset',{mode:0}),/keine Antwort des Fluggeräts/);
  for(let i=0;i<6;i++){y.session.acquire('op1');await y.clock.advance(1000);}
  await rejected;
});

test('look-at converts the height above take-off into the ellipsoid height',async()=>{
  const x=setup();await live(x);
  await x.session.lookAt('op1',{latitude:49.101,longitude:8.501,heightAboveTakeoff:0});
  const m=x.drc.find(d=>d.method==='drc_camera_look_at');
  assert.equal(m.data.height,150);                 // 180 (aircraft ellipsoid) − 30 (above take-off) + 0
  assert.equal(m.data.locked,false);
  await assert.rejects(x.session.lookAt('op1',{latitude:49.1,longitude:8.5,heightAboveTakeoff:-500}),/-200 und 1500/);
});

test('gimbal drag streams at 10 Hz while held and ends with one zero-speed message',async()=>{
  const x=setup();await live(x);
  x.session.gimbalDrag('op1',{pitch:-0.5,yaw:0});
  await x.clock.advance(250);
  const drags=()=>x.drc.filter(m=>m.method==='drc_camera_screen_drag');
  assert.ok(drags().length>=2);
  assert.equal(drags()[0].data.pitch_speed,-0.3);
  x.session.acquire('op1');
  await x.clock.advance(600);
  const last=drags().at(-1);
  assert.deepEqual([last.data.pitch_speed,last.data.yaw_speed],[0,0]);
  const n=drags().length;x.session.acquire('op1');await x.clock.advance(500);
  assert.equal(drags().length,n);                  // silence after the stop message
  assert.equal(x.session.snapshot().gimbalDragActive,false);
});

test('fail-safe stops a running gimbal drag; Matrice 4E cannot use thermal functions',async()=>{
  const x=setup();await live(x);
  x.session.gimbalDrag('op1',{pitch:1,yaw:1});
  await x.clock.advance(1600);                     // no lease renewal → fail-safe
  const last=x.drc.filter(m=>m.method==='drc_camera_screen_drag').at(-1);
  assert.deepEqual([last.data.pitch_speed,last.data.yaw_speed],[0,0]);
  const e=setup(M4E);await live(e);
  await assert.rejects(e.session.payload('op1','ir_metering_mode',{mode:1}),/Matrice 4T/);
});

test('simulator: drc_state via RC OSD, camera state pushes and gimbal movement reach the session',async()=>{
  const clock=fakeClock();
  let session;
  const sim=createRcSimulator({gateway:'RCP2SN',aircraftSn:'SIMM4T',clock,publish:(topic,msg)=>{
    const m=P.parseUp(topic,JSON.stringify(msg));if(m)queueMicrotask(()=>session.onUp(m));}});
  session=createDrcSession({gateway:'RCP2SN',clock,aircraft:()=>M4T,
    publishService:(gw,m)=>sim.receive(`thing/product/${gw}/services`,m),
    publishDrc:(gw,m)=>sim.receive(`thing/product/${gw}/drc/down`,m),
    broker:()=>({address:'h:1884',clientId:'drc-RCP2SN',username:'u',password:'p',expireTime:1793900000,enableTls:false})});
  sim.start(5);
  await session.requestAuthorization('op1');
  await clock.advance(400);session.acquire('op1');
  await session.enterLiveControl('op1');
  // Simulator emits RC drc_state=2 on mode entry and replies to the first
  // 1 Hz DRC heartbeat; the services acknowledgement alone is insufficient.
  await clock.advance(1100);session.acquire('op1');
  assert.equal(session.snapshot().controlLink.ready,true);
  await session.payload('op1','camera_mode',{mode:1});
  await session.payload('op1','recording_start',{});
  await session.payload('op1','zoom',{cameraType:'zoom',factor:10});
  for(let i=0;i<4;i++){session.acquire('op1');session.gimbalDrag('op1',{pitch:-1,yaw:0});await clock.advance(250);}
  session.acquire('op1');await clock.advance(1000);
  const snap=session.snapshot();
  assert.equal(snap.camera.state.cameraMode,1);
  assert.equal(snap.camera.state.recording,true);
  assert.equal(snap.camera.lens.zoom.factor,10);
  assert.ok(sim.state().camera.pitch< -20,'gimbal pitched down: '+sim.state().camera.pitch);
  assert.ok(snap.osd.gimbal_pitch< -20);
  // Recording is refused by the simulated camera in photo mode → rejection surfaces.
  await session.payload('op1','camera_mode',{mode:0});
  await assert.rejects(session.payload('op1','recording_start',{}),/result 1/);
  // The RC reports DRC lost in its OSD → session falls back to authorized.
  sim.receive('thing/product/RCP2SN/services',{tid:'t',bid:'b',timestamp:0,method:'drc_mode_exit',data:{}});
  await clock.advance(10);
  assert.equal(session.snapshot().phase,'authorized');
  sim.stop();await session.shutdown();
});

// --- RC Pro + Mavic 3 series (mqtt/rc-pro/drc): payload only, commands on services without the drc_ prefix ---------------
const M3M={sn:'M3MSN',modelKey:'0-77-2',modelName:'Mavic 3M',payloadIndex:null,heightEllipsoid:200,heightAboveTakeoff:50,
  position:{latitude:49.15,longitude:8.6},home:{latitude:49.15,longitude:8.6}};
function setupRcPro(aircraft=M3M){
  const clock=fakeClock(),sent=[],drc=[];
  let session;
  const publishService=(gw,msg)=>{sent.push(msg);
    if(msg.method!=='camera_screen_drag')queueMicrotask(()=>session.onUp({gateway:gw,channel:'services_reply',method:msg.method,tid:msg.tid,result:0}));};
  session=createDrcSession({gateway:'RCPROSN',variant:'rc-pro',publishService,publishDrc:(gw,m)=>drc.push(m),aircraft:()=>aircraft,clock,
    broker:()=>({address:'192.168.178.63:1884',clientId:'drc-RCPROSN',username:'drc',password:'pw',expireTime:1793900000,enableTls:false})});
  return {session,clock,sent,drc};
}
test('RC Pro: camera commands go to services without drc_, flight commands are refused, Mavic 3M payload 68-0-0',async()=>{
  const x=setupRcPro();
  await x.session.requestAuthorization('op1');
  x.session.onUp({gateway:'RCPROSN',channel:'events',method:'cloud_control_auth_notify',status:'ok'});
  await x.session.enterLiveControl('op1');
  assert.equal(x.drc.some(m=>m.method==='drc_initial_state_subscribe'),false,'RC Plus 2 only');
  await x.session.payload('op1','photo_take',{});
  await x.session.payload('op1','camera_mode',{mode:3});
  await assert.rejects(x.session.payload('op1','camera_mode',{mode:4}),/zwischen 0 und 3/);
  await assert.rejects(x.session.payload('op1','zoom',{cameraType:'zoom',factor:4}),/gibt es an dieser Kamera nicht/);
  await assert.rejects(x.session.payload('op1','live_lens',{videoType:'wide'}),/live_lens_change/);
  const cam=x.sent.filter(m=>m.method.startsWith('camera_'));
  assert.deepEqual(cam.map(m=>m.method),['camera_photo_take','camera_mode_switch']);
  assert.deepEqual(cam[0].data,{payload_index:'68-0-0'});
  assert.equal(x.drc.some(m=>/^drc_camera/.test(m.method)),false);
  x.session.gimbalDrag('op1',{pitch:0.5});
  await x.clock.advance(150);
  assert.ok(x.sent.some(m=>m.method==='camera_screen_drag'&&m.data.pitch_speed>0));
  assert.throws(()=>x.session.stickInput('op1',{}),/keine Flugbefehle/);
  await assert.rejects(x.session.flyTo('op1',{latitude:49.15,longitude:8.6,heightAboveTakeoff:40}),/keine Flugbefehle/);
  await assert.rejects(x.session.returnHome('op1'),/keine Flugbefehle/);
  assert.throws(()=>x.session.emergencyStop('op1'),/keine Flugbefehle/);
  assert.equal(x.session.snapshot().variant,'rc-pro');
  // a Matrice 4 behind an RC Pro is not accepted (and the RC Plus 2 variant still refuses a Mavic 3)
  const y=setupRcPro(M4T);
  await assert.rejects(y.session.requestAuthorization('op1'),/nur Mavic 3E\/3T\/3M/);
  assert.equal(PL.payloadContext('0-77-0','66-0-0','rc-pro').payloadIndex,'66-0-0');
  assert.equal(PL.methodFor('drc_gimbal_reset','rc-pro'),'gimbal_reset');
  assert.equal(PL.methodFor('drc_gimbal_reset','rc-plus-2'),'drc_gimbal_reset');
});
