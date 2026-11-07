'use strict';
// Dashboard RTK line (frontend/public/rtk-status.js): DJI position_state.is_fixed 0..3 plus mode_code ground/air.
const test=require('node:test');
const assert=require('node:assert/strict');
const {rtkStatus}=require('../../frontend/public/rtk-status.js');
const ac=(rtkFixState,modeCode,extra={})=>({deviceCategory:'aircraft',modeCode,telemetry:{rtkFixState,rtkSatellites:28,...extra}});
const current={kind:'current',text:'Aktuell · 1 s'};

test('FIX is ok, with RTK satellites',()=>{
  assert.deepEqual(rtkStatus(ac(2,5),{freshness:current}),{level:'ok',text:'RTK: FIX · 28 RTK-Satelliten'});
});
test('no fix on the ground warns, in flight alarms (SeeRutsche case: float during the whole mission)',()=>{
  const ground=rtkStatus(ac(1,0),{freshness:current});
  assert.equal(ground.level,'warn');assert.match(ground.text,/vor dem Start auf FIX warten/);
  const air=rtkStatus(ac(1,5),{freshness:current});
  assert.equal(air.level,'alarm');assert.match(air.text,/im Flug/);
  const failed=rtkStatus(ac(3,3),{freshness:current});
  assert.equal(failed.level,'alarm');assert.match(failed.text,/NTRIP/);
});
test('code 0 (RTK off or not started) is information, not an alarm, also in flight',()=>{
  assert.equal(rtkStatus(ac(0,5),{freshness:current}).level,'info');
});
test('nothing for non-aircraft, missing or invalid codes; stale state is not presented as current',()=>{
  assert.equal(rtkStatus({deviceCategory:'controller',telemetry:{rtkFixState:2}}),null);
  assert.equal(rtkStatus(ac(null,0)),null);
  assert.equal(rtkStatus(ac(7,0)),null);
  const stale=rtkStatus(ac(2,5),{freshness:{kind:'stale',text:'Veraltet · 3 min'}});
  assert.equal(stale.level,'info');assert.match(stale.text,/nicht aktuell/);
  assert.equal(rtkStatus(ac(2,5),{freshness:{kind:'unverified',text:'Zeit ungeprüft'}}).level,'ok');
});
test('dashboard loads rtk-status.js before its inline script',()=>{
  const html=require('node:fs').readFileSync(require('node:path').resolve(__dirname,'../../frontend/public/index.html'),'utf8');
  assert.ok(html.indexOf('<script src="/rtk-status.js"></script>')>0);
  assert.ok(html.indexOf('<script src="/rtk-status.js"></script>')<html.indexOf('<script>\n(function(){'));
});
