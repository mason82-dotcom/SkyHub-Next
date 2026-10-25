'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const planner=require('../../frontend/public/wpml-editor-core');
const {compareKmz}=require('../wpml-compare');

function plan(){
  return {
    name:'Private Pilot 2 & <Test> Mission',
    model:'mavic3m',speed:5,transitionSpeed:5,takeoffHeight:30,
    finishAction:'goHome',timestamp:1792573200000,
    waypoints:[
      {lat:49.12345,lon:8.56789,height:50,photo:false},
      {lat:49.12445,lon:8.56889,height:50,photo:false},
      {lat:49.12545,lon:8.56989,height:50,photo:false}
    ]
  };
}
const kmz=p=>Buffer.from(planner.build(p).kmz);

test('two identical DJI WPML KMZs are structurally equal without flight authorization',()=>{
  const a=kmz(plan()),report=compareKmz(a,a);
  assert.equal(report.summary.structuralDifferences,0);
  assert.equal(report.summary.structurallyEqualExcludingVolatileMetadata,true);
  assert.equal(report.summary.bothOfflineValid,true);
  assert.equal(report.summary.flightReady,false);
  assert.equal(report.summary.pilot2HardwareVerified,false);
  assert.equal(report.documents.length,2);
  assert.ok(report.documents.every(x=>x.equal));
  assert.equal(report.left.aircraftModel,'Mavic 3M');
  assert.deepEqual(report.left.waypointCounts,[3]);
});
test('timestamps and author/editor descriptions are ignored, but route speed is reported',()=>{
  const a=plan(),b=plan();
  b.timestamp+=10000;
  b.name='Another confidential author/location';
  assert.equal(compareKmz(kmz(a),kmz(b)).summary.structuralDifferences,0);
  b.speed=7;
  b.transitionSpeed=7;
  const diff=compareKmz(kmz(a),kmz(b));
  assert.ok(diff.summary.structuralDifferences>0);
  assert.ok(diff.documents.some(x=>x.changes.some(y=>y.path.endsWith('/wpml:autoFlightSpeed/#present')===false&&
    y.path.includes('autoFlightSpeed'))));
  assert.equal(diff.summary.bothOfflineValid,true);
  const serialized=JSON.stringify(diff);
  assert.doesNotMatch(serialized,/49\.12345|8\.56789|confidential author|Private Pilot/);
});
test('geographical waypoint changes show path, never raw coordinates',()=>{
  const a=plan(),b=plan();
  b.waypoints[1].lat=49.77777;
  b.waypoints[1].lon=8.33333;
  const diff=compareKmz(kmz(a),kmz(b));
  assert.ok(diff.documents.some(x=>x.changes.some(d=>d.category==='geometry')));
  const json=JSON.stringify(diff);
  assert.doesNotMatch(json,/49\.77777|8\.33333|49\.12445|8\.56889/);
  assert.match(json,/coordinates/);
  assert.match(json,/valuesRedacted/);
});
test('periodic DJI action group differences are detected and reported as actions',()=>{
  const a=plan(),b=plan();
  b.intervalPhotos={type:'multipleDistance',interval:12};
  const report=compareKmz(kmz(a),kmz(b));
  assert.ok(report.summary.structuralDifferences>0);
  assert.ok(report.documents[1].changedByCategory.actions>0);
  assert.equal(report.summary.flightReady,false);
  assert.equal(report.right.valid,true);
});
test('malformed and oversized KMZ input is rejected without content disclosure',()=>{
  const a=kmz(plan());
  assert.throws(()=>compareKmz(a,Buffer.from('private location')),/comparison rejected/);
  assert.throws(()=>compareKmz(Buffer.alloc(12*1024*1024+1),a),/comparison rejected/);
});
test('offline compare CLI has deterministic exit codes and omits raw location data',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'skyhub-wpml-compat-'));
  try{
    const left=path.join(dir,'original.kmz'),right=path.join(dir,'candidate.kmz');
    const script=path.join(__dirname,'../../scripts/wpml-compare.js');
    const a=plan(),b=plan();
    fs.writeFileSync(left,kmz(a));
    fs.writeFileSync(right,kmz(b));
    const run=(x,y)=>spawnSync(process.execPath,[script,x,y],{encoding:'utf8',timeout:15000});
    let proc=run(left,right);
    assert.equal(proc.status,0,proc.stderr);
    assert.equal(JSON.parse(proc.stdout).summary.structuralDifferences,0);
    b.waypoints[0].lat=49.22222;
    fs.writeFileSync(right,kmz(b));
    proc=run(left,right);
    assert.equal(proc.status,1,proc.stderr);
    assert.ok(JSON.parse(proc.stdout).summary.structuralDifferences>0);
    assert.doesNotMatch(proc.stdout,/49\.22222|49\.12345|Private Pilot/);
    fs.writeFileSync(right,Buffer.from('not a ZIP'));
    proc=run(left,right);
    assert.equal(proc.status,2);
    assert.doesNotMatch(proc.stderr,/49\.12345|Private Pilot|original\.kmz/);
    assert.equal(proc.stdout,'');
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('offline comparator neither network-connects nor initiates DJI flight/mission APIs',()=>{
  const code=fs.readFileSync(path.join(__dirname,'../wpml-compare.js'),'utf8');
  const cli=fs.readFileSync(path.join(__dirname,'../../scripts/wpml-compare.js'),'utf8');
  assert.doesNotMatch(code+cli,/\bfetch\s*\(|XMLHttpRequest|WebSocket|mqtt\.publish|\/api\/mission\/create/);
});

test('privacy-safe field-gap summary separates different values from absent fields',()=>{
  const left=plan(),right=plan();
  right.speed=7;
  right.transitionSpeed=7;
  const valuesOnly=compareKmz(kmz(left),kmz(right));
  assert.equal(valuesOnly.summary.leftOnlyFieldOccurrences,0);
  assert.equal(valuesOnly.summary.rightOnlyFieldOccurrences,0);
  assert.ok(valuesOnly.summary.changedValueOccurrences>0);
  assert.ok(valuesOnly.documents[1].patterns.entries.some(p=>
    p.path.includes('autoFlightSpeed')&&p.differentValues>0));
  right.intervalPhotos={type:'multipleDistance',interval:12};
  const added=compareKmz(kmz(left),kmz(right));
  assert.ok(added.summary.rightOnlyFieldOccurrences>0);
  assert.ok(added.documents[1].patterns.entries.some(p=>
    p.category==='actions'&&p.rightOnly>0));
  assert.equal(added.summary.structuralDifferences,
    added.summary.leftOnlyFieldOccurrences+added.summary.rightOnlyFieldOccurrences+
    added.summary.changedValueOccurrences);
});
test('repeated waypoint coordinate differences group into bounded generic index patterns',()=>{
  const left=plan(),right=plan();
  right.waypoints=right.waypoints.concat(
    Array.from({length:15},(_,i)=>({
      lat:49.1300+i*0.0001,lon:8.5700+i*0.0001,height:50,photo:false
    }))
  );
  const report=compareKmz(kmz(left),kmz(right));
  const d=report.documents[1];
  assert.ok(d.changesByDirection.rightOnly>0);
  assert.ok(d.patterns.total>0);
  assert.ok(d.patterns.displayed<=80);
  assert.ok(d.patterns.entries.some(p=>p.path.includes('[*]')));
  assert.ok(d.patterns.entries.some(p=>p.rightOnly>1));
  assert.equal(report.summary.flightReady,false);
});
test('malicious unknown XML tag and attribute names never appear in comparison output',()=>{
  const {packageKmz}=require('../wpml-kmz');
  const old=planner.documents(plan());
  const injected=old.waylinesXml.replace('</Placemark>',
    '<wpml:secret49.12345 data_private876.543="token">' +
    'hidden</wpml:secret49.12345></Placemark>');
  const reference=packageKmz(old.templateXml,old.waylinesXml);
  const candidate=packageKmz(old.templateXml,injected);
  const report=compareKmz(reference,candidate);
  const json=JSON.stringify(report);
  assert.equal(report.right.valid,true);
  assert.ok(report.summary.rightOnlyFieldOccurrences>0);
  assert.match(json,/\[unrecognized-element\]/);
  assert.match(json,/@\[attribute\]/);
  assert.doesNotMatch(json,/secret49\.12345|private876\.543|token|hidden/);
  assert.doesNotMatch(json,/49\.12345|8\.56789/);
});

test('focused --review output prioritizes DJI photo, lens and height mismatches without altering exit status',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'skyhub-wpml-review-'));
  try{
    const left=path.join(dir,'pilot2.kmz'),right=path.join(dir,'skyhub.kmz');
    const script=path.join(__dirname,'../../scripts/wpml-compare.js');
    const a=plan(),b=plan();
    b.waypoints[0].lat=49.22222;
    b.intervalPhotos={type:'multipleDistance',interval:12};
    fs.writeFileSync(left,kmz(a));
    fs.writeFileSync(right,kmz(b));
    const out=spawnSync(process.execPath,[script,'--review',left,right],
      {encoding:'utf8',timeout:15000});
    assert.equal(out.status,1,out.stderr);
    const parsed=JSON.parse(out.stdout);
    assert.equal(parsed.displayMode,'focused-review-not-complete-diff');
    assert.ok(parsed.summary.structuralDifferences>0);
    assert.ok(parsed.focusChanges[1].selectedPatterns.some(p=>p.category==='actions'));
    assert.equal(parsed.flightReady,false);
    assert.ok(parsed.warning.includes('hides geometry'));
    assert.doesNotMatch(out.stdout,/49\.22222|49\.12345|Private Pilot/);
    const same=spawnSync(process.execPath,[script,'--review',left,left],
      {encoding:'utf8',timeout:15000});
    assert.equal(same.status,0,same.stderr);
    assert.equal(JSON.parse(same.stdout).summary.structuralDifferences,0);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('semantic camera action inventory differentiates two reachPoint groups from one distance group',()=>{
  const individual=plan(),distance=plan(),timed=plan();
  individual.waypoints[0].photo=true;
  individual.waypoints[2].photo=true;
  distance.intervalPhotos={type:'multipleDistance',interval:12};
  timed.intervalPhotos={type:'multipleTiming',interval:3};
  const diff=compareKmz(kmz(individual),kmz(distance));
  assert.equal(diff.left.cameraActionSummary.actionGroupCount,2);
  assert.equal(diff.left.cameraActionSummary.actionCount,2);
  assert.equal(diff.left.cameraActionSummary.reachPointPhotoActions,2);
  assert.equal(diff.left.cameraActionSummary.triggerModes.reachPoint,2);
  assert.deepEqual(diff.left.cameraActionSummary.actionGroupsByWayline,[2]);
  assert.equal(diff.right.cameraActionSummary.actionGroupCount,1);
  assert.equal(diff.right.cameraActionSummary.actionCount,1);
  assert.equal(diff.right.cameraActionSummary.triggerModes.multipleDistance,1);
  assert.equal(diff.right.cameraActionSummary.periodicDistancePhotoActions,1);
  assert.equal(diff.right.cameraActionSummary.reachPointPhotoActions,0);
  assert.equal(diff.summary.cameraActionSummariesDiffer,true);
  assert.equal(diff.summary.pilot2HardwareVerified,false);
  const time=compareKmz(kmz(individual),kmz(timed));
  assert.equal(time.right.cameraActionSummary.triggerModes.multipleTiming,1);
  assert.equal(time.right.cameraActionSummary.periodicTimePhotoActions,1);
  assert.equal(time.right.cameraActionSummary.periodicDistancePhotoActions,0);
  assert.equal(time.right.cameraActionSummary.cameraHardwareVerified,false);
  const json=JSON.stringify(diff);
  assert.doesNotMatch(json,/49\.12345|8\.56789|Private Pilot/);
});
test('camera action inventory shows empty counts and equality on same KMZ',()=>{
  const zero=kmz(plan()),result=compareKmz(zero,zero);
  assert.deepEqual(result.left.cameraActionSummary.triggerModes,{});
  assert.deepEqual(result.left.cameraActionSummary.actuatorFunctions,{});
  assert.equal(result.left.cameraActionSummary.actionGroupCount,0);
  assert.equal(result.left.cameraActionSummary.actionCount,0);
  assert.equal(result.summary.cameraActionSummariesDiffer,false);
});
