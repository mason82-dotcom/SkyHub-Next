'use strict';
// DRC protocol against the DJI 1.18 RC Plus 2 reference (examples and documented ranges).
const test=require('node:test');
const assert=require('node:assert/strict');
const p=require('../drc-protocol');

test('service envelope and DRC envelope have the documented shape',()=>{
  const s=p.serviceMessage('fly_to_point',{x:1},{tid:'t',bid:'b',timestamp:1});
  assert.deepEqual(s,{tid:'t',bid:'b',timestamp:1,method:'fly_to_point',data:{x:1}});
  assert.deepEqual(p.drcMessage('stick_control',p.NEUTRAL,1),{method:'stick_control',data:{roll:1024,pitch:1024,throttle:1024,yaw:1024},seq:1});
  assert.deepEqual(p.drcMessage('heart_beat',p.heartBeat(1670415891013),1),{method:'heart_beat',data:{timestamp:1670415891013},seq:1});
  assert.throws(()=>p.serviceMessage('flighttask_prepare',{}),/unknown service/);   // dock-only, not offered for RC
  assert.throws(()=>p.drcMessage('stick_control',{},-1),/seq/);
});

test('authorization asks for "flight", release returns it',()=>{
  assert.deepEqual(p.authRequest({userId:'skyhub',userCallsign:'SkyHub Leitstand'}),
    {user_id:'skyhub',user_callsign:'SkyHub Leitstand',control_keys:['flight']});
  assert.deepEqual(p.authRelease(),{control_keys:['flight']});
  assert.throws(()=>p.authRequest({userId:'',userCallsign:'x'}),/user_id/);
});

test('drc_mode_enter carries broker data and frequencies 1..30 Hz',()=>{
  const d=p.drcEnter({address:'192.168.178.63:1884',clientId:'drc-5YSZK',username:'drc',password:'pw',expireTime:1793900000,enableTls:false});
  assert.deepEqual(d,{mqtt_broker:{address:'192.168.178.63:1884',client_id:'drc-5YSZK',username:'drc',password:'pw',expire_time:1793900000,
    enable_tls:false},osd_frequency:10,hsi_frequency:1});
  assert.throws(()=>p.drcEnter({...{address:'x:1',clientId:'c',username:'u',password:'p',expireTime:1},osdFrequency:31}),/osd_frequency/);
  assert.throws(()=>p.drcEnter({address:'kein port',clientId:'c',username:'u',password:'p',expireTime:1}),/host:port/);
});

test('fly_to_point: one point, 6 decimals, height 2..10000 m ellipsoid, speed 0..15',()=>{
  const d=p.flyTo({flyToId:'f',maxSpeed:12,target:{latitude:49.1234567,longitude:8.7654321,height:155.04}});
  assert.deepEqual(d,{fly_to_id:'f',max_speed:12,points:[{latitude:49.123457,longitude:8.765432,height:155}]});
  assert.throws(()=>p.flyTo({maxSpeed:16,target:{latitude:49,longitude:8,height:100}}),/max_speed/);
  assert.throws(()=>p.flyTo({maxSpeed:5,target:{latitude:0,longitude:0,height:100}}),/0\/0/);
  assert.throws(()=>p.flyTo({maxSpeed:5,target:{latitude:91,longitude:8,height:100}}),/latitude/);
  assert.throws(()=>p.flyTo({maxSpeed:5.5,target:{latitude:49,longitude:8,height:100}}),/ganzzahlig/);
  assert.throws(()=>p.flyToUpdate({maxSpeed:6,target:{latitude:49,longitude:8,height:100}}),/-4 und 5/);
});

test('takeoff_to_point uses the documented ranges and safe defaults (RTH on signal loss)',()=>{
  const d=p.takeoff({target:{latitude:49.1,longitude:8.5,height:180},securityTakeoffHeight:20,rthAltitude:60,commanderFlightHeight:60,maxSpeed:8,flightId:'x'});
  assert.equal(d.rc_lost_action,2);
  assert.equal(d.commander_mode_lost_action,1);
  assert.equal(d.rth_mode,1);
  assert.equal(d.flight_safety_advance_check,false);
  assert.throws(()=>p.takeoff({target:{latitude:49.1,longitude:8.5,height:180},securityTakeoffHeight:10,rthAltitude:60,commanderFlightHeight:60,maxSpeed:8}),/security_takeoff_height/);
});

