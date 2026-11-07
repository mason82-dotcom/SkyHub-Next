'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {checkInlineScripts}=require('../../scripts/check-dashboard-inline');

test('dashboard inline JavaScript parses without executing the page',()=>{
  const filename=path.resolve(__dirname,'../../frontend/public/index.html');
  const html=fs.readFileSync(filename,'utf8');
  assert.equal(checkInlineScripts(html,{filename}),1);
});

test('inline checker ignores external scripts and rejects malformed JavaScript',()=>{
  const html='<script src="/app.js"></script><script>const = ;</script>';
  assert.throws(()=>checkInlineScripts(html),/inline script 1/);
});

test('inline checker rejects broken script markup',()=>{
  assert.throws(()=>checkInlineScripts('<script>let active=true;'),/unmatched script tag/);
});

test('dashboard references local field freshness helper before inline JS',()=>{
  const filename=path.resolve(__dirname,'../../frontend/public/index.html');
  const html=fs.readFileSync(filename,'utf8');
  assert.ok(html.indexOf('<script src="/telemetry-freshness.js"></script>')>0);
  assert.ok(html.indexOf('<script src="/telemetry-freshness.js"></script>')<
    html.indexOf('<script>'));
});

test('event panel displays unverified media and reported flight status without raw file fields',()=>{
  const html=fs.readFileSync(path.resolve(__dirname,'../../frontend/public/index.html'),'utf8');
  const start=html.indexOf('function normalizeDeviceEvent(event){');
  const end=html.indexOf('function renderEvents(',start);
  assert.ok(start>0 && end>start,'expected local read-only event adapter');
  // Test only the pure event adapter/label; never execute dashboard boot code.
  const view=vm.runInNewContext(html.slice(start,end)+
    '\n({normalizeDeviceEvent,eventDescription});',{
      eventChannels:new Set(['events','status','services_reply'])
    });
  const evt={sn:'DOCK1',channel:'events',method:'file_upload_callback',at:1760000000000,
    mediaReport:{kind:'file_metadata_report',storageVerification:'not_checked'},
    file:{name:'PRIVATE_IMAGE.JPG',object_key:'PRIVATE_OBJECT_X',secret:'PRIVATE_SECRET_X'}};
  const media=view.normalizeDeviceEvent(evt);
  assert.deepEqual(JSON.parse(JSON.stringify(media.mediaReport)),{kind:'file_metadata_report'});
  const label=view.eventDescription(media);
  assert.match(label,/Medien-Metadaten/);
  assert.match(label,/ungeprüft/);
  assert.doesNotMatch(JSON.stringify(media)+label,/PRIVATE_IMAGE|PRIVATE_OBJECT|PRIVATE_SECRET/);
  const flight=view.normalizeDeviceEvent({sn:'DOCK1',channel:'events',
    method:'flighttask_progress',at:1760000000001,
    missionReport:{reportedStatus:'failed',progressPercent:65,currentStep:26,
      flight_id:'PRIVATE_MISSION_X',latitude:49.1234}});
  assert.match(view.eventDescription(flight),/fehlgeschlagen/);
  assert.match(view.eventDescription(flight),/nicht verifiziert/);
  assert.doesNotMatch(JSON.stringify(flight),/PRIVATE_MISSION_X|49\.1234/);
  const fake=view.normalizeDeviceEvent({sn:'DOCK1',channel:'events',
    method:'flighttask_progress',at:1760000000002,
    missionReport:{reportedStatus:'ok',progressPercent:300,currentStep:26}});
  assert.equal(fake.missionReport,null);
});
