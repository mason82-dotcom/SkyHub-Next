'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const cockpit=require('../../frontend/public/telemetry-cockpit.js');
const fresh=require('../../frontend/public/telemetry-freshness.js');
const now=1_800_000_000_000;
const read=name=>fs.readFileSync(path.resolve(__dirname,'../../frontend/public',name),'utf8');
function device(overrides={}){
  return Object.assign({
    aircraftConnected:true,
    telemetry:{battery:0,altitude:22.25,horizontalSpeed:0,heading:270,verticalSpeed:-1.5,linkQuality:4},
    telemetryFieldAt:{battery:now-2000,altitude:now-2000,horizontalSpeed:now-2000,
      heading:now-2000,verticalSpeed:now-2000,linkQuality:now-2000},
    telemetryFieldTimeVerified:{battery:true,altitude:true,horizontalSpeed:true,
      heading:true,verticalSpeed:true,linkQuality:true}
  },overrides);
}
const spec=key=>cockpit.SPECS.find(s=>s.key===key);
test('a recorded zero is shown as a value, not as missing',()=>{
  const record=device();
  assert.deepEqual(cockpit.valueFor(record,spec('battery'),fresh,now),
    {value:'0 %',age:'Aktuell · vor 2 s',kind:'current',meter:0});
  assert.equal(cockpit.valueFor(record,spec('horizontalSpeed'),fresh,now).value,'0,0 m/s');
  assert.equal(cockpit.valueFor(record,spec('verticalSpeed'),fresh,now).value,'-1,5 m/s');
});
test('each field is judged on its own timestamp, not on a fresh aggregate OSD',()=>{
  const record=device({lastTelemetryAt:now});
  record.telemetryFieldAt.altitude=now-22000;
  assert.equal(cockpit.valueFor(record,spec('altitude'),fresh,now).kind,'stale');
  assert.equal(cockpit.valueFor(record,spec('battery'),fresh,now).kind,'current');
});
test('unverified and disconnected values are never labelled current',()=>{
  const record=device();
  record.telemetryFieldTimeVerified.heading=false;
  assert.equal(cockpit.valueFor(record,spec('heading'),fresh,now).kind,'unverified');
  record.aircraftConnected=false;
  assert.equal(cockpit.valueFor(record,spec('battery'),fresh,now).kind,'stale');
});
test('missing, implausible and future-timestamp fields fail closed',()=>{
  const record=device();
  record.telemetry.battery=101;
  assert.deepEqual(cockpit.valueFor(record,spec('battery'),fresh,now),
    {value:'—',age:'Nicht empfangen',kind:'missing',meter:null});
  record.telemetry.battery=Number.NaN;
  assert.equal(cockpit.valueFor(record,spec('battery'),fresh,now).value,'—');
  delete record.telemetryFieldAt.altitude;
  assert.equal(cockpit.valueFor(record,spec('altitude'),fresh,now).kind,'unknown');
  record.telemetryFieldAt.altitude=now+1000;
  assert.equal(cockpit.valueFor(record,spec('altitude'),fresh,now).kind,'unknown');
  assert.equal(cockpit.valueFor(null,spec('battery'),fresh,now).value,'—');
});
test('compass bearing only uses a current, verified and bounded heading',()=>{
  const record=device();
  assert.equal(cockpit.bearingFor(record,fresh,now),270);
  record.telemetry.heading=-90;
  assert.equal(cockpit.bearingFor(record,fresh,now),270);
  record.telemetry.heading=360;
  assert.equal(cockpit.bearingFor(record,fresh,now),0);
  record.telemetry.heading=361;
  assert.equal(cockpit.bearingFor(record,fresh,now),null);
  record.telemetry.heading=90;
  record.telemetryFieldTimeVerified.heading=false;
  assert.equal(cockpit.bearingFor(record,fresh,now),null);
  record.telemetryFieldTimeVerified.heading=true;
  record.telemetryFieldAt.heading=now-17000;
  assert.equal(cockpit.bearingFor(record,fresh,now),null);
  record.telemetryFieldAt.heading=now-2000;
  record.aircraftConnected=false;
  assert.equal(cockpit.bearingFor(record,fresh,now),null);
  assert.equal(cockpit.bearingFor(null,fresh,now),null);
});
test('the horizon needs two current, verified, in-range angles',()=>{
  const d=device();
  Object.assign(d.telemetry,{attitudePitch:12.5,attitudeRoll:-20});
  Object.assign(d.telemetryFieldAt,{attitudePitch:now-2000,attitudeRoll:now-2000});
  Object.assign(d.telemetryFieldTimeVerified,{attitudePitch:true,attitudeRoll:true});
  assert.deepEqual(cockpit.attitudeFor(d,fresh,now),{pitch:12.5,roll:-20,offset:10});
  d.telemetry.attitudePitch=90.01;
  assert.equal(cockpit.attitudeFor(d,fresh,now),null);
  d.telemetry.attitudePitch=0;d.telemetry.attitudeRoll=181;
  assert.equal(cockpit.attitudeFor(d,fresh,now),null);
  d.telemetry.attitudeRoll=0;d.telemetryFieldAt.attitudeRoll=now-20000;
  assert.equal(cockpit.attitudeFor(d,fresh,now),null);
  d.telemetryFieldAt.attitudeRoll=now-2000;d.telemetryFieldTimeVerified.attitudePitch=false;
  assert.equal(cockpit.attitudeFor(d,fresh,now),null);
  d.telemetryFieldTimeVerified.attitudePitch=true;d.aircraftConnected=false;
  assert.equal(cockpit.attitudeFor(d,fresh,now),null);
  assert.equal(cockpit.attitudeFor(null,fresh,now),null);
});
test('quality counts cover exactly the eight shown fields',()=>{
  const d=device();
  const q=cockpit.qualityFor(d,fresh,now);
  assert.equal(q.total,8);
  assert.equal(q.current+q.stale+q.unverified+q.unknown+q.missing,8);
  assert.equal(q.current,6);
  assert.equal(q.missing,2);
  assert.equal(cockpit.qualityFor(null,fresh,now),null);
});
test('the locate action needs a valid, non-zero WGS84 position with a timestamp',()=>{
  const base={telemetry:{latitude:49,longitude:8},lastPositionAt:now};
  assert.equal(cockpit.validPosition(base),true);
  for(const bad of [
    {...base,positionUnavailable:true},
    {...base,telemetry:{latitude:0,longitude:0}},
    {...base,telemetry:{latitude:91,longitude:8}},
    {...base,telemetry:{latitude:49,longitude:181}},
    {...base,telemetry:{latitude:49,longitude:null}},
    {telemetry:base.telemetry},null
  ])assert.equal(cockpit.validPosition(bad),false);
});
test('the module never opens a transport or touches storage',()=>{
  assert.doesNotMatch(read('telemetry-cockpit.js'),
    /\bfetch\s*\(|\bWebSocket\s*\(|\bXMLHttpRequest\b|\bEventSource\b|\blocalStorage\b|\bsessionStorage\b|innerHTML/);
});
test('the dashboard wires the cockpit after the freshness helper and feeds it from update()',()=>{
  const html=read('index.html');
  const ids=['cockpit','cockpitTitle','cockpitDevice','cockpitStatus','cockpitLocate','cockpitCompass',
    'cockpitNeedle','cockpitAttitude','cockpitAttitudePlane','cockpitQualitySummary',
    ...cockpit.SPECS.flatMap(s=>['cockpit'+s.id,'cockpit'+s.id+'Age'])];
  for(const id of ids)assert.equal((html.match(new RegExp('id="'+id+'"','g'))||[]).length,1,id);
  assert.ok(html.indexOf('/telemetry-freshness.js')<html.indexOf('/telemetry-cockpit.js'));
  assert.ok(html.indexOf('/telemetry-cockpit.js')<html.indexOf('const cockpit='));
  assert.match(html,/cockpit\.render\(data,selectedSn,listState\)/);
  assert.match(html,/id="cockpitCompass"[^>]*aria-hidden="true" hidden/);
  assert.match(html,/id="cockpitAttitude"[^>]*aria-hidden="true" hidden/);
  assert.match(html,/href="\/skyhub-cockpit\.css"/);
});
test('the stylesheet only uses the shared light tokens and has no motion beyond a meter transition',()=>{
  const css=read('skyhub-cockpit.css');
  assert.doesNotMatch(css,/@keyframes|animation\s*:/);
  assert.doesNotMatch(css,/#0[0-9a-f]{2}\b|rgba?\(\s*0\s*,\s*0\s*,\s*0/i);
});