test('stick: neutral 1024, span ±660 scaled, clamped to 364..1684',()=>{
  assert.deepEqual(p.stick({}),p.NEUTRAL);
  assert.deepEqual(p.stick({roll:1,pitch:-1,throttle:0.5,yaw:0},1),{roll:1684,pitch:364,throttle:1354,yaw:1024});
  assert.deepEqual(p.stick({roll:1},0.5),{roll:1354,pitch:1024,throttle:1024,yaw:1024});
  assert.throws(()=>p.stick({roll:2}),/roll/);
  assert.throws(()=>p.stick({roll:NaN}),/roll/);
});

test('upstream parsing: replies, events, DRC OSD and state, nothing else',()=>{
  const reply=p.parseUp('thing/product/RC1/services_reply',JSON.stringify({tid:'t1',method:'cloud_control_auth_request',data:{result:0,output:{status:'ok'}}}));
  assert.deepEqual(reply,{gateway:'RC1',channel:'services_reply',method:'cloud_control_auth_request',tid:'t1',result:0,status:'ok'});
  const ev=p.parseUp('thing/product/RC1/events',{method:'joystick_invalid_notify',data:{reason:4}});
  assert.equal(ev.text,'Fernsteuerung hat die Kontrolle übernommen (z. B. Rückkehr ausgelöst)');
  const prog=p.parseUp('thing/product/RC1/events',{method:'fly_to_point_progress',data:{fly_to_id:'f',status:'wayline_progress',result:0,remaining_distance:12.5,
    planned_path_points:[{latitude:49,longitude:8,height:150}]}});
  assert.equal(prog.status,'wayline_progress');assert.equal(prog.path.length,1);
  const osd=p.parseUp('thing/product/RC1/drc/up',{method:'osd_info_push',seq:3,data:{latitude:49,longitude:8,height:150,attitude_head:90,secret:'x'}});
  assert.equal(osd.osd.height,150);assert.equal(osd.osd.secret,undefined);
  assert.deepEqual(p.parseUp('thing/product/RC1/state',{data:{drc_state:2}}),{gateway:'RC1',channel:'state',method:null,drcState:2});
  assert.equal(p.parseUp('thing/product/RC1/state',{data:{drc_state:7}}),null);
  assert.equal(p.parseUp('thing/product/RC1/services_reply',{tid:'t',method:'flighttask_prepare',data:{result:0}}),null);
  assert.equal(p.parseUp('thing/product/../services_reply','{}'),null);
  assert.equal(p.parseUp('thing/product/RC1/events','kein json'),null);
});

test('height above take-off is converted to the ellipsoid height DJI expects',()=>{
  assert.equal(p.ellipsoidTarget({heightAboveTakeoff:60,currentEllipsoid:180.4,currentAboveTakeoff:30.4}),210);
  assert.throws(()=>p.ellipsoidTarget({heightAboveTakeoff:60,currentEllipsoid:null,currentAboveTakeoff:3}),/Telemetrie/);
  assert.throws(()=>p.ellipsoidTarget({heightAboveTakeoff:1,currentEllipsoid:100,currentAboveTakeoff:0}),/2 und 1500/);
});

test('events with need_reply=1 are answered on events_reply with the same tid/bid/method',()=>{
  const ev=p.parseUp('thing/product/RC1/events',{tid:'t9',bid:'b9',method:'fly_to_point_progress',need_reply:1,data:{fly_to_id:'f',status:'wayline_ok',result:0}});
  assert.equal(ev.needReply,true);
  assert.deepEqual(p.eventsReply(ev,5),{tid:'t9',bid:'b9',timestamp:5,method:'fly_to_point_progress',data:{result:0}});
  const auth=p.parseUp('thing/product/RC1/events',{tid:'t1',method:'cloud_control_auth_notify',need_reply:0,data:{result:0,output:{status:'ok'}}});
  assert.equal(p.eventsReply(auth),null,'need_reply 0: no reply');
});
