'use strict';
// Live flight control session: state machine, reply matching, lease/fail-safe, sticks, limits, audit.
const test=require('node:test');
const assert=require('node:assert/strict');
const {createDrcSession}=require('../drc-session');
const P=require('../drc-protocol');

// Deterministic clock with timers.
function fakeClock(start=1793800000000){
  let t=start,id=0;const timers=new Map();
  const clock={now:()=>t,
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
  return clock;
}
const M4T={modelKey:'0-99-1',modelName:'Matrice 4T',heightEllipsoid:180,heightAboveTakeoff:30,position:{latitude:49.1,longitude:8.5},home:{latitude:49.1,longitude:8.5}};

function setup({aircraft=M4T,autoReply=true,result=0,limits={}}={}){
  const clock=fakeClock(),sent=[],drc=[],log=[];
  let session,respond=autoReply;
  const publishService=(gw,msg)=>{
    sent.push(msg);
    if(respond)queueMicrotask(()=>session.onUp({gateway:gw,channel:'services_reply',method:msg.method,tid:msg.tid,result}));
  };
  const replies=[];
  session=createDrcSession({gateway:'RCP2SN',publishService,publishDrc:(gw,m)=>drc.push(m),publishEventsReply:(gw,m)=>replies.push(m),aircraft:()=>aircraft,clock,
    broker:()=>({address:'192.168.178.63:1884',clientId:'drc-RCP2SN',username:'drc',password:'pw',expireTime:1793900000,enableTls:false}),
    audit:e=>log.push(e),limits});
  return {session,clock,sent,drc,log,replies,setReplies(v){respond=Boolean(v);}};
}
async function liveControl(x){
  await x.session.requestAuthorization('op1');
  x.session.onUp({gateway:'RCP2SN',channel:'events',method:'cloud_control_auth_notify',status:'ok'});
  x.session.acquire('op1');
  await x.session.enterLiveControl('op1');
  x.session.onUp({gateway:'RCP2SN',channel:'osd',drcState:2});
  x.session.onUp({gateway:'RCP2SN',channel:'drc/up',method:'heart_beat',timestamp:x.clock.now()});
}

test('full path: authorisation by the pilot, DRC channel, heartbeat both ways',async()=>{
  const x=setup();
  await x.session.requestAuthorization('op1');
  assert.equal(x.session.snapshot().phase,'auth_pending');
  assert.deepEqual(x.sent[0].data,{user_id:'skyhub',user_callsign:'SkyHub Leitstand',control_keys:['flight']});
  x.session.onUp({gateway:'RCP2SN',channel:'events',method:'cloud_control_auth_notify',status:'ok'});
  assert.equal(x.session.snapshot().phase,'authorized');
  await x.session.enterLiveControl('op1');
  assert.equal(x.session.snapshot().controlLink.ready,false,'service ack alone cannot arm flight');
  x.session.onUp({gateway:'RCP2SN',channel:'osd',drcState:2});
  x.session.onUp({gateway:'RCP2SN',channel:'drc/up',method:'heart_beat',timestamp:x.clock.now()});
  assert.equal(x.session.snapshot().controlLink.ready,true);
  assert.equal(x.session.snapshot().phase,'drc_active');
  assert.equal(x.sent[1].method,'drc_mode_enter');
  assert.equal(x.sent[1].data.mqtt_broker.client_id,'drc-RCP2SN');
  x.session.acquire('op1');
  await x.clock.advance(1000);
  assert.ok(x.drc.some(m=>m.method==='heart_beat'),'heartbeat sent');
  const seqs=x.drc.map(m=>m.seq);
  assert.deepEqual(seqs,[...seqs].sort((a,b)=>a-b),'seq increases');
});

test('DRC: services reply alone, wrong RC state and stale uplink all block flight control',async()=>{
  const x=setup();await x.session.requestAuthorization('op1');
  x.session.onUp({gateway:'RCP2SN',channel:'events',method:'cloud_control_auth_notify',status:'ok'});
  await x.session.enterLiveControl('op1');
  assert.equal(x.session.snapshot().controlLink.ready,false);
  assert.throws(()=>x.session.stickInput('op1',{pitch:1}),/Steuerung gesperrt/);
  await assert.rejects(x.session.flyTo('op1',{latitude:49.1005,longitude:8.5005,heightAboveTakeoff:50}),
    /Steuerung gesperrt/);
  x.session.onUp({gateway:'RCP2SN',channel:'state',drcState:1});
  x.session.onUp({gateway:'RCP2SN',channel:'drc\/up',method:'heart_beat',timestamp:x.clock.now()});
  assert.equal(x.session.snapshot().controlLink.ready,false,'connecting state is not ready');
  x.session.onUp({gateway:'RCP2SN',channel:'osd',drcState:2});
  assert.equal(x.session.snapshot().controlLink.ready,true);
  for(let i=0;i<11;i++){x.session.acquire('op1');await x.clock.advance(500);}
  assert.equal(x.session.snapshot().controlLink.ready,false,'uplink must be fresh');
  assert.throws(()=>x.session.stickInput('op1',{pitch:1}),/Lease|Steuerung gesperrt/);
  // A current heartbeat alone cannot rescue a stale RC state.
  x.session.acquire('op1');
  x.session.onUp({gateway:'RCP2SN',channel:'drc\/up',method:'heart_beat',timestamp:x.clock.now()});
  assert.equal(x.session.snapshot().controlLink.ready,true);
  await x.clock.advance(2001);
  assert.equal(x.session.snapshot().controlLink.ready,false,'RC state needs freshness as well');
});

test('MQTT transport loss invalidates proofs immediately; motion cannot cancel the fail-safe',async()=>{
  const x=setup();await liveControl(x);
  assert.equal(x.session.snapshot().controlLink.ready,true);
  x.session.invalidateLink('Broker-Verbindung unterbrochen');
  assert.equal(x.session.snapshot().controlLink.ready,false);
  assert.equal(x.session.snapshot().recoveryRequired,true);
  assert.equal(x.session.snapshot().failsafe.pending,true);
  x.session.acquire('op1');
  assert.equal(x.session.snapshot().failsafe.pending,true,'new lease cannot override a broken link');
  assert.throws(()=>x.session.stickInput('op1',{pitch:1}),/Steuerung gesperrt/);
  await x.clock.advance(3200);
  assert.equal(x.session.snapshot().phase,'idle');
  assert.equal(x.session.snapshot().recoveryRequired,false,'successful reply confirms handback');
  assert.ok(x.sent.some(m=>m.method==='cloud_control_release'));
});

test('unconfirmed handback remains latched; reauthorization blocked until manual RC recovery',async()=>{
  const x=setup();await liveControl(x);
  x.setReplies(false);
  x.session.invalidateLink('MQTT down');
  await x.clock.advance(15000);
  const state=x.session.snapshot();
  assert.equal(state.phase,'idle');
  assert.equal(state.recoveryRequired,true);
  assert.match(state.lastError,/nicht bestätigt/);
  await assert.rejects(x.session.requestAuthorization('op1'),/nicht bestätigt/);
});

test('active stick and gimbal streams stop when the uplink proof expires',async()=>{
  const x=setup({limits:{upLinkLostMs:700,drcStateFreshMs:2000,stickStaleMs:8000,dragStaleMs:8000}});
  await liveControl(x);
  x.session.stickInput('op1',{roll:0.5});
  x.session.gimbalDrag('op1',{pitch:0.5});
  await x.clock.advance(900);
  assert.equal(x.session.snapshot().controlLink.ready,false);
  assert.equal(x.session.snapshot().sticksActive,false);
  assert.equal(x.session.snapshot().gimbalDragActive,false);
  const sticks=x.drc.filter(m=>m.method==='stick_control');
  assert.ok(sticks.some(m=>m.data.roll!==P.NEUTRAL.roll),'positive commands existed before expiry');
  assert.deepEqual(sticks.at(-1).data,P.NEUTRAL,'uplink loss must end with neutral stick');
  const drags=x.drc.filter(m=>m.method==='drc_camera_screen_drag');
  assert.ok(drags.some(m=>m.data.pitch_speed!==0));
  assert.equal(drags.at(-1).data.pitch_speed,0,'uplink loss must end with zero gimbal speed');
});

test('pilot denies: back to idle, nothing else happens',async()=>{
  const x=setup();
  await x.session.requestAuthorization('op1');
  x.session.onUp({gateway:'RCP2SN',channel:'events',method:'cloud_control_auth_notify',status:'failed'});
  assert.equal(x.session.snapshot().phase,'idle');
  await assert.rejects(x.session.enterLiveControl('op1'),/Autorisierung/);
});

test('only Matrice 4E/4T; replies need the right tid and method; timeouts and rejections surface',async()=>{
  const m3e=setup({aircraft:{...M4T,modelKey:'0-77-0',modelName:'Mavic 3E'}});
  await assert.rejects(m3e.session.requestAuthorization('op1'),/nur Matrice 4E\/4T/);
  const none=setup({aircraft:null});
  await assert.rejects(none.session.requestAuthorization('op1'),/nicht verbunden/);
  const silent=setup({autoReply:false});
  const p=silent.session.requestAuthorization('op1');
  silent.session.onUp({gateway:'RCP2SN',channel:'services_reply',method:'cloud_control_auth_request',tid:'fremd',result:0});
  silent.session.onUp({gateway:'OTHER',channel:'services_reply',method:'cloud_control_auth_request',tid:silent.sent[0].tid,result:0});
  silent.clock.advance(10001);
  await assert.rejects(p,/keine Antwort/);
  assert.equal(silent.session.snapshot().phase,'idle');
  const no=setup({result:316001});
  await assert.rejects(no.session.requestAuthorization('op1'),/abgelehnt \(result 316001\)/);
});

test('lease: one operator at a time, others are refused',async()=>{
  const x=setup();await liveControl(x);
  assert.throws(()=>x.session.acquire('op2'),/anderer Bediener/);
  assert.throws(()=>x.session.stickInput('op2',{roll:1}),/Lease/);
  await assert.rejects(x.session.flyTo('op2',{latitude:49.101,longitude:8.5,heightAboveTakeoff:50}),/Lease/);
});

test('sticks at 10 Hz from fresh input, neutral when input is stale, then silent',async()=>{
  const x=setup();await liveControl(x);
  x.session.acquire('op1');
  x.session.stickInput('op1',{pitch:1});
  await x.clock.advance(200);
  const sticks=()=>x.drc.filter(m=>m.method==='stick_control');
  assert.equal(sticks().length,2);
  assert.equal(sticks()[0].data.pitch,1024+330,'half deflection by default');
  x.session.acquire('op1');
  await x.clock.advance(500);
  assert.deepEqual(sticks().at(-1).data,P.NEUTRAL,'stale input -> neutral');
  x.session.acquire('op1');
  await x.clock.advance(1000);
  const n=sticks().length;
  x.session.acquire('op1');
  await x.clock.advance(1000);
  assert.equal(sticks().length,n,'no more sticks without input');
});

test('FAIL-SAFE: operator gone -> neutral sticks, fly-to stopped, after 3 s DRC exit and cloud control released',async()=>{
  const x=setup();await liveControl(x);
  x.session.acquire('op1');
  await x.session.flyTo('op1',{latitude:49.1005,longitude:8.5005,heightAboveTakeoff:50,maxSpeed:8});
  x.session.stickInput('op1',{roll:0.3});
  await x.clock.advance(1600);                       // lease 1.5 s expires
  const snap=x.session.snapshot();
  assert.equal(snap.failsafe.pending,true);
  assert.ok(x.sent.some(m=>m.method==='fly_to_point_stop'));
  assert.deepEqual(x.drc.filter(m=>m.method==='stick_control').at(-1).data,P.NEUTRAL);
  await x.clock.advance(3000);
  assert.deepEqual(x.sent.slice(-2).map(m=>m.method).sort(),['cloud_control_release','drc_mode_exit']);
  assert.equal(x.session.snapshot().phase,'idle');
  assert.ok(x.log.some(e=>e.action==='failsafe')&&x.log.some(e=>e.action==='hand-back'));
});

test('fail-safe is cancelled when the operator returns in time',async()=>{
  const x=setup();await liveControl(x);
  await x.clock.advance(1600);
  assert.equal(x.session.snapshot().failsafe.pending,true);
  for(let i=0;i<10;i++){x.session.acquire('op1');await x.clock.advance(500);}   // operator back, lease kept alive
  assert.equal(x.session.snapshot().phase,'drc_active');
  assert.ok(!x.sent.some(m=>m.method==='cloud_control_release'));
});

test('fly-to converts height above take-off to ellipsoid and enforces limits',async()=>{
  const x=setup();await liveControl(x);x.session.acquire('op1');
  await x.session.flyTo('op1',{latitude:49.1005,longitude:8.5005,heightAboveTakeoff:60,maxSpeed:14});
  const msg=x.sent.find(m=>m.method==='fly_to_point');
  assert.equal(msg.data.points[0].height,210,'180 - 30 + 60');
  assert.equal(msg.data.max_speed,10,'capped at the configured 10 m/s');
  await assert.rejects(x.session.flyTo('op1',{latitude:49.1005,longitude:8.5005,heightAboveTakeoff:130}),/höchstens 120/);
  await assert.rejects(x.session.flyTo('op1',{latitude:49.1005,longitude:8.5005,heightAboveTakeoff:10}),/mindestens 20/);
  await assert.rejects(x.session.flyTo('op1',{latitude:49.2,longitude:8.5,heightAboveTakeoff:50}),/erlaubt 2000 m/);
  x.session.onUp({gateway:'RCP2SN',channel:'events',method:'fly_to_point_progress',id:msg.data.fly_to_id,status:'wayline_ok',path:[]});
  assert.equal(x.session.snapshot().flyTo.active,false);
});

test('emergency stop works without lease; return home stops sticks; joystick invalid blocks sticks',async()=>{
  const x=setup();await liveControl(x);
  x.session.emergencyStop('someone-else');
  assert.equal(x.drc.at(-1).method,'drone_emergency_stop');
  await x.session.returnHome('someone-else');
  assert.equal(x.sent.at(-1).method,'return_home');
  x.session.acquire('op1');
  x.session.onUp({gateway:'RCP2SN',channel:'events',method:'joystick_invalid_notify',reason:4,text:'Fernsteuerung hat die Kontrolle übernommen'});
  assert.throws(()=>x.session.stickInput('op1',{roll:1}),/gesperrt/);
  const idle=setup();
  assert.throws(()=>idle.session.emergencyStop('op1'),/Live-Steuermodus/);
  await assert.rejects(idle.session.returnHome('op1'),/Fernsteuerung auslösen/);
});

test('RC reports DRC disconnected: session drops back to authorized; shutdown hands control back',async()=>{
  const x=setup();await liveControl(x);
  x.session.onUp({gateway:'RCP2SN',channel:'state',drcState:0});
  assert.equal(x.session.snapshot().phase,'authorized');
  await x.session.shutdown();
  assert.equal(x.sent.at(-1).method,'cloud_control_release');
  assert.equal(x.session.snapshot().phase,'idle');
});

test('takeoff only on the ground, with RTH on signal loss',async()=>{
  const air=setup();await liveControl(air);air.session.acquire('op1');
  await assert.rejects(air.session.takeoff('op1',{latitude:49.1005,longitude:8.5005,heightAboveTakeoff:40}),/bereits in der Luft/);
  const ground=setup({aircraft:{...M4T,heightAboveTakeoff:0,heightEllipsoid:150,modeCode:0}});
  await liveControl(ground);ground.session.acquire('op1');
  await ground.session.takeoff('op1',{latitude:49.1005,longitude:8.5005,heightAboveTakeoff:40});
  const m=ground.sent.find(x=>x.method==='takeoff_to_point');
  assert.equal(m.data.target_height,190);
  assert.equal(m.data.rc_lost_action,2);
  assert.equal(m.data.commander_flight_height,40);
});

test('events needing a reply are acknowledged once, others not',async()=>{
  const x=setup();await liveControl(x);
  x.session.onUp({gateway:'RCP2SN',channel:'events',method:'joystick_invalid_notify',reason:0,text:'x',needReply:true,tid:'t1',bid:'b1'});
  x.session.onUp({gateway:'RCP2SN',channel:'events',method:'cloud_control_auth_notify',status:'ok',needReply:false,tid:'t2'});
  x.session.onUp({gateway:'OTHER',channel:'events',method:'fly_to_point_progress',needReply:true,tid:'t3'});
  assert.deepEqual(x.replies.map(r=>[r.tid,r.method,r.data.result]),[['t1','joystick_invalid_notify',0]]);
});
