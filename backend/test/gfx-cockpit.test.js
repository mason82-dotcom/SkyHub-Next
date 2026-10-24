'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const cockpit=require('../../frontend/public/gfx-cockpit.js');
const fresh=require('../../frontend/public/telemetry-freshness.js');
const now=1_800_000_000_000;
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
test('cockpit presents recorded zero values rather than missing values',()=>{
  const record=device();
  assert.deepEqual(cockpit.valueFor(record,cockpit.SPECS[0],fresh,now),{
    value:'0 %',age:'Aktuell · vor 2 s',kind:'current',meter:0
  });
  assert.equal(cockpit.valueFor(record,cockpit.SPECS[2],fresh,now).value,'0,0 m/s');
  assert.equal(cockpit.valueFor(record,cockpit.SPECS[4],fresh,now).value,'-1,5 m/s');
});
test('field state is independently validated even if an aggregate OSD packet is fresh',()=>{
  const record=device({lastTelemetryAt:now});
  record.telemetryFieldAt.altitude=now-22000;
  assert.equal(cockpit.valueFor(record,cockpit.SPECS[1],fresh,now).kind,'stale');
  assert.equal(cockpit.valueFor(record,cockpit.SPECS[0],fresh,now).kind,'current');
});
test('unverified and disconnected values are never labelled current',()=>{
  const record=device();
  record.telemetryFieldTimeVerified.heading=false;
  assert.equal(cockpit.valueFor(record,cockpit.SPECS[3],fresh,now).kind,'unverified');
  record.aircraftConnected=false;
  assert.equal(cockpit.valueFor(record,cockpit.SPECS[0],fresh,now).kind,'stale');
});
test('missing, invalid, implausible and future-timestamp fields fail closed',()=>{
  const record=device();
  record.telemetry.battery=101;
  assert.deepEqual(cockpit.valueFor(record,cockpit.SPECS[0],fresh,now),{
    value:'—',age:'Nicht empfangen',kind:'missing',meter:null
  });
  record.telemetry.battery=Number.NaN;
  assert.equal(cockpit.valueFor(record,cockpit.SPECS[0],fresh,now).value,'—');
  delete record.telemetryFieldAt.altitude;
  assert.equal(cockpit.valueFor(record,cockpit.SPECS[1],fresh,now).kind,'unknown');
  record.telemetryFieldAt.altitude=now+1000;
  assert.equal(cockpit.valueFor(record,cockpit.SPECS[1],fresh,now).kind,'unknown');
  assert.equal(cockpit.valueFor(null,cockpit.SPECS[0],fresh,now).value,'—');
});
test('cockpit markup preserves canonical device and map interactions',()=>{
  const html=fs.readFileSync(path.resolve(__dirname,'../../frontend/public/index.html'),'utf8');
  for(const id of ['gfxCockpit','gfxCockpitDevice','gfxCockpitStatus','gfxCockpitLocate',
    ...cockpit.SPECS.flatMap(s=>['gfxCockpit'+s.id,'gfxCockpit'+s.id+'Age',
       'gfxCockpit'+s.id+'Meter'])]){
    if(id.endsWith('Meter')&&!['Battery','Link'].some(s=>id==='gfxCockpit'+s+'Meter'))continue;
    assert.ok(html.includes('id="'+id+'"'),id);
  }
  assert.ok(html.indexOf('<script src="/telemetry-freshness.js"></script>')<
    html.indexOf('<script src="/gfx-cockpit.js"></script>'));
  assert.ok(html.indexOf('<script src="/gfx-cockpit.js"></script>')<
    html.indexOf('<script>'));
  assert.match(html,/SkyHubGfxCockpit\?\.mount/);
  assert.match(html,/cockpit\.render\(data,selectedSn,listState\)/);
  assert.match(html,/id="gfxCockpit"[^>]+aria-labelledby="gfxCockpitTitle"/);
  assert.equal((html.match(/id="gfxCockpitHeading"/g)||[]).length,1,"Heading telemetry id must be unique");
  assert.equal((html.match(/id="gfxCockpitTitle"/g)||[]).length,1,"Cockpit landmark title id must be unique");
});
test('cockpit module never creates secondary telemetry/auth transports',()=>{
  const source=fs.readFileSync(path.resolve(__dirname,'../../frontend/public/gfx-cockpit.js'),'utf8');
  assert.doesNotMatch(source,/\bfetch\s*\(|\bWebSocket\s*\(|\bXMLHttpRequest\b|\bEventSource\b|\blocalStorage\b|\bsessionStorage\b/);
});

test('compass bearing only uses current, verified, bounded DJI headings',()=>{
  const freshRecord=device();
  assert.equal(cockpit.bearingFor(freshRecord,fresh,now),270);
  freshRecord.telemetry.heading=-90;
  assert.equal(cockpit.bearingFor(freshRecord,fresh,now),270,'negative signed yaw normalized to 270 degrees');
  freshRecord.telemetry.heading=360;
  assert.equal(cockpit.bearingFor(freshRecord,fresh,now),0);
  freshRecord.telemetry.heading=361;
  assert.equal(cockpit.bearingFor(freshRecord,fresh,now),null,'unbounded heading must not draw a needle');
  assert.equal(cockpit.valueFor(freshRecord,cockpit.SPECS[3],fresh,now).kind,'missing');
  freshRecord.telemetry.heading=90;
  freshRecord.telemetryFieldTimeVerified.heading=false;
  assert.equal(cockpit.bearingFor(freshRecord,fresh,now),null);
  freshRecord.telemetryFieldTimeVerified.heading=true;
  freshRecord.telemetryFieldAt.heading=now-17000;
  assert.equal(cockpit.bearingFor(freshRecord,fresh,now),null);
  freshRecord.telemetryFieldAt.heading=now-2000;
  freshRecord.aircraftConnected=false;
  assert.equal(cockpit.bearingFor(freshRecord,fresh,now),null);
  assert.equal(cockpit.bearingFor(null,fresh,now),null);
});
test('decorative compass is hidden and driven by provenance, not fake animation',()=>{
  const html=fs.readFileSync(path.resolve(__dirname,'../../frontend/public/index.html'),'utf8');
  const css=fs.readFileSync(path.resolve(__dirname,'../../frontend/public/hyperframes-gfx.css'),'utf8');
  assert.match(html,/id="gfxCockpitCompass"[^>]+aria-hidden="true" hidden/);
  assert.match(html,/id="gfxCockpitNeedle" class="gfx-heading-needle"/);
  assert.match(css,/gfx-heading-compass\[hidden\]/);
  assert.doesNotMatch(css, /gfx-heading-needle[^{}]*\{[^}]*animation\s*:/);
});

test('attitude rendering requires both independently verified fresh field values',()=>{
  const d=device();
  d.telemetry.attitudePitch=12.5;
  d.telemetry.attitudeRoll=-20;
  d.telemetryFieldAt.attitudePitch=now-2000;
  d.telemetryFieldAt.attitudeRoll=now-2000;
  d.telemetryFieldTimeVerified.attitudePitch=true;
  d.telemetryFieldTimeVerified.attitudeRoll=true;
  assert.deepEqual(cockpit.attitudeFor(d,fresh,now),{pitch:12.5,roll:-20,offset:10});
  assert.equal(cockpit.valueFor(d,cockpit.SPECS.find(s=>s.key==='attitudePitch'),fresh,now).value,'12,5 °');
  d.telemetry.attitudePitch=90.01;
  assert.equal(cockpit.attitudeFor(d,fresh,now),null,'out-of-range pitch must hide the horizon');
  d.telemetry.attitudePitch=0;
  d.telemetry.attitudeRoll=181;
  assert.equal(cockpit.attitudeFor(d,fresh,now),null,'out-of-range roll must hide the horizon');
  d.telemetry.attitudeRoll=0;
  d.telemetryFieldAt.attitudeRoll=now-20000;
  assert.equal(cockpit.attitudeFor(d,fresh,now),null,'one stale field invalidates geometry');
  d.telemetryFieldAt.attitudeRoll=now-2000;
  d.telemetryFieldTimeVerified.attitudePitch=false;
  assert.equal(cockpit.attitudeFor(d,fresh,now),null,'unverified pitch invalidates geometry');
  d.telemetryFieldTimeVerified.attitudePitch=true;
  d.aircraftConnected=false;
  assert.equal(cockpit.attitudeFor(d,fresh,now),null,'disconnected aircraft invalidates geometry');
  assert.equal(cockpit.attitudeFor(null,fresh,now),null);
});
test('attitude visual is decorative and starts hidden without invented data',()=>{
  const html=fs.readFileSync(path.resolve(__dirname,'../../frontend/public/index.html'),'utf8');
  const css=fs.readFileSync(path.resolve(__dirname,'../../frontend/public/hyperframes-gfx.css'),'utf8');
  assert.match(html,/id="gfxCockpitAttitude"[^>]+aria-hidden="true" hidden/);
  assert.match(html,/id="gfxCockpitAttitudePlane"/);
  assert.match(html,/id="gfxCockpitPitchAge"/);
  assert.match(html,/id="gfxCockpitRollAge"/);
  assert.match(css,/gfx-attitude-instrument\[hidden\]/);
  assert.doesNotMatch(css,/gfx-attitude-plane\s*\{[^}]*animation\s*:/);
});

test('quality panel counts only eight shown fields, never aggregate OSD readiness',()=>{
  const d=device({lastTelemetryAt:now});
  // Existing test fixture has six measured fields, two attitude fields absent.
  let q=cockpit.qualityFor(d,fresh,now);
  assert.deepEqual(q,{total:8,current:6,stale:0,unverified:0,unknown:0,missing:2});
  d.telemetryFieldAt.altitude=now-19000;
  d.telemetryFieldTimeVerified.heading=false;
  delete d.telemetryFieldAt.linkQuality;
  d.telemetry.battery=120;
  q=cockpit.qualityFor(d,fresh,now);
  assert.deepEqual(q,{total:8,current:2,stale:1,unverified:1,unknown:1,missing:3});
  assert.equal(Object.keys(q).filter(k=>k!=='total')
    .reduce((n,k)=>n+q[k],0),cockpit.SPECS.length);
  d.aircraftConnected=false;
  q=cockpit.qualityFor(d,fresh,now);
  assert.equal(q.current,0,'disconnected device may not have current instrument quality');
  assert.equal(q.stale,4,'measured nonmissing fields become stale');
  assert.equal(cockpit.qualityFor(null,fresh,now),null);
});
test('quality panel offers text counts and clear non-readiness label',()=>{
  const html=fs.readFileSync(path.resolve(__dirname,'../../frontend/public/index.html'),'utf8');
  const css=fs.readFileSync(path.resolve(__dirname,'../../frontend/public/hyperframes-gfx.css'),'utf8');
  for(const id of ['gfxQualitySummary','gfxQualityTitle','gfxQualityCurrent','gfxQualityStale',
    'gfxQualityUnverified','gfxQualityUnknown','gfxQualityMissing']){
    assert.ok(html.includes('id="'+id+'"'),id);
  }
  assert.match(html,/nicht der Status der Drohne oder eine Flugfreigabe/);
  assert.match(html,/class="gfx-quality" aria-labelledby="gfxQualityTitle"/);
  assert.match(css,/gfx-quality-counts/);
});

test('timeline observes only whitelisted fields with field timestamps, not OSD aggregate time',()=>{
  const d=device({lastTelemetryAt:now});
  const baseline=cockpit.observeFields(d,fresh,now);
  assert.equal(Object.keys(baseline).length,8);
  assert.equal(cockpit.timelineChanges(null,baseline,now).length,0,'baseline cannot produce events');
  assert.deepEqual(cockpit.timelineChanges(baseline,cockpit.observeFields(d,fresh,now),now),[],
    're-rendering the same snapshot must not invent data changes');
  const next=cockpit.observeFields(d,fresh,now+20000);
  const changes=cockpit.timelineChanges(baseline,next,now+20000);
  assert.equal(changes.length,6);
  assert.ok(changes.every(x=>x.kind==='stale'&&x.message==='Aktuell → Veraltet'));
  assert.ok(changes.every(x=>x.observedAt===now+20000));
  assert.ok(changes.every(x=>!JSON.stringify(x).includes('SYN-A1')),'event must not contain serials');
});
test('timeline detects verified field timestamp advancement but not unverified or older timestamps',()=>{
  const d=device({lastTelemetryAt:now});
  const old=cockpit.observeFields(d,fresh,now);
  d.telemetryFieldAt.battery=now-1000;
  let events=cockpit.timelineChanges(old,cockpit.observeFields(d,fresh,now),now);
  assert.deepEqual(events.map(x=>x.kind),['timestamp']);
  assert.equal(events[0].label,'Akku');
  d.telemetryFieldTimeVerified.battery=false;
  events=cockpit.timelineChanges(old,cockpit.observeFields(d,fresh,now),now);
  assert.equal(events[0].kind,'unverified','status transition takes precedence over timestamp event');
  d.telemetryFieldTimeVerified.battery=true;
  d.telemetryFieldAt.battery=now-5000;
  events=cockpit.timelineChanges(old,cockpit.observeFields(d,fresh,now),now);
  assert.equal(events.length,0,'older timestamp cannot be called an update');
  assert.equal(cockpit.observeFields(null,fresh,now),null);
  assert.equal(cockpit.TIMELINE_MAX,24);
});
test('timeline controls are local, bounded and explain observation limitations',()=>{
  const html=fs.readFileSync(path.resolve(__dirname,'../../frontend/public/index.html'),'utf8');
  const css=fs.readFileSync(path.resolve(__dirname,'../../frontend/public/hyperframes-gfx.css'),'utf8');
  for(const id of ['gfxCockpitTimeline','gfxTimelineClear','gfxTimelineEmpty','gfxTimelineList'])
    assert.ok(html.includes('id="'+id+'"'),id);
  assert.match(html,/kein Paket- oder Flugprotokoll/i);
  assert.match(css,/gfx-timeline-item/);
});

test('bounded field-observation digest separates stale transitions from timestamp updates',()=>{
  const d=device({lastTelemetryAt:now});
  const base=cockpit.observeFields(d,fresh,now);
  const aged=cockpit.observeFields(d,fresh,now+20000);
  const transitions=cockpit.timelineChanges(base,aged,now+20000);
  const s=cockpit.summarizeTimeline(transitions);
  assert.deepEqual([s.retained,s.staleTransitions,s.timestampAdvances,s.otherTransitions],
    [6,6,0,0]);
  assert.deepEqual(s.topStale.map(x=>x.key),['battery','altitude','horizontalSpeed']);
  assert.ok(transitions.every(x=>cockpit.SPECS.some(spec=>spec.key===x.key)));
  assert.deepEqual(cockpit.summarizeTimeline([]),{
    retained:0,staleTransitions:0,timestampAdvances:0,otherTransitions:0,topStale:[]
  });
});
test('repeated stale transitions count only within retained window and for known keys',()=>{
  const stale=(key,ts)=>({key,kind:'stale',
    label:'unused',message:'Aktuell → Veraltet',observedAt:ts});
  const step=(key,ts)=>({key,kind:'timestamp',label:'unused',
    message:'Verifizierter Feldzeitpunkt fortgeschrieben',observedAt:ts});
  const q=cockpit.summarizeTimeline([
    stale('altitude',now),stale('altitude',now+1000),
    stale('battery',now+2000),step('battery',now+3000),
    {key:'privateAccount',kind:'stale',message:'Aktuell → Veraltet',observedAt:now},
    {key:'heading',kind:'stale',message:'arbitrary untrusted message',observedAt:now}
  ]);
  assert.equal(q.retained,6);
  assert.equal(q.staleTransitions,3);
  assert.equal(q.timestampAdvances,1);
  assert.equal(q.otherTransitions,1);
  assert.deepEqual(q.topStale.map(x=>[x.label,x.count]),
    [['Höhe relativ',2],['Akku',1]]);
  assert.equal(cockpit.summarizeTimeline(Array.from({length:26},(_,i)=>stale('altitude',now+i))).retained,24);
  assert.equal(cockpit.summarizeTimeline(Array.from({length:26},(_,i)=>stale('altitude',now+i))).staleTransitions,24);
});
test('diagnostic digest documents bounded observations without packet-loss estimates',()=>{
  const html=fs.readFileSync(path.resolve(__dirname,'../../frontend/public/index.html'),'utf8');
  const css=fs.readFileSync(path.resolve(__dirname,'../../frontend/public/hyperframes-gfx.css'),'utf8');
  for(const id of ['gfxTimelineDigestTitle','gfxTimelineSummary','gfxTimelineTopEmpty','gfxTimelineTop']){
    assert.ok(html.includes('id="'+id+'"'),id);
  }
  assert.match(html,/Keine Fehlerhäufigkeit, Paketverlustquote/);
  assert.match(css,/gfx-timeline-digest/);
});
